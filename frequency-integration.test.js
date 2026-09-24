'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const minute = 60000;
const start = Date.UTC(2026, 8, 22, 0, 0);
// Execute the exact production coordinator with an entirely fake clock,
// exchange and HTTP stack. There is no network and no child-process execution.
function harness({interval = '5', allowDust = true, kind = 'empty', signal = false, pending = false, stale = false} = {}) {
  let now = start, requests = [], logs = [], scheduled = null;
  const source = fs.readFileSync(require.resolve('./multi-live'), 'utf8');
  const prices = {'BTC-EUR': 65000, 'ETH-EUR': 3000, 'DOGE-EUR': 0.15};
  const residue = kind === 'dust' ? 8e-7 : kind === 'position' ? 0.005 : 0;
  function rows(pair) {
    const activeSignal = Array.isArray(signal) ? signal.includes((now-start)/minute) : signal;
    return Array.from({length: 100}, (_, i) => {
      const close = prices[pair] * (1 + (100 - i) * 0.00001 + (activeSignal && i === 0 ? 0.005 : 0));
      return [String(now - (i + 1) * 5 * minute - (stale ? 3600000 : 0)), '0', '0', '0', String(close), String(activeSignal && i === 0 ? 10000 : 100), '0', '0', '1'];
    });
  }
  const book = pair => residue && pair === 'ETH-EUR' ? [{ordId:'synthetic',clOrdId:'ANTONsynthetic',instId:pair,side:'buy',accFillSz:String(residue),avgPx:'3000',fee:'0',feeCcy:'EUR',cTime:String(start - 3600000)}] : [];
  const fakeFetch = async (url, options = {}) => {
    const signed = String(url).startsWith('http://127.0.0.1');
    const payload = signed ? JSON.parse(options.body) : null;
    const route = signed ? payload.path : new URL(url).pathname + new URL(url).search;
    const parsed = new URL(route, 'https://mock.invalid');
    const pair = parsed.searchParams.get('instId');
    requests.push({at: now, method: payload?.method || 'GET', route, body: payload?.body});
    let data;
    if (route.startsWith('/api/v5/account/balance')) data = [{details: [{ccy:'EUR',availBal:'100'}, {ccy:'BTC',availBal:'0'}, {ccy:'ETH',availBal:String(residue)}, {ccy:'DOGE',availBal:'0'}]}];
    else if (route.startsWith('/api/v5/trade/orders-history-archive')) data = [];
    else if (route.startsWith('/api/v5/trade/orders-history')) data = book(pair);
    else if (route.startsWith('/api/v5/trade/orders-pending')) data = pending ? [{clOrdId:'ANTONpending'}] : [];
    else if (route.startsWith('/api/v5/public/instruments')) data = [{state:'live', minSz: pair === 'BTC-EUR' ? '0.0001' : pair === 'ETH-EUR' ? '0.001' : '10',lotSz:pair === 'BTC-EUR' ? '0.00000001' : '0.000001'}];
    else if (route.startsWith('/api/v5/market/ticker')) data = [{last:String(prices[pair])}];
    else if (route.startsWith('/api/v5/market/candles')) data = rows(pair);
    else if (route.startsWith('/api/v5/public/open-interest')) data = [{instId:pair,oiUsd:String(1000000*(1+(now-start)/(5*minute)*0.002)),ts:String(now)}];
    else if (route.startsWith('/api/v5/public/funding-rate')) data = [{instId:pair,fundingRate:'-0.001'}];
    else if (route === '/api/v5/trade/order') data = [{sCode:'0',ordId:'SIMULATED_ONLY'}];
    else throw Error('UNEXPECTED_TEST_ROUTE ' + route);
    return {ok: true, json: async () => ({ok:true,code:'0',data})};
  };
  const fakeChild = {once(){},kill(){}};
  const fakeServer = {listen(port, host, cb){cb();},close(){}};
  const context = {
    module:{exports:{}}, __dirname:__dirname, fetch:fakeFetch, AbortSignal,
    Date:class extends Date {static now(){return now;}},
    process:{env:{MULTI_SPOT_LIVE:'true',MAX_ORDER_EUR:'20',SIGNER_TOKEN:'synthetic-test-only',MULTI_SIGNAL_INTERVAL_MINUTES:interval,MULTI_ALLOW_DUST_REENTRY:String(allowDust)},execPath:'unused',once(){},exit(){throw Error('TEST_UNEXPECTED_EXIT');}},
    console:{log:m=>logs.push(m),error:m=>logs.push(m),warn:m=>logs.push(m)},
    require:name=> name === 'node:child_process' ? {spawn:()=>fakeChild} : name === 'node:http' ? {createServer:()=>fakeServer,request:()=>{throw Error('NETWORK_NOT_ALLOWED');}} : require(name),
    setTimeout:()=>0,clearTimeout(){},setInterval:(fn,delay)=>{scheduled={fn,delay};return 1;},clearInterval(){}
  };
  vm.runInNewContext(source + '\nrun();', context, {filename:require.resolve('./multi-live')});
  return {get period(){return scheduled.delay;}, requests, logs, async tick(at){now=start+at*minute;await scheduled.fn();}};
}
test('five-minute candidate evaluates three times as often without forced buys', async () => {
  const baseline=harness({interval:'15'}), candidate=harness({interval:'5'});
  assert.equal(baseline.period,15*minute);assert.equal(candidate.period,5*minute);
  for(let t=0;t<60;t+=15)await baseline.tick(t);
  for(let t=0;t<60;t+=5)await candidate.tick(t);
  const count=h=>h.logs.filter(l=>l.startsWith('ANTON_MULTI_SIGNAL')).length;
  assert.equal(count(baseline),12);assert.equal(count(candidate),36);
  assert.equal(candidate.requests.filter(r=>r.method==='POST').length,0);
  assert.equal(candidate.logs.filter(l=>l.startsWith('ANTON_MULTI_ERROR')).length,0);
  const derivativeRoutes=candidate.requests.filter(r=>r.route.startsWith('/api/v5/public/')).map(r=>r.route);
  for(const instId of ['BTC-USDT-SWAP','ETH-USDT-SWAP','DOGE-USDT-SWAP']){
    assert.ok(derivativeRoutes.some(r=>r.includes('open-interest')&&r.includes(instId)));
    assert.ok(derivativeRoutes.some(r=>r.includes('funding-rate')&&r.includes(instId)));
  }
});
test('candidate can catch a synthetic breakout between baseline checks', async () => {
  const baseline=harness({interval:'15',signal:[20]}), candidate=harness({interval:'5',signal:[20]});
  for(const t of [0,15,30])await baseline.tick(t);
  for(const t of [0,5,10,15,20,25,30])await candidate.tick(t);
  assert.equal(baseline.requests.filter(r=>r.method==='POST').length,0);
  const simulated=candidate.requests.filter(r=>r.method==='POST');
  assert.equal(simulated.length,1);
  assert.equal(simulated[0].at,start+20*minute);
});
test('sub-lot dust candidate changes synthetic ETH eligibility, retaining cooldown and caps', async () => {
  const disabled=harness({allowDust:false,kind:'dust',signal:true});
  const enabled=harness({allowDust:true,kind:'dust',signal:true});
  for(const h of [disabled,enabled])for(const t of [0,5,10,15,20,25])await h.tick(t);
  assert.ok(disabled.logs.some(l=>l.includes('DUST_REENTRY_DISABLED')));
  assert.equal(disabled.requests.filter(r=>r.body?.instId==='ETH-EUR'&&r.method==='POST').length,0);
  const eth=enabled.requests.filter(r=>r.body?.instId==='ETH-EUR'&&r.method==='POST');
  assert.equal(eth.length,1);
  assert.equal(eth[0].body.sz,'20');
  assert.equal(enabled.requests.some(r=>r.body&&Number(r.body.sz)>20),false);
});
test('normal positions, stale data and pending orders still prevent new entries', async () => {
  const position=harness({kind:'position',signal:true});
  for(const t of [0,5,10,15,20,25])await position.tick(t);
  assert.equal(position.requests.filter(r=>r.body?.instId==='ETH-EUR'&&r.method==='POST').length,0);
  assert.ok(position.logs.some(l=>l.includes('POSITION_ALREADY_OPEN')));
  for(const settings of [{stale:true},{pending:true}]){
    const h=harness({...settings,signal:true});
    for(const t of [0,5,10,15,20])await h.tick(t);
    assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
  }
});
