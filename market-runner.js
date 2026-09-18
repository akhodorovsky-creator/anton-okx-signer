"use strict";
// Public reverse proxy + optional independent market-only signals.
// Existing risk-monitor, gateway, signer and independent TP/SL remain intact.
const http=require('node:http');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {compute}=require('./market-strategy');
const PORT=Number(process.env.PORT||3000),GATEWAY_PORT=PORT+2,SIGNER_PORT=PORT+3;
const LIVE=String(process.env.MARKET_ONLY_LIVE||'').toLowerCase()==='true';
// Railway polling is independent of n8n's 15-minute execution quota.
const INTERVAL=5*60_000;
const state={lastOi:null,lastSignal:null,lastSignalAt:null};
const OKX_BASE='https://eea.okx.com';
let busy=false,stopped=false;
const holdBody=JSON.stringify({signal:'HOLD',actionable:false,confirmLive:true});
function proxy(req,res){
  // Old n8n may send signals for BTC-USDT and blocked news. Quarantine ALL external
  // strategy instructions, but forward HOLD so existing open positions still get TP/SL.
  const suppress=req.method==='POST'&&(req.url||'').split('?')[0]==='/auto';
  const headers={...req.headers,host:`127.0.0.1:${GATEWAY_PORT}`};
  if(suppress){delete headers['transfer-encoding'];headers['content-length']=String(Buffer.byteLength(holdBody));}
  const upstream=http.request({hostname:'127.0.0.1',port:GATEWAY_PORT,path:req.url,method:req.method,headers,timeout:80000},r=>{
    res.writeHead(r.statusCode||502,r.headers);r.pipe(res);
  });
  upstream.on('error',e=>{console.error('ANTON_MARKET_PROXY_ERROR',e.message);if(!res.headersSent){res.writeHead(502);res.end('Gateway unavailable');}else res.destroy();});
  upstream.on('timeout',()=>upstream.destroy(new Error('Gateway timeout')));
  if(suppress){req.resume();upstream.end(holdBody);}else req.pipe(upstream);
}
async function publicJson(pathname){
  const r=await fetch(OKX_BASE+pathname,{signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('MARKET_HTTP_'+r.status);
  const d=await r.json();if(d?.code!=='0')throw new Error('MARKET_API_ERROR');return d;
}
async function localJson(port,method,route,body){
  if(!process.env.SIGNER_TOKEN)throw new Error('SIGNER_TOKEN_MISSING');
  const r=await fetch(`http://127.0.0.1:${port}${route}`,{
    method,headers:{authorization:`Bearer ${process.env.SIGNER_TOKEN}`,...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(65000)
  });
  const d=await r.json();if(!r.ok||d?.ok!==true)throw new Error('LOCAL_API_'+r.status);return d;
}
async function inspectReadiness(price){
  // Read-only account checks; no private write is done here.
  const [health,pnl,balance,instrument]=await Promise.all([
    localJson(SIGNER_PORT,'GET','/health'),
    localJson(SIGNER_PORT,'GET','/pnl'),
    localJson(SIGNER_PORT,'POST','/okx',{method:'GET',path:'/api/v5/account/balance?ccy=EUR'}),
    localJson(SIGNER_PORT,'POST','/okx',{method:'GET',path:'/api/v5/public/instruments?instType=SPOT&instId=BTC-EUR'})
  ]);
  if(health.mode!=='LIVE'||pnl.mode!=='LIVE'||pnl.instrument!=='BTC-EUR')throw new Error('LIVE_MODE_OR_PAIR_MISMATCH');
  const qty=Number(pnl.position?.qty);
  if(!Number.isFinite(qty)||qty<0)throw new Error('POSITION_UNVERIFIED');
  const free=Number(balance.data?.[0]?.details?.find(x=>x.ccy==='EUR')?.availBal);
  const min=Number(instrument.data?.[0]?.minSz),status=instrument.data?.[0]?.state;
  if(!(free>=20))throw new Error('INSUFFICIENT_OR_UNKNOWN_EUR');
  if(!(min>0)||min*price*1.02>20||status!=='live')throw new Error('INVALID_MIN_ORDER_OR_INSTRUMENT');
  return {qty};
}
async function tick(){
  if(busy||stopped)return;busy=true;
  try{
    const [btc,eth,oi,funding]=await Promise.all([
      publicJson('/api/v5/market/candles?instId=BTC-EUR&bar=5m&limit=100'),
      publicJson('/api/v5/market/candles?instId=ETH-EUR&bar=5m&limit=100'),
      publicJson('/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'),
      publicJson('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP')
    ]);
    const d=compute({btc,eth,oi,funding},state);
    const oiValue=Number(oi.data?.[0]?.oiUsd??oi.data?.[0]?.oi);
    if(d.marketInputsFresh&&Number.isFinite(oiValue)&&oiValue>0)state.lastOi=oiValue;
    console.log('ANTON_MARKET_SIGNAL '+JSON.stringify(d));
    if(!LIVE||!d.actionable)return;
    if(d.signal==='BUY'){
      const check=await inspectReadiness(d.price);
      if(check.qty>0){console.log('ANTON_MARKET_SKIP_EXISTING_POSITION');return;}
    }
    const reply=await localJson(GATEWAY_PORT,'POST','/auto',{
      signal:d.signal,actionable:true,confirmLive:true,signalTimestamp:d.timestamp,
      source:'railway-market-only-v1',instId:'BTC-EUR',dataQuality:{marketInputsFresh:true}
    });
    console.log('ANTON_MARKET_EXECUTION '+JSON.stringify({action:reply.action,reason:reply.reason||null,mode:reply.mode||null}));
    if(reply.action==='BUY'||reply.action==='SELL'){
      state.lastSignal=d.signal;state.lastSignalAt=Date.now();
    }
  }catch(e){console.error('ANTON_MARKET_ERROR '+String(e.message).slice(0,180));}
  finally{busy=false;}
}
function run(){
  if(!Number.isInteger(PORT)||PORT<1||PORT>65530)throw new Error('PORT_INVALID');
  const child=spawn(process.execPath,[path.join(__dirname,'risk-monitor.js')],{
    env:{...process.env,PORT:String(GATEWAY_PORT)},stdio:'inherit'
  });
  const server=http.createServer(proxy);
  server.listen(PORT,'0.0.0.0',()=>console.log('ANTON_MARKET_PROXY '+JSON.stringify({port:PORT,marketOnlyLive:LIVE,externalN8nSignals:'HOLD_ONLY'})));
  const first=setTimeout(tick,45_000),regular=setInterval(tick,INTERVAL);
  function stop(sig){if(stopped)return;stopped=true;clearTimeout(first);clearInterval(regular);server.close();child.kill(sig);}
  process.once('SIGTERM',()=>stop('SIGTERM'));process.once('SIGINT',()=>stop('SIGINT'));
  child.once('exit',(code,sig)=>{clearTimeout(first);clearInterval(regular);server.close();if(!stopped)console.error('ANTON_MONITOR_EXIT',code,sig);process.exit(code==null?1:code);});
}
if(require.main===module)run();
module.exports={proxy,tick};
