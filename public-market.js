'use strict';
const {CONFIG,HOUR,features}=require('./engine');
const BASE='https://eea.okx.com';
const VENUE='OKX_PUBLIC_EUR';
const ALLOWED=new Set(['/api/v5/market/history-candles','/api/v5/market/ticker']);

async function readPublic(route,params,request=fetch) {
  if(!ALLOWED.has(route))throw Error('PUBLIC_MARKET_ROUTE_ONLY');
  const url=new URL(route,BASE);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const response=await request(url,{method:'GET',redirect:'error',headers:{accept:'application/json','cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('PUBLIC_MARKET_HTTP_'+response.status);
  const text=await response.text();
  if(text.length>1000000)throw Error('PUBLIC_MARKET_OVERSIZED');
  const payload=JSON.parse(text);
  if(payload.code!=='0'||!Array.isArray(payload.data))throw Error('PUBLIC_MARKET_RESPONSE');
  return payload.data;
}

async function snapshot({request=fetch,now=Date.now()}={}) {
  const currentHour=Math.floor(now/HOUR)*HOUR,latestExpected=currentHour-HOUR;
  const rows=await Promise.all(CONFIG.pairs.map(async pair=>{
    const candles=[];let after;
    for(let page=0;page<5;page++) {
      const part=await readPublic('/api/v5/market/history-candles',{instId:pair,bar:'1H',limit:100,...(after?{after}:{})},request);
      if(!part.length)throw Error('PUBLIC_HISTORY_UNAVAILABLE');
      const next=Math.min(...part.map(r=>Number(r[0])));
      if(!Number.isFinite(next)||(after&&next>=Number(after)))throw Error('HISTORY_NOT_ADVANCING');
      candles.push(...part);after=String(next);
    }
    const ticker=(await readPublic('/api/v5/market/ticker',{instId:pair},request))[0];
    const bars=candles.filter(r=>r[8]==='1'&&Number(r[0])+HOUR<=now).map(r=>({timestamp:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])})).sort((a,b)=>a.timestamp-b.timestamp);
    const latest=features(bars).at(-1);
    if(latest.timestamp!==latestExpected)throw Error('STALE_OR_FUTURE_CANDLES_'+pair);
    const bid=Number(ticker?.bidPx),ask=Number(ticker?.askPx),quoteAt=Number(ticker?.ts);
    if(ticker?.instId!==pair||![bid,ask,quoteAt].every(Number.isFinite)||!(bid>0&&ask>=bid)||now-quoteAt>120000||quoteAt-now>60000)throw Error('INVALID_OR_STALE_QUOTE_'+pair);
    return {pair,features:latest,quote:{bid,ask,exchangeTimestamp:quoteAt}};
  }));
  return {venue:VENUE,observedAt:now,
    snapshot:Object.fromEntries(rows.map(r=>[r.pair,r.features])),quotes:Object.fromEntries(rows.map(r=>[r.pair,r.quote]))};
}
module.exports={readPublic,snapshot,VENUE};
