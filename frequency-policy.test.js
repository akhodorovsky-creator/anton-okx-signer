'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {sellSize} = require('./lot-size');
const {signalPeriod, dustEnabled, observeOi, entryBlock} = require('./frequency-policy');
const MINUTE = 60000;
test('frequency is opt-in and invalid values cannot accelerate trading', () => {
  assert.equal(signalPeriod(), 15 * MINUTE);
  assert.equal(signalPeriod('5'), 5 * MINUTE);
  assert.equal(signalPeriod('15'), 15 * MINUTE);
  for (const value of ['0', '-1', '1', 'NaN', '5minutes', null]) assert.throws(() => signalPeriod(value));
  assert.equal(dustEnabled(), false);
  assert.equal(dustEnabled('true'), true);
  assert.throws(() => dustEnabled('yes'));
});
test('BTC scientific lot size rounds down to eight decimal places', () => {
  assert.equal(sellSize(0.000123456789, 0.000123456789, 1e-8, 0.0001), '0.00012345');
  assert.equal(sellSize('0.000123456789', '0.000111119999', '0.00000001', '0.0001'), '0.00011111');
  assert.equal(sellSize('1.2345e-4', '1.2345e-4', '1e-8', '1e-4'), '0.00012345');
  assert.equal(sellSize('1', '1', '0.00000001', '0.0001'), '1');
});
test('rounding never exceeds balance or bot inventory and rejects dust', () => {
  for (let units = 10000; units <= 10100; units++) {
    const qty = units / 1e8 + 3e-10;
    const available = qty - 2e-8;
    const result = sellSize(qty, available, 1e-8, 0.00001);
    assert.ok(Number(result) <= qty && Number(result) <= available);
    assert.ok(Math.abs(Number(result) * 1e8 - Math.round(Number(result) * 1e8)) < 1e-7);
  }
  assert.equal(sellSize('0.000099999', '1', '1e-8', '0.0001'), null);
  assert.equal(sellSize('0.0000001', '1', '0.000001', '0.001'), null);
  for (const value of [NaN, Infinity, -1, null, false, 'garbage']) assert.equal(sellSize(value, 1, 0.01, 0.1), null);
});
test('only reconciled sub-lot residue permits an opt-in new entry', () => {
  const p = {qty: 8e-7, free: 8e-7, instrument: {minSz: '0.001', lotSz: '0.000001'}};
  assert.equal(entryBlock(p), 'DUST_REENTRY_DISABLED');
  assert.equal(entryBlock(p, true), null);
  assert.equal(entryBlock({...p, qty: 0.0001, free: 0.0001}, true), 'POSITION_ALREADY_OPEN');
  assert.equal(entryBlock({...p, free: 0}, true), 'DUST_BALANCE_MISMATCH');
  assert.equal(entryBlock({...p, free: 2}, true), 'DUST_BALANCE_MISMATCH');
  assert.equal(entryBlock({...p, qty: 0.01, free: 0.01}, true), 'POSITION_ALREADY_OPEN');
  assert.equal(entryBlock({...p, qty: NaN}, true), 'POSITION_UNVERIFIED');
});
test('live BTC ETH DOGE sub-lot rounding drift reconciles only with dust option enabled', () => {
  const residues = [
    {qty: 5.779999999997766e-9, free: 5.78e-9, instrument: {minSz: '0.0001', lotSz: '0.00000001'}},
    {qty: 8.349999999993779e-7, free: 8.35e-7, instrument: {minSz: '0.001', lotSz: '0.000001'}},
    {qty: 1.4000022474647267e-8, free: 1.4e-8, instrument: {minSz: '10', lotSz: '0.000001'}}
  ];
  for (const p of residues) {
    assert.equal(entryBlock(p), 'DUST_REENTRY_DISABLED');
    assert.equal(entryBlock(p, true), null);
  }
});
test('dust tolerance cannot conceal missing, extra, microscopic or tradeable inventory', () => {
  const p = {qty: 1.4000022474647267e-8, free: 1.4e-8, instrument: {minSz: '10', lotSz: '0.000001'}};
  for (const free of [0, p.free * .99, p.free * 1.01, 2])
    assert.equal(entryBlock({...p, free}, true), 'DUST_BALANCE_MISMATCH');
  assert.equal(entryBlock({...p, qty: 0.000001}, true), 'POSITION_ALREADY_OPEN');
  assert.equal(entryBlock({qty: 1e-17, free: 1e-15, instrument: p.instrument}, true), 'DUST_BALANCE_MISMATCH');
});
test('faster observations retain a fifteen-minute OI comparison', () => {
  const state = {}, start = 1800000000000;
  for (let i = 0; i < 3; i++) assert.equal(observeOi(state, {oi: 1000 + i, ts: start + i * 5 * MINUTE}, start + i * 5 * MINUTE).ready, false);
  const r = observeOi(state, {oi: 1100, ts: start + 15 * MINUTE}, start + 15 * MINUTE);
  assert.deepEqual(r, {ready: true, prior: 1000, lookbackMs: 15 * MINUTE});
  const next = observeOi(state, {oi: 1200, ts: start + 20 * MINUTE}, start + 20 * MINUTE);
  assert.equal(next.prior, 1001);
  assert.equal(observeOi(state, {oi: 1200, ts: start + 20 * MINUTE}, start + 20 * MINUTE).ready, false);
});
test('stale, missing, future and excessively old reference samples cannot create OI signals', () => {
  const now = 1800000000000;
  for (const row of [null, {oi: 1, ts: now - 120000}, {oi: 1, ts: now + 120000}, {oi: 'NaN', ts: now}])
    assert.equal(observeOi({}, row, now).ready, false);
  const state = {};
  observeOi(state, {oi: 1000, ts: now}, now);
  assert.equal(observeOi(state, {oi: 1500, ts: now + 25 * MINUTE}, now + 25 * MINUTE).ready, false);
});
