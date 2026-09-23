"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {monitorPosition}=require('./risk-monitor');

async function withMultiMode(enabled,fn){
  const previous=process.env.MULTI_SPOT_LIVE;
  const previousApproval=process.env.TELEGRAM_TRADE_APPROVAL;
  process.env.MULTI_SPOT_LIVE=enabled?'true':'false';
  process.env.TELEGRAM_TRADE_APPROVAL='false';
  try{return await fn();}
  finally {
    if(previous===undefined)delete process.env.MULTI_SPOT_LIVE;else process.env.MULTI_SPOT_LIVE=previous;
    if(previousApproval===undefined)delete process.env.TELEGRAM_TRADE_APPROVAL;else process.env.TELEGRAM_TRADE_APPROVAL=previousApproval;
  }
}

test('legacy monitor sends HOLD only, never BUY or SELL',async()=>withMultiMode(false,async()=>{
  let seen;
  const result=await monitorPosition({port:8080,signerToken:'unit-test-token',request:async(url,options)=>{
    seen={url,...options};
    return {ok:true,status:200,json:async()=>({ok:true,action:'WAIT_FOR_BUY',reason:'SIGNAL_NOT_BUY',mode:'LIVE'})};
  }});
  assert.equal(seen.url,'http://127.0.0.1:8080/auto');
  assert.equal(seen.method,'POST');
  assert.deepEqual(JSON.parse(seen.body),{signal:'HOLD',actionable:false,confirmLive:true});
  assert.equal(result.action,'WAIT_FOR_BUY');
}));

test('monitor fails closed without authentication token in either mode',async()=>{
  for(const enabled of [false,true])await withMultiMode(enabled,async()=>{
    await assert.rejects(monitorPosition({signerToken:'',request:async()=>{throw Error('must not call');}}),/SIGNER_TOKEN/);
  });
});

test('legacy monitor rejects failed upstream response without trading retry',async()=>withMultiMode(false,async()=>{
  let calls=0;
  await assert.rejects(monitorPosition({signerToken:'test',request:async()=>{
    calls++;
    return {ok:false,status:409,json:async()=>({error:'Automation already processing a request'})};
  }}),/HTTP 409/);
  assert.equal(calls,1);
}));

test('live multi-spot monitor does not invoke legacy auto',async()=>withMultiMode(true,async()=>{
  let calls=0;
  const result=await monitorPosition({signerToken:'test',request:async()=>{calls++;throw Error('legacy auto must not run');}});
  assert.equal(calls,0);
  assert.equal(result.action,'MULTI_COORDINATOR_ONLY');
}));
