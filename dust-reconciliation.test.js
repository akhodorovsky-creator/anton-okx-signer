'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {entryBlock,isReconciledDust}=require('./frequency-policy');
const doge={qty:1.4000022474647267e-8,free:1.4e-8,instrument:{minSz:'10',lotSz:'0.000001'}};
test('real DOGE residue reconciles despite fee arithmetic rounding',()=>{
  assert.equal(isReconciledDust(doge),true);
  assert.equal(entryBlock(doge,true),null);
  assert.equal(entryBlock(doge,false),'DUST_REENTRY_DISABLED');
});
test('real BTC and ETH residues are tracked as sub-lot dust',()=>{
  assert.equal(isReconciledDust({qty:5.779999999997766e-9,free:5.78e-9,instrument:{minSz:'0.0001',lotSz:'0.00000001'}}),true);
  assert.equal(isReconciledDust({qty:8.349999999993779e-7,free:8.35e-7,instrument:{minSz:'0.001',lotSz:'0.000001'}}),true);
});
test('meaningful discrepancy or a real position is never hidden as dust',()=>{
  for(const p of [
    {...doge,free:0}, {...doge,free:2}, {...doge,free:doge.qty+2e-12},
    {...doge,qty:0.000003,free:0.000003}, {...doge,qty:NaN}, {...doge,qty:1e-14,free:0}
  ]) assert.equal(isReconciledDust(p),false);
  assert.equal(entryBlock({...doge,free:2},true),'DUST_BALANCE_MISMATCH');
  assert.equal(entryBlock({...doge,qty:0.000003,free:0.000003},true),'POSITION_ALREADY_OPEN');
});
test('entry retains fail-closed rules for nonfinite quantity and disabled dust trading',()=>{
  assert.equal(entryBlock({...doge,qty:NaN},true),'POSITION_UNVERIFIED');
  assert.equal(entryBlock(doge,false),'DUST_REENTRY_DISABLED');
  assert.equal(entryBlock({...doge,qty:0,free:0},true),null);
});
