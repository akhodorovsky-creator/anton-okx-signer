"use strict";
const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const OKX_BASE_URL = process.env.OKX_BASE_URL || "https://eea.okx.com";
const LIVE = String(process.env.LIVE || "false").toLowerCase() === "true";
const INST_ID = "BTC-EUR";
const BASE_CCY = "BTC";
const QUOTE_CCY = "EUR";
const ORDER_EUR = Math.min(Math.max(Number(process.env.MAX_ORDER_EUR || 20), 0), 20);
const TAKE_PROFIT = 0.05;
const STOP_LOSS = 0.02;
const ORDER_PREFIX = "ANTON";

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error("Missing environment variable: " + name);
  return value;
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 100000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function allowedPath(path) {
  return path.startsWith("/api/v5/account/") ||
    path.startsWith("/api/v5/trade/") ||
    path.startsWith("/api/v5/market/") ||
    path.startsWith("/api/v5/public/");
}
function isOrderPath(path) {
  return path === "/api/v5/trade/order" || path === "/api/v5/trade/batch-orders";
}
function orderId() {
  return ORDER_PREFIX + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
}
function logAutoResult(result) {
  const payload = {
    action: result && result.action || null,
    reason: result && result.reason || null,
    mode: result && result.mode || (LIVE ? "LIVE" : "DEMO"),
    price: result && result.price || null,
    position: result && result.position || null,
    orderEur: result && result.orderEur || null,
    minSz: result && result.minSz || null,
    estimatedMinEur: result && result.estimatedMinEur || null,
    availableEur: result && result.availableEur || null
  };
  console.log("ANTON_AUTO_RESULT " + JSON.stringify(payload));
}

