"use strict";
// Market-only ANTON Signal: pure indicator calculation; never places orders.
const INTERVAL = 5 * 60_000;
function number(x) { if (x == null || x === '' || typeof x === 'boolean') return NaN; const n=Number(x); return Number.isFinite(n)?n:NaN; }
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function ema(v,p){let x=v[0],k=2/(p+1);for(let i=1;i<v.length;i++)x=v[i]*k+x*(1-k);return x;}
function rsi(v,p=14){let g=0,l=0;for(let i=v.length-p;i<v.length;i++){let d=v[i]-v[i-1];if(d>=0)g+=d;else l-=d;}return l===0?100:100-100/(1+g/l);}
function candles(data,now){
  if(!data||data.code!=='0'||!Array.isArray(data.data))throw new Error('UNAVAILABLE_CANDLES');
  const list=data.data.filter(r=>Array.isArray(r)&&r[8]==='1').map(r=>({ts:number(r[0]),close:number(r[4]),volume:number(r[5])})).sort((a,b)=>a.ts-b.ts);
  if(list.length<60||list.some(r=>!Number.isFinite(r.ts)||!(r.close>0)||!(r.volume>=0)))throw new Error('INVALID_CANDLES');
  const last=list.at(-1);
  if(last.ts>now+60_000||now-(last.ts+INTERVAL)>15*60_000)throw new Error('STALE_CANDLES');
  return list;
}
function compute(market,state={},now=Date.now()){
  const out={signal:'HOLD',actionable:false,score:null,reasons:[],marketInputsFresh:false,instrument:'BTC-EUR',strategy:'market-only-v1',timestamp:new Date(now).toISOString()};
  let btc,eth;
  try{btc=candles(market.btc,now);eth=candles(market.eth,now);}catch(e){out.reasons.push(e.message);return out;}
  const oi=number(market.oi?.data?.[0]?.oiUsd??market.oi?.data?.[0]?.oi);
  const funding=number(market.funding?.data?.[0]?.fundingRate);
  const oiTs=number(market.oi?.data?.[0]?.ts);
  if(market.oi?.code!=='0'||market.funding?.code!=='0'||!(oi>0)||!Number.isFinite(funding)||!Number.isFinite(oiTs)||oiTs>now+60_000||now-oiTs>15*60_000){out.reasons.push('DERIVATIVES_DATA_UNAVAILABLE');return out;}
  out.marketInputsFresh=true;
  const close=btc.map(x=>x.close),price=close.at(-1),prev=close.at(-2);
  const lastVol=btc.at(-1).volume,volAvg=btc.slice(-21,-1).reduce((s,x)=>s+x.volume,0)/20;
  if(!(volAvg>0)||!Number.isFinite(prev)||!(prev>0)){out.reasons.push('INVALID_MARKET_VOLUME');return out;}
  const ret5=(price/prev-1)*100,volRatio=lastVol/volAvg,ema20=ema(close,20),ema50=ema(close,50),rsi14=rsi(close);
  let technical=ema20>ema50?0.45:-0.45;
  if(rsi14<=38)technical+=0.45;
  if(rsi14>=62)technical-=0.45;
  if(ret5>0.2&&volRatio>1.4)technical+=0.35;
  if(ret5< -0.2&&volRatio>1.4)technical-=0.35;
  technical=clamp(technical,-1.2,1.2);
  const prior=number(state.lastOi),oiChange=prior>0?(oi/prior-1)*100:0;
  let flow=0;
  if(Math.abs(oiChange)>=0.35){
    if(oiChange>0&&ret5>0.10)flow+=0.55;
    if(oiChange>0&&ret5< -0.10)flow-=0.55;
    if(oiChange<0&&ret5>0.10)flow+=0.20;
    if(oiChange<0&&ret5< -0.10)flow-=0.20;
  }
  if(funding>0.0005)flow-=0.35;
  if(funding< -0.0005)flow+=0.35;
  flow=clamp(flow,-1.2,1.2);
  const score=technical+flow;
  let signal='HOLD';
  if(score>=0.9)signal='BUY';else if(score<=-0.9)signal='SELL';
  const elapsed=now-number(state.lastSignalAt);
  const cooldown=signal!=='HOLD'&&state.lastSignal===signal&&Number.isFinite(elapsed)&&elapsed>=0&&elapsed<30*60_000;
  Object.assign(out,{signal,actionable:signal!=='HOLD'&&!cooldown,score:Number(score.toFixed(3)),price,technical:Number(technical.toFixed(3)),flow:Number(flow.toFixed(3)),oiChange:Number(oiChange.toFixed(3)),rsi14:Number(rsi14.toFixed(2)),btcCandleAt:new Date(btc.at(-1).ts).toISOString(),ethCandleAt:new Date(eth.at(-1).ts).toISOString()});
  out.reasons.push(cooldown?'COOLDOWN':'MARKET_ONLY');return out;
}
module.exports={candles,compute};