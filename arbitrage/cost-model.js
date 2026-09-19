'use strict';
// Public-book cost research only. No credentials, orders, balance reads or trading signals.
const {loadPair,levels}=require('./kraken-spot');
const FEE=Object.freeze({maker:0.004,taker:0.008});
const EUR_BUDGET=100;
const SLIPPAGE_RESERVE=0.002; // 0.2% extra reserve is illustrative, NOT measured slippage.
function model(book,{fee=FEE,reserve=SLIPPAGE_RESERVE}={}) {
  const ask=levels(book,'asks')[0],bid=levels(book,'bids')[0];
  if(!ask||!bid||ask.price<=bid.price||!(reserve>=0&&reserve<1))throw Error('Invalid or crossed orderbook');
  const spreadPct=(ask.price/bid.price-1)*100;
  // For taker legs, prices are observable best ask/bid. For maker legs, fill prices are NOT known.
  const scenarios=[['maker/maker',fee.maker,fee.maker,false],['maker/taker',fee.maker,fee.taker,false],['taker/taker',fee.taker,fee.taker,true]].map(([name,entry,exit,immediate])=>{
    if(![entry,exit].every(v=>Number.isFinite(v)&&v>=0&&v<1))throw Error('Invalid fee assumptions');
    const feeOnlyPct=(1/((1-entry)*(1-exit))-1)*100;
    const conservativeBreakEvenPct=(1/((1-entry)*(1-exit)*(1-reserve))-1)*100;
    const requiredBidRisePct=immediate?(ask.price/bid.price/((1-entry)*(1-exit)*(1-reserve))-1)*100:null;
    return {name,feeOnlyPct,conservativeBreakEvenPct,requiredBidRisePct,makerFillGuaranteed:false,readyForLive:false};
  });
  const topSizeOK=EUR_BUDGET/ask.price<=ask.baseSize&&EUR_BUDGET/ bid.price<=bid.baseSize;
  return {mode:'PAPER',strategy:'fee-first-observer',ordersEnabled:false,accountConnected:false,capitalLimitEUR:EUR_BUDGET,feeAssumption:FEE,slippageReserveAssumptionPct:reserve*100,ask:ask.price,bid:bid.price,spreadPct,topSizeOK,scenarios,realizedProfitEUR:null,action:'OBSERVE_ONLY',warning:'Not arbitrage. Maker execution, exact account fee, minimum size and future prices are unknown. Estimates are not a forecast or actionable buy signal.'};
}
async function scan(){const book=await loadPair('XBTEUR');return {...model(book),pair:'BTC/EUR',fetchedAt:new Date().toISOString()};}
module.exports={model,scan};
