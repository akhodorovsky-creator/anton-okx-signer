'use strict';
// Independent PAPER market-signal research. NEVER imports signer, credentials, or order routes.
const {levels}=require('./kraken-spot');
const PAIRS=Object.freeze([{symbol:'SOL',pair:'SOLEUR'},{symbol:'ADA',pair:'ADAEUR'},{symbol:'XRP',pair:'XRPEUR'}]);
const FEE=Object.freeze({maker:0.004,taker:0.008}); // illustrative, not the user's verified fee
const RESERVE=0.002, BUDGET=100, MAX_PER_PAIR=20;
function ema(v,p){let n=v[0],k=2/(p+1);for(let i=1;i<v.length;i++)n=v[i]*k+n*(1-k);return n;}
function rsi(v){let gains=0,loss=0;for(let i=v.length-14;i<v.length;i++){const x=v[i]-v[i-1];if(x>=0)gains+=x;else loss-=x;}return loss===0?100:100-100/(1+gains/loss);}
async function getPublic(path,get=fetch){const r=await get('https://api.kraken.com/0/public/'+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('KRAKEN_HTTP_'+r.status);const j=await r.json();if(!Array.isArray(j.error)||j.error.length||!j.result)throw Error('KRAKEN_API_ERROR');return j.result;}
function single(result){const entries=Object.entries(result).filter(([k])=>k!=='last');if(entries.length!==1)throw Error('AMBIGUOUS_PAIR');return entries[0][1];}
function analyse({symbol,pair},ohlc,book,meta,now=Date.now()){
 if(!meta||meta.status!=='online'||meta.quote!=='ZEUR'||!(Number(meta.ordermin)>0))throw Error('PAIR_ELIGIBILITY_UNVERIFIED');
 const rows=ohlc.filter(r=>Array.isArray(r)&&r.length>=7).map(r=>({ts:Number(r[0])*1000,close:Number(r[4]),volume:Number(r[6])})).filter(r=>r.ts+300000<=now).sort((a,b)=>a.ts-b.ts);
 if(rows.length<60||rows.some(r=>!(r.close>0)||!(r.volume>=0)||!Number.isFinite(r.ts)))throw Error('INSUFFICIENT_CANDLES');
 const last=rows.at(-1);if(last.ts>now||now-(last.ts+300000)>900000)throw Error('STALE_CANDLES');
 const asks=levels(book,'asks'),bids=levels(book,'bids'),ask=asks[0],bid=bids[0];if(!ask||!bid||!(ask.price>bid.price))throw Error('INVALID_ORDER_BOOK');
 const closes=rows.map(r=>r.close),e20=ema(closes,20),e50=ema(closes,50),ret5=(last.close/closes.at(-2)-1)*100;
 const avg=rows.slice(-21,-1).reduce((s,r)=>s+r.volume,0)/20;if(!(avg>0))throw Error('NO_VOLUME');
 const volumeRatio=last.volume/avg,rsi14=rsi(closes);
 const trend=e20>e50?'UP':e20<e50?'DOWN':'FLAT';
 const signal=trend==='UP'&&ret5>0.2&&volumeRatio>1.4&&rsi14<70?'WATCH_UP':'HOLD';
 const minBase=Number(meta.ordermin),costmin=Number(meta.costmin||0),minimumEUR=Math.max(minBase*ask.price,costmin);
 const orderSizeValid=minimumEUR<=MAX_PER_PAIR && MAX_PER_PAIR/ask.price<=ask.baseSize && MAX_PER_PAIR/ask.price<=bid.baseSize;
 const spreadPct=(ask.price/bid.price-1)*100;
 const requiredBidRisePct=(ask.price/bid.price/((1-FEE.taker)**2*(1-RESERVE))-1)*100;
 return {symbol,pair:meta.wsname||pair,mode:'PAPER',ordersEnabled:false,signal,actionable:false,price:last.close,bid:bid.price,ask:ask.price,spreadPct,ret5,volumeRatio,rsi14,trend,minimumOrderEUR:minimumEUR,illustrativeOrderEUR:MAX_PER_PAIR,orderSizeValid,feeAssumption:FEE,slippageReservePct:RESERVE*100,requiredBidRisePct,feeVerified:false,accountEligibilityVerified:false,positionEUR:0,realizedPnLEUR:null,candleAt:new Date(last.ts).toISOString(),warning:'Watch signal only: directional spot risk; actual fees, fills, account pair access and net profitability unverified.'};
}
async function scan(options={}){const get=options.get||fetch;const now=options.now||Date.now();const markets=await Promise.all(PAIRS.map(async cfg=>{try{const [o,b,m]=await Promise.all([getPublic('OHLC?pair='+cfg.pair+'&interval=5',get),getPublic('Depth?pair='+cfg.pair+'&count=10',get),getPublic('AssetPairs?pair='+cfg.pair,get)]);return analyse(cfg,single(o),single(b),single(m),now);}catch(e){return {symbol:cfg.symbol,pair:cfg.pair,mode:'PAPER',signal:'UNAVAILABLE',actionable:false,ordersEnabled:false,error:String(e.message).slice(0,100)};}}));return {mode:'PAPER',strategy:'independent-alt-assets-v1',exchange:'Kraken public spot',fetchedAt:new Date(now).toISOString(),capitalLimitEUR:BUDGET,maxIllustrativeOrderEUR:MAX_PER_PAIR,tradesEnabled:false,accountConnected:false,markets,warning:'Research-only market signals, NOT profit, balance or executable orders. Main ANTON Signal untouched.'};}
module.exports={PAIRS,analyse,scan};
