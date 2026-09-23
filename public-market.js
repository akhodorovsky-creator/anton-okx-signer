'use strict';
const {CONFIG,HOUR,features}=require('./engine');
const BASE='https://api.binance.com';
const ALLOWED=new Set(['/api/v3/klines','/api/v3/ticker/bookTicker']);

async function readPublic(route,params,request=fetch) {
  if(!ALLOWED.has(route))throw Error('PUBLIC_MARKET_ROUTE_ONLY');
  const url=new URL(route,BASE);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const response=await request(url,{method:'GET',redirect:'error',headers:{accept:'application/json','cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('PUBLIC_MARKET_HTTP_'+response.status);
  const text=await response.text();
  if(text.length>1000000)throw Error('PUBLIC_MARKET_OVERSIZED');
  return JSON.parse(text);
}

async function snapshot({request=fetch,now=Date.now()}={}) {
  const currentHour=Math.floor(now/HOUR)*HOUR,latestExpected=currentHour-HOUR;
  const rows=await Promise.all(CONFIG.pairs.map(async pair=>{
    const symbol=pair.replace('-','');
    const [candles,ticker]=await Promise.all([
      readPublic('/api/v3/klines',{symbol,interval:'1h',limit:1000},request),
      readPublic('/api/v3/ticker/bookTicker',{symbol},request)]);
    if(!Array.isArray(candles))throw Error('PUBLIC_HISTORY_UNAVAILABLE');
    const bars=candles.filter(r=>Number(r[6])<now).map(r=>{
      if(Number(r[6])!==Number(r[0])+HOUR-1)throw Error('INVALID_BAR_CLOSE_TIME');
      return {timestamp:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])};
    });
    const latest=features(bars).at(-1);
    if(latest.timestamp!==latestExpected)throw Error('STALE_OR_FUTURE_CANDLES_'+pair);
    const bid=Number(ticker.bidPrice),ask=Number(ticker.askPrice);
    if(ticker.symbol!==symbol || ![bid,ask].every(Number.isFinite) || !(bid>0&&ask>=bid))throw Error('INVALID_QUOTE_'+pair);
    return {pair,features:latest,quote:{bid,ask}};
  }));
  return {venue:'BINANCE_PUBLIC_EUR_PROXY',observedAt:now,
    snapshot:Object.fromEntries(rows.map(r=>[r.pair,r.features])),quotes:Object.fromEntries(rows.map(r=>[r.pair,r.quote]))};
}
module.exports={readPublic,snapshot};
