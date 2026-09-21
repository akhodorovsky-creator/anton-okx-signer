"use strict";
// Read-only hourly snapshot. It cannot submit a trade or write an account ledger.
const { audit } = require("./fill-audit");
const ALLOWED = /^\/api\/v5\/trade\/(?:orders-history|orders-history-archive|orders-pending|fills-history)\?/;
const PAIR = /^(?:BTC|ETH|DOGE)-EUR$/;
const START_DELAY = 45_000;
const INTERVAL = 60 * 60_000;

function clients({port = Number(process.env.PORT || 3000), token = process.env.SIGNER_TOKEN, request = fetch, clock = Date.now} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65490 || !token) throw Error("AUDIT_CONFIG_UNAVAILABLE");
  const read = async path => {
    if (!ALLOWED.test(path)) throw Error("AUDIT_NON_READ_ONLY_PATH");
    const response = await request(`http://127.0.0.1:${port + 23}/okx`, {
      method:"POST", headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({method:"GET",path}), signal:AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error("AUDIT_SIGNER_HTTP_"+response.status);
    const payload=await response.json();
    if (payload.ok!==true||payload.code!=="0"||!Array.isArray(payload.data)) throw Error("AUDIT_OKX_RESPONSE_INVALID");
    return payload.data;
  };
  const getPrice=async pair => {
    if (!PAIR.test(pair)) throw Error("AUDIT_PAIR_NOT_ALLOWED");
    const response=await request(`https://eea.okx.com/api/v5/market/ticker?instId=${pair}`, {method:"GET", signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error("AUDIT_TICKER_HTTP_"+response.status);
    const payload=await response.json();
    if (payload.code!=="0"||!Array.isArray(payload.data)) throw Error("AUDIT_TICKER_UNAVAILABLE");
    const price=Number(payload.data[0]?.last),ts=Number(payload.data[0]?.ts),age=clock()-ts;
    if (!(price>0)||!Number.isFinite(age)||age < -60000||age>120000) throw Error("AUDIT_STALE_TICKER");
    return price;
  };
  return {read,getPrice};
}

async function runOnce(options) {
  const report=await audit(clients(options));
  // Do not log personal trades, raw fills, client IDs or authentication headers.
  console.log("ANTON_FILL_AUDIT "+JSON.stringify(report));
  return report;
}

function run() {
  let busy=false, stopped=false;
  async function tick() {
    if (busy||stopped) return;
    busy=true;
    try { await runOnce(); }
    catch(error) {console.error("ANTON_FILL_AUDIT_UNVERIFIED "+String(error.message).slice(0,160));}
    finally {busy=false;}
  }
  const initial=setTimeout(tick,START_DELAY);
  const interval=setInterval(tick,INTERVAL);
  const stop=()=>{stopped=true;clearTimeout(initial);clearInterval(interval);};
  process.once("SIGTERM",stop);
  process.once("SIGINT",stop);
}
if (require.main===module) run();
module.exports={clients,runOnce};
