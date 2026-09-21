"use strict";
// Multi-pair coordinator owns all entry and exit orders when enabled.
// In that mode the legacy +3% BTC /auto mechanism must be read-only.
const { spawn } = require('node:child_process');
const path = require('node:path');
const INTERVAL_MS = 15 * 60 * 1000;
const START_DELAY_MS = 30 * 1000;

async function monitorPosition({
  port = Number(process.env.PORT || 3000),
  signerToken = process.env.SIGNER_TOKEN,
  request = fetch
} = {}) {
  if (!signerToken) throw new Error('SIGNER_TOKEN is required for internal monitoring');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  // IMPORTANT: do not call /auto here: it could sell the BTC position at +3%
  // while the multi-pair coordinator is expecting +5%, or race a pending sell.
  if (process.env.MULTI_SPOT_LIVE === 'true') {
    return {action:'MULTI_COORDINATOR_ONLY',reason:'LEGACY_AUTO_DISABLED',mode:'LIVE'};
  }
  const response = await request(`http://127.0.0.1:${port}/auto`, {
    method:'POST',
    headers:{authorization:`Bearer ${signerToken}`,'content-type':'application/json'},
    body:JSON.stringify({signal:'HOLD',actionable:false,confirmLive:true}),
    signal:AbortSignal.timeout(80000)
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true)
    throw new Error(`Monitor request failed: HTTP ${response.status}; ${String(data.error || 'unknown').slice(0,160)}`);
  return {action:data.action,reason:data.reason || null,mode:data.mode || null};
}

// Read-only feed for legacy BTC snapshot. This is NOT a complete realized-P&L ledger.
async function readPnlSnapshot({
  port = Number(process.env.PORT || 3000),
  signerToken = process.env.SIGNER_TOKEN,
  request = fetch
} = {}) {
  if (!signerToken) throw new Error('SIGNER_TOKEN is required for P&L monitoring');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const response = await request(`http://127.0.0.1:${port}/pnl`, {
    method:'GET',headers:{authorization:`Bearer ${signerToken}`},
    signal:AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`P&L read failed: HTTP ${response.status}`);
  const data = await response.json();
  if (data?.ok !== true || !['LIVE','DEMO'].includes(data.mode) || data.instrument !== 'BTC-EUR')
    throw new Error('P&L response is not a valid BTC-EUR snapshot');
  const pnlEur=Number(data.pnlEur), positionQty=Number(data.position?.qty);
  const price=Number(data.price),entryPrice=Number(data.position?.entryPrice);
  const filledOrders=Number(data.filledOrders);
  if (![pnlEur,positionQty,price,entryPrice,filledOrders].every(Number.isFinite) ||
      positionQty<0 || price<=0 || entryPrice<0 ||
      !Number.isSafeInteger(filledOrders) || filledOrders<0 ||
      !Number.isFinite(Date.parse(data.updatedAt)))
    throw new Error('P&L snapshot has invalid numeric fields or timestamp');
  return {mode:data.mode,instrument:data.instrument,pnlEur,positionQty,entryPrice,
    price,filledOrders,updatedAt:data.updatedAt,
    completeness:'UNVERIFIED_RECENT_AND_ARCHIVE_LIMITS'};
}
function run() {
  const gateway=spawn(process.execPath,[path.join(__dirname,'safety-gateway.js')],{
    env:process.env,stdio:'inherit'
  });
  let busy=false,stopped=false;
  async function tick() {
    if (busy || stopped) return;
    busy=true;
    try {
      const result=await monitorPosition();
      console.log('ANTON_POSITION_MONITOR '+JSON.stringify(result));
    } catch(error) {
      console.error('ANTON_POSITION_MONITOR_ERROR '+error.message);
    }
    try {
      const snapshot=await readPnlSnapshot();
      console.log('ANTON_PNL_SNAPSHOT '+JSON.stringify(snapshot));
    } catch(error) {
      console.error('ANTON_PNL_MONITOR_ERROR '+error.message);
    } finally {busy=false;}
  }
  const initial=setTimeout(tick,START_DELAY_MS);
  const interval=setInterval(tick,INTERVAL_MS);
  function stop(signal) {
    if (stopped) return;
    stopped=true;clearTimeout(initial);clearInterval(interval);gateway.kill(signal);
  }
  process.once('SIGTERM',()=>stop('SIGTERM'));
  process.once('SIGINT',()=>stop('SIGINT'));
  gateway.once('exit',(code,signal)=>{
    clearTimeout(initial);clearInterval(interval);
    if (!stopped) console.error('ANTON_GATEWAY_EXIT '+JSON.stringify({code,signal}));
    process.exit(code == null ? 1 : code);
  });
}
if (require.main===module) run();
module.exports={monitorPosition,readPnlSnapshot};
