"use strict";

const { portfolio } = require("./multi-live");
const { isReconciledDust } = require("./frequency-policy");

const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_ALLOWED_CHAT_ID || "").trim();
const POLL_TIMEOUT = 25;
const WATCH_MS = 60_000;
const APPROVAL_WATCH_MS = 20_000;
const COORDINATOR_PORT = Number(process.env.PORT || 3000);
const SIGNER_TOKEN = String(process.env.SIGNER_TOKEN || "").trim();

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) + " EUR" : "—";
}
function number(value, digits = 8) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") : "—";
}
function isAllowed(chatId) {
  return Boolean(ALLOWED_CHAT_ID) && String(chatId) === ALLOWED_CHAT_ID;
}
async function api(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout((POLL_TIMEOUT + 10) * 1000)
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error("TELEGRAM_" + method + "_" + response.status);
  return data.result;
}
async function send(chatId, text) {
  return api("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}
async function sendProposal(chatId, proposal) {
  const side = proposal.side === "buy" ? "BUY" : "SELL";
  const amount = proposal.side === "buy" ? money(proposal.valueEur) : number(proposal.size) + " " + proposal.pair.split("-")[0];
  const text = [
    "ANTON Signal — подтверждение сделки",
    side + " " + proposal.pair,
    "Объём: " + amount,
    "Ориентир цены: " + money(proposal.price),
    "Причина: " + proposal.reason,
    "Тип: рыночный ордер",
    "Действует до: " + new Date(proposal.expiresAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Berlin" })
  ].join("\n");
  return api("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[
      { text: "Подтвердить", callback_data: "trade:approve:" + proposal.id },
      { text: "Отклонить", callback_data: "trade:reject:" + proposal.id }
    ]] }
  });
}
async function coordinator(method, path, body) {
  if (!SIGNER_TOKEN) throw new Error("SIGNER_TOKEN_MISSING");
  const response = await fetch("http://127.0.0.1:" + COORDINATOR_PORT + path, {
    method,
    headers: { authorization: "Bearer " + SIGNER_TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(data.error || ("COORDINATOR_" + response.status));
  return data;
}
function parseTradeCallback(data) {
  const match = String(data || "").match(/^trade:(approve|reject):([A-Za-z0-9_-]{8,32})$/);
  return match ? { decision: match[1], id: match[2] } : null;
}
function summary(book) {
  const open = book.pairs.filter(p => Number(p.qty) > 1e-9 && !isReconciledDust(p));
  return [
    "ANTON Signal",
    "Режим: " + book.mode,
    "P&L: " + money(book.pnlEur),
    "Открыто: " + money(book.exposureEur),
    "Свободно: " + money(book.availableEur),
    "Исполнено ордеров: " + book.filledOrders,
    "Позиции: " + (open.length ? open.map(p => p.pair).join(", ") : "нет"),
    "Обновлено: " + new Date(book.updatedAt).toLocaleString("ru-RU", { timeZone: "Europe/Berlin" })
  ].join("\n");
}
function positions(book) {
  const rows = book.pairs.map(p => {
    const state = isReconciledDust(p) ? "технический остаток" : (Number(p.qty) > 1e-9 ? "В ПОЗИЦИИ" : "нет");
    return [
      p.pair + " — " + state,
      "  цена: " + money(p.price),
      "  qty: " + number(p.qty),
      "  стоимость: " + money(p.exposure),
      "  P&L: " + money(p.pnlEur)
    ].join("\n");
  });
  return rows.join("\n\n");
}
function helpText() {
  return [
    "ANTON Signal Telegram",
    "/status — состояние бота",
    "/profit — текущий P&L",
    "/balance — свободные EUR",
    "/positions — позиции по парам",
    "/trades — число исполненных ордеров",
    "/chatid — показать ID этого чата",
    "/help — команды",
    "",
    "Новые сделки: бот присылает предложение с кнопками подтверждения.",
    "Без нажатия «Подтвердить» реальный ордер не отправляется."
  ].join("\n");
}
async function handleMessage(message) {
  const chatId = message?.chat?.id;
  if (chatId == null) return;
  const command = String(message.text || "").trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  if (command === "/chatid") return send(chatId, "Chat ID: " + chatId);
  if (command === "/start" || command === "/help") {
    if (!isAllowed(chatId)) {
      return send(chatId, "Этот чат пока не авторизован.\nChat ID: " + chatId + "\nДобавьте его в Railway как TELEGRAM_ALLOWED_CHAT_ID.");
    }
    return send(chatId, helpText());
  }
  if (!isAllowed(chatId)) return send(chatId, "Доступ запрещён. Chat ID: " + chatId);
  if (!["/status", "/profit", "/balance", "/positions", "/trades"].includes(command)) return send(chatId, helpText());

  const book = await portfolio();
  if (command === "/status") return send(chatId, summary(book));
  if (command === "/profit") return send(chatId, "Текущий P&L: " + money(book.pnlEur));
  if (command === "/balance") return send(chatId, "Свободно EUR на OKX: " + money(book.availableEur));
  if (command === "/positions") return send(chatId, positions(book));
  if (command === "/trades") return send(chatId, "Исполнено ордеров ANTON: " + book.filledOrders);
}
async function handleCallback(query) {
  const chatId = query?.message?.chat?.id;
  if (query?.id) {
    try { await api("answerCallbackQuery", { callback_query_id: query.id, text: "Проверяю предложение…" }); } catch {}
  }
  if (chatId == null || !isAllowed(chatId)) return;
  const action = parseTradeCallback(query.data);
  if (!action) return send(chatId, "Неизвестная команда подтверждения.");
  try {
    const result = await coordinator("POST", "/trade-approval", action);
    if (query?.message?.message_id != null) {
      try { await api("editMessageReplyMarkup", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch {}
    }
    if (result.rejected) return send(chatId, "Сделка отклонена.");
    const side = result.side === "buy" ? "BUY" : "SELL";
    return send(chatId, "Ордер подтверждён и отправлен: " + side + " " + result.pair + "\nOrder ID: " + result.orderId);
  } catch (error) {
    return send(chatId, "Ордер не отправлен: " + error.message);
  }
}
function fingerprint(book) {
  return JSON.stringify({
    filledOrders: book.filledOrders,
    positions: book.pairs.map(p => [p.pair, Number(p.qty) > 1e-9 && !isReconciledDust(p)])
  });
}
async function watchApprovals() {
  if (!ALLOWED_CHAT_ID || !SIGNER_TOKEN) return;
  let lastSent = null;
  const once = async () => {
    try {
      const data = await coordinator("GET", "/trade-proposal");
      const proposal = data.proposal;
      if (!proposal) return;
      if (proposal.id === lastSent) return;
      await sendProposal(ALLOWED_CHAT_ID, proposal);
      lastSent = proposal.id;
    } catch (error) {
      console.error("ANTON_TELEGRAM_APPROVAL_WATCH_ERROR " + error.message);
    }
  };
  const first = setTimeout(() => once().catch(e => console.error("ANTON_TELEGRAM_APPROVAL_WATCH_START_ERROR " + e.message)), 12_000);
  first.unref();
  setInterval(once, APPROVAL_WATCH_MS).unref();
}
async function watch() {
  if (!ALLOWED_CHAT_ID) return;
  let last = null;
  let lastErrorAt = 0;
  const once = async () => {
    try {
      const book = await portfolio();
      const current = fingerprint(book);
      if (last !== null && current !== last) await send(ALLOWED_CHAT_ID, "Изменение в ANTON Signal\n\n" + summary(book));
      last = current;
    } catch (error) {
      const now = Date.now();
      if (now - lastErrorAt > 15 * 60_000) {
        lastErrorAt = now;
        try { await send(ALLOWED_CHAT_ID, "ANTON Signal: ошибка мониторинга Telegram. Основной торговый процесс не остановлен."); } catch {}
      }
      console.error("ANTON_TELEGRAM_WATCH_ERROR " + error.message);
    }
  };
  const first = setTimeout(() => once().catch(e => console.error("ANTON_TELEGRAM_WATCH_START_ERROR " + e.message)), 15_000);
  first.unref();
  setInterval(once, WATCH_MS).unref();
}
async function run() {
  if (!TOKEN) {
    console.log("ANTON_TELEGRAM_DISABLED TELEGRAM_BOT_TOKEN_MISSING");
    return;
  }
  console.log("ANTON_TELEGRAM_READY " + JSON.stringify({restricted: Boolean(ALLOWED_CHAT_ID)}));
  watch().catch(e => console.error("ANTON_TELEGRAM_WATCH_START_ERROR " + e.message));
  watchApprovals().catch(e => console.error("ANTON_TELEGRAM_APPROVAL_WATCH_START_ERROR " + e.message));
  let offset = 0;
  for (;;) {
    try {
      const updates = await api("getUpdates", {
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: ["message", "callback_query"]
      });
      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        try {
          if (update.callback_query) await handleCallback(update.callback_query);
          else await handleMessage(update.message);
        }
        catch (error) {
          console.error("ANTON_TELEGRAM_MESSAGE_ERROR " + error.message);
          const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
          if (chatId != null && isAllowed(chatId)) {
            try { await send(chatId, "Не удалось обработать команду ANTON Signal."); } catch {}
          }
        }
      }
    } catch (error) {
      console.error("ANTON_TELEGRAM_POLL_ERROR " + error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
if (require.main === module) run().catch(e => {
  console.error("ANTON_TELEGRAM_FATAL " + e.message);
  process.exitCode = 1;
});
module.exports = { summary, positions, fingerprint, handleMessage, handleCallback, parseTradeCallback };
