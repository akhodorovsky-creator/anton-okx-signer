"use strict";
// This one-shot probe only reads balances, order histories and instruments.
// Never calls /auto or an order-writing endpoint.
const { portfolio } = require('./multi-live');
const delay=Number(process.env.MULTI_PREFLIGHT_DELAY_MS||25000);
setTimeout(async()=>{
  try {
    const p=await portfolio();
    console.log('ANTON_MULTI_PREFLIGHT '+JSON.stringify({
      ok:true,
      pairs:p.pairs.map(x=>({pair:x.pair,live:x.instrument.state==='live',minimumExceedsFiveEur:x.minTrade>5,pendingOrders:x.pending})),
      accountBalanceReadable:Number.isFinite(p.availableEur),
      positionHistoryReadable:true,
      totalExposureWithinLimit:p.exposureEur<=200,
      filledOrders:p.filledOrders
    }));
  } catch(e) {
    console.error('ANTON_MULTI_PREFLIGHT '+JSON.stringify({ok:false,error:e.message}));
  }
},Number.isFinite(delay)&&delay>=0&&delay<120000?delay:25000);
