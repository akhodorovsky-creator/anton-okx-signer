'use strict';
const http = require('node:http');
const { evaluate } = require('./scanner');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
function send(res, status, value) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(value));
}
const demo = Object.freeze({marketId:'DEMO: two exhaustive outcomes (synthetic quotes)',outcomeA:{ask:0.18,size:100},outcomeB:{ask:0.78,size:80},payout:1,feeA:0.005,feeB:0.005,settlementCost:0,minProfit:0});
const page = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ANTON Arbitrage — PAPER</title><style>body{font:16px system-ui,sans-serif;max-width:680px;margin:32px auto;padding:0 18px;line-height:1.5;background:#101827;color:#f5f7fa}main{background:#202b3d;border-radius:18px;padding:24px}strong{color:#85e0b8}.warning{background:#433324;padding:12px;border-radius:9px}button{background:#85e0b8;border:0;padding:12px 18px;border-radius:8px;font-weight:bold;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101827;padding:16px;border-radius:10px}a{color:#85e0b8}</style></head><body><main><h1>ANTON Arbitrage</h1><p><strong>Сервис запущен · PAPER ONLY</strong></p><p class="warning">РЫНОЧНЫЕ ДАННЫЕ НЕ ПОДКЛЮЧЕНЫ. Все цены в демонстрации вымышленные. Сделки и переводы денег невозможны.</p><p>Отдельный экспериментальный сервис. Основной ANTON Signal не затронут.</p><h2>Демонстрация расчёта</h2><p>Два взаимоисключающих и исчерпывающих исхода, условные цены 0,18 и 0,78, комиссии 0,005 за каждую сторону. Расчёт не учитывает риск неисполнения, дефолта площадки и ошибок расчёта исхода.</p><button id="run" type="button">Рассчитать пример</button><pre id="out" aria-live="polite">Нажмите кнопку для расчёта.</pre><p>Технический статус: <a href="/health">/health</a></p></main><script>document.getElementById('run').onclick=async()=>{const out=document.getElementById('out');out.textContent='Расчёт…';try{const r=await fetch('/demo');if(!r.ok)throw Error('HTTP '+r.status);out.textContent=JSON.stringify(await r.json(),null,2)}catch(e){out.textContent='Ошибка: '+e.message}}</script></body></html>`;
const server = http.createServer((req,res)=>{
 if(req.method==='GET' && req.url==='/health')return send(res,200,{status:'ok',bot:'ANTON Arbitrage',mode:'PAPER',liveEnabled:false,connectedToMarket:false});
 if(req.method==='GET' && req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"});return res.end(page);}
 if(req.method==='GET' && req.url==='/demo')return send(res,200,{synthetic:true,quoteSource:'hard-coded illustration, not live market data',result:evaluate(demo)});
 if(req.method!=='POST'||req.url!=='/evaluate')return send(res,404,{error:'Not found'});
 if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')return send(res,415,{error:'Content-Type must be application/json'});
 let body='';let exceeded=false;
 req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>16384){exceeded=true;send(res,413,{error:'Payload too large'});req.destroy();}});
 req.on('end',()=>{if(exceeded)return;try{send(res,200,{syntheticOrUserSupplied:true,marketDataVerified:false,result:evaluate(JSON.parse(body))});}catch(e){send(res,400,{error:e.message,mode:'PAPER'});}});
});
if(require.main===module)server.listen(port,'0.0.0.0',()=>console.log(`ANTON Arbitrage PAPER dashboard listening on ${port}; live trading disabled`));
module.exports=server;
