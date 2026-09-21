"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {clients}=require('./fill-audit-runner');

test('auditor submits no exchange orders: signer payload is GET and endpoint allowlisted',async()=>{
  const seen=[];
  const {read}=clients({port:3000,token:'unit-token',request:async(url,options)=>{seen.push({url,...options});return {ok:true,json:async()=>({ok:true,code:'0',data:[]})};}});
  await read('/api/v5/trade/fills-history?instType=SPOT&instId=BTC-EUR&limit=100');
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,'http://127.0.0.1:3023/okx');
  assert.equal(JSON.parse(seen[0].body).method,'GET');
  assert.equal(JSON.parse(seen[0].body).confirmLive,undefined);
  await assert.rejects(read('/api/v5/trade/order?instId=BTC-EUR'),/AUDIT_NON_READ_ONLY_PATH/);
  await assert.rejects(read('/api/v5/account/balance?ccy=EUR'),/AUDIT_NON_READ_ONLY_PATH/);
});
test('auditor refuses stale and unverified price',async()=>{
  const {getPrice}=clients({port:3000,token:'test',clock:()=>1000000,request:async()=>({ok:true,json:async()=>({code:'0',data:[{last:'200',ts:'700000'}]})})});
  await assert.rejects(getPrice('BTC-EUR'),/AUDIT_STALE_TICKER/);
  await assert.rejects(getPrice('BTC-USDT'),/AUDIT_PAIR_NOT_ALLOWED/);
});
test('audit signer errors propagate, never return a fabricated zero',async()=>{
  const {read}=clients({port:3000,token:'test',request:async()=>({ok:false,status:401})});
  await assert.rejects(read('/api/v5/trade/fills-history?instType=SPOT&instId=BTC-EUR'),/AUDIT_SIGNER_HTTP_401/);
});
