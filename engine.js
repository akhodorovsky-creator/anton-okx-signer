'use strict';
// Pure simulation. This module has no network, credentials, signer or order API.
const CONFIG = Object.freeze(require('./experiment.json'));
const HOUR = 3600000;
const iso = t => new Date(t).toISOString();
const average = values => values.reduce((a, b) => a + b, 0) / values.length;

function validateBars(bars) {
  if (!Array.isArray(bars) || bars.length < 250) throw Error('INSUFFICIENT_CLOSED_HISTORY');
  bars.forEach((b, i) => {
    if (![b.timestamp,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
        b.timestamp % HOUR !== 0 || b.low <= 0 || b.volume < 0 ||
        b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) ||
        (i && b.timestamp - bars[i-1].timestamp !== HOUR)) throw Error('INVALID_OR_GAPPED_BARS');
  });
  return bars;
}

function features(bars) {
  validateBars(bars);
  let e20 = bars[0].close, e50 = e20, e200 = e20;
  const result = [], trueRanges = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], previous = bars[Math.max(0,i-1)];
    e20 += 2/21*(b.close-e20); e50 += 2/51*(b.close-e50); e200 += 2/201*(b.close-e200);
    trueRanges.push(Math.max(b.high-b.low, Math.abs(b.high-previous.close),Math.abs(b.low-previous.close)));
    let gain = 0, loss = 0;
    for (let j=Math.max(1,i-13);j<=i;j++) {
      const delta=bars[j].close-bars[j-1].close;
      gain+=Math.max(delta,0); loss+=Math.max(-delta,0);
    }
    result.push({...b, ema20:e20,ema50:e50,ema200:e200,ready:i>=249,
      rsi:gain+loss===0?50:loss===0?100:100-100/(1+gain/loss),
      atr:average(trueRanges.slice(-14)),
      previousClose:previous.close,previousLow:previous.low,
      previousEma20:result.at(-1)?.ema20??e20,
      ema50SixHoursAgo:result[Math.max(0,i-6)]?.ema50??e50,
      high24:i>=24?Math.max(...bars.slice(i-24,i).map(x=>x.high)):null,
      return24:i>=24?b.close/bars[i-24].close-1:null,
      volumeRatio:i>=20?b.volume/average(bars.slice(i-20,i).map(x=>x.volume)):0});
  }
  return result;
}

function decision(candidate, f, btc) {
  if (!CONFIG.candidates.includes(candidate)) throw Error('UNKNOWN_CANDIDATE');
  if (!f?.ready || !btc?.ready || f.timestamp!==btc.timestamp) return {buy:false,reason:'HISTORY_NOT_READY'};
  if (!(btc.close>btc.ema200 && btc.ema50>btc.ema200)) return {buy:false,reason:'BTC_TREND_FILTER'};
  if (!(f.close>f.ema200 && f.ema50>f.ema200 && f.ema50>f.ema50SixHoursAgo)) return {buy:false,reason:'PAIR_TREND_FILTER'};
  // Avoid signals at extreme extension; all parameters fixed before testing.
  if (!(f.atr>0) || f.close-f.ema20>3*f.atr) return {buy:false,reason:'EXTENDED_PRICE'};
  const buy = candidate==='breakout24' ? f.close>f.high24 && f.volumeRatio>=1.2 :
    candidate==='pullback20' ? f.previousLow<=f.previousEma20 && f.previousClose<=f.previousEma20 && f.close>f.ema20 && f.rsi>=42 && f.rsi<=65 :
      f.return24>=0.02 && f.rsi>=50 && f.rsi<=70;
  return {buy,reason:buy?candidate.toUpperCase():'WAIT_FOR_SETUP'};
}

function assumptions(overrides={}) {
  const c={...CONFIG,...overrides};
  for (const key of ['capitalEur','orderEur','maximumExposureEur','feeRate','slippageRate','takeProfitRate','stopLossRate','dailyEntryLossLimitEur','drawdownEntryLimitEur'])
    if (!Number.isFinite(c[key])) throw Error('INVALID_ASSUMPTION_'+key);
  if (!(c.capitalEur>0 && c.orderEur>0 && c.orderEur<=20 && c.maximumExposureEur<=60 && c.maximumExposureEur>=c.orderEur && c.capitalEur>=c.maximumExposureEur && c.feeRate>=0 && c.feeRate<0.1 && c.slippageRate>=0 && c.slippageRate<0.1 && c.takeProfitRate>0 && c.stopLossRate>0 && c.stopLossRate<1 && c.dailyEntryLossLimitEur>0 && c.drawdownEntryLimitEur>0)) throw Error('INVALID_ASSUMPTIONS');
  return c;
}

function initialState(candidate, overrides={}) {
  const c=assumptions(overrides);
  if (!CONFIG.candidates.includes(candidate)) throw Error('UNKNOWN_CANDIDATE');
  return {version:1,mode:'PAPER_ONLY',candidate,cash:c.capitalEur,positions:{},lastFill:{},lastBar:null,
    peak:c.capitalEur,maxDrawdownEur:0,maxDrawdownPct:0,day:null,dayStartEquity:c.capitalEur,entryHalted:false,
    realizedPnlEur:0,feesPaidEur:0,entries:0,trades:[],events:[],exposureHours:0,observations:0};
}

function mark(state, quotes, c) {
  return state.cash + Object.entries(state.positions).reduce((s,[pair,p])=>s+p.qty*quotes[pair].bid*(1-c.slippageRate)*(1-c.feeRate),0);
}

