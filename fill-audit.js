"use strict";
// Independent, READ-ONLY accounting of ANTON spot fills. This module NEVER submits orders.
// It is deliberately not wired into the live trading loop or production dashboard.
const PAIRS = Object.freeze(["BTC-EUR", "ETH-EUR", "DOGE-EUR"]);
const BOT_START = Date.parse("2026-09-01T00:00:00Z");
const LIMIT = 100;
const MAX_PAGES = 30;
const num = (value, field) => {
  if (value == null || value === "" || typeof value === "boolean") throw Error("MISSING_" + field);
  const result = Number(value);
  if (!Number.isFinite(result)) throw Error("INVALID_" + field);
  return result;
};
const id = (value, field) => {
  if (!/^\d+$/.test(String(value || ""))) throw Error("INVALID_" + field);
  return String(value);
};

async function paginate(read, endpoint, pair, key, maxPages = MAX_PAGES) {
  if (typeof read !== "function" || !/^\/(?:api\/v5\/trade\/)/.test(endpoint) || !PAIRS.includes(pair)) throw Error("UNSAFE_PAGINATION_REQUEST");
  const all = [];
  const seen = new Set();
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    const query = `${endpoint}?instType=SPOT&instId=${pair}&limit=${LIMIT}` + (after ? `&after=${after}` : "");
    const rows = await read(query);
    if (!Array.isArray(rows) || rows.length > LIMIT) throw Error("BAD_HISTORY_PAGE");
    if (!rows.length) return all;
    let last = null;
    for (const row of rows) {
      const cursor = id(row[key], "HISTORY_CURSOR");
      if (after && BigInt(cursor) >= BigInt(after)) throw Error("NONMONOTONIC_HISTORY");
      if (last && BigInt(cursor) >= BigInt(last)) throw Error("UNSORTED_HISTORY");
      if (seen.has(cursor)) throw Error("DUPLICATE_HISTORY_CURSOR");
      seen.add(cursor);
      all.push(row);
      last = cursor;
    }
    if (rows.length < LIMIT) return all;
    after = last;
  }
  throw Error("HISTORY_PAGE_LIMIT_REACHED");
}

function distinctOrders(recent, archive) {
  const byId = new Map();
  for (const order of [...archive, ...recent]) {
    if (!String(order.clOrdId || "").startsWith("ANTON")) continue;
    const key = id(order.ordId, "ORDER_ID");
    const old = byId.get(key);
    if (old && (old.instId !== order.instId || old.side !== order.side || old.clOrdId !== order.clOrdId)) throw Error("ORDER_ID_CONFLICT");
    if (!old || num(order.uTime || order.cTime, "ORDER_TIME") >= num(old.uTime || old.cTime, "ORDER_TIME")) byId.set(key, order);
  }
  return [...byId.values()];
}

