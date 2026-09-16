"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { monitorPosition } = require("./risk-monitor");

test("monitor sends HOLD only; never requests BUY or SELL", async () => {
  let seen;
  const result = await monitorPosition({
    port: 8080,
    signerToken: "unit-test-token",
    request: async (url, options) => {
      seen = { url, ...options };
      return { ok: true, status: 200, json: async () => ({ ok: true, action: "WAIT_FOR_BUY", reason: "SIGNAL_NOT_BUY", mode: "LIVE" }) };
    }
  });
  assert.equal(seen.url, "http://127.0.0.1:8080/auto");
  assert.equal(seen.method, "POST");
  assert.deepEqual(JSON.parse(seen.body), { signal: "HOLD", actionable: false, confirmLive: true });
  assert.equal(result.action, "WAIT_FOR_BUY");
});

test("monitor fails closed without an authentication token", async () => {
  await assert.rejects(monitorPosition({ signerToken: "", request: async () => { throw new Error("must not call"); } }), /SIGNER_TOKEN/);
});

test("monitor reports a rejected request without triggering another trade", async () => {
  let calls = 0;
  await assert.rejects(monitorPosition({ signerToken: "test", request: async () => {
    calls++;
    return { ok: false, status: 409, json: async () => ({ error: "Automation already processing a request" }) };
  } }), /HTTP 409/);
  assert.equal(calls, 1);
});
