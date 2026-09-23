'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CONFIG,HOUR,features,decision,initialState,step,summary}=require('./engine');
const {readPublic}=require('./public-market');
const {restore,persist,processObservation}=require('./paper');
const T=Date.parse('2026-01-01T00:00:00Z');
function bars(n=300) {return Array.from({length:n},(_,i)=>({timestamp:T+i*HOUR,open:100,high:101,low:99,close:100,volume:100}));}
function snap(t=T,close=100) {return Object.fromEntries(CONFIG.pairs.map(p=>[p,{timestamp:t,ready:true,close,low:close-1,ema20:close,ema50:95,ema200:90,ema50SixHoursAgo:94,atr:2,return24:0.03,rsi:60,volumeRatio:2,high24:close-1,previousLow:98,previousClose:99,previousEma20:100}]));}
function quotes(p=100){return Object.fromEntries(CONFIG.pairs.map(x=>[x,{bid:p,ask:p}]));}

test('historical feature prefix is unchanged by future prices',()=>{
  const a=bars(350),b=bars(350);for(let i=300;i<350;i++)Object.assign(b[i],{open:200,high:201,low:199,close:200});
  assert.deepEqual(features(a).slice(0,300),features(b).slice(0,300));
});
test('history rejects gaps, duplicate timestamps and malformed candles',()=>{
  const gap=bars();gap[150].timestamp+=HOUR;assert.throws(()=>features(gap),/GAPPED/);
  const invalid=bars();invalid[100].close=120;assert.throws(()=>features(invalid),/INVALID/);
});
test('BTC regime blocks all candidate purchases',()=>{
  const f=snap()['BTC-EUR'];const btc={...f,close:80};
  for(const c of CONFIG.candidates)assert.equal(decision(c,f,btc).buy,false);
});
test('fees and slippage reduce unchanged-price equity; cap is 3 x 20 EUR',()=>{
  const state=initialState('momentum24');step(state,snap(),quotes(),T+HOUR);
  assert.equal(state.entries,3);assert.equal(state.cash,240);
  const expected=240+60*(1-CONFIG.feeRate)**2*(1-CONFIG.slippageRate)/(1+CONFIG.slippageRate);
  assert.ok(Math.abs(summary(state,quotes()).equityEur-expected)<1e-9);
  assert.ok(summary(state,quotes()).pnlEur<0);
});
test('fill occurs no earlier than close; duplicate observation has no effect',()=>{
  const state=initialState('momentum24');assert.throws(()=>step(state,snap(),quotes(),T),/FUTURE/);
  step(state,snap(),quotes(),T+HOUR);const saved=JSON.stringify(state);
  assert.equal(step(state,snap(),quotes(),T+HOUR).processed,false);assert.equal(JSON.stringify(state),saved);
});
test('next quote gap is charged fully; stop threshold is not a loss guarantee',()=>{
  const state=initialState('momentum24');step(state,snap(),quotes(),T+HOUR);
  step(state,snap(T+HOUR,96),quotes(90),T+2*HOUR);
  assert.equal(state.trades.length,3);assert.ok(state.trades.every(t=>t.pnlEur<-2));
  assert.ok(state.trades.every(t=>t.reason==='NET_STOP_LOSS'));
});
test('drawdown blocks entries but leaves position exits working',()=>{
  const state=initialState('momentum24');step(state,snap(),quotes(),T+HOUR);state.peak=310;
  step(state,snap(T+HOUR,96),quotes(96),T+2*HOUR);
  assert.equal(state.entryHalted,true);assert.equal(state.trades.length,3);
  step(state,snap(T+26*HOUR),quotes(),T+27*HOUR);assert.equal(state.entries,3);
});
test('wide spread suppresses paper entries',()=>{
  const state=initialState('momentum24'),q=quotes();for(const p of CONFIG.pairs)q[p].ask=102;
  step(state,snap(),q,T+HOUR);assert.equal(state.entries,0);
});
test('public client rejects every account or order endpoint',async()=>{
  let calls=0;const request=async()=>{calls++;throw Error('MUST_NOT_CALL');};
  for(const route of ['/api/v3/order','/api/v3/account','/api/v5/trade/order','https://evil.test'])await assert.rejects(readPublic(route,{},request),/PUBLIC_MARKET_ROUTE_ONLY/);
  assert.equal(calls,0);
});
test('public client uses GET without auth and refuses redirects',async()=>{
  let options;await readPublic('/api/v3/ticker/bookTicker',{symbol:'BTCEUR'},async(url,opts)=>{
    assert.equal(url.origin,'https://api.binance.com');options=opts;return {ok:true,text:async()=>'{}'};
  });
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,undefined);
});
test('late boot observes without retroactive entries; state survives ordinary restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anton-paper-test-')),file=path.join(dir,'state.json');
  try{
    const store=restore(file),now=T+HOUR+10*60000;
    processObservation(store,{venue:'BINANCE_PUBLIC_EUR_PROXY',observedAt:now,snapshot:snap(),quotes:quotes()},now);
    assert.ok(store.states.every(s=>s.entries===0));persist(store,file);
    assert.deepEqual(restore(file),store);
    const epoch=store.epoch;fs.unlinkSync(file);assert.notEqual(restore(file).epoch,epoch);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('paper runner refuses stale observations and venue mixing',()=>{
  const store={states:CONFIG.candidates.map(x=>initialState(x))};
  assert.throws(()=>processObservation(store,{venue:'OKX',observedAt:T},T),/VENUE/);
  assert.throws(()=>processObservation(store,{venue:'BINANCE_PUBLIC_EUR_PROXY',observedAt:T},T+61000),/STALE_OBSERVATION/);
});
test('paper state cannot be switched into live mode',()=>{
  const state=initialState('momentum24');state.mode='LIVE';assert.throws(()=>step(state,snap(),quotes(),T+HOUR),/PAPER_ONLY/);
});
