"use strict";
const DAY=86_400_000;
const SMA_DAYS=200;
const ENTRY_BAND=0.02;
const EXIT_BAND=0.02;
const VOL_DAYS=30;
const TARGET_PORTFOLIO_VOL=0.15;
const MIN_ALLOCATION=0.10;
const MAX_ALLOCATION=0.50;

function validateDailyBars(bars){
  if(!Array.isArray(bars)||bars.length<SMA_DAYS)throw Error('INSUFFICIENT_DAILY_HISTORY');
  let previous=null;
  for(const bar of bars){
    if(!bar||!Number.isFinite(bar.timestamp)||!Number.isFinite(bar.close)||!(bar.close>0))throw Error('INVALID_DAILY_BAR');
    if(previous!==null&&bar.timestamp-previous!==DAY)throw Error('GAPPED_DAILY_HISTORY');
    previous=bar.timestamp;
  }
  return bars;
}

function sma200(bars){
  validateDailyBars(bars);
  const slice=bars.slice(-SMA_DAYS);
  return slice.reduce((sum,bar)=>sum+bar.close,0)/SMA_DAYS;
}

function realizedVolatility(bars,days=VOL_DAYS){
  validateDailyBars(bars);
  if(!Number.isInteger(days)||days<2||bars.length<days+1)throw Error('INVALID_VOLATILITY_WINDOW');
  const slice=bars.slice(-(days+1));
  const returns=[];
  for(let i=1;i<slice.length;i++)returns.push(Math.log(slice[i].close/slice[i-1].close));
  const mean=returns.reduce((sum,x)=>sum+x,0)/returns.length;
  const variance=returns.reduce((sum,x)=>sum+(x-mean)**2,0)/(returns.length-1);
  const annualized=Math.sqrt(variance*365);
  if(!(annualized>0)||!Number.isFinite(annualized))throw Error('VOLATILITY_UNVERIFIED');
  return annualized;
}

function riskBudget(bars,capitalEur){
  if(!(capitalEur>0)||!Number.isFinite(capitalEur))throw Error('INVALID_RISK_CAPITAL');
  const annualizedVol=realizedVolatility(bars,VOL_DAYS);
  const raw=TARGET_PORTFOLIO_VOL/annualizedVol;
  const allocation=Math.min(MAX_ALLOCATION,Math.max(MIN_ALLOCATION,raw));
  return Object.freeze({
    version:'BTC_VOL_TARGET_15_V1',
    annualizedVol,
    annualizedVolPct:annualizedVol*100,
    targetPortfolioVolPct:TARGET_PORTFOLIO_VOL*100,
    allocation,
    allocationPct:allocation*100,
    targetExposureEur:capitalEur*allocation,
    minAllocationPct:MIN_ALLOCATION*100,
    maxAllocationPct:MAX_ALLOCATION*100
  });
}

function dailyRegime(bars,hasPosition){
  validateDailyBars(bars);
  const last=bars.at(-1);
  const average=sma200(bars);
  const threshold=average*(hasPosition?1-EXIT_BAND:1+ENTRY_BAND);
  const riskOn=last.close>=threshold;
  return Object.freeze({
    version:'BTC_DAILY_SMA200_BAND_V2',
    candleAt:last.timestamp,
    close:last.close,
    sma200:average,
    distancePct:(last.close/average-1)*100,
    hasPosition:Boolean(hasPosition),
    riskOn,
    action:hasPosition?(riskOn?'HOLD':'EXIT'):(riskOn?'BUY':'WAIT'),
    entryBandPct:ENTRY_BAND*100,
    exitBandPct:EXIT_BAND*100
  });
}

module.exports={
  DAY,SMA_DAYS,ENTRY_BAND,EXIT_BAND,VOL_DAYS,TARGET_PORTFOLIO_VOL,MIN_ALLOCATION,MAX_ALLOCATION,
  validateDailyBars,sma200,realizedVolatility,riskBudget,dailyRegime
};
