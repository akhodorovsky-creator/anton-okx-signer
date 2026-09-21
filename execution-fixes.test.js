'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {prepare}=require('./eur-order-cap-launcher');
const {monitorPosition}=require('./risk-monitor');
const baseline=[
"const MAX_ORDER=Math.min(5,Number(process.env.MAX_ORDER_EUR||5));",
"function orderSize(requested){if(requested>5)return false;}",
"async function tick(){if(MAX_ORDER>5)throw Error('limit');}",
"function run(){if(MAX_ORDER>5)throw Error('limit');}",
"function handler(req,res){const route=(req.url||'').split('?')[0];}",
"function exits(){for(const p of [{pair:'ETH-EUR',qty:1,free:0,instrument:{minSz:1,lotSz:1}}]){console.error('ANTON_MULTI_EXIT_BLOCKED '+p.pair+' BELOW_MIN_OR_UNAVAILABLE');continue;}}",
'const CAP_EUR=200, TP=.05, SL=.02, PERIOD=15*60_000;',
"const PAIRS=Object.freeze(['BTC-EUR','ETH-EUR','DOGE-EUR']);",
"function signal(d,book){for(const x of [1]){if(!d.actionable||d.signal!=='BUY')continue;",
'if(book.exposureEur+MAX_ORDER>CAP_EUR||book.availableEur<MAX_ORDER)continue;}}',
"const LIVE=process.env.MULTI_SPOT_LIVE==='true';"
].join('\n');
test('runtime patch raises max order consistently and disables legacy /auto',()=>{
  const result=prepare(baseline);
  assert.match(result,/MAX_ORDER=Math.min\(20/);
  assert.match(result,/requested>20/);
  assert.match(result,/MULTI_COORDINATOR_OWNS_ALL_TRADING/);
  assert.match(result,/ANTON_MULTI_EXIT_BLOCKED.*JSON\.stringify/);
  assert.doesNotMatch(result,/MAX_ORDER>5/);
});
test('patch fails closed when upstream source changes unexpectedly',()=>{
  assert.throws(()=>prepare(baseline.replace('requested>5','requested>6')),/SOURCE_PATCH_MISMATCH/);
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
