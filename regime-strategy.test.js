"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {DAY,SMA_DAYS,dailyRegime,riskBudget,realizedVolatility,validateDailyBars}=require('./regime-strategy');

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

test('risk budget targets 15% portfolio volatility and is bounded to 10-50% capital',()=>{
  const quiet=bars(103);
  const q=riskBudget(quiet,300);
  assert.equal(q.version,'BTC_VOL_TARGET_15_V1');
  assert.ok(q.annualizedVolPct>0);
  assert.ok(q.allocationPct>=10&&q.allocationPct<=50);
  assert.ok(q.targetExposureEur>=30&&q.targetExposureEur<=150);

  const noisy=bars();
  for(let i=noisy.length-31;i<noisy.length;i++)noisy[i]={...noisy[i],close:100*(i%2?1.08:0.92)};
  const n=riskBudget(noisy,300);
  assert.equal(n.allocationPct,10);
  assert.equal(n.targetExposureEur,30);
  assert.ok(realizedVolatility(noisy)>q.annualizedVol);
});

test('risk budget fails closed when volatility cannot be verified',()=>{
  assert.throws(()=>riskBudget(bars(),300),/VOLATILITY_UNVERIFIED/);
  assert.throws(()=>riskBudget(bars(103),0),/INVALID_RISK_CAPITAL/);
});