function step(state, snapshot, quotes, executionAt, overrides={}, allowEntries=true) {
  const c=assumptions(overrides), pairs=c.pairs;
  if (state.mode!=='PAPER_ONLY') throw Error('PAPER_ONLY_REQUIRED');
  const timestamp=snapshot[pairs[0]]?.timestamp;
  if (!Number.isFinite(timestamp) || !Number.isFinite(executionAt) || executionAt<timestamp+HOUR) throw Error('FUTURE_SIGNAL');
  if (state.lastBar!==null && timestamp<=state.lastBar) return {processed:false,reason:'DUPLICATE_OR_OLD_CANDLE'};
  for (const pair of pairs) {
    const q=quotes[pair];
    if (snapshot[pair]?.timestamp!==timestamp || !q || ![q.bid,q.ask].every(Number.isFinite) || !(q.bid>0 && q.ask>=q.bid)) throw Error('UNVERIFIED_SNAPSHOT');
  }
  const before=mark(state,quotes,c), day=iso(executionAt).slice(0,10);
  if (state.day!==day) {state.day=day;state.dayStartEquity=before;}
  state.peak=Math.max(state.peak,before);
  state.maxDrawdownEur=Math.max(state.maxDrawdownEur,state.peak-before);
  state.maxDrawdownPct=Math.max(state.maxDrawdownPct,(state.peak-before)/state.peak*100);
  if (state.peak-before>=c.drawdownEntryLimitEur) state.entryHalted=true;
  const events=[];
  for (const pair of pairs) {
    const p=state.positions[pair]; if(!p)continue;
    const f=snapshot[pair], hypotheticalExit=p.qty*f.close*(1-c.slippageRate)*(1-c.feeRate);
    const netReturn=hypotheticalExit/p.spent-1;
    const reason=netReturn>=c.takeProfitRate?'NET_TAKE_PROFIT':netReturn<=-c.stopLossRate?'NET_STOP_LOSS':executionAt-p.entryAt>=c.maximumHoldingHours*HOUR?'TIME_EXIT':null;
    if (!reason)continue;
    const gross=p.qty*quotes[pair].bid*(1-c.slippageRate), proceeds=gross*(1-c.feeRate), pnl=proceeds-p.spent;
    const trade={pair,entryAt:iso(p.entryAt),exitAt:iso(executionAt),spentEur:p.spent,proceedsEur:proceeds,pnlEur:pnl,reason};
    state.cash+=proceeds;state.realizedPnlEur+=pnl;state.feesPaidEur+=gross*c.feeRate;
    state.trades.push(trade);delete state.positions[pair];state.lastFill[pair]=executionAt;
    events.push({type:'PAPER_SELL',...trade});
  }
  const afterExits=mark(state,quotes,c);
  const permitted=allowEntries && !state.entryHalted && state.dayStartEquity-afterExits<c.dailyEntryLossLimitEur;
  if (permitted)for(const pair of pairs) {
    if(state.positions[pair] || executionAt-(state.lastFill[pair]??-Infinity)<c.pairCooldownHours*HOUR)continue;
    const q=quotes[pair], spread=(q.ask-q.bid)/((q.ask+q.bid)/2);
    if(spread>c.maxSpreadRate || !decision(state.candidate,snapshot[pair],snapshot['BTC-EUR']).buy)continue;
    const committed=Object.values(state.positions).reduce((s,p)=>s+p.spent,0);
    if(state.cash<c.orderEur || committed+c.orderEur>c.maximumExposureEur+1e-9)continue;
    const spent=c.orderEur, qty=spent*(1-c.feeRate)/(q.ask*(1+c.slippageRate));
    state.positions[pair]={qty,spent,entryAt:executionAt};state.cash-=spent;state.lastFill[pair]=executionAt;
    state.feesPaidEur+=spent*c.feeRate;state.entries++;
    events.push({type:'PAPER_BUY',pair,at:iso(executionAt),spentEur:spent,qty});
  }
  state.lastBar=timestamp;state.observations++;
  if(Object.keys(state.positions).length)state.exposureHours++;
  const equity=mark(state,quotes,c);
  state.peak=Math.max(state.peak,equity);state.maxDrawdownEur=Math.max(state.maxDrawdownEur,state.peak-equity);
  state.maxDrawdownPct=Math.max(state.maxDrawdownPct,(state.peak-equity)/state.peak*100);
  state.events.push(...events);
  return {processed:true,events,equityEur:equity};
}

function summary(state,quotes,overrides={}) {
  const c=assumptions(overrides), equity=mark(state,quotes,c), pnl=equity-c.capitalEur;
  const gains=state.trades.reduce((s,t)=>s+Math.max(t.pnlEur,0),0), losses=-state.trades.reduce((s,t)=>s+Math.min(t.pnlEur,0),0);
  return {status:'HYPOTHETICAL_NOT_LIVE',candidate:state.candidate,equityEur:equity,pnlEur:pnl,returnPct:pnl/c.capitalEur*100,
    realizedPnlEur:state.realizedPnlEur,unrealizedPnlEur:pnl-state.realizedPnlEur,
    maxDrawdownEur:state.maxDrawdownEur,maxDrawdownPct:state.maxDrawdownPct,
    entries:state.entries,closedTrades:state.trades.length,openPositions:Object.keys(state.positions).length,
    winningTrades:state.trades.filter(t=>t.pnlEur>0).length,profitFactor:losses>0?gains/losses:null,
    feesPaidEur:state.feesPaidEur,entryHalted:state.entryHalted,exposureHours:state.exposureHours,observations:state.observations};
}

module.exports={CONFIG,HOUR,features,decision,assumptions,initialState,mark,step,summary,validateBars};
