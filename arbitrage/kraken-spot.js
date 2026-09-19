'use strict';
// READ ONLY. Public Kraken order books; never import exchange credentials or submit orders.
// Approximation only: non-atomic 3-leg execution, stale quotes and partial fills can cause losses.
const API = 'https://api.kraken.com/0/public/Depth';
const PAIRS = ['XBTEUR', 'ETHEUR', 'ETHXBT'];
const MAX_PAPER_EUR = 100;
const DEFAULT_TAKER_FEE = 0.008; // Conservative published Kraken Pro tier-1 crypto taker fee; confirm user's actual tier.
function levels(book, side) {
  const rows = book && Array.isArray(book[side]) ? book[side] : [];
  return rows.map(x => ({price: Number(x[0]), baseSize: Number(x[1])}))
    .filter(x => Number.isFinite(x.price) && x.price > 0 && Number.isFinite(x.baseSize) && x.baseSize > 0)
    .sort((a,b) => side === 'asks' ? a.price-b.price : b.price-a.price);
}
function simulate(books, initialEUR = MAX_PAPER_EUR, fee = DEFAULT_TAKER_FEE) {
  if (!Number.isFinite(initialEUR) || initialEUR <= 0 || initialEUR > MAX_PAPER_EUR) throw Error('Paper budget must be 0 < EUR <= 100');
  if (!Number.isFinite(fee) || fee < 0 || fee >= 1) throw Error('Invalid fee');
  const btc = books.XBTEUR, eth = books.ETHEUR, cross = books.ETHXBT;
  if (!btc || !eth || !cross) throw Error('Missing spot pair');
  const [ba,bb,ea,eb,ca,cb] = [levels(btc,'asks')[0],levels(btc,'bids')[0],levels(eth,'asks')[0],levels(eth,'bids')[0],levels(cross,'asks')[0],levels(cross,'bids')[0]];
  if (![ba,bb,ea,eb,ca,cb].every(Boolean)) throw Error('Missing executable top-of-book side');
  // Route A EUR -> BTC (buy XBTEUR) -> ETH (buy ETHXBT) -> EUR (sell ETHEUR).
  const aBtc = initialEUR / ba.price * (1-fee);
  const aEth = aBtc / ca.price * (1-fee);
  const aFinish = aEth * eb.price * (1-fee);
  const aDepth = aBtc <= ba.baseSize && aEth <= ca.baseSize && aEth <= eb.baseSize;
  // Route B EUR -> ETH (buy ETHEUR) -> BTC (sell ETHXBT) -> EUR (sell XBTEUR).
  const bEth = initialEUR / ea.price * (1-fee);
  const bBtc = bEth * cb.price * (1-fee);
  const bFinish = bBtc * bb.price * (1-fee);
  const bDepth = bEth <= ea.baseSize && bEth <= cb.baseSize && bBtc <= bb.baseSize;
  const view = (route, eur, depth) => ({route, initialEUR, estimatedFinalEUR:eur, estimatedNetEUR:eur-initialEUR, topLevelDepthSufficient:depth, candidateForFurtherReview:depth && eur>initialEUR, executableTrade:false});
  return {mode:'PAPER', venue:'Kraken public spot', takerFeeAssumption:fee, quotesNotAtomic:true, accountFeeAndPairEligibilityVerified:false, ordersEnabled:false, budgetEUR:MAX_PAPER_EUR, routes:[view('EUR→BTC→ETH→EUR',aFinish,aDepth),view('EUR→ETH→BTC→EUR',bFinish,bDepth)], warning:'Indicative asynchronous top-level books, assuming three taker fees. No account fee confirmation, minimum order/precision check, simultaneous fill guarantee or execution logic.'};
}
async function loadPair(pair, get = fetch) {
  const response = await get(`${API}?pair=${encodeURIComponent(pair)}&count=10`, {headers:{accept:'application/json'}, signal:AbortSignal.timeout(6000)});
  if (!response.ok) throw Error(`Kraken HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.error) || payload.error.length || !payload.result || Object.keys(payload.result).length !== 1) throw Error(`Kraken response for ${pair} invalid`);
  return Object.values(payload.result)[0];
}
async function scan(options={}) {
  const get = options.get || fetch;
  const pairs = await Promise.all(PAIRS.map(async pair=>[pair,await loadPair(pair,get)]));
  return {...simulate(Object.fromEntries(pairs),options.initialEUR ?? MAX_PAPER_EUR,options.fee ?? DEFAULT_TAKER_FEE), fetchedAt:new Date().toISOString(), publicFeedReceived:true};
}
module.exports={levels,simulate,scan,loadPair};
