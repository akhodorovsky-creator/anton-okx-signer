"use strict";
// Independent news observer. NEVER imports order execution or emits BUY/SELL.
const crypto = require('node:crypto');
const fs = require('node:fs');
const QUERY='(Trump OR "Elon Musk") (bitcoin OR crypto OR tariffs OR sanctions OR Iran)';
const FEEDS = [
  'https://news.google.com/rss/search?q=' + encodeURIComponent(QUERY+' when:1h') + '&hl=en-US&gl=US&ceid=US:en',
  'https://www.bing.com/news/search?q=' + encodeURIComponent(QUERY) + '&format=rss'
];
const INTERVAL = 15 * 60_000;
const STATE_FILE = process.env.POLITICAL_SHADOW_STATE_FILE || '/tmp/anton-political-shadow.json';
const seen = new Set();
function decode(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function extract(xml, now=Date.now()) {
  if (typeof xml !== 'string' || xml.length > 600000 || !xml.includes('<rss')) throw Error('INVALID_NEWS_FEED');
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].slice(0,60);
  return items.map((m) => {
    const title = m[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1];
    const date = m[1].match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
    const published = Date.parse(date||'');
    if (!title || !Number.isFinite(published) || published>now+60000 || now-published>60*60_000) return null;
    const headline = decode(title).slice(0,220);
    const people = [ /\b(?:donald\s+)?trump\b/i.test(headline)?'TRUMP':null, /\b(?:elon\s+)?musk\b/i.test(headline)?'MUSK':null ].filter(Boolean);
    const subjects = [ /\b(?:bitcoin|btc|crypto(?:currency)?)\b/i.test(headline)?'CRYPTO':null, /\b(?:tariffs?|trade)\b/i.test(headline)?'TRADE':null, /\b(?:sanctions?|iran)\b/i.test(headline)?'GEOPOLITICS':null ].filter(Boolean);
    if (!people.length || !subjects.length) return null;
    return { id:crypto.createHash('sha256').update(headline+'|'+published).digest('hex').slice(0,20), headline, publishedAt:new Date(published).toISOString(), people, subjects };
  }).filter(Boolean);
}
async function readFeed(fetchFn=fetch, now=Date.now()) {
  const failures=[];
  for(const url of FEEDS){
    try{
      const result=await fetchFn(url,{signal:AbortSignal.timeout(12000),headers:{'user-agent':'ANTON-Research-Observer/1.0'}});
      if(!result.ok)throw Error('NEWS_HTTP_'+result.status);
      const xml=await result.text();
      return extract(xml,now);
    }catch(e){failures.push(String(e.message).slice(0,40));}
  }
  throw Error('NEWS_SOURCES_UNAVAILABLE_'+failures.join('_'));
}
function summarize(items, now=Date.now()) {
  const subjectCounts={CRYPTO:0,TRADE:0,GEOPOLITICS:0};
  let latest=0;
  for(const item of items){
    latest=Math.max(latest,Date.parse(item.publishedAt)||0);
    for(const subject of item.subjects||[])if(Object.prototype.hasOwnProperty.call(subjectCounts,subject))subjectCounts[subject]++;
  }
  return {
    version:1,
    mode:'MARKET_CONTEXT',
    feedHealthy:true,
    matching:items.length,
    subjectCounts,
    latestPublishedAt:latest?new Date(latest).toISOString():null,
    at:new Date(now).toISOString()
  };
}
function writeState(state, file=STATE_FILE) {
  const tmp=file+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state),{encoding:'utf8',mode:0o600});
  fs.renameSync(tmp,file);
}
async function tick(fetchFn=fetch, log=console.log, now=Date.now()) {
  try {
    const items=await readFeed(fetchFn,now);
    const state=summarize(items,now);
    writeState(state);
    let fresh=0;
    for (const event of items) {
      if(seen.has(event.id))continue;
      seen.add(event.id); fresh++;
      log('ANTON_POLITICAL_SHADOW '+JSON.stringify({...event,mode:'OBSERVE_ONLY',tradeSignal:null}));
    }
    while(seen.size>250)seen.delete(seen.values().next().value);
    log('ANTON_POLITICAL_SHADOW_STATUS '+JSON.stringify({...state,mode:'MARKET_CONTEXT',newEvents:fresh}));
    return {ok:true,matching:items.length,newEvents:fresh};
  } catch(e) {
    const failed={version:1,mode:'MARKET_CONTEXT',feedHealthy:false,matching:0,subjectCounts:{CRYPTO:0,TRADE:0,GEOPOLITICS:0},latestPublishedAt:null,error:String(e.message).slice(0,100),at:new Date(now).toISOString()};
    try{writeState(failed);}catch(writeError){log('ANTON_POLITICAL_SHADOW_STATE_ERROR '+String(writeError.message).slice(0,100));}
    log('ANTON_POLITICAL_SHADOW_STATUS '+JSON.stringify(failed));
    return {ok:false};
  }
}
function start(){
  if(process.env.POLITICAL_SHADOW_ENABLED!=='true')return;
  console.log('ANTON_POLITICAL_SHADOW_START mode=MARKET_CONTEXT orders=DISABLED');
  tick();setInterval(tick,INTERVAL);
}
if(require.main===module)start();
module.exports={extract,readFeed,summarize,writeState,tick,start,STATE_FILE};
