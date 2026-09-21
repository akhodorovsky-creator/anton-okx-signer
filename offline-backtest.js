"use strict";
// Offline research only. No HTTP, credentials, exchange orders, or production imports.
const fs = require('node:fs');
const {compute} = require('./market-strategy');
const BAR_MS = 5 * 60_000;
const TICK_MS = 15 * 60_000;
const HEADER = 'time,open,high,low,close,volume,ethClose,ethVolume,oi,funding';
function finite(value, name) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) throw Error('INVALID_' + name);
  return Number(value);
}
function parseCsv(text) {
  if (typeof text !== 'string') throw Error('CSV_REQUIRED');
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift() !== HEADER) throw Error('CSV_HEADER_MISMATCH');
  const bars = lines.map((line, i) => {
    const cells = line.split(',');
    if (cells.length !== 10) throw Error('CSV_COLUMNS_' + (i + 2));
    const timestamp = Date.parse(cells[0]);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(cells[0]) || !Number.isFinite(timestamp)) throw Error('INVALID_TIME_' + (i + 2));
    const [open,high,low,close,volume,ethClose,ethVolume,oi,funding] = cells.slice(1).map((x,j) => finite(x, ['OPEN','HIGH','LOW','CLOSE','VOLUME','ETH_CLOSE','ETH_VOLUME','OI','FUNDING'][j]));
    if (!(low > 0 && open >= low && close >= low && high >= open && high >= close && high >= low && volume >= 0 && ethClose > 0 && ethVolume >= 0 && oi > 0)) throw Error('INVALID_BAR_' + (i + 2));
    if (i && timestamp - bars[i-1].timestamp !== BAR_MS) throw Error('MISSING_OR_DUPLICATE_BAR_' + (i + 2));
    return {timestamp,open,high,low,close,volume,ethClose,ethVolume,oi,funding};
  });
  if (bars.length < 64) throw Error('INSUFFICIENT_HISTORY');
  return bars;
}
function candle(bar, eth = false) {
  const price = eth ? bar.ethClose : bar.close;
  return [String(bar.timestamp),'','','',String(price),String(eth ? bar.ethVolume : bar.volume),'','','1'];
}
function marketAt(bars, index) {
  const history = bars.slice(index - 59, index + 1);
  const last = bars[index];
  return {
    btc:{code:'0',data:history.map(b => candle(b))},
    eth:{code:'0',data:history.map(b => candle(b,true))},
    oi:{code:'0',data:[{oiUsd:String(last.oi),ts:String(last.timestamp)}]},
    funding:{code:'0',data:[{fundingRate:String(last.funding)}]}
  };
}
function replay(bars, options = {}) {
  if (!Array.isArray(bars) || bars.length < 64) throw Error('INSUFFICIENT_HISTORY');
  const capital = options.capital ?? 200, order = options.order ?? 5;
  const fee = options.fee ?? 0.001, slippage = options.slippage ?? 0.0005;
  if (![capital,order,fee,slippage].every(Number.isFinite) || !(capital > 0 && order > 0 && order <= 20 && order <= capital && fee >= 0 && fee < 0.1 && slippage >= 0 && slippage < 0.1)) throw Error('INVALID_ASSUMPTIONS');
  const signalFn = options.signalFn ?? compute;
  let cash = capital, position = null, realized = 0, peak = capital, maxDrawdownPct = 0, signals = 0, entries = 0;
  let lastFillTime = -Infinity;
  const state = {lastOi:null,lastSignal:null,lastSignalAt:null};
  const trades = [];
  let benchmarkEntry = null;
  for (let i = 59; i < bars.length; i++) {
    const bar = bars[i];
    if (position) {
      const mark = cash + position.qty * bar.close * (1-slippage) * (1-fee);
      peak = Math.max(peak, mark);
      maxDrawdownPct = Math.max(maxDrawdownPct, (peak-mark)/peak*100);
    } else {
      peak = Math.max(peak,cash);
      maxDrawdownPct = Math.max(maxDrawdownPct,(peak-cash)/peak*100);
    }
    const now = bar.timestamp + BAR_MS;
    if (now % TICK_MS !== 0 || i+1 >= bars.length) continue;
    const next = bars[i+1];
    if (!benchmarkEntry) benchmarkEntry = next.open;
    // Production checks TP/SL on scheduled snapshots and executes on the exchange;
    // replay executes at the NEXT candle open, never at the observed close.
    if (position && (bar.close >= position.entryPrice*1.05 || bar.close <= position.entryPrice*0.98)) {
      const received = position.qty * next.open * (1-slippage) * (1-fee);
      cash += received;
      const pnl = received - position.spent;
      realized += pnl;
      trades.push({entryTime:position.entryTime,exitTime:new Date(next.timestamp).toISOString(),entryPrice:position.entryPrice,exitPrice:next.open*(1-slippage),pnlEur:pnl,reason:bar.close >= position.entryPrice*1.05?'TP':'SL'});
      position = null;
      lastFillTime = next.timestamp;
      continue;
    }
    if (position || now - lastFillTime < 30*60_000) continue;
    const result = signalFn(marketAt(bars,i), state, now);
    signals++;
    if (result.marketInputsFresh && bars[i].oi > 0) state.lastOi = bars[i].oi;
    if (!result.actionable || result.signal !== 'BUY' || cash < order) continue;
    const entryPrice = next.open*(1+slippage);
    position = {qty:order*(1-fee)/entryPrice,spent:order,entryPrice,entryTime:new Date(next.timestamp).toISOString()};
    cash -= order;
    lastFillTime = next.timestamp;
    state.lastSignal = 'BUY';
    state.lastSignalAt = now;
    entries++;
  }
  const last = bars.at(-1);
  const liquidationValue = position ? position.qty * last.close * (1-slippage) * (1-fee) : 0;
  const equity = cash + liquidationValue;
  const benchmarkQty = benchmarkEntry ? capital*(1-fee)/(benchmarkEntry*(1+slippage)) : 0;
  const benchmarkEquity = benchmarkEntry ? benchmarkQty*last.close*(1-slippage)*(1-fee) : null;
  return {status:'HYPOTHETICAL_NOT_LIVE',pair:'BTC-EUR',from:new Date(bars[0].timestamp).toISOString(),to:new Date(last.timestamp).toISOString(),capitalEur:capital,orderEur:order,feeRate:fee,slippageRate:slippage,signalsEvaluated:signals,entries,closedTrades:trades.length,realizedPnlEur:realized,unrealizedPnlEur:liquidationValue-(position?.spent??0),equityEur:equity,returnPct:(equity/capital-1)*100,maxDrawdownPct,benchmarkBuyHoldReturnPct:benchmarkEquity == null ? null : (benchmarkEquity/capital-1)*100,openPosition:!!position,trades};
}
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw Error('USAGE: node offline-backtest.js /path/to/local-history.csv');
    const bars = parseCsv(fs.readFileSync(process.argv[2],'utf8'));
    console.log(JSON.stringify(replay(bars),null,2));
  } catch (error) {console.error('OFFLINE_BACKTEST_ERROR '+error.message);process.exitCode=1;}
}
module.exports={parseCsv,marketAt,replay,HEADER};
