"use strict";
// Shadow-only research module. No exchange credentials, network access or order execution.
const ACTORS=new Set(['trump','musk']);
const MAX_AGE_MS=30*60_000;
const MAX_FUTURE_MS=60_000;
const SOURCES={trump:new Set(['truthsocial.com','www.truthsocial.com','whitehouse.gov','www.whitehouse.gov','x.com','www.x.com','twitter.com','www.twitter.com']),musk:new Set(['x.com','www.x.com','twitter.com','www.twitter.com','tesla.com','www.tesla.com'])};
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function normalizeUrl(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;u.hash='';u.search='';return u;}catch{return null;}}
function inspectEvent(event,market={},seen=new Set(),now=Date.now()){
  const out={mode:'SHADOW_ONLY',actionable:false,tradeSignal:null,status:'REJECTED',reasons:[],actor:null,eventId:null,observedMarket:null};
  if(!event||typeof event!=='object'){out.reasons.push('INVALID_EVENT');return out;}
  const actor=String(event.actor||'').toLowerCase();out.actor=actor;
  if(!ACTORS.has(actor)){out.reasons.push('UNKNOWN_ACTOR');return out;}
  const url=normalizeUrl(event.sourceUrl);
  if(!url||!SOURCES[actor].has(url.hostname)){out.reasons.push('UNTRUSTED_SOURCE_DOMAIN');return out;}
  const id=String(event.id||'');if(!/^[a-zA-Z0-9:_-]{6,160}$/.test(id)){out.reasons.push('INVALID_EVENT_ID');return out;}
  out.eventId=id;
  if(seen.has(`${actor}:${id}`)){out.reasons.push('DUPLICATE_EVENT');return out;}
  const published=Date.parse(event.publishedAt);
  if(!Number.isFinite(published)||published>now+MAX_FUTURE_MS||now-published>MAX_AGE_MS){out.reasons.push('STALE_OR_INVALID_PUBLICATION_TIME');return out;}
  // A URL alone is not proof of authorship. The upstream collector must independently
  // authenticate the original post/statement; screenshots and reposts do not qualify.
  if(event.originalVerified!==true){out.reasons.push('ORIGINAL_NOT_VERIFIED');return out;}
  const before=finite(market.priceBefore),after=finite(market.priceAfter);
  const volume=finite(market.volumeRatio),oi=finite(market.oiChangePct),funding=finite(market.fundingRate);
  const marketAt=Date.parse(market.observedAt);
  if(!(before>0)||!(after>0)||!(volume>=0)||oi===null||funding===null||!Number.isFinite(marketAt)||marketAt<published||marketAt>now+MAX_FUTURE_MS||now-marketAt>15*60_000){out.reasons.push('MISSING_OR_STALE_MARKET_CONFIRMATION');return out;}
  const movePct=(after/before-1)*100;
  out.observedMarket={movePct:Number(movePct.toFixed(4)),volumeRatio:volume,oiChangePct:oi,fundingRate:funding};
  out.status=Math.abs(movePct)>=0.2&&volume>=1.4&&Math.abs(oi)>=0.35?'OBSERVED_CORRELATION':'INSUFFICIENT_CONFIRMATION';
  out.reasons.push(out.status==='OBSERVED_CORRELATION'?'RESEARCH_ONLY_NOT_CAUSAL':'MARKET_DID_NOT_CONFIRM');
  return out;
}
module.exports={inspectEvent};
