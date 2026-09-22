'use strict';
const MINUTE = 60_000, OI_LOOKBACK = 15 * MINUTE, OI_TOLERANCE = 90_000;
function signalPeriod(raw) {
  if (raw === undefined || raw === '') return 15 * MINUTE;
  if (!['5', '15'].includes(String(raw))) throw Error('INVALID_SIGNAL_INTERVAL');
  return Number(raw) * MINUTE;
}
function dustEnabled(raw) {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw !== 'true') throw Error('INVALID_DUST_REENTRY_SETTING');
  return true;
}
// A fast loop must not silently change the derivative feature to a 5-minute delta.
// Keep only samples that were actually observed, with a bounded 15-minute window.
function observeOi(state, row, now) {
  const oi = Number(row?.oiUsd ?? row?.oi), ts = Number(row?.ts);
  if (!(oi > 0) || !Number.isFinite(oi) || !Number.isFinite(ts) ||
      !Number.isFinite(now) || ts > now + MINUTE || now - ts > MINUTE)
    return {ready: false, reason: 'OI_SAMPLE_UNVERIFIED'};
  const history = (state.oiHistory || []).filter(s => s.ts >= ts - OI_LOOKBACK - OI_TOLERANCE && s.observedAt <= now);
  if (history.length && ts <= history.at(-1).ts) return {ready: false, reason: 'OI_SAMPLE_NOT_ADVANCING'};
  const target = ts - OI_LOOKBACK;
  const reference = history.filter(s => Math.abs(s.ts - target) <= OI_TOLERANCE)
    .sort((a, b) => Math.abs(a.ts - target) - Math.abs(b.ts - target))[0];
  history.push({ts, oi, observedAt: now});
  state.oiHistory = history.slice(-8);
  return reference ? {ready: true, prior: reference.oi, lookbackMs: ts - reference.ts} :
    {ready: false, reason: 'OI_15M_WARMUP'};
}
// A sub-lot remnant is not sellable. Only permit numerical ledger noise smaller
// than a millionth of one lot when reconciling with the exchange free balance.
function isReconciledDust(position) {
  const {qty, free} = position;
  const min = Number(position.instrument?.minSz), lot = Number(position.instrument?.lotSz);
  if (![qty, free, min, lot].every(Number.isFinite) ||
      !(qty > 0) || !(free >= 0) || !(min > 0) || !(lot > 0)) return false;
  if (!(qty < lot && qty < min && free < lot)) return false;
  return Math.abs(free - qty) <= Math.max(lot * 1e-6, qty * 1e-9);
}
function entryBlock(position, allowDust = false) {
  const {qty, free} = position;
  const min = Number(position.instrument?.minSz), lot = Number(position.instrument?.lotSz);
  if (![qty, free, min, lot].every(Number.isFinite) || qty < 0 || free < 0 || min <= 0 || lot <= 0)
    return 'POSITION_UNVERIFIED';
  if (qty === 0) return null;
  // Residual remains in cost basis, P&L and overall capital exposure.
  if (!(qty < lot && qty < min)) return 'POSITION_ALREADY_OPEN';
  if (!allowDust) return 'DUST_REENTRY_DISABLED';
  if (!isReconciledDust(position)) return 'DUST_BALANCE_MISMATCH';
  return null;
}
module.exports = {signalPeriod, dustEnabled, observeOi, entryBlock, isReconciledDust};
