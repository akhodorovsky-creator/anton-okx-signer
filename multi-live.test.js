"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PAIRS,ledger,reportLedger,applyPnlBaseline,parsePnlBaselines,uniqueOrders,orderSize,sellSize,hourlyEntryConfirmation,page}=require('./multi-live');
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

test('live coordinator consumes political gate without changing order cap or exit rules',()=>{
  const source=fs.readFileSync('multi-live.js','utf8');
  assert.match(source,/getPoliticalLiveGate/);
  assert.match(source,/BTC_DAILY_ENTRY_BAND_NOT_MET/);
  assert.match(source,/hourlyEntryConfirmation/);
  assert.match(source,/BTC_DAILY_REGIME_EXIT/);
  assert.match(source,/MAX_ORDER=Math\.min\(20/);

  const hour=60*60_000,now=Date.UTC(2026,8,26,12,0,0);
  const rows=Array.from({length:60},(_,i)=>{
    const close=100+i*0.05+(i%2?0.1:-0.1);
    return [String(now-(60-i)*hour),'0','0','0',String(close),'100','0','0','1'];
  }).reverse();
  const confirmed=hourlyEntryConfirmation({code:'0',data:rows},now);
  assert.equal(confirmed.entryAllowed,true);
  const weak=rows.map(r=>[...r]);
  weak[0][4]='90';
  const blocked=hourlyEntryConfirmation({code:'0',data:weak},now);
  assert.equal(blocked.entryAllowed,false);
  assert.equal(blocked.reason,'BTC_1H_BELOW_EMA50');
});
