"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {extract,tick,readFeed,summarize}=require('./political-shadow');
const now=Date.parse('2026-09-19T06:00:00Z');
const rss=(title,date='Sat, 19 Sep 2026 05:45:00 GMT')=>`<rss version="2.0"><channel><item><title><![CDATA[${title}]]></title><pubDate>${date}</pubDate></item></channel></rss>`;
test('classifies attributed headlines without making trade recommendations',()=>{
 const result=extract(rss('Trump comments on Bitcoin tariffs'),now);
 assert.equal(result.length,1);assert.deepEqual(result[0].people,['TRUMP']);assert.deepEqual(result[0].subjects,['CRYPTO','TRADE']);
 assert.equal('signal' in result[0],false);assert.equal('actionable' in result[0],false);
 const state=summarize(result,now);
 assert.equal(state.feedHealthy,true);assert.equal(state.matching,1);
 assert.equal(state.subjectCounts.CRYPTO,1);assert.equal(state.subjectCounts.TRADE,1);
 assert.equal('tradeSignal' in state,false);
});
test('ignores stale, future, unrelated and invalid feed data',()=>{
 assert.equal(extract(rss('Elon Musk discusses crypto','Sat, 19 Sep 2026 03:45:00 GMT'),now).length,0);
 assert.equal(extract(rss('Elon Musk discusses crypto','Sat, 19 Sep 2026 07:45:00 GMT'),now).length,0);
 assert.equal(extract(rss('Football league confirms results'),now).length,0);
 assert.throws(()=>extract('not RSS',now),/INVALID_NEWS_FEED/);
});
test('logs only observation and does not emit orders',async()=>{
 const logs=[]; const fakeFetch=async()=>({ok:true,text:async()=>rss('Elon Musk comments on crypto')});
 const first=await tick(fakeFetch,s=>logs.push(s),now);
 assert.equal(first.ok,true);assert.equal(first.newEvents,1);
 assert.ok(logs.some(s=>s.includes('"tradeSignal":null')));
 assert.ok(logs.every(s=>!s.includes('"tradeSignal":"BUY"')));
});
test('falls back to independent RSS on primary source 503',async()=>{
 let calls=0;const result=await readFeed(async()=>{calls++;return calls===1?{ok:false,status:503}:{ok:true,text:async()=>rss('Trump talks bitcoin tariffs')};},now);
 assert.equal(calls,2);assert.equal(result.length,1);
});
test('news HTTP failure fails closed',async()=>{
 const logs=[];
 const result=await tick(async()=>({ok:false,status:429}),s=>logs.push(s),now);
 assert.equal(result.ok,false);assert.ok(logs.some(s=>s.includes('"feedHealthy":false')));
});
