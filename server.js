"use strict";

const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const OKX_BASE_URL = "https://www.okx.com";
const LIVE = String(process.env.LIVE || "false").toLowerCase() === "true";

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 100_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function allowedPath(path) {
  return path.startsWith("/api/v5/account/") ||
    path.startsWith("/api/v5/trade/") ||
    path.startsWith("/api/v5/market/") ||
    path.startsWith("/api/v5/public/");
}

function isOrderPath(path) {
  return path === "/api/v5/trade/order" || path === "/api/v5/trade/batch-orders";
}

async function okxRequest({ method = "GET", path, body }) {
  method = String(method).toUpperCase();
  if (!path || !path.startsWith("/api/v5/") || !allowedPath(path)) {
    throw new Error("OKX path is not allowed");
  }
  if (!["GET", "POST"].includes(method)) throw new Error("Method is not allowed");

  const timestamp = new Date().toISOString();
  const bodyText = method === "GET" || body == null ? "" : JSON.stringify(body);
  const signature = crypto
    .createHmac("sha256", required("OKX_SECRET_KEY"))
    .update(timestamp + method + path + bodyText)
    .digest("base64");

  const headers = {
    "content-type": "application/json",
    "OK-ACCESS-KEY": required("OKX_API_KEY"),
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": required("OKX_PASSPHRASE")
  };
  if (!LIVE) headers["x-simulated-trading"] = "1";

  const response = await fetch(OKX_BASE_URL + path, {
    method,
    headers,
    body: bodyText || undefined,
    signal: AbortSignal.timeout(15_000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { httpStatus: response.status, data };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, live: LIVE, mode: LIVE ? "LIVE" : "DEMO" });
    }
    if (req.method !== "POST" || req.url !== "/okx") {
      return json(res, 404, { ok: false, error: "Not found" });
    }

    if (!safeEqual(req.headers.authorization, `Bearer ${required("SIGNER_TOKEN")}`)) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const input = await readBody(req);
    if (LIVE && isOrderPath(input.path) && input.confirmLive !== true) {
      return json(res, 400, { ok: false, error: "confirmLive=true is required for live orders" });
    }

    const result = await okxRequest(input);
    return json(res, result.httpStatus, { ok: result.httpStatus >= 200 && result.httpStatus < 300, mode: LIVE ? "LIVE" : "DEMO", ...result.data });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ANTON OKX Signer listening on ${PORT} (${LIVE ? "LIVE" : "DEMO"})`);
});
