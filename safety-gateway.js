"use strict";

// Railway exposes only this gateway's PORT. The existing signer runs on an internal port.
// This file adds server-side risk controls independently of the n8n workflow editor.
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = PUBLIC_PORT + 1;
const MAX_BODY_BYTES = 64 * 1024;
const CAPITAL_CAP_EUR = 200;
const MAX_ORDER_EUR = Math.min(20, Math.max(0, Number(process.env.MAX_ORDER_EUR || 20)));
const MAX_SIGNAL_AGE_SECONDS = Math.max(60, Math.min(3600, Number(process.env.MAX_SIGNAL_AGE_SECONDS || 900)));
const LIVE_AUTOMATION_ENABLED =
  String(process.env.LIVE_ENABLED || "").toLowerCase() === "true" ||
  String(process.env.LIVE || "").toLowerCase() === "true";
let autoBusy = false;

function respond(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function currentSignal(input, now = Date.now()) {
  const nestedAuto = input && input.autoRequest && typeof input.autoRequest === "object" && !Array.isArray(input.autoRequest)
    ? input.autoRequest
    : null;
  const normalized = nestedAuto ? { ...input, ...nestedAuto } : input;
  const signal = String(normalized.signal || "HOLD").toUpperCase();
  const requested = normalized.actionable === true || String(normalized.actionable || "").toLowerCase() === "true";
  const signalTimestamp = normalized.signalTimestamp || normalized.timestamp || null;
  const age = Date.parse(signalTimestamp);
  const fresh = Number.isFinite(age) && age <= now + 60_000 && age >= now - MAX_SIGNAL_AGE_SECONDS * 1000;
  const quality = normalized.dataQuality && typeof normalized.dataQuality === "object" ? normalized.dataQuality : {};
  const liveConfirmed = normalized.confirmLive === true || LIVE_AUTOMATION_ENABLED;
  const baseValid = liveConfirmed && requested &&
    normalized.policyRevision === "politics-v2" && quality.marketInputsFresh === true && fresh;
  const buyValid = baseValid && signal === "BUY" && quality.canOpenPosition === true;
  const sellValid = baseValid && signal === "SELL";
  // Returning HOLD still invokes the signer's server-side TP/SL checks on open positions.
  return {
    ...normalized,
    signal: buyValid || sellValid ? signal : "HOLD",
    actionable: buyValid || sellValid,
    confirmLive: liveConfirmed,
    signalTimestamp
  };
}

function forward(req, res, body) {
  return new Promise((resolve, reject) => {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: INTERNAL_PORT,
      path: req.url,
      method: req.method,
      headers: {
        authorization: req.headers.authorization || "",
        "content-type": "application/json",
        ...(body ? { "content-length": Buffer.byteLength(body) } : {})
      },
      timeout: 75000
    }, reply => {
      res.writeHead(reply.statusCode || 502, {
        "content-type": reply.headers["content-type"] || "application/json",
        "cache-control": "no-store"
      });
      reply.pipe(res);
      reply.once("end", resolve);
      reply.once("error", reject);
    });
    upstream.once("timeout", () => upstream.destroy(new Error("Signer timeout")));
    upstream.once("error", reject);
    upstream.end(body || undefined);
  });
}

async function positionWithinCapitalCap(authorization) {
  const response = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/pnl`, {
    headers: { authorization: authorization || "" }, signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) return false;
  const data = await response.json();
  const qty = Number(data?.position?.qty);
  const price = Number(data?.price);
  if (!Number.isFinite(qty) || qty < 0 || !(price > 0) || !(MAX_ORDER_EUR > 0)) return false;
  return qty * price + MAX_ORDER_EUR <= CAPITAL_CAP_EUR;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const result = JSON.parse(text || "{}");
  if (!result || Array.isArray(result) || typeof result !== "object") throw new Error("Expected JSON object");
  return result;
}

const server = http.createServer(async (req, res) => {
  const route = (req.url || "").split("?")[0];
  // Never expose the signer's unrestricted POST /okx pass-through: it bypasses
  // position tracking, spot-only automation and maximum order checks.
  if (route === "/okx" && req.method === "POST") {
    return respond(res, 403, { ok: false, error: "Raw OKX writes disabled; use guarded /auto" });
  }
  if (route !== "/auto" || req.method !== "POST") {
    try { await forward(req, res); }
    catch (error) {
      console.error("ANTON_GATEWAY_UPSTREAM_ERROR", error.message);
      if (!res.headersSent) respond(res, 502, { ok: false, error: "Signer temporarily unavailable" });
      else res.destroy();
    }
    return;
  }
  if (autoBusy) return respond(res, 409, { ok: false, error: "Automation already processing a request" });
  autoBusy = true;
  try {
    const incoming = await readJson(req);
    const safeInput = currentSignal(incoming);
    if (safeInput.signal === "BUY") {
      // Fail closed on missing history, invalid prices or an exhausted capital cap.
      let withinCap = false;
      try { withinCap = await positionWithinCapitalCap(req.headers.authorization); }
      catch (error) { console.error("ANTON_CAP_CHECK_ERROR", error.message); }
      if (!withinCap) {
        safeInput.signal = "HOLD";
        safeInput.actionable = false;
        console.warn("ANTON_GATEWAY_BUY_BLOCKED: capital cap or unreadable position");
      }
    }
    const incomingSignal = String(
      incoming?.autoRequest?.signal ?? incoming?.signal ?? "HOLD"
    ).toUpperCase();
    if (incomingSignal === "BUY" && safeInput.signal !== "BUY") {
      console.warn("ANTON_GATEWAY_BUY_BLOCKED: invalid or stale political/market evidence");
    }
    await forward(req, res, JSON.stringify(safeInput));
  } catch (error) {
    console.error("ANTON_GATEWAY_ERROR", error.message);
    if (!res.headersSent) respond(res, 400, { ok: false, error: "Invalid request or signer unavailable" });
    else res.destroy();
  } finally {
    autoBusy = false;
  }
});

if (require.main === module) {
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(INTERNAL_PORT) }, stdio: "inherit"
  });
  child.once("exit", (code, signal) => {
    console.error("ANTON_SIGNER_EXIT", { code, signal });
    process.exit(code || 1);
  });
  const shutdown = signal => { child.kill(signal); server.close(); };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  server.listen(PUBLIC_PORT, "0.0.0.0", () =>
    console.log("ANTON safety gateway listening on " + PUBLIC_PORT + "; internal signer on " + INTERNAL_PORT));
}

module.exports = { currentSignal };
