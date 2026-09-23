'use strict';
const fs=require('node:fs'),path=require('node:path');
const {CONFIG,features,initialState,step,summary}=require('./engine');
function load(directory) {
  const data=Object.fromEntries(CONFIG.pairs.map(p=>[p,features(JSON.parse(fs.readFileSync(path.join(directory,p+'.json'),'utf8')))]));
  const ref=data['BTC-EUR'];
  if(CONFIG.pairs.some(p=>data[p].length!==ref.length || data[p].some((b,i)=>b.timestamp!==ref[i].timestamp)))throw Error('PAIR_ALIGNMENT');
  return data;
}
function replay(data,candidate,start,end,slippageRate=CONFIG.slippageRate) {
  const state=initialState(candidate), reference=data['BTC-EUR'], from=Date.parse(start), to=Date.parse(end);
  let first=null,last=null,quotes;
  const equityCurve=[];
  for(let i=249;i<reference.length-1;i++) {
    // The decision uses i, and execution uses i+1. Evaluation periods are based on execution times.
    const executionAt=reference[i+1].timestamp;
    if(executionAt<from || executionAt>=to)continue;
    const snapshot=Object.fromEntries(CONFIG.pairs.map(p=>[p,data[p][i]]));
    quotes=Object.fromEntries(CONFIG.pairs.map(p=>[p,{bid:data[p][i+1].open,ask:data[p][i+1].open}]));
    const r=step(state,snapshot,quotes,executionAt,{slippageRate});
    first??=i+1;last=i+1;equityCurve.push([executionAt,r.equityEur]);
  }
  if(first===null)throw Error('EMPTY_PERIOD');
  quotes=Object.fromEntries(CONFIG.pairs.map(p=>[p,{bid:data[p][last].close,ask:data[p][last].close}]));
  const result=summary(state,quotes,{slippageRate});
  // Include the final liquidation mark in drawdown, without inventing an executed close.
  result.maxDrawdownEur=Math.max(result.maxDrawdownEur,state.peak-result.equityEur);
  result.maxDrawdownPct=Math.max(result.maxDrawdownPct,(state.peak-result.equityEur)/state.peak*100);
  let hold=CONFIG.capitalEur-CONFIG.orderEur*CONFIG.pairs.length;
  for(const p of CONFIG.pairs)hold+=CONFIG.orderEur*(1-CONFIG.feeRate)/(data[p][first].open*(1+slippageRate))*data[p][last].close*(1-slippageRate)*(1-CONFIG.feeRate);
  return {...result,start:new Date(reference[first].timestamp).toISOString(),end:new Date(reference[last].timestamp+CONFIG.barMs).toISOString(),slippageRate,
    benchmarkCashPnlEur:0,benchmarkEqualNotionalHoldPnlEur:hold-CONFIG.capitalEur,trades:state.trades,equityCurve};
}
function run(directory) {
  const data=load(directory), results=[];
  for(const candidate of CONFIG.candidates)for(const [period,start,end] of [
    ['development',CONFIG.developmentStart,CONFIG.validationStart],['validation',CONFIG.validationStart,CONFIG.endExclusive]])
    for(const friction of ['base','stress'])results.push({period,friction,...replay(data,candidate,start,end,friction==='base'?CONFIG.slippageRate:CONFIG.stressSlippageRate)});
  const development=results.filter(x=>x.period==='development'&&x.friction==='base');
  const ranked=[...development].sort((a,b)=>b.pnlEur-a.pnlEur);
  const chosen=ranked[0], validation=results.find(x=>x.candidate===chosen.candidate&&x.period==='validation'&&x.friction==='base'),stress=results.find(x=>x.candidate===chosen.candidate&&x.period==='validation'&&x.friction==='stress');
  const reasons=[];
  if(!(chosen.pnlEur>0))reasons.push('DEVELOPMENT_NOT_PROFITABLE');
  if(validation.closedTrades<CONFIG.screen.minimumClosedTrades)reasons.push('TOO_FEW_VALIDATION_TRADES');
  if(!(validation.pnlEur>0&&stress.pnlEur>0))reasons.push('VALIDATION_NOT_POSITIVE_AFTER_COSTS');
  if(!(validation.profitFactor>=CONFIG.screen.minimumProfitFactor))reasons.push('VALIDATION_PROFIT_FACTOR');
  if(validation.maxDrawdownEur>CONFIG.drawdownEntryLimitEur)reasons.push('DRAWDOWN_LIMIT_EXCEEDED');
  return {status:'RESEARCH_ONLY_NO_LIVE_AUTHORIZATION',generatedAt:new Date().toISOString(),config:CONFIG,
    oldStrategyComparison:'UNAVAILABLE_WITHOUT_POINT_IN_TIME_OKX_OI_AND_FUNDING',
    developmentWinner:chosen.candidate,screenPassed:reasons.length===0,screenReasons:reasons,
    caveats:['Different venue: Binance EUR is a proxy, not OKX execution history.','Current three-pair universe is fixed retrospectively; no claim of universe-selection neutrality.','Fee is an explicit assumption; spread, slippage and stop gaps may be worse.','Pairs and trades are correlated; counts are not independent evidence.','Infrastructure costs and exchange quantity rounding are not modelled.','Hourly sampled drawdown can miss intrahour losses.','Development and validation start flat independently; indicator warmup is carried, positions are not.'],results};
}
if(require.main===module) {
  try{if(process.argv.length!==3)throw Error('USAGE: node backtest.js DATA_DIRECTORY');console.log(JSON.stringify(run(process.argv[2]),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={load,replay,run};