function calculate(pair, orders, fills, price) {
  if (!PAIRS.includes(pair)) throw Error("UNKNOWN_PAIR");
  const mark = num(price, "MARK_PRICE");
  if (!(mark > 0)) throw Error("INVALID_MARK_PRICE");
  const base = pair.split("-")[0];
  const map = new Map(orders.map(o => [id(o.ordId, "ORDER_ID"), o]));
  const seenBill = new Set();
  const seenTrade = new Set();
  const selected = [];
  for (const fill of fills) {
    if (fill.instId !== pair) throw Error("WRONG_PAIR_FILL");
    const ordId = id(fill.ordId, "FILL_ORDER_ID");
    const o = map.get(ordId);
    if (!o) {
      if (String(fill.clOrdId || "").startsWith("ANTON")) throw Error("MISSING_BOT_ORDER");
      continue; // Other user's trades must not contaminate ANTON accounting.
    }
    if (fill.clOrdId && fill.clOrdId !== o.clOrdId) throw Error("FILL_ORDER_MISMATCH");
    if (fill.side !== o.side || o.instId !== pair) throw Error("FILL_SIDE_MISMATCH");
    const bill = id(fill.billId, "BILL_ID");
    const trade = id(fill.tradeId, "TRADE_ID");
    if (seenBill.has(bill) || seenTrade.has(trade)) throw Error("DUPLICATE_FILL");
    seenBill.add(bill); seenTrade.add(trade);
    selected.push(fill);
  }
  const totals = new Map();
  for (const fill of selected) totals.set(fill.ordId, (totals.get(fill.ordId) || 0) + num(fill.fillSz, "FILL_SIZE"));
  for (const order of orders) {
    const expected = num(order.accFillSz, "ORDER_ACC_FILL");
    const actual = totals.get(String(order.ordId)) || 0;
    if (expected < 0 || Math.abs(expected - actual) > Math.max(1e-9, expected * 1e-7)) throw Error("ORDER_FILL_MISMATCH_" + order.ordId);
  }
  selected.sort((a, b) => num(a.fillTime, "FILL_TIME") - num(b.fillTime, "FILL_TIME") || (BigInt(a.billId) < BigInt(b.billId) ? -1 : 1));
  let quantity = 0, basis = 0, realized = 0, cash = 0;
  for (const fill of selected) {
    const size = num(fill.fillSz, "FILL_SIZE");
    const px = num(fill.fillPx, "FILL_PRICE");
    const fee = num(fill.fee, "FEE");
    if (!(size > 0) || !(px > 0)) throw Error("INVALID_EXECUTION");
    const feeCcy = String(fill.feeCcy || "");
    if (feeCcy !== "EUR" && feeCcy !== base && fee !== 0) throw Error("UNPRICED_FEE_CURRENCY_" + feeCcy);
    const baseFee = feeCcy === base ? fee : 0;
    const euroFee = feeCcy === "EUR" ? fee : 0;
    if (fill.side === "buy") {
      const received = size + baseFee;
      if (!(received > 0)) throw Error("INVALID_BUY_NET_AMOUNT");
      const spent = size * px - euroFee;
      quantity += received;
      basis += spent;
      cash -= spent;
    } else if (fill.side === "sell") {
      const removed = size - baseFee;
      if (!(removed > 0) || removed > quantity + 1e-8) throw Error("SELL_WITHOUT_BOT_INVENTORY");
      const proportionalCost = basis * Math.min(1, removed / quantity);
      const proceeds = size * px + euroFee;
      realized += proceeds - proportionalCost;
      cash += proceeds;
      basis = Math.max(0, basis - proportionalCost);
      quantity = Math.max(0, quantity - removed);
    } else throw Error("UNKNOWN_FILL_SIDE");
  }
  const unrealized = quantity * mark - basis;
  const total = realized + unrealized;
  if (Math.abs(total - (cash + quantity * mark)) > 1e-7) throw Error("PNL_RECONCILIATION_FAILED");
  return { pair, fillCount: selected.length, orderCount: orders.length, quantity, markPrice: mark, costBasisEur: basis, realizedEur: realized, unrealizedEur: unrealized, totalEur: total };
}

async function audit({read, getPrice, now = Date.now(), botStart = BOT_START}) {
  if (typeof read !== "function" || typeof getPrice !== "function") throw Error("READ_ONLY_CLIENT_REQUIRED");
  if (!Number.isFinite(now) || !Number.isFinite(botStart) || now < botStart || now - botStart >= 85 * 86400_000) throw Error("HISTORY_RETENTION_UNVERIFIED");
  const pairs = [];
  for (const pair of PAIRS) {
    const [recent, archive, fills, mark] = await Promise.all([
      paginate(read, "/api/v5/trade/orders-history", pair, "ordId"),
      paginate(read, "/api/v5/trade/orders-history-archive", pair, "ordId"),
      paginate(read, "/api/v5/trade/fills-history", pair, "billId"),
      getPrice(pair)
    ]);
    const orders = distinctOrders(recent, archive);
    const pending = await read(`/api/v5/trade/orders-pending?instType=SPOT&instId=${pair}&limit=100`);
    if (!Array.isArray(pending) || pending.length >= 100 || pending.some(o => String(o.clOrdId || "").startsWith("ANTON"))) throw Error("PENDING_OR_UNVERIFIED_ORDERS_" + pair);
    pairs.push(calculate(pair, orders, fills, mark));
  }
  const sum = field => pairs.reduce((n, p) => n + p[field], 0);
  return { completeness: "RECONCILED_AVAILABLE_API_WINDOW_NOT_DURABLE", taxReady: false, valuation: "LAST_TRADE_MARK_EXCLUDES_FUTURE_EXIT_COSTS", from: new Date(botStart).toISOString(), at: new Date(now).toISOString(), pairs, realizedEur: sum("realizedEur"), unrealizedEur: sum("unrealizedEur"), totalEur: sum("totalEur"), fillCount: sum("fillCount") };
}
module.exports = {PAIRS, BOT_START, paginate, distinctOrders, calculate, audit};
