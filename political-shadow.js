"use strict";
// Independent read-only news observer. NEVER imports order execution or emits BUY/SELL.
const crypto = require('node:crypto');
const QUERY='(Trump OR "Elon Musk") (bitcoin OR crypto OR tariffs OR sanctions OR Iran)';
const FEEDS = [
  'https://news.google.com/rss/search?q=' + encodeURIComponent(QUERY+' when:1h') + '&hl=en-US&gl=US&ceid=US:en',
  'https://www.bing.com/news/search?q=' + encodeURIComponent(QUERY) + '&format=rss'
];
const INTERVAL = 15 * 60_000;
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
async function tick(fetchFn=fetch, log=console.log, now=Date.now()) {
  try {
    const items=await readFeed(fetchFn,now);
    let fresh=0;
    for (const event of items) {
      if(seen.has(event.id))continue;
      seen.add(event.id); fresh++;
      log('ANTON_POLITICAL_SHADOW '+JSON.stringify({...event,mode:'OBSERVE_ONLY',tradeSignal:null}));
    }
    while(seen.size>250)seen.delete(seen.values().next().value);
    log('ANTON_POLITICAL_SHADOW_STATUS '+JSON.stringify({mode:'OBSERVE_ONLY',feedHealthy:true,matching:items.length,newEvents:fresh,at:new Date(now).toISOString()}));
    return {ok:true,matching:items.length,newEvents:fresh};
  } catch(e) {
    log('ANTON_POLITICAL_SHADOW_STATUS '+JSON.stringify({mode:'OBSERVE_ONLY',feedHealthy:false,error:String(e.message).slice(0,100),at:new Date(now).toISOString()}));
    return {ok:false};
  }
}
function start(){
  if(process.env.POLITICAL_SHADOW_ENABLED!=='true')return;
  console.log('ANTON_POLITICAL_SHADOW_START mode=OBSERVE_ONLY orders=DISABLED');
  tick();setInterval(tick,INTERVAL);
}
if(require.main===module)start();
module.exports={extract,readFeed,tick,start};
