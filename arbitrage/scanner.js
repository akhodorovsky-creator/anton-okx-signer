'use strict';
// PAPER ONLY: no exchange client, network requests, credentials, or order execution.
// Input: JSON lines containing { marketId, outcomeA: {ask, size}, outcomeB: {ask,size}, payout, feeA, feeB, settlementCost, minProfit }.
const readline = require('node:readline');
function finiteNonnegative(x) { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }
function evaluate(q) {
  if (!q || typeof q.marketId !== 'string' || !q.marketId.trim()) throw new Error('marketId required');
  if (!q.outcomeA || !q.outcomeB) throw new Error('both outcomes required');
  for (const outcome of [q.outcomeA, q.outcomeB]) {
    if (!finiteNonnegative(outcome.ask) || !finiteNonnegative(outcome.size)) throw new Error('invalid ask or size');
  }
  const { payout, feeA = 0, feeB = 0, settlementCost = 0, minProfit = 0 } = q;
  for (const n of [payout, feeA, feeB, settlementCost, minProfit]) {
    if (!finiteNonnegative(n)) throw new Error('invalid payout, fee, settlement cost or threshold');
  }
  if (payout <= 0) throw new Error('positive payout required');
  const quantity = Math.min(q.outcomeA.size, q.outcomeB.size);
  const costPerPair = q.outcomeA.ask + q.outcomeB.ask + feeA + feeB + settlementCost;
  const profitPerPair = payout - costPerPair;
  const profit = quantity * profitPerPair;
  return { marketId: q.marketId, mode: 'PAPER', quantity, costPerPair, payoutPerPair: payout,
    profitPerPair, estimatedProfit: profit, candidate: quantity > 0 && profitPerPair > 0 && profit >= minProfit,
    warning: 'The inputs must be executable asks for exhaustive mutually exclusive outcomes; fill, settlement, and counterparty risks remain.' };
}
if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => {
    try { console.log(JSON.stringify(evaluate(JSON.parse(line)))); }
    catch (error) { console.log(JSON.stringify({ mode: 'PAPER', error: error.message })); }
  });
}
module.exports = { evaluate };
