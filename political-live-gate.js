"use strict";
// Execution gate only. Political/news context may accelerate or block NEW BTC entries,
// but it never creates exits, changes order size, or bypasses the daily BTC regime.
const {readPoliticalContext,politicalAdjustment}=require('./market-strategy');

const FIVE_MINUTES=5*60_000;
const NORMAL_COOLDOWN=24*60*60_000;
const EVENT_COOLDOWN=6*60*60_000;

function marketReaction(payload,now=Date.now()){
  if(!payload||payload.code!=='0'||!Array.isArray(payload.data))throw Error('POLITICAL_MARKET_UNAVAILABLE');
  const bars=payload.data
    .filter(r=>Array.isArray(r)&&r[8]==='1')
    .map(r=>({ts:Number(r[0]),close:Number(r[4]),volume:Number(r[5])}))
    .sort((a,b)=>a.ts-b.ts);
  if(bars.length<21||bars.some(r=>!Number.isFinite(r.ts)||!(r.close>0)||!(r.volume>=0)))throw Error('POLITICAL_MARKET_INVALID');
  const last=bars.at(-1),prev=bars.at(-2);
  if(last.ts>now+60_000||now-(last.ts+FIVE_MINUTES)>15*60_000)throw Error('POLITICAL_MARKET_STALE');
  const volAvg=bars.slice(-21,-1).reduce((s,r)=>s+r.volume,0)/20;
  if(!(volAvg>0))throw Error('POLITICAL_MARKET_VOLUME_INVALID');
  return {
    ret5:Number((((last.close/prev.close)-1)*100).toFixed(4)),
    volRatio:Number((last.volume/volAvg).toFixed(4)),
    candleAt:new Date(last.ts).toISOString()
  };
}

function evaluatePoliticalGate(context,reaction){
  const matching=Number.isInteger(context?.matching)?context.matching:0;
  if(!context?.enabled)return{entryAllowed:true,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_DISABLED',matching:0,politicalScore:0};
  if(!context.verified)return{entryAllowed:false,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_CONTEXT_UNVERIFIED',matching,politicalScore:0};
  if(matching===0)return{entryAllowed:true,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_NO_RECENT_EVENT',matching,politicalScore:0};
  if(!reaction)return{entryAllowed:false,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_MARKET_UNVERIFIED',matching,politicalScore:0};
  const politicalScore=politicalAdjustment(context,reaction);
  const base={matching,politicalScore:Number(politicalScore.toFixed(3)),ret5:reaction.ret5,volRatio:reaction.volRatio,candleAt:reaction.candleAt};
  if(politicalScore<0)return{...base,entryAllowed:false,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_MARKET_CONFIRMED_DOWN'};
  if(politicalScore>0){
    const counts=context.subjectCounts||{};
    const geopolitical=Number(counts.GEOPOLITICS||0);
    const crypto=Number(counts.CRYPTO||0);
    if(geopolitical>0)return{...base,entryAllowed:true,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_MARKET_CONFIRMED_UP_NO_ACCELERATION'};
    if(crypto>0)return{...base,entryAllowed:true,cooldownMs:EVENT_COOLDOWN,reason:'POLITICAL_CRYPTO_CONFIRMED_UP'};
    return{...base,entryAllowed:true,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_MARKET_CONFIRMED_UP_NO_ACCELERATION'};
  }
  return{...base,entryAllowed:true,cooldownMs:NORMAL_COOLDOWN,reason:'POLITICAL_EVENT_NO_CONFIRMED_REACTION'};
}

async function getPoliticalLiveGate(publicGet,now=Date.now()){
  const context=readPoliticalContext(now);
  if(!context.enabled||!context.verified||context.matching===0)return evaluatePoliticalGate(context,null);
  try{
    const payload=await publicGet('/api/v5/market/candles?instId=BTC-EUR&bar=5m&limit=30');
    return evaluatePoliticalGate(context,marketReaction(payload,now));
  }catch{
    return evaluatePoliticalGate(context,null);
  }
}

module.exports={marketReaction,evaluatePoliticalGate,getPoliticalLiveGate,NORMAL_COOLDOWN,EVENT_COOLDOWN};
