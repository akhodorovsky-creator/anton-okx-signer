'use strict';
// Read-only public Gamma + CLOB APIs. No credentials, order methods, or trading.
const { evaluate } = require('./scanner');
const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const TIMEOUT_MS = 6500;
async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
  return response.json();
}
function arrayField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function parseBinary(m) {
  if (!m || m.active !== true || m.closed === true || m.acceptingOrders !== true || m.enableOrderBook !== true || m.negRisk === true) return null;
  const outcomes = arrayField(m.outcomes), tokens = arrayField(m.clobTokenIds);
  if (outcomes.length !== 2 || tokens.length !== 2 || !outcomes.includes('Yes') || !outcomes.includes('No')) return null;
  if (!tokens.every(x => /^\d{15,}$/.test(String(x)))) return null;
  return { marketId: String(m.id), question: String(m.question || '').slice(0, 220), slug: String(m.slug || ''), yes: String(tokens[outcomes.indexOf('Yes')]), no: String(tokens[outcomes.indexOf('No')]) };
}
function bestAsk(book) {
  const asks = Array.isArray(book?.asks) ? book.asks : [];
  const levels = asks.map(x => ({ price: Number(x.price), size: Number(x.size) })).filter(x => Number.isFinite(x.price) && x.price > 0 && x.price <= 1 && Number.isFinite(x.size) && x.size > 0);
  levels.sort((a,b) => a.price - b.price);
  return levels[0] || null;
}
async function scan({ limit = 6, get = getJson } = {}) {
  const safeLimit = Math.min(10, Math.max(1, Number(limit) || 6));
  const markets = await get(`${GAMMA}/markets?active=true&closed=false&limit=60&order=volume24hr&ascending=false`);
  if (!Array.isArray(markets)) throw new Error('Invalid Gamma response');
  const eligible = markets.map(parseBinary).filter(Boolean).slice(0, safeLimit);
  const rows = await Promise.all(eligible.map(async market => {
    try {
      const [yes, no] = await Promise.all([market.yes, market.no].map(token => get(`${CLOB}/book?token_id=${token}`)));
      const a = bestAsk(yes), b = bestAsk(no);
      if (!a || !b) return { marketId: market.marketId, question: market.question, status: 'no_executable_asks' };
      const raw = evaluate({ marketId: market.marketId, outcomeA: { ask: a.price, size: a.size }, outcomeB: { ask: b.price, size: b.size }, payout: 1 });
      return { marketId: market.marketId, question: market.question, slug: market.slug,
        yesAsk: a.price, noAsk: b.price, pairSizeTopLevel: raw.quantity,
        grossSpreadPerPair: raw.profitPerPair, grossSpreadTopLevel: raw.estimatedProfit,
        status: raw.profitPerPair > 0 ? 'gross_spread_only_unverified' : 'no_gross_spread',
        executableOpportunity: false, feesVerified: false,
        warning: 'Gross top-of-book quote only. Venue fees, size-dependent depth, fill timing, eligibility and settlement unverified; NOT a net arbitrage signal.' };
    } catch (e) { return { marketId: market.marketId, question: market.question, status: 'feed_error', error: String(e.message).slice(0,100) }; }
  }));
  return { mode: 'PAPER', source: 'Polymarket public Gamma + CLOB', fetchedAt: new Date().toISOString(), marketsSeen: markets.length, eligibleCount: eligible.length, rows,
    tradesEnabled: false, netProfitVerified: false, disclaimer: 'Informational read-only quote monitor, no trading. Gross spreads are NOT executable net profits.' };
}
module.exports = { scan, parseBinary, bestAsk };
