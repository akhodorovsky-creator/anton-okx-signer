"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseCsv,replay,marketAt,HEADER} = require('./offline-backtest');
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
function csv(count = 80, price = () => 100) {
  const lines = [HEADER];
  for (let i = 0; i < count; i++) {
    const p = price(i);
    lines.push([new Date(BASE + i*300000).toISOString(),p,p+1,p-1,p,100,3000,200,1000,0].join(','));
  }
  return lines.join('\n');
}
const buy = () => ({signal:'BUY',actionable:true,marketInputsFresh:true});
const hold = () => ({signal:'HOLD',actionable:false,marketInputsFresh:true});
test('validates strict chronological input, full rows and minimum sample', () => {
  assert.equal(parseCsv(csv()).length,80);
  assert.throws(() => parseCsv(csv(60)),/INSUFFICIENT_HISTORY/);
  assert.throws(() => parseCsv(csv().replace(HEADER,'date,open')),/CSV_HEADER_MISMATCH/);
  const lines = csv().split('\n');
  lines[12] = lines[12].replace(/^[^,]+/,new Date(BASE + 12*300000).toISOString());
  assert.throws(() => parseCsv(lines.join('\n')),/MISSING_OR_DUPLICATE_BAR/);
  assert.throws(() => parseCsv(csv().replace(',100,101,99,100,100,',',100,101,99,0,100,')),/INVALID_BAR/);
});
test('market snapshot sees only 60 historical closed candles', () => {
  const bars = parseCsv(csv());
  const snapshot = marketAt(bars,62);
  assert.equal(snapshot.btc.data.length,60);
  assert.equal(Number(snapshot.btc.data.at(-1)[0]),bars[62].timestamp);
  assert.equal(Number(snapshot.btc.data.at(-1)[4]),bars[62].close);
});
test('HOLD has no trades or phantom profit; benchmark includes costs', () => {
  const result = replay(parseCsv(csv()),{signalFn:hold});
  assert.equal(result.entries,0);
  assert.equal(result.equityEur,200);
  assert.equal(result.realizedPnlEur,0);
  assert.equal(result.returnPct,0);
  assert.ok(result.benchmarkBuyHoldReturnPct < 0);
  assert.equal(result.status,'HYPOTHETICAL_NOT_LIVE');
});
test('BUY fills only on the following bar and fees reduce marked equity', () => {
  const result = replay(parseCsv(csv()),{signalFn:buy});
  assert.equal(result.entries,1);
  assert.equal(result.openPosition,true);
  assert.equal(result.closedTrades,0);
  assert.ok(result.equityEur < 200);
  assert.ok(result.unrealizedPnlEur < 0);
});
test('stop is evaluated on scheduled close and filled at next open', () => {
  const bars = parseCsv(csv(80,i => i >= 64 ? 97 : 100));
  const result = replay(bars,{signalFn:buy});
  assert.ok(result.closedTrades >= 1);
  assert.equal(result.trades[0].reason,'SL');
  assert.equal(result.trades[0].entryTime,new Date(BASE+60*300000).toISOString());
  assert.equal(result.trades[0].exitTime,new Date(BASE+66*300000).toISOString());
  assert.ok(result.trades[0].pnlEur < 0);
});
test('later price candles do not enter an earlier signal snapshot', () => {
  let firstA,firstB;
  replay(parseCsv(csv(80)),{signalFn:(market) => {firstA ??= JSON.stringify(market); return buy();}});
  replay(parseCsv(csv(80,i => i>=70 ? 200 : 100)),{signalFn:(market) => {firstB ??= JSON.stringify(market); return buy();}});
  assert.ok(firstA);
  assert.equal(firstA,firstB);
});
test('rejects incorrect risk and friction assumptions', () => {
  const bars = parseCsv(csv());
  assert.throws(() => replay(bars,{order:21}),/INVALID_ASSUMPTIONS/);
  assert.throws(() => replay(bars,{fee:-0.1}),/INVALID_ASSUMPTIONS/);
  assert.throws(() => replay(bars,{capital:0}),/INVALID_ASSUMPTIONS/);
});
