"use strict";

// A login-only front end. The existing market runner, gateway, trading signer,
// position monitor, and trade endpoints are unchanged behind the proxy.
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const COOKIE_NAME = "__Host-anton_dashboard";
const LOGIN_MAX_BYTES = 4096;

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}
function secretFor(token) {
  return crypto.createHash("sha256").update("dashboard-cookie-v1:").update(token).digest();
}
function newCookie(token, now = Date.now()) {
  const time = Math.floor(now / 1000).toString(36);
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `${time}.${nonce}`;
  const mac = crypto.createHmac("sha256", secretFor(token)).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}
function validCookie(cookie, token, now = Date.now()) {
  if (!token || typeof cookie !== "string") return false;
  const parts = cookie.split(".");
  if (parts.length !== 3 || !/^[0-9a-z]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{22}$/.test(parts[1])) return false;
  const stamp = parseInt(parts[0], 36);
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(stamp) || stamp > current + 60 || stamp < current - SESSION_SECONDS) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", secretFor(token)).update(payload).digest("base64url");
  return safeEqual(parts[2], expected);
}
function sessionFromRequest(req, token) {
  const match = (req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE_NAME + "="));
  return validCookie(match ? match.slice(COOKIE_NAME.length + 1) : "", token);
}
function redirect(res, destination, cookie) {
  const headers = { location: destination, "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (cookie) headers["set-cookie"] = `${COOKIE_NAME}=${cookie}; Path=/; Max-Age=${SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`;
  res.writeHead(303, headers);
  res.end();
}
function loginHtml(error = false) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>ANTON Signal — вход</title><style>html{font-family:system-ui;color-scheme:dark}body{background:#0b0f14;color:#eef3f8;margin:0;padding:20px}main{max-width:380px;margin:8vh auto;background:#121923;border:1px solid #263140;border-radius:18px;padding:24px}input,button{box-sizing:border-box;display:block;width:100%;font:inherit;padding:13px;margin-top:14px;border-radius:10px}input{background:#0b0f14;color:white;border:1px solid #526071}button{background:#3984f6;color:white;border:0;font-weight:700}p{color:#abb9c9;line-height:1.5}.error{color:#ff9898}</style></head><body><main><h1>ANTON Signal</h1><p>Введите ключ панели из переменной DASHBOARD_TOKEN в Railway. Ключ останется вне адресной строки; повторный вход обычно не нужен 7 дней.</p>${error ? '<p class="error" role="alert">Неверный ключ. Проверьте DASHBOARD_TOKEN.</p>' : ''}<form method="post" action="/dashboard/login" autocomplete="off"><label for="password">Ключ панели</label><input id="password" name="password" type="password" required autofocus autocomplete="off"><button type="submit">Открыть панель</button></form></main></body></html>`;
}
function html(res, status, content) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
  res.end(content);
}
function proxy(req, res, upstreamPort, overridePath) {
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  const upstream = http.request({ hostname: "127.0.0.1", port: upstreamPort, method: req.method, path: overridePath || req.url, headers, timeout: 80000 }, reply => {
    res.writeHead(reply.statusCode || 502, reply.headers);
    reply.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) { res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); res.end("Сервис временно недоступен"); }
    else res.destroy();
  });
  upstream.on("timeout", () => upstream.destroy());
  req.pipe(upstream);
}
function makeHandler({ upstreamPort, token }) {
  return async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const route = url.pathname;
    if (route === "/dashboard/login" && req.method === "GET") return html(res, 200, loginHtml());
    if (route === "/dashboard/login" && req.method === "POST") {
      let raw = "";
      try {
        for await (const chunk of req) {
          raw += chunk.toString("utf8");
          if (Buffer.byteLength(raw, "utf8") > LOGIN_MAX_BYTES) { html(res, 413, "Слишком длинный запрос"); return; }
        }
        const submitted = new URLSearchParams(raw).get("password") || "";
        if (token && safeEqual(submitted, token)) return redirect(res, "/dashboard", newCookie(token));
        return html(res, 401, loginHtml(true));
      } catch { return html(res, 400, "Неверный запрос"); }
    }
    if ((route === "/dashboard" || route === "/dashboard-data") && req.method === "GET") {
      const key = url.searchParams.get("key");
      if (token && key && safeEqual(key, token)) {
        if (route === "/dashboard") return redirect(res, "/dashboard", newCookie(token));
        return proxy(req, res, upstreamPort, `${route}?key=${encodeURIComponent(token)}`);
      }
      if (!sessionFromRequest(req, token)) {
        if (route === "/dashboard") return redirect(res, "/dashboard/login");
        res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      }
      return proxy(req, res, upstreamPort, `${route}?key=${encodeURIComponent(token)}`);
    }
    if (route === "/dashboard/login") { res.writeHead(405); return res.end(); }
    return proxy(req, res, upstreamPort);
  };
}
function run() {
  const port = Number(process.env.PORT || 3000);
  const token = process.env.DASHBOARD_TOKEN || "";
  if (!Number.isInteger(port) || port < 1 || port > 65515 || !token) throw new Error("PORT or DASHBOARD_TOKEN invalid");
  const upstreamPort = port + 10;
  const child = spawn(process.execPath, [path.join(__dirname, "market-runner.js")], {
    env: { ...process.env, PORT: String(upstreamPort) }, stdio: "inherit"
  });
  const server = http.createServer(makeHandler({ upstreamPort, token }));
  server.listen(port, "0.0.0.0", () => console.log("ANTON_DASHBOARD_LOGIN_READY on " + port));
  let closing = false;
  function shutdown(signal) { if (closing) return; closing = true; server.close(); child.kill(signal); }
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  child.once("exit", (code, signal) => {
    server.close();
    if (!closing) console.error("ANTON_MARKET_RUNNER_EXIT", code, signal);
    process.exit(code == null ? 1 : code);
  });
}
if (require.main === module) run();
module.exports = { makeHandler, newCookie, validCookie, loginHtml };
