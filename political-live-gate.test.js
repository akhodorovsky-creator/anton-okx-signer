"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {marketReaction,evaluatePoliticalGate,NORMAL_COOLDOWN,EVENT_COOLDOWN}=require('./political-live-gate');

const now=Date.UTC(2026,8,25,16,0,0);
function context(extra={}){return{enabled:true,verified:true,matching:1,subjectCounts:{CRYPTO:0,TRADE:0,GEOPOLITICS:1},...extra};}
function candles({move=0.003,spike=2}={}){
  const rows=[];
  const base=100;
  for(let i=0;i<30;i++){
    const ts=now-(30-i)*5*60_000;
    const close=i===29?base*(1+move):base;
    const volume=i===29?100*spike:100;
    rows.push([String(ts),'0','0','0',String(close),String(volume),'0','0','1']);
  }
  return{code:'0',data:rows.reverse()};
}

test('disabled political block preserves normal entry cadence',()=>{
  const g=evaluatePoliticalGate({enabled:false,verified:true,matching:0},null);
  assert.equal(g.entryAllowed,true);assert.equal(g.cooldownMs,NORMAL_COOLDOWN);
});
test('unverified political context fails closed for new entries',()=>{
  const g=evaluatePoliticalGate({enabled:true,verified:false,matching:0},null);
  assert.equal(g.entryAllowed,false);assert.equal(g.reason,'POLITICAL_CONTEXT_UNVERIFIED');
});
test('confirmed positive geopolitical reaction does not accelerate entries, while crypto-specific reaction can',()=>{
  const reaction={ret5:0.35,volRatio:1.8,candleAt:new Date(now).toISOString()};
  const geo=evaluatePoliticalGate(context(),reaction);
  assert.equal(geo.entryAllowed,true);assert.equal(geo.cooldownMs,NORMAL_COOLDOWN);
  assert.equal(geo.reason,'POLITICAL_MARKET_CONFIRMED_UP_NO_ACCELERATION');
  const crypto=evaluatePoliticalGate(context({subjectCounts:{CRYPTO:1,TRADE:0,GEOPOLITICS:0}}),reaction);
  assert.equal(crypto.entryAllowed,true);assert.equal(crypto.cooldownMs,EVENT_COOLDOWN);
  assert.equal(crypto.reason,'POLITICAL_CRYPTO_CONFIRMED_UP');
});
test('confirmed negative reaction blocks new long entries',()=>{
  const g=evaluatePoliticalGate(context(),{ret5:-0.35,volRatio:1.8,candleAt:new Date(now).toISOString()});
  assert.equal(g.entryAllowed,false);assert.equal(g.cooldownMs,NORMAL_COOLDOWN);assert.equal(g.reason,'POLITICAL_MARKET_CONFIRMED_DOWN');
});
test('headline without market confirmation does not accelerate trading',()=>{
  const g=evaluatePoliticalGate(context(),{ret5:0.05,volRatio:1.1,candleAt:new Date(now).toISOString()});
  assert.equal(g.entryAllowed,true);assert.equal(g.cooldownMs,NORMAL_COOLDOWN);assert.equal(g.reason,'POLITICAL_EVENT_NO_CONFIRMED_REACTION');
});
test('5 minute market reaction requires fresh closed candles and volume history',()=>{
  const r=marketReaction(candles(),now);
  assert.ok(r.ret5>0.2);assert.ok(r.volRatio>1.4);
  assert.throws(()=>marketReaction({code:'1',data:[]},now),/POLITICAL_MARKET_UNAVAILABLE/);
});
