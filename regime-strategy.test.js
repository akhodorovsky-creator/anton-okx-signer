"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {DAY,SMA_DAYS,dailyRegime,validateDailyBars}=require('./regime-strategy');

function bars(lastClose=100){
  const start=Date.parse('2026-01-01T00:00:00Z');
  return Array.from({length:SMA_DAYS},(_,i)=>({timestamp:start+i*DAY,close:i===SMA_DAYS-1?lastClose:100}));
}

test('new BTC position requires close at least 2% above SMA200',()=>{
  assert.equal(dailyRegime(bars(101),false).action,'WAIT');
  assert.equal(dailyRegime(bars(103),false).action,'BUY');
});

test('existing BTC position uses lower 2% exit band to reduce whipsaw',()=>{
  assert.equal(dailyRegime(bars(99),true).action,'HOLD');
  assert.equal(dailyRegime(bars(97),true).action,'EXIT');
});

test('regime exposes auditable SMA and distance',()=>{
  const d=dailyRegime(bars(103),false);
  assert.equal(d.version,'BTC_DAILY_SMA200_BAND_V2');
  assert.ok(d.sma200>100&&d.sma200<101);
  assert.ok(Number.isFinite(d.distancePct));
});

test('daily history fails closed on insufficient or gapped bars',()=>{
  assert.throws(()=>validateDailyBars(bars().slice(1)),/INSUFFICIENT/);
  const broken=bars();broken[100]={...broken[100],timestamp:broken[100].timestamp+DAY};
  assert.throws(()=>validateDailyBars(broken),/GAPPED/);
});
