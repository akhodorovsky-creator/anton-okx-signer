"use strict";

// Independent position monitoring: the n8n workflow can stop reaching /auto on HOLD.
// This process is deliberately unable to originate a BUY or a strategy SELL.
const { spawn } = require("node:child_process");
const path = require("node:path");

const INTERVAL_MS = 15 * 60 * 1000;
const START_DELAY_MS = 30 * 1000;

async function monitorPosition({
  port = Number(process.env.PORT || 3000),
  signerToken = process.env.SIGNER_TOKEN,
  request = fetch
} = {}) {
  if (!signerToken) throw new Error("SIGNER_TOKEN is required for internal monitoring");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  const response = await request(`http://127.0.0.1:${port}/auto`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${signerToken}`,
      "content-type": "application/json"
    },
    // HOLD is intentional. The signer independently checks existing positions
    // against the user's configured +5% / -2% thresholds before considering a buy.
    body: JSON.stringify({ signal: "HOLD", actionable: false, confirmLive: true }),
    signal: AbortSignal.timeout(80000)
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) {
    throw new Error(`Monitor request failed: HTTP ${response.status}; ${String(data.error || "unknown").slice(0, 160)}`);
  }
  return { action: data.action, reason: data.reason || null, mode: data.mode || null };
}

function run() {
  const gateway = spawn(process.execPath, [path.join(__dirname, "safety-gateway.js")], {
    env: process.env,
    stdio: "inherit"
  });
  let busy = false;
  let stopped = false;
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const result = await monitorPosition();
      console.log("ANTON_POSITION_MONITOR " + JSON.stringify(result));
    } catch (error) {
      // Fail visibly, but never open a position as an error-recovery action.
      console.error("ANTON_POSITION_MONITOR_ERROR " + error.message);
    } finally {
      busy = false;
    }
  }
  const initial = setTimeout(tick, START_DELAY_MS);
  const interval = setInterval(tick, INTERVAL_MS);
  function stop(signal) {
    if (stopped) return;
    stopped = true;
    clearTimeout(initial);
    clearInterval(interval);
    gateway.kill(signal);
  }
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  gateway.once("exit", (code, signal) => {
    clearTimeout(initial);
    clearInterval(interval);
    if (!stopped) console.error("ANTON_GATEWAY_EXIT " + JSON.stringify({ code, signal }));
    process.exit(code == null ? 1 : code);
  });
}

if (require.main === module) run();
module.exports = { monitorPosition };
