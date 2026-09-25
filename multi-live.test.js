"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {PAIRS,ledger,reportLedger,applyPnlBaseline,parsePnlBaselines,uniqueOrders,orderSize,sellSize,page}=require('./multi-live');
const buy={ordId:'1',clOrdId:'ANTON1',instId:'ETH-EUR',side:'buy',accFillSz:'0.01',avgPx:'3000',fee:'-0.00001',feeCcy:'ETH',cTime:'100'};
const sell={ordId:'2',clOrdId:'ANTON2',instId:'ETH-EUR',side:'sell',accFillSz:'0.005',avgPx:'3300',fee:'-0.02',feeCcy:'EUR',cTime:'200'};
test('dashboard tracks three EUR pairs but labels BTC as the new-entry strategy',()=>{assert.deepEqual(PAIRS,['BTC-EUR','ETH-EUR','DOGE-EUR']);const html=page();assert.match(html,/BTC-EUR новая стратегия/);assert.match(html,/ETH\/DOGE только сопровождение/);assert.match(html,/Не фактическая сумма на счёте/);});
test('order history deduplicates and fails closed if page reaches cap',()=>{assert.equal(uniqueOrders([buy],[buy]).length,1);assert.throws(()=>uniqueOrders(Array(100).fill(buy),[]),/INCOMPLETE/);assert.deepEqual(uniqueOrders([{...buy,clOrdId:'PERSONAL'}],[]),[]);});
test('position accounts for fees and cannot sell personal assets',()=>{const p=ledger([buy,sell],3300);assert.ok(p.qty>0.0049&&p.qty<0.005);assert.ok(p.pnlEur>0&&p.pnlEur<4);assert.equal(p.fills,2);assert.throws(()=>ledger([sell],3300),/EXCEEDS_TRACKED/);});
test('5 EUR source order is never inflated to exchange minimum',()=>{assert.equal(orderSize({state:'live',minSz:'0.0001',lotSz:'0.00000001'},67000,5).valid,false);assert.equal(orderSize({state:'live',minSz:'1',lotSz:'1'},0.2,5).valid,true);assert.equal(orderSize({state:'suspend',minSz:'1',lotSz:'1'},0.2,5).valid,false);assert.equal(orderSize({state:'live',minSz:'1',lotSz:'1'},0.2,20).valid,true);assert.equal(orderSize({state:'live',minSz:'1',lotSz:'1'},0.2,21).valid,false);});
test('sell rounding is downward for whole and fractional tokens',()=>{assert.equal(sellSize(10,10,1,1),'10');assert.equal(sellSize(3.8,3.8,1,1),'3');assert.equal(sellSize(0.00231,0.00231,0.0001,0.0001),'0.0023');assert.equal(sellSize(0.0023,0.001,0.0001,0.002),null);});

test('P&L reset preserves full position history and subtracts a monetary baseline',()=>{
  const full=ledger([buy,sell],3300);
  const baseline={'ETH-EUR':1.25};
  const adjusted=applyPnlBaseline(full,'ETH-EUR',baseline);
  assert.equal(adjusted.qty,full.qty);
  assert.equal(adjusted.fills,full.fills);
  assert.ok(Math.abs(adjusted.pnlEur-(full.pnlEur-1.25))<1e-12);
  assert.equal(reportLedger([buy,sell],3300,'ETH-EUR').qty,full.qty);
});
test('P&L baseline config is strict and pair-scoped',()=>{
  assert.deepEqual(parsePnlBaselines('{"BTC-EUR":1.1,"ETH-EUR":-0.2}'),{'BTC-EUR':1.1,'ETH-EUR':-0.2});
  assert.throws(()=>parsePnlBaselines('{"SOL-EUR":1}'),/UNKNOWN_PNL_BASELINE_PAIR/);
  assert.throws(()=>parsePnlBaselines('{"BTC-EUR":"x"}'),/INVALID_PNL_BASELINE_VALUE/);
  assert.throws(()=>parsePnlBaselines('{bad'),/INVALID_PNL_BASELINES_JSON/);
});
