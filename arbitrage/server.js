'use strict';
const http = require('node:http');
const {evaluate} = require('./scanner');
const {scan: polyScan} = require('./live-feed');
const {scan: krakenScan} = require('./kraken-spot');
const dashboard = require('./dashboard');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
const send = (res,status,data) => {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
const demo = Object.freeze({marketId:'SYNTHETIC EXAMPLE',outcomeA:{ask:0.18,size:100},outcomeB:{ask:0.78,size:80},payout:1,feeA:0.005,feeB:0.005,settlementCost:0,minProfit:0});
const cache = new Map(), flights = new Map(), history = [];
const startedAt = new Date().toISOString();
const paperAutoscanEnabled = process.env.PAPER_AUTOSCAN === 'true';
const scanIntervalMs = 15 * 60 * 1000;
let totalScans = 0, candidateCount = 0, lastScanError = null;
function recordKraken(data) {
  const routes = Array.isArray(data.routes) ? data.routes : [];
  const best = routes.reduce((a,b) => !a || b.estimatedNetEUR > a.estimatedNetEUR ? b : a,null);
  const candidate = routes.some(r=>r.candidateForFurtherReview === true);
  history.push({fetchedAt:data.fetchedAt,bestRoute:best?.route || null,bestEstimatedNetEUR:best?.estimatedNetEUR ?? null,candidate});
  if(history.length > 500) history.shift();
  totalScans++;
  if(candidate) candidateCount++;
  lastScanError = null;
}
async function cached(key,fn) {
  const old=cache.get(key);
  if(old && Date.now()-old.time < 60000) return old.data;
  if(!flights.has(key)) flights.set(key,fn().then(data=>{
    cache.set(key,{time:Date.now(),data});
    if(key==='kraken') recordKraken(data);
    return data;
  }).finally(()=>flights.delete(key)));
  return flights.get(key);
}
async function periodicPaperScan() {
  try {
    await cached('kraken',krakenScan);
    console.log(`PAPER autoscan succeeded; totalScans=${totalScans}; orders disabled`);
  } catch(e) {
    lastScanError=String(e.message).slice(0,140);
    console.error(`PAPER autoscan failed: ${lastScanError}`);
  }
}
const server=http.createServer((req,res)=>{
  if(req.method==='GET' && req.url==='/health') return send(res,200,{status:'ok',mode:'PAPER',tradesEnabled:false,hardBudgetEUR:100,paperAutoscanEnabled,scanIntervalMinutes:paperAutoscanEnabled?15:null,totalScans,lastScanError,krakenFeedReceived:cache.has('kraken'),krakenDataTimestamp:cache.get('kraken')?.data.fetchedAt || null,polymarketTradingAllowedInGermany:false});
  if(req.method==='GET' && (req.url==='/' || req.url==='/dashboard')) {
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"});
    return res.end(dashboard);
  }
  if(req.method==='GET' && req.url==='/history') return send(res,200,{mode:'PAPER',tradesEnabled:false,realizedPnLAvailable:false,accountBalanceAvailable:false,persistent:false,startedAt,totalScans,candidateCount,latest:cache.get('kraken')?.data || null,records:history});
  if(req.method==='GET' && req.url==='/kraken') {cached('kraken',krakenScan).then(d=>send(res,200,d)).catch(e=>send(res,503,{mode:'PAPER',source:'Kraken',error:String(e.message).slice(0,140),tradesEnabled:false}));return;}
  if(req.method==='GET' && req.url==='/markets') {cached('poly',polyScan).then(d=>send(res,200,{...d,polymarketTradingAllowedInGermany:false})).catch(e=>send(res,503,{mode:'PAPER',source:'Polymarket',error:String(e.message).slice(0,140),tradesEnabled:false}));return;}
  if(req.method==='GET' && req.url==='/demo') return send(res,200,{synthetic:true,result:evaluate(demo)});
  if(req.method!=='POST' || req.url!=='/evaluate') return send(res,404,{error:'Not found'});
  if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json') return send(res,415,{error:'JSON required'});
  let body='',tooLarge=false;
  req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>16384 && !tooLarge){tooLarge=true;send(res,413,{error:'Payload too large'});req.destroy();}});
  req.on('end',()=>{if(tooLarge)return;try{send(res,200,{userSuppliedData:true,verified:false,result:evaluate(JSON.parse(body))});}catch(e){send(res,400,{mode:'PAPER',error:e.message});}});
});
if(require.main===module) server.listen(port,'0.0.0.0',()=>{
  console.log(`ANTON Arbitrage PAPER dashboard on ${port}; public Kraken scan; real trading disabled; background=${paperAutoscanEnabled}`);
  if(paperAutoscanEnabled) {
    void periodicPaperScan();
    setInterval(()=>void periodicPaperScan(),scanIntervalMs);
  }
});
module.exports=server;
