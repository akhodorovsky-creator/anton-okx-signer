"use strict";
const DAY=86_400_000;
const SMA_DAYS=200;
const ENTRY_BAND=0.02;
const EXIT_BAND=0.02;

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

module.exports={DAY,SMA_DAYS,ENTRY_BAND,EXIT_BAND,validateDailyBars,sma200,dailyRegime};
