'use strict';
// Standalone virtual portfolios. No exchange account credentials or live orders.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {CONFIG,HOUR,initialState,step,summary,decision}=require('./engine');
const {snapshot}=require('./public-market');
const STORE=process.env.PAPER_STATE_PATH||path.join('/tmp','anton-paper-state.json');
const CONFIG_HASH=crypto.createHash('sha256').update(JSON.stringify(CONFIG)).digest('hex');
function restore(file=STORE) {
  if(!fs.existsSync(file))return {version:1,mode:'PAPER_ONLY',configHash:CONFIG_HASH,epoch:crypto.randomUUID(),createdAt:new Date().toISOString(),states:CONFIG.candidates.map(x=>initialState(x)),lastObservation:null};
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value.mode!=='PAPER_ONLY'||value.version!==1||value.configHash!==CONFIG_HASH||!Array.isArray(value.states)||value.states.length!==CONFIG.candidates.length || value.states.some((s,i)=>s.candidate!==CONFIG.candidates[i]||s.mode!=='PAPER_ONLY'||!Number.isFinite(s.cash)))throw Error('PAPER_STATE_INVALID');
  return value;
}
function persist(state,file=STORE) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});fs.renameSync(file+'.tmp',file);
}
function processObservation(store,observation,now=Date.now()) {
  if(observation.venue!=='BINANCE_PUBLIC_EUR_PROXY')throw Error('VENUE_MISMATCH');
  if(!Number.isFinite(observation.observedAt)||now-observation.observedAt>60000||now<observation.observedAt)throw Error('STALE_OBSERVATION');
  const lastClose=observation.snapshot['BTC-EUR'].timestamp+HOUR;
  if(now-lastClose<0||now-lastClose>HOUR)throw Error('STALE_SIGNAL');
  // A late boot only observes. Never replay a missed fill at an earlier candle price.
  const entryWindow=now-lastClose<=5*60000;
  const snapshots=[];
  for(const state of store.states) {
    const r=step(state,observation.snapshot,observation.quotes,now,{},entryWindow);
    snapshots.push({candidate:state.candidate,events:r.events||[],...summary(state,observation.quotes)});
    state.events=[];
  }
  store.lastObservation={at:new Date(now).toISOString(),barAt:new Date(lastClose-HOUR).toISOString(),entryWindow,
    regime:decision('momentum24',observation.snapshot['BTC-EUR'],observation.snapshot['BTC-EUR']).reason,
    venue:observation.venue,snapshots};
  return {mode:'PAPER_ONLY',liveOrdersEnabled:false,epoch:store.epoch,...store.lastObservation};
}
async function main() {
  const store=restore();let busy=false,lastAttemptHour=null;
  let status={mode:'PAPER_ONLY',liveOrdersEnabled:false,epoch:store.epoch,createdAt:store.createdAt,stateStorage:'LOCAL_DISK_RESETS_IF_HOST_REPLACES_FILESYSTEM',lastObservation:store.lastObservation};
  async function tick() {
    const hour=Math.floor(Date.now()/HOUR);
    if(busy||hour===lastAttemptHour)return;
    busy=true;
    try {
      const observation=await snapshot();
      const report=processObservation(store,observation);persist(store);
      status={...status,lastObservation:report,lastError:null};lastAttemptHour=hour;
      console.log('ANTON_PAPER_SNAPSHOT '+JSON.stringify(report));
    }catch(e){status.lastError=String(e.message).slice(0,200);console.error('ANTON_PAPER_ERROR '+status.lastError);}
    finally{busy=false;}
  }
  const port=Number(process.env.PORT||3000);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_PORT');
  const server=http.createServer((req,res)=>{
    if(req.method==='GET'&&req.url==='/'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
      return res.end(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'));
    }
    if(req.method!=='GET'||!['/health','/status'].includes(req.url)){res.writeHead(404);return res.end();}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify(status));
  });
  server.listen(port,'0.0.0.0',()=>console.log('ANTON_PAPER_READY '+JSON.stringify({mode:'PAPER_ONLY',liveOrdersEnabled:false,candidates:CONFIG.candidates,epoch:store.epoch})));
  await tick();const interval=setInterval(tick,60000);
  const stop=()=>{clearInterval(interval);server.close();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
if(require.main===module)main().catch(e=>{console.error('PAPER_START_FAILED '+e.message);process.exitCode=1;});
module.exports={restore,persist,processObservation};
