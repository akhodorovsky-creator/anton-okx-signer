"use strict";

// Railway exposes only this gateway's PORT. The existing signer runs on an internal port.
// This file adds server-side risk controls independently of the n8n workflow editor.
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = PUBLIC_PORT + 1;
const MAX_BODY_BYTES = 64 * 1024;
const CAPITAL_CAP_EUR = 200;
const MAX_ORDER_EUR = Math.min(20, Math.max(0, Number(process.env.MAX_ORDER_EUR || 20)));
const MAX_SIGNAL_AGE_SECONDS = Math.max(60, Math.min(3600, Number(process.env.MAX_SIGNAL_AGE_SECONDS || 900)));
const DASHBOARD_TOKEN = String(process.env.DASHBOARD_TOKEN || "");
const LIVE_AUTOMATION_ENABLED =
  String(process.env.LIVE_ENABLED || "").toLowerCase() === "true" ||
  String(process.env.LIVE || "").toLowerCase() === "true";
let autoBusy = false;

function respond(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function respondHtml(res, status, body) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer"
  });
  res.end(body);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function dashboardAuthorized(req) {
  if (!DASHBOARD_TOKEN) return false;
  const url = new URL(req.url || "/", "http://127.0.0.1");
  return safeEqual(url.searchParams.get("key"), DASHBOARD_TOKEN);
}

function currentSignal(input, now = Date.now()) {
  const nestedAuto = input && input.autoRequest && typeof input.autoRequest === "object" && !Array.isArray(input.autoRequest)
    ? input.autoRequest
    : null;
  const normalized = nestedAuto ? { ...input, ...nestedAuto } : input;
  const signal = String(normalized.signal || "HOLD").toUpperCase();
  const requested = normalized.actionable === true || String(normalized.actionable || "").toLowerCase() === "true";
  const signalTimestamp = normalized.signalTimestamp || normalized.timestamp || null;
  const age = Date.parse(signalTimestamp);
  const fresh = Number.isFinite(age) && age <= now + 60_000 && age >= now - MAX_SIGNAL_AGE_SECONDS * 1000;
  const quality = normalized.dataQuality && typeof normalized.dataQuality === "object" ? normalized.dataQuality : {};
  const liveConfirmed = normalized.confirmLive === true || LIVE_AUTOMATION_ENABLED;

  // Relaxed live-entry gate: politics-v2 metadata and canOpenPosition are advisory,
  // not hard blockers. A live BUY still requires an explicit actionable BUY,
  // fresh market inputs, a fresh timestamp, and the existing server-side capital cap.
  const baseValid = liveConfirmed && requested && quality.marketInputsFresh === true && fresh;
  const buyValid = baseValid && signal === "BUY";
  const sellValid = baseValid && signal === "SELL";

  // Returning HOLD still invokes the signer's server-side TP/SL checks on open positions.
  return {
    ...normalized,
    signal: buyValid || sellValid ? signal : "HOLD",
    actionable: buyValid || sellValid,
    confirmLive: liveConfirmed,
    signalTimestamp
  };
}

function forward(req, res, body) {
  return new Promise((resolve, reject) => {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: INTERNAL_PORT,
      path: req.url,
      method: req.method,
      headers: {
        authorization: req.headers.authorization || "",
        "content-type": "application/json",
        ...(body ? { "content-length": Buffer.byteLength(body) } : {})
      },
      timeout: 75000
    }, reply => {
      res.writeHead(reply.statusCode || 502, {
        "content-type": reply.headers["content-type"] || "application/json",
        "cache-control": "no-store"
      });
      reply.pipe(res);
      reply.once("end", resolve);
      reply.once("error", reject);
    });
    upstream.once("timeout", () => upstream.destroy(new Error("Signer timeout")));
    upstream.once("error", reject);
    upstream.end(body || undefined);
  });
}

