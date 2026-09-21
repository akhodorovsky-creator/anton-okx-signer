"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { paginate, distinctOrders, calculate, audit, BOT_START } = require("./fill-audit");
const order = (ordId, side, accFillSz, pair = "BTC-EUR") => ({ordId:String(ordId), clOrdId:"ANTONtest"+ordId, instId:pair, side, accFillSz:String(accFillSz), cTime:"1780000000000", uTime:"1780000000100"});
const fill = (ordId, billId, tradeId, side, size, price, fee, feeCcy = "EUR", pair = "BTC-EUR", time = "1780000000000") => ({ordId:String(ordId), billId:String(billId), tradeId:String(tradeId), clOrdId:"ANTONtest"+ordId, instId:pair, side, fillSz:String(size), fillPx:String(price), fee:String(fee), feeCcy, fillTime:time});

test("computes realized/unrealized profit with base and EUR fees, partial fills", () => {
  const orders = [order(1,"buy",2), order(2,"sell",1)];
  const fills = [fill(2,30,30,"sell",1,60,-0.12),fill(1,20,20,"buy",1,50,-0.01,"BTC"),fill(1,19,19,"buy",1,50,-0.01,"BTC")];
  const book = calculate("BTC-EUR", orders, fills, 60);
  assert.equal(book.fillCount,3);
  assert.ok(Math.abs(book.quantity-0.98)<1e-10);
  assert.ok(Math.abs(book.realizedEur-(59.88-100/1.98))<1e-8);
  assert.ok(Math.abs(book.totalEur-(59.88-100+0.98*60))<1e-8);
});

test("does not count non-bot account trades", () => {
  const external = {...fill(3,31,31,"buy",10,50,0),clOrdId:"PERSONAL"};
  const result = calculate("BTC-EUR",[order(1,"buy",1)],[external,fill(1,40,40,"buy",1,50,-0.05)],55);
  assert.equal(result.fillCount,1);
  assert.ok(Math.abs(result.totalEur-4.95)<1e-10);
});

test("rejects incomplete, duplicated or misattributed fills and third-currency fees", () => {
  const orders=[order(1,"buy",1)];
  const one=fill(1,20,20,"buy",1,50,0);
  assert.throws(()=>calculate("BTC-EUR",orders,[] ,55),/ORDER_FILL_MISMATCH/);
  assert.throws(()=>calculate("BTC-EUR",orders,[one,one],55),/DUPLICATE_FILL/);
  assert.throws(()=>calculate("BTC-EUR",orders,[{...one,clOrdId:"ANTONwrong"}],55),/FILL_ORDER_MISMATCH/);
  assert.throws(()=>calculate("BTC-EUR",orders,[{...one,fee:"-0.1",feeCcy:"OKB"}],55),/UNPRICED_FEE_CURRENCY/);
  assert.throws(()=>calculate("BTC-EUR",[],[one],55),/MISSING_BOT_ORDER/);
  assert.throws(()=>calculate("BTC-EUR",[order(1,"sell",1)],[fill(1,20,20,"sell",1,50,0)],55),/SELL_WITHOUT_BOT_INVENTORY/);
});

test("paginates with after=last billId; stops only on short or empty page", async () => {
  const rows = Array.from({length: 100},(_,i)=>({billId:String(400-i)}));
  const urls=[];
  const result=await paginate(async path=>{urls.push(path);return urls.length===1?rows:[{billId:"300"}];},"/api/v5/trade/fills-history","BTC-EUR","billId");
  assert.equal(result.length,101);
  assert.match(urls[1], /after=301$/);
  await assert.rejects(paginate(async()=>rows,"/api/v5/trade/fills-history","BTC-EUR","billId",1),/HISTORY_PAGE_LIMIT_REACHED/);
  await assert.rejects(paginate(async()=>[{billId:"300"},{billId:"301"}],"/api/v5/trade/fills-history","BTC-EUR","billId"),/UNSORTED_HISTORY/);
});

test("deduplicates order archives and rejects contradictory identities", () => {
  assert.equal(distinctOrders([order(1,"buy",1)], [order(1,"buy",1)]).length,1);
  assert.throws(()=>distinctOrders([order(1,"buy",1)], [order(1,"sell",1)]),/ORDER_ID_CONFLICT/);
});

test("full audit reads only GETs, calculates three pairs and never claims tax-ready", async () => {
  const urls=[];
  const read=async path=>{
    urls.push(path);
    const pair=new URL("https://example.test"+path).searchParams.get("instId");
    if (path.includes("orders-history-archive") || path.includes("orders-pending")) return [];
    if (pair!=="BTC-EUR") return [];
    if (path.includes("fills-history")) return [fill(1,20,20,"buy",1,50,-0.05)];
    if (path.includes("orders-history")) return [order(1,"buy",1)];
    throw Error("UNEXPECTED_ENDPOINT");
  };
  const result=await audit({read,getPrice:async()=>55,now:BOT_START+86400_000});
  assert.equal(result.fillCount,1);
  assert.ok(Math.abs(result.totalEur-4.95)<1e-10);
  assert.equal(result.taxReady,false);
  assert.match(result.completeness,/NOT_DURABLE/);
  assert.equal(urls.filter(p=>p.includes("fills-history")).length,3);
  assert.ok(urls.every(p=>p.startsWith("/api/v5/trade/")&&!p.includes("/trade/order?")));
  await assert.rejects(audit({read,getPrice:async()=>55,now:BOT_START+86*86400_000}),/HISTORY_RETENTION_UNVERIFIED/);
});

test("rejects pending ANTON orders before reporting a reconciled audit", async () => {
  const read=async path=>path.includes("orders-pending")?[{clOrdId:"ANTONpending"}]:[];
  await assert.rejects(audit({read,getPrice:async()=>55,now:BOT_START+86400_000}),/PENDING_OR_UNVERIFIED_ORDERS/);
});
