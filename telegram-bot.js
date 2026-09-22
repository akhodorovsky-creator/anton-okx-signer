"use strict";

const { portfolio } = require("./multi-live");

const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_ALLOWED_CHAT_ID || "").trim();
const POLL_TIMEOUT = 25;
const WATCH_MS = 60_000;

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
function summary(book) {
  const open = book.pairs.filter(p => Number(p.qty) > 1e-9);
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
    const state = Number(p.qty) > 1e-9 ? "В ПОЗИЦИИ" : "нет";
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
    "Торговых команд BUY/SELL здесь нет."
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
function fingerprint(book) {
  return JSON.stringify({
    filledOrders: book.filledOrders,
    positions: book.pairs.map(p => [p.pair, Number(p.qty) > 1e-9])
  });
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
  await once();
  setInterval(once, WATCH_MS).unref();
}
async function run() {
  if (!TOKEN) {
    console.log("ANTON_TELEGRAM_DISABLED TELEGRAM_BOT_TOKEN_MISSING");
    return;
  }
  console.log("ANTON_TELEGRAM_READY " + JSON.stringify({restricted: Boolean(ALLOWED_CHAT_ID)}));
  watch().catch(e => console.error("ANTON_TELEGRAM_WATCH_START_ERROR " + e.message));
  let offset = 0;
  for (;;) {
    try {
      const updates = await api("getUpdates", {
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: ["message"]
      });
      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        try { await handleMessage(update.message); }
        catch (error) {
          console.error("ANTON_TELEGRAM_MESSAGE_ERROR " + error.message);
          const chatId = update.message?.chat?.id;
          if (chatId != null && isAllowed(chatId)) {
            try { await send(chatId, "Не удалось получить данные ANTON Signal."); } catch {}
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
module.exports = { summary, positions, fingerprint, handleMessage };