async function internalJson(pathname, method = "GET", body = null) {
  const signerToken = String(process.env.SIGNER_TOKEN || "");
  if (!signerToken) throw new Error("SIGNER_TOKEN is missing");
  const response = await fetch(`http://127.0.0.1:${INTERNAL_PORT}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${signerToken}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000)
  });
  const data = await response.json();
  if (!response.ok || data?.ok !== true) throw new Error(String(data?.error || `HTTP ${response.status}`));
  return data;
}

async function getDashboardSnapshot() {
  const [pnl, balance, orders] = await Promise.all([
    internalJson("/pnl"),
    internalJson("/okx", "POST", { method: "GET", path: "/api/v5/account/balance?ccy=EUR" }),
    internalJson("/okx", "POST", { method: "GET", path: "/api/v5/trade/orders-history?instType=SPOT&instId=BTC-EUR&limit=20" })
  ]);

  const details = Array.isArray(balance?.data?.[0]?.details) ? balance.data[0].details : [];
  const eurRow = details.find(row => row && row.ccy === "EUR");
  const availableEur = Number(eurRow?.availBal || 0);

  const recentTrades = (Array.isArray(orders?.data) ? orders.data : [])
    .filter(order => String(order?.clOrdId || "").startsWith("ANTON"))
    .filter(order => Number(order?.accFillSz || 0) > 0)
    .sort((a, b) => Number(b.cTime || 0) - Number(a.cTime || 0))
    .slice(0, 8)
    .map(order => {
      const qty = Number(order.accFillSz || 0);
      const price = Number(order.avgPx || order.fillPx || 0);
      return {
        side: String(order.side || "").toUpperCase(),
        qty,
        price,
        valueEur: qty > 0 && price > 0 ? Number((qty * price).toFixed(2)) : null,
        fee: Number(order.fee || 0),
        feeCcy: order.feeCcy || null,
        time: Number.isFinite(Number(order.cTime)) ? new Date(Number(order.cTime)).toISOString() : null
      };
    });

  const qty = Number(pnl?.position?.qty || 0);
  const price = Number(pnl?.price || 0);
  const pnlEur = Number(pnl?.pnlEur || 0);
  const positionValueEur = qty > 0 && price > 0 ? qty * price : 0;
  return {
    ok: true,
    mode: pnl.mode,
    instrument: pnl.instrument,
    state: qty > 0 ? "POSITION_OPEN" : "WAITING_FOR_BUY",
    budgetEur: CAPITAL_CAP_EUR,
    estimatedBotEquityEur: Number((CAPITAL_CAP_EUR + pnlEur).toFixed(2)),
    pnlEur: Number(pnlEur.toFixed(4)),
    availableEur: Number(availableEur.toFixed(2)),
    price,
    positionQty: qty,
    entryPrice: Number(pnl?.position?.entryPrice || 0),
    positionValueEur: Number(positionValueEur.toFixed(2)),
    filledOrders: Number(pnl?.filledOrders || 0),
    recentTrades,
    updatedAt: pnl.updatedAt || new Date().toISOString()
  };
}

function dashboardPage() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ANTON Signal — LIVE</title>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0f14;color:#eef3f8}main{max-width:880px;margin:auto;padding:18px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}.title{font-size:24px;font-weight:800}.pill{padding:7px 11px;border-radius:999px;background:#17202b;font-size:13px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{background:#121923;border:1px solid #263140;border-radius:16px;padding:15px}.label{font-size:12px;color:#9fb0c3;margin-bottom:5px}.value{font-size:26px;font-weight:800;word-break:break-word}.small{font-size:14px}.good{color:#73e29a}.bad{color:#ff8d8d}.muted{color:#9fb0c3}h2{font-size:17px;margin:22px 0 10px}table{width:100%;border-collapse:collapse;background:#121923;border:1px solid #263140;border-radius:14px;overflow:hidden}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #263140;font-size:13px}th{color:#9fb0c3;font-weight:600}tr:last-child td{border-bottom:0}.status{font-weight:800}#err{display:none;background:#3a1717;border:1px solid #743232;padding:12px;border-radius:12px;margin-bottom:12px}@media(max-width:620px){.grid{grid-template-columns:1fr}.value{font-size:23px}main{padding:12px}th:nth-child(2),td:nth-child(2){display:none}}
</style>
</head>
<body><main>
<div class="top"><div><div class="title">ANTON Signal</div><div class="muted small">BTC-EUR · автоматическая торговля</div></div><div class="pill" id="mode">…</div></div>
<div id="err"></div>
<div class="grid">
  <div class="card"><div class="label">Расчётный капитал бота</div><div class="value" id="equity">—</div><div class="muted small">бюджет 200 € + результат торговли</div></div>
  <div class="card"><div class="label">Прибыль / убыток</div><div class="value" id="pnl">—</div><div class="muted small" id="orders">—</div></div>
  <div class="card"><div class="label">Состояние</div><div class="value status" id="state">—</div><div class="muted small">обновление каждые 15 секунд</div></div>
  <div class="card"><div class="label">BTC / EUR сейчас</div><div class="value" id="price">—</div><div class="muted small" id="updated">—</div></div>
  <div class="card"><div class="label">Позиция BTC</div><div class="value" id="qty">—</div><div class="muted small" id="positionValue">—</div></div>
  <div class="card"><div class="label">Цена входа</div><div class="value" id="entry">—</div><div class="muted small" id="cash">—</div></div>
</div>
<h2>Последние сделки бота</h2>
<table><thead><tr><th>Время</th><th>Операция</th><th>Сумма</th><th>Цена</th></tr></thead><tbody id="trades"><tr><td colspan="4" class="muted">Пока сделок нет</td></tr></tbody></table>
</main>
<script>
const key=new URLSearchParams(location.search).get('key')||'';
const eur=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
const num=(n,d=6)=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:d}).format(Number(n||0));
const when=s=>s?new Date(s).toLocaleString('ru-RU'): '—';
async function refresh(){
  try{
    const r=await fetch('/dashboard-data?key='+encodeURIComponent(key),{cache:'no-store'});
    const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||'Ошибка данных');
    document.getElementById('err').style.display='none';
    document.getElementById('mode').textContent=d.mode+' · '+d.instrument;
    document.getElementById('equity').textContent=eur(d.estimatedBotEquityEur);
    const p=document.getElementById('pnl'); p.textContent=(d.pnlEur>=0?'+':'')+eur(d.pnlEur); p.className='value '+(d.pnlEur>=0?'good':'bad');
    document.getElementById('orders').textContent='Исполнено ордеров: '+d.filledOrders;
    document.getElementById('state').textContent=d.state==='POSITION_OPEN'?'ПОЗИЦИЯ ОТКРЫТА':'ЖДЁМ BUY';
    document.getElementById('price').textContent=eur(d.price);
    document.getElementById('updated').textContent='Обновлено: '+when(d.updatedAt);
    document.getElementById('qty').textContent=num(d.positionQty,8)+' BTC';
    document.getElementById('positionValue').textContent='Стоимость позиции: '+eur(d.positionValueEur);
    document.getElementById('entry').textContent=d.entryPrice>0?eur(d.entryPrice):'—';
    document.getElementById('cash').textContent='Свободно EUR на OKX: '+eur(d.availableEur);
    const tb=document.getElementById('trades');
    if(!d.recentTrades.length){tb.innerHTML='<tr><td colspan="4" class="muted">Пока сделок нет</td></tr>';}
    else tb.innerHTML=d.recentTrades.map(t=>'<tr><td>'+when(t.time)+'</td><td class="'+(t.side==='BUY'?'good':'bad')+'">'+t.side+'</td><td>'+eur(t.valueEur)+'</td><td>'+eur(t.price)+'</td></tr>').join('');
  }catch(e){const x=document.getElementById('err');x.textContent='Не удалось обновить: '+e.message;x.style.display='block';}
}
refresh(); setInterval(refresh,15000);
</script></body></html>`;
}

async function positionWithinCapitalCap(authorization) {
  const response = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/pnl`, {
    headers: { authorization: authorization || "" }, signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) return false;
  const data = await response.json();
  const qty = Number(data?.position?.qty);
  const price = Number(data?.price);
  if (!Number.isFinite(qty) || qty < 0 || !(price > 0) || !(MAX_ORDER_EUR > 0)) return false;
  return qty * price + MAX_ORDER_EUR <= CAPITAL_CAP_EUR;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const result = JSON.parse(text || "{}");
  if (!result || Array.isArray(result) || typeof result !== "object") throw new Error("Expected JSON object");
  return result;
}

const server = http.createServer(async (req, res) => {
  const route = (req.url || "").split("?")[0];

  if (route === "/dashboard" && req.method === "GET") {
    if (!dashboardAuthorized(req)) return respondHtml(res, 401, "<h1>401</h1><p>Неверная ссылка панели.</p>");
    return respondHtml(res, 200, dashboardPage());
  }
  if (route === "/dashboard-data" && req.method === "GET") {
    if (!dashboardAuthorized(req)) return respond(res, 401, { ok: false, error: "Unauthorized" });
    try { return respond(res, 200, await getDashboardSnapshot()); }
    catch (error) {
      console.error("ANTON_DASHBOARD_ERROR", error.message);
      return respond(res, 502, { ok: false, error: "Dashboard data temporarily unavailable" });
    }
  }

  // Never expose the signer's unrestricted POST /okx pass-through: it bypasses
  // position tracking, spot-only automation and maximum order checks.
  if (route === "/okx" && req.method === "POST") {
    return respond(res, 403, { ok: false, error: "Raw OKX writes disabled; use guarded /auto" });
  }
  if (route !== "/auto" || req.method !== "POST") {
    try { await forward(req, res); }
    catch (error) {
      console.error("ANTON_GATEWAY_UPSTREAM_ERROR", error.message);
      if (!res.headersSent) respond(res, 502, { ok: false, error: "Signer temporarily unavailable" });
      else res.destroy();
    }
    return;
  }
  if (autoBusy) return respond(res, 409, { ok: false, error: "Automation already processing a request" });
  autoBusy = true;
  try {
    const incoming = await readJson(req);
    const safeInput = currentSignal(incoming);
    if (safeInput.signal === "BUY") {
      // Fail closed on missing history, invalid prices or an exhausted capital cap.
      let withinCap = false;
      try { withinCap = await positionWithinCapitalCap(req.headers.authorization); }
      catch (error) { console.error("ANTON_CAP_CHECK_ERROR", error.message); }
      if (!withinCap) {
        safeInput.signal = "HOLD";
        safeInput.actionable = false;
        console.warn("ANTON_GATEWAY_BUY_BLOCKED: capital cap or unreadable position");
      }
    }
    const incomingSignal = String(
      incoming?.autoRequest?.signal ?? incoming?.signal ?? "HOLD"
    ).toUpperCase();
    if (incomingSignal === "BUY" && safeInput.signal !== "BUY") {
      console.warn("ANTON_GATEWAY_BUY_BLOCKED: missing/stale actionable market evidence or capital limit");
    }
    await forward(req, res, JSON.stringify(safeInput));
  } catch (error) {
    console.error("ANTON_GATEWAY_ERROR", error.message);
    if (!res.headersSent) respond(res, 400, { ok: false, error: "Invalid request or signer unavailable" });
    else res.destroy();
  } finally {
    autoBusy = false;
  }
});

if (require.main === module) {
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(INTERNAL_PORT) }, stdio: "inherit"
  });
  child.once("exit", (code, signal) => {
    console.error("ANTON_SIGNER_EXIT", { code, signal });
    process.exit(code || 1);
  });
  const shutdown = signal => { child.kill(signal); server.close(); };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  server.listen(PUBLIC_PORT, "0.0.0.0", () =>
    console.log("ANTON safety gateway listening on " + PUBLIC_PORT + "; internal signer on " + INTERNAL_PORT));
}

module.exports = { currentSignal };
