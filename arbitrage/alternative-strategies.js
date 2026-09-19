'use strict';
// Research-only strategy comparison. No credentials, balance access or order execution.
// Fees are published tier-1 assumptions; actual account fees must be verified.
const BUDGET = 100;
const FEE = Object.freeze({maker:0.004,taker:0.008});
function evaluateRoundTrip({buyEUR, sellEUR, sizeEUR=100, entry='maker', exit='maker', slippagePct=0}) {
  if (![buyEUR,sellEUR,sizeEUR,slippagePct].every(Number.isFinite) || buyEUR<=0 || sellEUR<=0 || sizeEUR<=0 || sizeEUR>BUDGET || slippagePct<0 || slippagePct>=1) throw Error('Invalid paper inputs or budget');
  if (!Object.hasOwn(FEE,entry) || !Object.hasOwn(FEE,exit)) throw Error('Invalid fee class');
  const base=(sizeEUR/buyEUR)*(1-FEE[entry]);
  const finish=base*sellEUR*(1-FEE[exit])*(1-slippagePct);
  return Object.freeze({mode:'PAPER',notArbitrage:true,ordersEnabled:false,entry,exit,sizeEUR,estimatedFinalEUR:finish,estimatedNetEUR:finish-sizeEUR,estimatedNetPct:(finish/sizeEUR-1)*100,breakEvenRisePct:(1/((1-FEE[entry])*(1-FEE[exit])*(1-slippagePct))-1)*100,warning:'Maker fills are not guaranteed; direction, adverse selection, gaps and overnight risk are not modeled. Not a trading signal.'});
}
function options() {return {mode:'PAPER',ordersEnabled:false,accountConnected:false,capitalLimitEUR:BUDGET,feeAssumption:FEE,candidates:[{id:'passive-spot',description:'Limit-maker entry and exit on a single EUR spot pair; directional risk, both fills not guaranteed',roundTripBreakEvenPct:evaluateRoundTrip({buyEUR:1,sellEUR:1,entry:'maker',exit:'maker'}).breakEvenRisePct,readyForLive:false},{id:'maker-taker',description:'Limit-maker entry, protective taker exit; directional risk and potential slippage',roundTripBreakEvenPct:evaluateRoundTrip({buyEUR:1,sellEUR:1,entry:'maker',exit:'taker'}).breakEvenRisePct,readyForLive:false},{id:'market-observer',description:'Read-only cross-venue price discrepancy observer; transfers, both venues and fees unverified',readyForLive:false}],reasonsNotLive:['No verified account-specific fees','No authenticated balance or trading permission','No validated minimum sizes, spread, slippage or fill simulation','No evidence of positive out-of-sample net returns']};}
module.exports={evaluateRoundTrip,options};
