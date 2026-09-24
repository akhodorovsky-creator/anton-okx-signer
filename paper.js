'use strict';
// Fully automatic PAPER simulation of the production ANTON market-only strategy.
// Public OKX market data only. This process has no signer, API credentials, or order endpoint.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {compute}=require('./market-strategy');

const PAIRS=Object.freeze(['BTC-EUR','ETH-EUR','DOGE-EUR']);
const CAPITAL=300, ORDER_EUR=20, TP=.05, SL=.02, PERIOD=15*60_000, COOLDOWN=30*60_000;
const FEE_RATE=.001, SLIPPAGE_RATE=.0005;
const MODE='PAPER_AUTO_15M', LIVE_ORDERS_ENABLED=false, BASE='https://eea.okx.com';
const STORE=process.env.PAPER_STATE_PATH||path.join('/tmp','anton-paper-auto-state.json');
const CONFIG_HASH=crypto.createHash('sha256').update(JSON.stringify({PAIRS,CAPITAL,ORDER_EUR,TP,SL,PERIOD,COOLDOWN,FEE_RATE,SLIPPAGE_RATE,strategy:'market-only-v1.1'})).digest('hex');

function freshState(now=Date.now()){
  return {version:2,mode:MODE,configHash:CONFIG_HASH,createdAt:new Date(now).toISOString(),cashEur:CAPITAL,positions:{},lastFillAt:{},signalStates:Object.fromEntries(PAIRS.map(p=>[p,{lastOi:null,lastSignal:null,lastSignalAt:null}])),realizedPnlEur:0,feesEur:0,trades:[],entries:0,lastBucket:null,lastTickAt:null,lastSignals:{},lastQuotes:{}};
}
function restore(file=STORE){
  try{
    if(!fs.existsSync(file))return freshState();
    const s=JSON.parse(fs.readFileSync(file,'utf8'));
    if(s?.version!==2||s.mode!==MODE||s.configHash!==CONFIG_HASH||!Number.isFinite(s.cashEur)||!s.positions||!s.signalStates)return freshState();
    for(const pair of PAIRS)if(!s.signalStates[pair])s.signalStates[pair]={lastOi:null,lastSignal:null,lastSignalAt:null};
    return s;
  }catch{return freshState();}
}
function persist(state,file=STORE){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});fs.renameSync(file+'.tmp',file);}
function exposureEur(state){return Object.values(state.positions).reduce((s,p)=>s+p.spentEur,0);}
function markPosition(position,quote){const gross=position.qty*quote.bid*(1-SLIPPAGE_RATE);return gross*(1-FEE_RATE);}
function summary(state,quotes=state.lastQuotes){
  let openValue=0;for(const [pair,p] of Object.entries(state.positions)){const q=quotes[pair];if(q?.bid>0)openValue+=markPosition(p,q);else openValue+=p.spentEur;}
  const equity=state.cashEur+openValue,pnl=equity-CAPITAL;
  return {mode:MODE,liveOrdersEnabled:false,capitalEur:CAPITAL,orderEur:ORDER_EUR,takeProfitPct:TP*100,stopLossPct:SL*100,intervalMinutes:PERIOD/60000,cashEur:state.cashEur,equityEur:equity,pnlEur:pnl,returnPct:pnl/CAPITAL*100,realizedPnlEur:state.realizedPnlEur,feesEur:state.feesEur,exposureEur:exposureEur(state),openPositions:Object.keys(state.positions).length,entries:state.entries,closedTrades:state.trades.length,positions:state.positions,lastSignals:state.lastSignals,lastTickAt:state.lastTickAt,createdAt:state.createdAt};
}
function paperBuy(state,pair,quote,now=Date.now()){
  if(state.positions[pair])throw Error('POSITION_ALREADY_OPEN');
  if(state.cashEur+1e-9<ORDER_EUR||exposureEur(state)+ORDER_EUR>CAPITAL+1e-9)throw Error('PAPER_CAPITAL_LIMIT');
  const execPrice=quote.ask*(1+SLIPPAGE_RATE),fee=ORDER_EUR*FEE_RATE,qty=(ORDER_EUR-fee)/execPrice;
  if(!(execPrice>0&&qty>0))throw Error('INVALID_PAPER_BUY');
  state.cashEur-=ORDER_EUR;state.feesEur+=fee;state.entries++;
  state.positions[pair]={qty,entryPrice:execPrice,spentEur:ORDER_EUR,entryAt:now};state.lastFillAt[pair]=now;
  const event={type:'PAPER_BUY',pair,at:new Date(now).toISOString(),spentEur:ORDER_EUR,qty,price:execPrice};
  console.log('ANTON_PAPER_BUY '+JSON.stringify(event));return event;
}
function paperSell(state,pair,quote,reason,now=Date.now()){
  const p=state.positions[pair];if(!p)throw Error('POSITION_NOT_OPEN');
  const execPrice=quote.bid*(1-SLIPPAGE_RATE),gross=p.qty*execPrice,fee=gross*FEE_RATE,proceeds=gross-fee,pnl=proceeds-p.spentEur;
  state.cashEur+=proceeds;state.feesEur+=fee;state.realizedPnlEur+=pnl;state.lastFillAt[pair]=now;delete state.positions[pair];
  const trade={type:'PAPER_SELL',pair,entryAt:new Date(p.entryAt).toISOString(),exitAt:new Date(now).toISOString(),entryPrice:p.entryPrice,exitPrice:execPrice,spentEur:p.spentEur,proceedsEur:proceeds,pnlEur:pnl,reason};
  state.trades.push(trade);if(state.trades.length>500)state.trades=state.trades.slice(-500);
  console.log('ANTON_PAPER_SELL '+JSON.stringify(trade));return trade;
}
async function publicGet(route){
  if(!/^\/api\/v5\/(market\/(candles|ticker)|public\/(open-interest|funding-rate))\?/.test(route))throw Error('PUBLIC_ROUTE_ONLY');
  const r=await fetch(BASE+route,{method:'GET',headers:{accept:'application/json','cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('PUBLIC_HTTP_'+r.status);const d=await r.json();if(d?.code!=='0'||!Array.isArray(d.data))throw Error('PUBLIC_DATA_INVALID');return d;
}
function quoteFromTicker(payload,pair,now=Date.now()){
  const x=payload.data?.[0],bid=Number(x?.bidPx),ask=Number(x?.askPx),last=Number(x?.last),ts=Number(x?.ts);
  if(x?.instId!==pair||![bid,ask,last,ts].every(Number.isFinite)||!(bid>0&&ask>=bid&&last>0)||ts>now+60_000||now-ts>120_000)throw Error('INVALID_TICKER_'+pair);
  return {bid,ask,last,ts};
}
async function marketSnapshot(now=Date.now()){
  const [btc,eth,doge,oi,funding,...tickers]=await Promise.all([
    publicGet('/api/v5/market/candles?instId=BTC-EUR&bar=5m&limit=100'),
    publicGet('/api/v5/market/candles?instId=ETH-EUR&bar=5m&limit=100'),
    publicGet('/api/v5/market/candles?instId=DOGE-EUR&bar=5m&limit=100'),
    publicGet('/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'),
    publicGet('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'),
    ...PAIRS.map(p=>publicGet('/api/v5/market/ticker?instId='+encodeURIComponent(p)))
  ]);
  const feeds={'BTC-EUR':btc,'ETH-EUR':eth,'DOGE-EUR':doge};
  const quotes=Object.fromEntries(PAIRS.map((p,i)=>[p,quoteFromTicker(tickers[i],p,now)]));
  return {feeds,oi,funding,quotes,btc,eth};
}
function exitReason(position,last){if(last>=position.entryPrice*(1+TP))return 'TAKE_PROFIT_5_PERCENT';if(last<=position.entryPrice*(1-SL))return 'STOP_LOSS_2_PERCENT';return null;}
async function runTick(state,now=Date.now()){
  const bucket=Math.floor(now/PERIOD);if(state.lastBucket===bucket)return {processed:false,reason:'SAME_15M_BUCKET'};
  const m=await marketSnapshot(now);state.lastQuotes=m.quotes;
  let exited=false;
  for(const pair of PAIRS){const p=state.positions[pair];if(!p)continue;const reason=exitReason(p,m.quotes[pair].last);if(reason){paperSell(state,pair,m.quotes[pair],reason,now);exited=true;}}
  if(!exited){
    for(const pair of PAIRS){
      const sigState=state.signalStates[pair];
      const d=compute({btc:m.feeds[pair],eth:pair==='BTC-EUR'?m.eth:m.btc,oi:m.oi,funding:m.funding},sigState,now);
      state.lastSignals[pair]={...d,at:new Date(now).toISOString()};
      console.log('ANTON_PAPER_SIGNAL '+JSON.stringify({pair,signal:d.signal,actionable:d.actionable,score:d.score,reasons:d.reasons,intervalMinutes:15}));
      const oiNow=Number(m.oi.data?.[0]?.oiUsd??m.oi.data?.[0]?.oi);if(d.marketInputsFresh&&oiNow>0)sigState.lastOi=oiNow;
      if(!d.actionable||d.signal!=='BUY'||state.positions[pair])continue;
      if(now-(state.lastFillAt[pair]??-Infinity)<COOLDOWN)continue;
      if(state.cashEur<ORDER_EUR||exposureEur(state)+ORDER_EUR>CAPITAL)continue;
      paperBuy(state,pair,m.quotes[pair],now);sigState.lastSignal='BUY';sigState.lastSignalAt=now;break;
    }
  }
  state.lastBucket=bucket;state.lastTickAt=new Date(now).toISOString();persist(state);
  const report=summary(state,m.quotes);console.log('ANTON_PAPER_AUTO_SNAPSHOT '+JSON.stringify(report));return {processed:true,report};
}
async function main(){
  const state=restore();let busy=false;let lastError=null;
  const tick=async()=>{if(busy)return;busy=true;try{await runTick(state);lastError=null;}catch(e){lastError=String(e.message).slice(0,200);console.error('ANTON_PAPER_AUTO_ERROR '+lastError);}finally{busy=false;}};
  const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_PORT');
  const server=http.createServer((req,res)=>{
    if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'));}
    if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({ok:true,mode:MODE,liveOrdersEnabled:false,lastError}));}
    if(req.method==='GET'&&req.url==='/status'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({...summary(state),lastError,recentTrades:state.trades.slice(-20)}));}
    res.writeHead(404);res.end();
  });
  server.listen(port,'0.0.0.0',()=>console.log('ANTON_PAPER_AUTO_READY '+JSON.stringify({mode:MODE,liveOrdersEnabled:false,pairs:PAIRS,capitalEur:CAPITAL,orderEur:ORDER_EUR,tpPct:5,slPct:2,intervalMinutes:15})));
  await tick();const timer=setInterval(tick,60_000);timer.unref();
  const stop=()=>{clearInterval(timer);server.close();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
if(require.main===module)main().catch(e=>{console.error('PAPER_START_FAILED '+e.message);process.exitCode=1;});
module.exports={freshState,restore,persist,summary,paperBuy,paperSell,exitReason,runTick,exposureEur};
