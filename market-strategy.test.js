"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {compute}=require('./market-strategy');
const time=Date.UTC(2026,8,18,5,0,0);
function fixture({ethStale=false,oi='1000000',funding='0',vol=100,rise=false}={}){
  const rows=(s,stale=false)=>Array.from({length:100},(_,i)=>{
    const ts=time-(stale?3*60*60_000:0)-(i+1)*300000;
    const close=s+(rise?(i===0?300:(100-i)*0.8):i*-0.01);
    return [String(ts),'0','0','0',String(close),String(i===0?vol:100),'0','0','1'];
  });
  return {btc:{code:'0',data:rows(67000)},eth:{code:'0',data:rows(3200,ethStale)},oi:{code:'0',data:[{oiUsd:oi,ts:String(time)}]},funding:{code:'0',data:[{fundingRate:funding}]}};
}
test('fail closed with stale ETH despite valid BTC',()=>{let x=compute(fixture({ethStale:true}),{},time);assert.equal(x.signal,'HOLD');assert.equal(x.actionable,false)});
test('fail closed on missing derivative data',()=>{let x=compute(fixture({oi:null}),{},time);assert.equal(x.actionable,false);assert.equal(x.reasons[0],'DERIVATIVES_DATA_UNAVAILABLE')});
test('no forced BUY on ordinary valid markets',()=>{let x=compute(fixture(),{},time);assert.equal(x.signal,'HOLD');assert.equal(x.actionable,false);assert.equal(x.marketInputsFresh,true)});
test('confirmed candles only and insufficient bars fail closed',()=>{let m=fixture();m.btc.data=m.btc.data.map(r=>[...r.slice(0,8),'0']);let x=compute(m,{},time);assert.equal(x.actionable,false)});
test('cooldown prevents repeated orders',()=>{let m=fixture({vol:10000,rise:true,oi:'1036000',funding:'-0.001'});let first=compute(m,{lastOi:1000000},time);assert.equal(first.signal,'BUY');assert.equal(first.actionable,true);let later=compute(m,{lastOi:1000000,lastSignal:'BUY',lastSignalAt:time-100000},time);assert.equal(later.signal,'BUY');assert.equal(later.actionable,false)});
test('stale open interest fails closed',()=>{let m=fixture();m.oi.data[0].ts=String(time-3600000);let x=compute(m,{},time);assert.equal(x.actionable,false);assert.equal(x.reasons[0],'DERIVATIVES_DATA_UNAVAILABLE')});