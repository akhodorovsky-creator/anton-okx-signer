'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifyConfig}=require('./eur-order-cap-launcher');
const {monitorPosition}=require('./risk-monitor');
const coordinator=fs.readFileSync(path.join(__dirname,'multi-live.js'),'utf8');
const launcher=fs.readFileSync(path.join(__dirname,'eur-order-cap-launcher.js'),'utf8');

test('canonical coordinator owns order cap, legacy /auto block and dust handling',()=>{
  assert.match(coordinator,/MAX_ORDER=Math\.min\(20/);
  assert.match(coordinator,/requested>20/);
  assert.match(coordinator,/MULTI_COORDINATOR_OWNS_ALL_TRADING/);
  assert.match(coordinator,/ANTON_MULTI_EXIT_BLOCKED.*JSON\.stringify/);
  assert.match(coordinator,/ANTON_MULTI_DUST/);
  assert.match(coordinator,/reportedDust\.has/);
  assert.match(coordinator,/p\.dust\?'Технический остаток'/);
  assert.match(coordinator,/isReconciledDust\(p\)/);
  assert.doesNotMatch(coordinator,/MAX_ORDER>5/);
});

test('launcher no longer rewrites or compiles patched coordinator source',()=>{
  assert.doesNotMatch(launcher,/SOURCE_PATCH_MISMATCH|_compile\(|vm\.Script|split\(before\)/);
  assert.match(launcher,/require\('\.\/multi-live'\)/);
  assert.equal(verifyConfig({MAX_ORDER_EUR:'20',CAPITAL_CAP_EUR:'1000'}),true);
  assert.throws(()=>verifyConfig({MAX_ORDER_EUR:'21'}),/INVALID_MAX_ORDER_EUR/);
  assert.throws(()=>verifyConfig({MAX_ORDER_EUR:'abc'}),/INVALID_MAX_ORDER_EUR/);
  assert.throws(()=>verifyConfig({CAPITAL_CAP_EUR:'1001'}),/INVALID_CAPITAL_CAP_EUR/);
});

test('coordinator retains capital guard and only BTC can receive a new v2 entry',()=>{
  assert.match(coordinator,/Math\.min\(MAX_ORDER,remainingTarget,CAP_EUR-book\.exposureEur,book\.availableEur\)/);
  assert.match(coordinator,/dailyRegime\(bars,btcBook\.qty>=btcMin\)/);
  assert.match(coordinator,/const p=btcBook/);
  assert.match(coordinator,/riskBudget\(bars,CAP_EUR\)/);
  assert.match(coordinator,/V2_POSITION_SIZE_GUARD/);
  assert.match(coordinator,/TRACKED_BTC_NOT_AVAILABLE/);
  assert.match(coordinator,/BTC_DAILY_REGIME_EXIT/);
  assert.match(coordinator,/LEGACY_TAKE_PROFIT_5_PERCENT/);
  assert.doesNotMatch(coordinator,/compute\(\{|derivativeRows|observeOi\(/);
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
