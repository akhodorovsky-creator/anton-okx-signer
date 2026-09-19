'use strict';
const http = require('node:http');
const { evaluate } = require('./scanner');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const send = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok', bot: 'ANTON Arbitrage', mode: 'PAPER', liveEnabled: false, connectedToMarket: false });
  if (req.method === 'GET' && req.url === '/') return send(res, 200, { bot: 'ANTON Arbitrage', mode: 'PAPER', status: 'Prototype online; no live market feed or trading', endpoints: ['GET /health', 'POST /evaluate'] });
  if (req.method !== 'POST' || req.url !== '/evaluate') return send(res, 404, { error: 'Not found' });
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') return send(res, 415, { error: 'Content-Type must be application/json' });
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 16384) req.destroy(); });
  req.on('end', () => {
    try { send(res, 200, evaluate(JSON.parse(body))); }
    catch (e) { send(res, 400, { error: e.message, mode: 'PAPER' }); }
  });
});
if (require.main === module) server.listen(port, '0.0.0.0', () => console.log(`ANTON Arbitrage PAPER health server listening on ${port}; live trading disabled`));
module.exports = server;
