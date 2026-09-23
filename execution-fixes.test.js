'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {prepare}=require('./eur-order-cap-launcher');
const {monitorPosition}=require('./risk-monitor');
// Validate the coordinator that startup patches; avoid a stale copy of its source.
const baseline=fs.readFileSync(path.join(__dirname,'multi-live.js'),'utf8');
test('runtime patch raises max order consistently and disables legacy /auto',()=>{
  const result=prepare(baseline);
  assert.match(result,/MAX_ORDER=Math.min\(20/);
  assert.match(result,/requested>20/);
  assert.match(result,/MULTI_COORDINATOR_OWNS_ALL_TRADING/);
  assert.match(result,/ANTON_MULTI_EXIT_BLOCKED.*JSON\.stringify/);
  assert.match(result,/ANTON_MULTI_DUST/);
  assert.match(result,/reportedDust\.has/);
  assert.match(result,/p\.dust\?'Технический остаток'/);
  assert.match(result,/isReconciledDust\(p\)/);
  assert.doesNotMatch(result,/MAX_ORDER>5/);
});
test('patch fails closed when upstream source changes unexpectedly',()=>{
  assert.throws(()=>prepare(baseline.replace('requested>5','requested>6')),/SOURCE_PATCH_MISMATCH/);
});
test('patch still rejects a missing capital exposure guard',()=>{
  const changed=baseline.replace('book.exposureEur+MAX_ORDER>CAP_EUR','false');
  assert.notEqual(changed,baseline);
  assert.throws(()=>prepare(changed),/TRADING_GUARD_SOURCE_MISMATCH/);
});
test('approval mode legacy monitor never posts /auto',async()=>{
  const live=process.env.MULTI_SPOT_LIVE, approval=process.env.TELEGRAM_TRADE_APPROVAL;
  process.env.MULTI_SPOT_LIVE='false';
  process.env.TELEGRAM_TRADE_APPROVAL='true';
  try {
    const result=await monitorPosition({port:4000,signerToken:'local',request:()=>{throw Error('Must not call /auto');}});
    assert.deepEqual(result,{action:'MULTI_COORDINATOR_ONLY',reason:'LEGACY_AUTO_DISABLED',mode:'TELEGRAM_APPROVAL'});
  } finally {
    if(live===undefined)delete process.env.MULTI_SPOT_LIVE; else process.env.MULTI_SPOT_LIVE=live;
    if(approval===undefined)delete process.env.TELEGRAM_TRADE_APPROVAL; else process.env.TELEGRAM_TRADE_APPROVAL=approval;
  }
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
