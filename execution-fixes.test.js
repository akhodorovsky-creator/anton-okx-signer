'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifySource}=require('./trading-guard-source-check');
const {monitorPosition}=require('./risk-monitor');
// Validate the exact coordinator source used by startup.
const baseline=fs.readFileSync(path.join(__dirname,'multi-live.js'),'utf8');
test('native coordinator carries the 20 EUR cap, legacy /auto block and dust guards',()=>{
  assert.match(baseline,/function maxOrderEur\(raw\)/);
  assert.match(baseline,/value<1\|\|value>20/);
  assert.match(baseline,/requested>20/);
  assert.match(baseline,/MULTI_COORDINATOR_OWNS_ALL_TRADING/);
  assert.match(baseline,/ANTON_MULTI_EXIT_BLOCKED.*JSON\.stringify/);
  assert.match(baseline,/ANTON_MULTI_DUST/);
  assert.match(baseline,/reportedDust\.has/);
  assert.match(baseline,/p\.dust\?'Технический остаток'/);
  assert.match(baseline,/isReconciledDust\(p\)/);
  assert.doesNotMatch(baseline,/requested>5/);
  assert.equal(verifySource(baseline),true);
});
test('static guard check fails closed when the order-limit guard changes',()=>{
  const changed=baseline.replace("if(!(MAX_ORDER>0)||MAX_ORDER>20)throw Error('ORDER_LIMIT_UNSAFE');","if(!(MAX_ORDER>0)||MAX_ORDER>21)throw Error('ORDER_LIMIT_UNSAFE');");
  assert.notEqual(changed,baseline);
  assert.throws(()=>verifySource(changed),/TRADING_GUARD_SOURCE_MISMATCH/);
});
test('static guard check rejects a missing capital exposure guard',()=>{
  const changed=baseline.replace('book.exposureEur+MAX_ORDER>CAP_EUR','false');
  assert.notEqual(changed,baseline);
  assert.throws(()=>verifySource(changed),/TRADING_GUARD_SOURCE_MISMATCH/);
});
test('multi-pair legacy monitor never posts /auto',async()=>{
  const previous=process.env.MULTI_SPOT_LIVE;
  process.env.MULTI_SPOT_LIVE='true';
  try {
    const result=await monitorPosition({port:4000,signerToken:'local',request:()=>{throw Error('Must not call /auto');}});
    assert.deepEqual(result,{action:'MULTI_COORDINATOR_ONLY',reason:'LEGACY_AUTO_DISABLED',mode:'LIVE'});
  } finally {
    if(previous===undefined)delete process.env.MULTI_SPOT_LIVE;
    else process.env.MULTI_SPOT_LIVE=previous;
  }
});
