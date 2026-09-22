"use strict";
// Keep existing dashboard authentication, BTC monitor and order signer behind a
// single sequential coordinator. Disable the old independent BTC BUY process.
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {compute}=require('./market-strategy');
const {sellSize}=require('./lot-size');
const {signalPeriod,dustEnabled,observeOi,entryBlock}=require('./frequency-policy');
const PAIRS=Object.freeze(['BTC-EUR','ETH-EUR','DOGE-EUR']);
const CAP_EUR=200, TP=.05, SL=.02, PERIOD=15*60_000;
const SIGNAL_PERIOD=signalPeriod(process.env.MULTI_SIGNAL_INTERVAL_MINUTES);
const ALLOW_DUST_REENTRY=dustEnabled(process.env.MULTI_ALLOW_DUST_REENTRY);
const PORT=Number(process.env.PORT||3000),CHILD_PORT=PORT+10,SIGNER_PORT=PORT+23;
const LIVE=process.env.MULTI_SPOT_LIVE==='true';
const MAX_ORDER=Math.min(5,Number(process.env.MAX_ORDER_EUR||5));
const BOT_START=Date.parse('2026-09-01T00:00:00Z');
const states=new Map(PAIRS.map(p=>[p,{lastOi:null,lastSignal:null,lastSignalAt:null}]));
let busy=false,uncertain=false,cache=null;
const n=x=>x==null||x===''?NaN:Number(x);
function requirePositive(x,field){const v=n(x);if(!(v>0)||!Number.isFinite(v))throw Error('INVALID_'+field);return v;}
function round(x){return Number(x.toFixed(4));}
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));}
function proxy(req,res){const headers={...req.headers,host:`127.0.0.1:${CHILD_PORT}`};const up=http.request({hostname:'127.0.0.1',port:CHILD_PORT,path:req.url,method:req.method,headers,timeout:80000},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res);});up.on('timeout',()=>up.destroy(Error('UPSTREAM_TIMEOUT')));up.on('error',()=>{if(!res.headersSent)json(res,502,{ok:false,error:'Gateway unavailable'});else res.destroy();});req.pipe(up);}
function checkAuth(req,route){return new Promise((resolve,reject)=>{const up=http.request({hostname:'127.0.0.1',port:CHILD_PORT,path:route,method:'GET',headers:{cookie:req.headers.cookie||'',authorization:req.headers.authorization||''},timeout:65000},res=>{let text='';res.on('data',c=>{text+=c;if(text.length>1e6){res.destroy();reject(Error('AUTH_TOO_LARGE'));}});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));res.on('error',reject);});up.on('timeout',()=>up.destroy(Error('AUTH_TIMEOUT')));up.on('error',reject);up.end();});}
async function signer(method,route,body){if(!process.env.SIGNER_TOKEN)throw Error('SIGNER_TOKEN_MISSING');const r=await fetch(`http://127.0.0.1:${SIGNER_PORT}/okx`,{method:'POST',headers:{authorization:`Bearer ${process.env.SIGNER_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({method,path:route,...(body?{body,confirmLive:true}:{})}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok||d.ok!==true||d.code!=='0'||!Array.isArray(d.data))throw Error('OKX_API_'+r.status);return d.data;}
async function publicGet(route){const r=await fetch('https://eea.okx.com'+route,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('MARKET_HTTP_'+r.status);const d=await r.json();if(d.code!=='0'||!Array.isArray(d.data))throw Error('MARKET_DATA');return d;}
function uniqueOrders(recent,archive){if(!Array.isArray(recent)||!Array.isArray(archive)||recent.length>=100||archive.length>=100)throw Error('ORDER_HISTORY_INCOMPLETE');const map=new Map();for(const o of [...archive,...recent])if(String(o.clOrdId||'').startsWith('ANTON')&&o.ordId)map.set(o.ordId,o);return [...map.values()].sort((a,b)=>Number(a.cTime||0)-Number(b.cTime||0));}
function ledger(orders,price){let qty=0,cost=0,cash=0,fills=0,latest=0;for(const o of orders){const filled=n(o.accFillSz),avg=n(o.avgPx||o.fillPx);if(!(filled>0))continue;if(!(avg>0))throw Error('INVALID_FILL_PRICE');const fee=n(o.fee||0);if(!Number.isFinite(fee))throw Error('INVALID_FEE');const base=String(o.instId||'').split('-')[0];const baseFee=o.feeCcy===base?fee:0,eurFee=o.feeCcy==='EUR'?fee:0;if(fee&&!baseFee&&!eurFee)throw Error('UNKNOWN_FEE_CURRENCY');if(o.side==='buy'){const received=filled+baseFee;if(!(received>0))throw Error('INVALID_NET_FILL');qty+=received;const paid=filled*avg-eurFee;cash-=paid;cost+=paid;}else if(o.side==='sell'){const taken=filled-baseFee;if(!(taken>0)||taken>qty+1e-8)throw Error('SELL_EXCEEDS_TRACKED_POSITION');cost*=1-Math.min(1,taken/qty);qty=Math.max(0,qty-taken);cash+=filled*avg+eurFee;}else throw Error('UNKNOWN_SIDE');fills++;latest=Math.max(latest,Number(o.cTime||0));}if(!(qty>=0)||!(price>0))throw Error('INVALID_POSITION');return{qty,entry:qty>1e-9?cost/qty:0,exposure:qty*price,pnlEur:cash+qty*price,fills,latest};}
function orderSize(instrument,price,requested=MAX_ORDER){if(instrument.state!=='live')return{valid:false,reason:'PAIR_NOT_LIVE'};const min=requirePositive(instrument.minSz,'MIN_SIZE'),lot=requirePositive(instrument.lotSz,'LOT_SIZE');if(!(requested>0)||requested>5||requested>CAP_EUR)return{valid:false,reason:'ORDER_CAP'};if(min*price*1.03>requested)return{valid:false,reason:'BELOW_EXCHANGE_MINIMUM'};return{valid:true,min,lot};}
async function portfolio(){if(Date.now()-BOT_START>=85*86400_000)throw Error('ORDER_ARCHIVE_TIME_HORIZON_EXCEEDED');const bal=await signer('GET','/api/v5/account/balance?ccy=EUR,BTC,ETH,DOGE');const details=bal[0]?.details;if(!Array.isArray(details))throw Error('ACCOUNT_BALANCE_UNVERIFIED');const eurRow=details.find(x=>x.ccy==='EUR');const availableEur=eurRow?n(eurRow.availBal):0;if(!(availableEur>=0))throw Error('AVAILABLE_EUR_UNVERIFIED');const balances=Object.fromEntries(details.map(x=>[x.ccy,n(x.availBal)]));const pairs=[];for(const pair of PAIRS){const [recent,archive,pending,instruments,ticker]=await Promise.all([signer('GET',`/api/v5/trade/orders-history?instType=SPOT&instId=${pair}&limit=100`),signer('GET',`/api/v5/trade/orders-history-archive?instType=SPOT&instId=${pair}&limit=100`),signer('GET',`/api/v5/trade/orders-pending?instType=SPOT&instId=${pair}&limit=100`),signer('GET',`/api/v5/public/instruments?instType=SPOT&instId=${pair}`),publicGet(`/api/v5/market/ticker?instId=${pair}`)]);if(pending.length>=100||!instruments[0]||!ticker.data[0])throw Error('PAIR_UNVERIFIED_'+pair);const price=requirePositive(ticker.data[0].last,'TICKER_'+pair);const book=ledger(uniqueOrders(recent,archive),price);const free=balances[pair.split('-')[0]]??0;if(!(free>=0))throw Error('BASE_BALANCE_UNVERIFIED_'+pair);pairs.push({pair,price,...book,free,pending:pending.filter(x=>String(x.clOrdId||'').startsWith('ANTON')).length,instrument:instruments[0],minTrade:round(Number(instruments[0].minSz)*price*1.03)});}const exposureEur=pairs.reduce((s,p)=>s+p.exposure,0),pnlEur=pairs.reduce((s,p)=>s+p.pnlEur,0);if(!Number.isFinite(exposureEur)||!Number.isFinite(pnlEur))throw Error('PORTFOLIO_UNVERIFIED');return{pairs,exposureEur,pnlEur,availableEur,filledOrders:pairs.reduce((s,p)=>s+p.fills,0),mode:LIVE?'LIVE':'MONITOR_ONLY',updatedAt:new Date().toISOString(),capitalLimitEur:CAP_EUR,orderLimitEur:MAX_ORDER};}
async function submit(pair,side,size,id){const body={instId:pair,tdMode:'cash',side,ordType:'market',sz:size,tgtCcy:side==='buy'?'quote_ccy':'base_ccy',clOrdId:id};const result=await signer('POST','/api/v5/trade/order',body);if(!result[0]||result[0].sCode!=='0'||!result[0].ordId)throw Error('ORDER_REJECTED');console.log('ANTON_MULTI_ORDER_ACK '+JSON.stringify({pair,side,orderId:result[0].ordId}));return result[0];}
async function tick(){
  if(busy||uncertain||!LIVE)return;
  busy=true;
  try{
    if(!(MAX_ORDER>0)||MAX_ORDER>5)throw Error('ORDER_LIMIT_UNSAFE');
    const book=await portfolio();
    if(book.pairs.some(p=>p.pending))throw Error('BOT_ORDER_PENDING');
    let exited=false;
    for(const p of book.pairs){
      if(!(p.qty>1e-9))continue;
      const reason=p.price>=p.entry*(1+TP)?'TAKE_PROFIT_5_PERCENT':p.price<=p.entry*(1-SL)?'STOP_LOSS_2_PERCENT':null;
      if(!reason)continue;
      const size=sellSize(p.qty,p.free,p.instrument.lotSz,p.instrument.minSz);
      if(!size){console.error('ANTON_MULTI_EXIT_BLOCKED '+p.pair+' BELOW_MIN_OR_UNAVAILABLE');continue;}
      const id='ANTON'+crypto.randomBytes(10).toString('hex');
      try{await submit(p.pair,'sell',size,id);}catch(e){uncertain=true;throw Error('UNCERTAIN_EXIT_'+p.pair+'_'+e.message);}
      console.log('ANTON_MULTI_EXIT '+JSON.stringify({pair:p.pair,reason,qty:size}));
      exited=true;
    }
    if(exited){cache=null;return;}
    const [btc,eth,doge,oi,funding]=await Promise.all([
      publicGet('/api/v5/market/candles?instId=BTC-EUR&bar=5m&limit=100'),
      publicGet('/api/v5/market/candles?instId=ETH-EUR&bar=5m&limit=100'),
      publicGet('/api/v5/market/candles?instId=DOGE-EUR&bar=5m&limit=100'),
      publicGet('/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'),
      publicGet('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP')
    ]);
    const feeds={'BTC-EUR':btc,'ETH-EUR':eth,'DOGE-EUR':doge};
    for(const p of book.pairs){
      const state=states.get(p.pair), now=Date.now();
      const fast=SIGNAL_PERIOD<PERIOD;
      const window=fast?observeOi(state,oi.code==='0'?oi.data[0]:null,now):null;
      const computeState=fast?{...state,lastOi:window.ready?window.prior:null}:state;
      const d=compute({btc:feeds[p.pair],eth:p.pair==='BTC-EUR'?eth:btc,oi,funding},computeState,now);
      if(fast&&(!window.ready||d.btcCandleAt===state.lastEvaluatedCandleAt)){
        d.actionable=false;
        d.reasons.push(!window.ready?window.reason:'CANDLE_ALREADY_EVALUATED');
      }
      if(d.marketInputsFresh)state.lastEvaluatedCandleAt=d.btcCandleAt;
      console.log('ANTON_MULTI_SIGNAL '+JSON.stringify({pair:p.pair,signal:d.signal,actionable:d.actionable,fresh:d.marketInputsFresh,reasons:d.reasons,intervalMinutes:SIGNAL_PERIOD/60000,oiLookbackMs:window?.lookbackMs}));
      const oiNow=n(oi.data[0]?.oiUsd??oi.data[0]?.oi);
      if(d.marketInputsFresh&&oiNow>0)state.lastOi=oiNow;
      if(!d.actionable||d.signal!=='BUY')continue;
      const blocked=entryBlock(p,ALLOW_DUST_REENTRY);
      if(blocked){console.log('ANTON_MULTI_SKIP '+JSON.stringify({pair:p.pair,reason:blocked}));continue;}
      if(p.latest&&now-p.latest<30*60_000){console.log('ANTON_MULTI_SKIP '+JSON.stringify({pair:p.pair,reason:'RECENT_FILL_COOLDOWN'}));continue;}
      const check=orderSize(p.instrument,p.price);
      if(!check.valid){console.log('ANTON_MULTI_SKIP '+JSON.stringify({pair:p.pair,reason:check.reason,minTrade:p.minTrade}));continue;}
      if(book.exposureEur+MAX_ORDER>CAP_EUR||book.availableEur<MAX_ORDER)continue;
      const id='ANTON'+crypto.randomBytes(10).toString('hex');
      try{await submit(p.pair,'buy',String(MAX_ORDER),id);}catch(e){uncertain=true;throw Error('UNCERTAIN_BUY_'+p.pair+'_'+e.message);}
      state.lastSignal='BUY';state.lastSignalAt=now;cache=null;break;
    }
  }catch(e){console.error('ANTON_MULTI_ERROR '+e.message);}finally{busy=false;}
}
function page(){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ANTON Signal — три пары</title><style>body{background:#0b0f14;color:#edf3fc;font:15px system-ui;margin:0}main{max-width:900px;margin:auto;padding:18px}h1{font-size:25px}.muted{color:#a0b2c5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.tile{padding:17px;background:#141d28;border:1px solid #344252;border-radius:14px}.value{font-size:23px;font-weight:750;margin-top:6px}table{width:100%;border-collapse:collapse;display:block;overflow-x:auto;white-space:nowrap}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #344252;font-size:13px}th,small{color:#a0b2c5}#error{color:#ff9f9f}</style></head><body><main><h1>ANTON Signal</h1><p class="muted">BTC-EUR · ETH-EUR · DOGE-EUR · только Spot / EUR</p><p id="error"></p><section class="grid"><div class="tile">Режим<div id="mode" class="value">—</div></div><div class="tile">Прибыль / убыток (оценка)<div id="pnl" class="value">—</div></div><div class="tile">Открытые позиции<div id="exposure" class="value">—</div></div><div class="tile">Свободно EUR на OKX<div id="available" class="value">—</div></div><div class="tile">Исполненные ордера<div id="fills" class="value">—</div></div><div class="tile">Лимит капитала<div class="value">200 €</div><small>Не фактическая сумма на счёте</small></div></section><h2>Торговые пары</h2><table><thead><tr><th>Пара</th><th>Цена</th><th>Позиция</th><th>Стоимость</th><th>P&L (оценка)</th><th>Минимум / статус</th></tr></thead><tbody id="pairs"><tr><td colspan="6">Загрузка...</td></tr></tbody></table><p class="muted"><small id="updated">Обновление каждые 15 секунд. Результат оценочный, не банковская выписка.</small></p></main><script>const money=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n);async function refresh(){try{const r=await fetch('/multi-data',{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Ошибка данных');document.getElementById('error').textContent='';for(const [id,value] of Object.entries({mode:d.mode,pnl:money(d.pnlEur),exposure:money(d.exposureEur),available:money(d.availableEur),fills:d.filledOrders}))document.getElementById(id).textContent=value;document.getElementById('pairs').innerHTML=d.pairs.map(p=>'<tr><td>'+p.pair+'</td><td>'+money(p.price)+'</td><td>'+p.qty.toFixed(8)+'</td><td>'+money(p.exposure)+'</td><td>'+money(p.pnlEur)+'</td><td>'+(p.qty>0?'В позиции':p.minTrade>d.orderLimitEur?'Минимум выше лимита':p.instrumentLive?'Ожидает сигнал':'Недоступна')+'</td></tr>').join('');document.getElementById('updated').textContent='Обновлено: '+new Date(d.updatedAt).toLocaleString('ru-RU')+' · Результат оценочный.';}catch(e){document.getElementById('error').textContent='Не удалось обновить: '+e.message;}}refresh();setInterval(refresh,15000);</script></body></html>`;}
async function handler(req,res){const route=(req.url||'').split('?')[0];if(req.method==='GET'&&(route==='/dashboard'||route==='/multi-data')){let auth;try{auth=await checkAuth(req,'/dashboard'+(route==='/dashboard'?(req.url.slice(route.length)||''):''));}catch{return json(res,502,{ok:false,error:'Auth unavailable'});}if(auth.status!==200){res.writeHead(auth.status||502,{...auth.headers,'cache-control':'no-store'});return res.end(auth.text);}if(route==='/dashboard'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer'});return res.end(page());}try{if(!cache||Date.now()-cache.at>10000)cache={at:Date.now(),value:await portfolio()};return json(res,200,{ok:true,...cache.value,pairs:cache.value.pairs.map(p=>({pair:p.pair,price:p.price,qty:p.qty,exposure:round(p.exposure),pnlEur:round(p.pnlEur),minTrade:p.minTrade,instrumentLive:p.instrument.state==='live'}))});}catch(e){console.error('ANTON_MULTI_DASHBOARD_ERROR '+e.message);return json(res,502,{ok:false,error:'Данные OKX временно недоступны'});}}return proxy(req,res);}
function run(){if(!Number.isInteger(PORT)||PORT<1||PORT>65500||!Number.isFinite(MAX_ORDER)||!(MAX_ORDER>0)||MAX_ORDER>5)throw Error('UNSAFE_CONFIGURATION');const child=spawn(process.execPath,[path.join(__dirname,'dashboard-launcher.js')],{env:{...process.env,PORT:String(CHILD_PORT),MARKET_ONLY_LIVE:'false'},stdio:'inherit'});const server=http.createServer((req,res)=>{handler(req,res).catch(e=>{console.error('ANTON_MULTI_HTTP_ERROR '+e.message);if(!res.headersSent)json(res,502,{ok:false,error:'Unavailable'});else res.destroy();});});server.listen(PORT,'0.0.0.0',()=>console.log('ANTON_MULTI_READY '+JSON.stringify({pairs:PAIRS,live:LIVE,maxOrderEur:MAX_ORDER,capEur:CAP_EUR,signalIntervalMinutes:SIGNAL_PERIOD/60000,allowDustReentry:ALLOW_DUST_REENTRY})));const initial=setTimeout(tick,60000),interval=setInterval(tick,SIGNAL_PERIOD);let closing=false;const stop=s=>{if(closing)return;closing=true;clearTimeout(initial);clearInterval(interval);server.close();child.kill(s);};process.once('SIGTERM',()=>stop('SIGTERM'));process.once('SIGINT',()=>stop('SIGINT'));child.once('exit',(code,s)=>{clearTimeout(initial);clearInterval(interval);server.close();if(!closing)console.error('ANTON_CHILD_EXIT '+JSON.stringify({code,s}));process.exit(code==null?1:code);});}
if(require.main===module)run();module.exports={PAIRS,ledger,uniqueOrders,orderSize,sellSize,page,handler,tick,portfolio};

