'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const MINUTE=60_000,DAY=86_400_000;
const start=Date.UTC(2026,8,25,12,0,0);
const latestDaily=Date.UTC(2026,8,24,0,0,0);

function harness({riskOn=false,pending=false,ethPosition=false,ethPrice=3000,btcQty=0,btcLastAge=2*DAY}={}){
  let now=start,requests=[],logs=[],scheduled=null;
  const source=fs.readFileSync(require.resolve('./multi-live'),'utf8');
  const prices={'BTC-EUR':65000,'ETH-EUR':ethPrice,'DOGE-EUR':0.15};
  function dailyRows(after){
    const first=after?Number(after)-DAY:latestDaily;
    return Array.from({length:100},(_,i)=>{
      const ts=first-i*DAY;
      const close=riskOn&&ts===latestDaily?103:100;
      return [String(ts),String(close),String(close),String(close),String(close),'100','0','0','1'];
    });
  }
  const book=pair=>{
    if(btcQty>0&&pair==='BTC-EUR')return [{ordId:'btc-synthetic',clOrdId:'ANTONbtcsynthetic',instId:pair,side:'buy',accFillSz:String(btcQty),avgPx:'65000',fee:'0',feeCcy:'EUR',cTime:String(start-btcLastAge)}];
    if(ethPosition&&pair==='ETH-EUR')return [{ordId:'eth-synthetic',clOrdId:'ANTONethsynthetic',instId:pair,side:'buy',accFillSz:'0.005',avgPx:'3000',fee:'0',feeCcy:'EUR',cTime:String(start-DAY)}];
    return [];
  };
  const fakeFetch=async(url,options={})=>{
    const signed=String(url).startsWith('http://127.0.0.1');
    const payload=signed?JSON.parse(options.body):null;
    const route=signed?payload.path:new URL(url).pathname+new URL(url).search;
    const parsed=new URL(route,'https://mock.invalid');
    const pair=parsed.searchParams.get('instId');
    requests.push({at:now,method:payload?.method||'GET',route,body:payload?.body});
    let data;
    if(route.startsWith('/api/v5/account/balance'))data=[{details:[
      {ccy:'EUR',availBal:'100'},{ccy:'BTC',availBal:String(btcQty)},
      {ccy:'ETH',availBal:ethPosition?'0.005':'0'},{ccy:'DOGE',availBal:'0'}
    ]}];
    else if(route.startsWith('/api/v5/trade/orders-history-archive'))data=[];
    else if(route.startsWith('/api/v5/trade/orders-history'))data=book(pair);
    else if(route.startsWith('/api/v5/trade/orders-pending'))data=pending?[{clOrdId:'ANTONpending'}]:[];
    else if(route.startsWith('/api/v5/public/instruments'))data=[{state:'live',minSz:pair==='BTC-EUR'?'0.0001':pair==='ETH-EUR'?'0.001':'10',lotSz:pair==='BTC-EUR'?'0.00000001':pair==='ETH-EUR'?'0.000001':'1'}];
    else if(route.startsWith('/api/v5/market/ticker'))data=[{last:String(prices[pair])}];
    else if(route.startsWith('/api/v5/market/history-candles'))data=dailyRows(parsed.searchParams.get('after'));
    else if(route==='/api/v5/trade/order')data=[{sCode:'0',ordId:'SIMULATED_ONLY'}];
    else throw Error('UNEXPECTED_TEST_ROUTE '+route);
    return {ok:true,json:async()=>({ok:true,code:'0',data})};
  };
  const fakeChild={once(){},kill(){}};
  const fakeServer={listen(port,host,cb){cb();},close(){}};
  const context={
    module:{exports:{}},__dirname,fetch:fakeFetch,AbortSignal,
    Date:class extends Date{static now(){return now;}},
    process:{env:{MULTI_SPOT_LIVE:'true',MAX_ORDER_EUR:'20',SIGNER_TOKEN:'synthetic-test-only',MULTI_SIGNAL_INTERVAL_MINUTES:'5'},execPath:'unused',once(){},exit(){throw Error('TEST_UNEXPECTED_EXIT');}},
    console:{log:m=>logs.push(m),info:m=>logs.push(m),error:m=>logs.push(m),warn:m=>logs.push(m)},
    require:name=>name==='node:child_process'?{spawn:()=>fakeChild}:name==='node:http'?{createServer:()=>fakeServer,request:()=>{throw Error('NETWORK_NOT_ALLOWED');}}:require(name),
    setTimeout:()=>0,clearTimeout(){},setInterval:(fn,delay)=>{scheduled={fn,delay};return 1;},clearInterval(){}
  };
  vm.runInNewContext(source+'\nrun();',context,{filename:require.resolve('./multi-live')});
  return {get period(){return scheduled.delay;},requests,logs,async tick(){await scheduled.fn();}};
}

test('v2 ignores old fast-signal setting and evaluates on guarded 15-minute coordinator ticks',()=>{
  assert.equal(harness().period,15*MINUTE);
});

test('risk-off stays in EUR while risk-on can open only BTC',async()=>{
  const off=harness({riskOn:false});await off.tick();
  assert.equal(off.requests.filter(r=>r.method==='POST').length,0);
  assert.ok(off.logs.some(l=>l.includes('BTC_REGIME_RISK_OFF')));

  const on=harness({riskOn:true});await on.tick();
  const orders=on.requests.filter(r=>r.method==='POST');
  assert.equal(orders.length,1);
  assert.equal(orders[0].body.instId,'BTC-EUR');
  assert.equal(orders[0].body.side,'buy');
  assert.equal(orders[0].body.sz,'20');
  assert.match(orders[0].body.clOrdId,/^ANTONV2/);
});

test('risk-on can add one guarded BTC tranche to an existing tracked BTC position',async()=>{
  const h=harness({riskOn:true,btcQty:0.0003});await h.tick();
  const orders=h.requests.filter(r=>r.method==='POST');
  assert.equal(orders.length,1);
  assert.equal(orders[0].body.instId,'BTC-EUR');
  assert.equal(orders[0].body.side,'buy');
  assert.equal(orders[0].body.sz,'20');
  assert.ok(h.logs.some(l=>l.includes('BTC_VOL_TARGET_15_V1')));
});

test('24-hour fill cooldown prevents rapid BTC accumulation',async()=>{
  const h=harness({riskOn:true,btcQty:0.0003,btcLastAge:6*60*60_000});await h.tick();
  assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
  assert.ok(h.logs.some(l=>l.includes('V2_24H_FILL_COOLDOWN')));
});

test('risk budget stops adding BTC after target exposure is reached',async()=>{
  const h=harness({riskOn:true,btcQty:0.003});await h.tick();
  assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
  assert.ok(h.logs.some(l=>l.includes('TARGET_EXPOSURE_REACHED')));
});

test('existing ETH remains exit-managed during migration but never creates a new ETH entry',async()=>{
  const h=harness({riskOn:true,ethPosition:true,ethPrice:3300});await h.tick();
  const orders=h.requests.filter(r=>r.method==='POST');
  assert.equal(orders.length,1);
  assert.equal(orders[0].body.instId,'ETH-EUR');
  assert.equal(orders[0].body.side,'sell');
  assert.ok(h.logs.some(l=>l.includes('LEGACY_TAKE_PROFIT_5_PERCENT')));
});

test('pending ANTON order blocks all new v2 entries fail-closed',async()=>{
  const h=harness({riskOn:true,pending:true});await h.tick();
  assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
  assert.ok(h.logs.some(l=>l.includes('BOT_ORDER_PENDING')));
});
