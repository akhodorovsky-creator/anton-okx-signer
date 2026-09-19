'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {audit, REQUIRED} = require('./readiness');
test('no account always blocks review and orders', () => {
 const r = audit({capitalEUR:100});
 assert.equal(r.readyForReview,false);
 assert.equal(r.liveOrdersAuthorized,false);
 assert.ok(r.missingChecks.includes('accountVerified'));
 assert.equal(r.ordersSubmitted,0);
});
test('budget above 100 or invalid blocks review', () => {
 for(const x of [100.01,101,0,-1,NaN,Infinity,'100']){
  const r = audit(Object.fromEntries([...REQUIRED.map(k=>[k,true]),['capitalEUR',x]]));
  assert.equal(r.readyForReview,false);
  assert.ok(r.missingChecks.includes('validCapitalEURAtMost100'));
 }
});
test('audit never authorizes orders even when all checks assert true', () => {
 const r=audit(Object.fromEntries([...REQUIRED.map(k=>[k,true]),['capitalEUR',100]]));
 assert.equal(r.readyForReview,true);
 assert.equal(r.liveOrdersAuthorized,false);
 assert.equal(r.ordersSubmitted,0);
});
test('missing safety control fails closed',()=>{
 const checks=Object.fromEntries([...REQUIRED.map(k=>[k,true]),['capitalEUR',100]]);
 delete checks.restartReconciliationTested;
 assert.equal(audit(checks).readyForReview,false);
});