async function okxRequest({ method = "GET", path, body }) {
  method = String(method).toUpperCase();
  if (!path || !path.startsWith("/api/v5/") || !allowedPath(path)) throw new Error("OKX path is not allowed");
  if (!["GET", "POST"].includes(method)) throw new Error("Method is not allowed");
  const timestamp = new Date().toISOString();
  const bodyText = method === "GET" || body == null ? "" : JSON.stringify(body);
  const signature = crypto.createHmac("sha256", required("OKX_SECRET_KEY"))
    .update(timestamp + method + path + bodyText).digest("base64");
  const headers = {
    "content-type": "application/json",
    "OK-ACCESS-KEY": required("OKX_API_KEY"),
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": required("OKX_PASSPHRASE")
  };
  if (!LIVE) headers["x-simulated-trading"] = "1";
  const response = await fetch(OKX_BASE_URL + path, {
    method, headers, body: bodyText || undefined, signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok || (data && data.code && data.code !== "0")) {
    throw new Error("OKX error: " + JSON.stringify(data));
  }
  return { httpStatus: response.status, data };
}

function deriveBotPosition(orders) {
  const unique = new Map();
  for (const o of orders) if (o && o.ordId) unique.set(o.ordId, o);
  const sorted = [...unique.values()]
    .filter(o => String(o.clOrdId || "").startsWith(ORDER_PREFIX))
    .sort((a, b) => Number(a.cTime || 0) - Number(b.cTime || 0));
  let qty = 0;
  let cost = 0;
  for (const o of sorted) {
    const filled = Number(o.accFillSz || 0);
    const price = Number(o.avgPx || o.fillPx || 0);
    if (!(filled > 0) || !(price > 0)) continue;
    if (o.side === "buy") {
      qty += filled;
      cost += filled * price;
    } else if (o.side === "sell") {
      const sold = Math.min(qty, filled);
      const avg = qty > 0 ? cost / qty : 0;
      qty -= sold;
      cost -= sold * avg;
      if (qty < 0.00000001) { qty = 0; cost = 0; }
    }
  }
  return { qty, entryPrice: qty > 0 ? cost / qty : 0 };
}

function botOrders(orders) {
  const unique = new Map();
  for (const order of orders) {
    if (order && order.ordId) unique.set(order.ordId, order);
  }
  return [...unique.values()]
    .filter(order => String(order.clOrdId || "").startsWith(ORDER_PREFIX))
    .sort((a, b) => Number(a.cTime || 0) - Number(b.cTime || 0));
}

function deriveBotPnl(orders, lastPrice) {
  let baseBalance = 0;
  let quoteBalance = 0;
  let filledOrders = 0;

  for (const order of botOrders(orders)) {
    const filled = Number(order.accFillSz || 0);
    const price = Number(order.avgPx || order.fillPx || 0);
    if (!(filled > 0) || !(price > 0)) continue;

    if (order.side === "buy") {
      baseBalance += filled;
      quoteBalance -= filled * price;
    } else if (order.side === "sell") {
      baseBalance -= filled;
      quoteBalance += filled * price;
    } else {
      continue;
    }

    const fee = Number(order.fee || 0);
    if (Number.isFinite(fee) && fee !== 0) {
      if (order.feeCcy === BASE_CCY) baseBalance += fee;
      else if (order.feeCcy === QUOTE_CCY) quoteBalance += fee;
    }
    filledOrders += 1;
  }

  if (Math.abs(baseBalance) < 0.00000001) baseBalance = 0;
  const pnlEur = quoteBalance + baseBalance * lastPrice;
  return { pnlEur, baseBalance, quoteBalance, filledOrders };
}

async function getBotOrders() {
  const q = "?instType=SPOT&instId=" + INST_ID + "&limit=100";
  const recent = await okxRequest({ path: "/api/v5/trade/orders-history" + q });
  let archive = { data: { data: [] } };
  try { archive = await okxRequest({ path: "/api/v5/trade/orders-history-archive" + q }); } catch {}
  return [...(archive.data.data || []), ...(recent.data.data || [])];
}

async function getBotPosition() {
  return deriveBotPosition(await getBotOrders());
}

async function getLastPrice() {
  const result = await okxRequest({ path: "/api/v5/market/ticker?instId=" + INST_ID });
  const price = Number(result.data.data && result.data.data[0] && result.data.data[0].last);
  if (!(price > 0)) throw new Error("Invalid BTC price");
  return price;
}

async function getAvailableBalance(ccy) {
  const result = await okxRequest({ path: "/api/v5/account/balance?ccy=" + ccy });
  const details = result.data.data && result.data.data[0] && result.data.data[0].details;
  const row = Array.isArray(details) ? details.find(x => x.ccy === ccy) : null;
  return Number(row && row.availBal || 0);
}

async function getInstrumentLimits() {
  const result = await okxRequest({ path: "/api/v5/public/instruments?instType=SPOT&instId=" + INST_ID });
  const row = result.data.data && result.data.data[0];
  const minSz = Number(row && row.minSz || 0);
  const lotSz = Number(row && row.lotSz || 0);
  if (!(minSz > 0)) throw new Error("Invalid OKX minimum size for " + INST_ID);
  return { minSz, lotSz };
}

async function getPnlSnapshot() {
  const [orders, price] = await Promise.all([getBotOrders(), getLastPrice()]);
  const position = deriveBotPosition(orders);
  const pnl = deriveBotPnl(orders, price);
  return {
    mode: LIVE ? "LIVE" : "DEMO",
    instrument: INST_ID,
    pnlEur: Number(pnl.pnlEur.toFixed(4)),
    price,
    position: {
      qty: pnl.baseBalance,
      entryPrice: position.entryPrice
    },
    filledOrders: pnl.filledOrders,
    updatedAt: new Date().toISOString()
  };
}

async function autoTrade(input) {
  if (LIVE && input.confirmLive !== true) throw new Error("confirmLive=true is required for live automation");
  const signal = String(input.signal || "HOLD").toUpperCase();
  const actionable = input.actionable === true || String(input.actionable).toLowerCase() === "true";
  const position = await getBotPosition();
  const price = await getLastPrice();

  if (position.qty > 0) {
    let reason = null;
    if (price >= position.entryPrice * (1 + TAKE_PROFIT)) reason = "TAKE_PROFIT_5_PERCENT";
    else if (price <= position.entryPrice * (1 - STOP_LOSS)) reason = "STOP_LOSS_2_PERCENT";
    else if (actionable && signal === "SELL") reason = "STRATEGY_SELL";
    if (!reason) return { action: "HOLD_POSITION", mode: LIVE ? "LIVE" : "DEMO", price, position };

    const available = await getAvailableBalance(BASE_CCY);
    const sellQty = Math.min(position.qty, available);
    if (!(sellQty > 0.00000001)) throw new Error("Bot position exists but available BTC is insufficient");
    const body = {
      instId: INST_ID, tdMode: "cash", side: "sell", ordType: "market",
      sz: sellQty.toFixed(8).replace(/0+$/, "").replace(/\.$/, ""),
      tgtCcy: "base_ccy", clOrdId: orderId(), tag: ORDER_PREFIX
    };
    const order = await okxRequest({ method: "POST", path: "/api/v5/trade/order", body });
    return { action: "SELL", reason, mode: LIVE ? "LIVE" : "DEMO", price, position, order: order.data };
  }

  if (!(actionable && signal === "BUY")) {
    return { action: "WAIT_FOR_BUY", mode: LIVE ? "LIVE" : "DEMO", price, position };
  }

  const [{ minSz }, availableEur] = await Promise.all([
    getInstrumentLimits(),
    getAvailableBalance(QUOTE_CCY)
  ]);
  const estimatedMinEur = Number((minSz * price * 1.02).toFixed(2));
  if (ORDER_EUR < estimatedMinEur) {
    return {
      action: "BLOCKED_MIN_SIZE",
      reason: "ORDER_BELOW_OKX_MINIMUM",
      mode: LIVE ? "LIVE" : "DEMO",
      price,
      position,
      orderEur: ORDER_EUR,
      minSz,
      estimatedMinEur
    };
  }
  if (availableEur + 1e-9 < ORDER_EUR) {
    return {
      action: "BLOCKED_INSUFFICIENT_EUR",
      reason: "AVAILABLE_EUR_BELOW_ORDER",
      mode: LIVE ? "LIVE" : "DEMO",
      price,
      position,
      orderEur: ORDER_EUR,
      availableEur
    };
  }

  const body = {
    instId: INST_ID, tdMode: "cash", side: "buy", ordType: "market",
    sz: String(ORDER_EUR), tgtCcy: "quote_ccy", clOrdId: orderId(), tag: ORDER_PREFIX
  };
  const order = await okxRequest({ method: "POST", path: "/api/v5/trade/order", body });
  return { action: "BUY", reason: "STRATEGY_BUY", mode: LIVE ? "LIVE" : "DEMO", price, position, orderEur: ORDER_EUR, order: order.data };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, live: LIVE, mode: LIVE ? "LIVE" : "DEMO", auto: true, orderEur: ORDER_EUR });
    }
    if (!safeEqual(req.headers.authorization, "Bearer " + required("SIGNER_TOKEN"))) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }
    if (req.method === "GET" && req.url === "/pnl") {
      return json(res, 200, { ok: true, ...(await getPnlSnapshot()) });
    }
    if (req.method !== "POST" || !["/okx", "/auto"].includes(req.url)) {
      return json(res, 404, { ok: false, error: "Not found" });
    }
    const input = await readBody(req);
    if (req.url === "/auto") {
      const result = await autoTrade(input);
      logAutoResult(result);
      return json(res, 200, { ok: true, ...result });
    }
    if (LIVE && isOrderPath(input.path) && input.confirmLive !== true) {
      return json(res, 400, { ok: false, error: "confirmLive=true is required for live orders" });
    }
    const result = await okxRequest(input);
    return json(res, result.httpStatus, { ok: true, mode: LIVE ? "LIVE" : "DEMO", ...result.data });
  } catch (error) {
    console.error("ANTON_REQUEST_ERROR " + JSON.stringify({ path: req.url, error: error.message }));
    return json(res, 400, { ok: false, error: error.message });
  }
});
server.listen(PORT, "0.0.0.0", () => console.log("ANTON OKX Signer " + (LIVE ? "LIVE" : "DEMO") + " on " + PORT));
