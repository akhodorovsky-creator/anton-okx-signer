'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('./scanner');
const q = { marketId:'demo', outcomeA:{ask:0.18,size:100}, outcomeB:{ask:0.78,size:90}, payout:1, feeA:0, feeB:0 };
test('detects positive paper arbitrage with executable pair size', () => { const r=evaluate(q); assert.equal(r.mode,'PAPER'); assert.equal(r.quantity,90); assert.ok(Math.abs(r.estimatedProfit-3.6)<1e-9); assert.equal(r.candidate,true); });
test('rejects opportunity after fees', () => assert.equal(evaluate({...q, feeA:0.03, feeB:0.03}).candidate,false));
test('rejects zero available size', () => assert.equal(evaluate({...q, outcomeA:{ask:0.18,size:0}}).candidate,false));
test('rejects missing outcomes and invalid prices', () => { assert.throws(()=>evaluate({marketId:'x'})); assert.throws(()=>evaluate({...q, outcomeA:{ask:-1,size:1}})); });
