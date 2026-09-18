"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { makeHandler, newCookie, validCookie } = require("./dashboard-launcher");
const token = "sample-random-password-not-a-real-key";
function listen(server) { return new Promise(resolve => server.listen(0,"127.0.0.1",()=>resolve(server.address().port))); }
function close(server) { return new Promise(resolve => server.close(resolve)); }
test("dashboard login redirects, authenticates cookie and keeps trades unchanged", async () => {
  const forwarded = [];
  const upstream = http.createServer(async (req, res) => {
    let body=""; for await (const c of req) body += c;
    forwarded.push({method:req.method,path:req.url,body});
    res.writeHead(200, {"content-type":"application/json"});
    res.end(JSON.stringify({ok:true,path:req.url,body}));
  });
  const upstreamPort = await listen(upstream);
  const frontend = http.createServer(makeHandler({upstreamPort,token}));
  const port = await listen(frontend);
  const base=`http://127.0.0.1:${port}`;
  try {
    let r=await fetch(base+"/dashboard", {redirect:"manual"});
    assert.equal(r.status,303); assert.equal(r.headers.get("location"),"/dashboard/login");
    r=await fetch(base+"/dashboard/login");
    assert.equal(r.status,200); assert.match(await r.text(),/Введите ключ панели/);
    r=await fetch(base+"/dashboard-data");
    assert.equal(r.status,401); assert.equal(forwarded.length,0);
    r=await fetch(base+"/dashboard/login", {method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"password=wrong",redirect:"manual"});
    assert.equal(r.status,401); assert.equal(r.headers.get("set-cookie"),null);
    r=await fetch(base+"/dashboard/login", {method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({password:token}),redirect:"manual"});
    assert.equal(r.status,303); assert.equal(r.headers.get("location"),"/dashboard");
    const cookie=r.headers.get("set-cookie");
    assert.match(cookie,/HttpOnly/); assert.match(cookie,/Secure/); assert.match(cookie,/SameSite=Strict/);
    assert.ok(!cookie.includes(token));
    const cookieHeader=cookie.split(";")[0];
    r=await fetch(base+"/dashboard",{headers:{cookie:cookieHeader}});
    assert.equal(r.status,200);
    assert.equal((await r.json()).path,"/dashboard?key="+encodeURIComponent(token));
    r=await fetch(base+"/dashboard-data?key=",{headers:{cookie:cookieHeader}});
    assert.equal(r.status,200);
    assert.equal((await r.json()).path,"/dashboard-data?key="+encodeURIComponent(token));
    r=await fetch(base+"/auto",{method:"POST",headers:{"content-type":"application/json"},body:'{"signal":"HOLD","confirmLive":true}'});
    assert.equal(r.status,200);
    const data=await r.json();
    assert.equal(data.path,"/auto");assert.equal(data.body,'{"signal":"HOLD","confirmLive":true}');
    r=await fetch(base+"/dashboard?key="+encodeURIComponent(token),{redirect:"manual"});
    assert.equal(r.status,303); assert.equal(r.headers.get("location"),"/dashboard");
    assert.equal(forwarded.filter(x=>x.path==="/auto").length,1);
  } finally {await close(frontend); await close(upstream);}
});
test("cookie forgery and expiration are rejected",()=>{
  const cookie=newCookie(token,Date.now());
  assert.equal(validCookie(cookie,token),true);
  assert.equal(validCookie(cookie+"a",token),false);
  assert.equal(validCookie(cookie,"another-token"),false);
  assert.equal(validCookie(cookie,token,Date.now()+8*86400_000),false);
  assert.equal(validCookie(newCookie(token,Date.now()+200_000),token),false);
});
