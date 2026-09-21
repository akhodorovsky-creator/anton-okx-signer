"use strict";
// Fail-closed, deterministic compatibility patch for the proven coordinator.
// No source file is modified on disk; no extra trading process is started.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const sourceFile = path.join(__dirname, 'multi-live.js');
function prepare(source) {
  const changes = [
    ['const MAX_ORDER=Math.min(5,Number(process.env.MAX_ORDER_EUR||5));',
     'const MAX_ORDER=Math.min(20,Number(process.env.MAX_ORDER_EUR||5));', 1],
    ['requested>5', 'requested>20', 1],
    ['MAX_ORDER>5', 'MAX_ORDER>20', 2],
    ["function handler(req,res){const route=(req.url||'').split('?')[0];",
     "function handler(req,res){const route=(req.url||'').split('?')[0];" +
     "if(LIVE&&route==='/auto'&&req.method==='POST'){req.resume();return json(res,409,{ok:false,error:'MULTI_COORDINATOR_OWNS_ALL_TRADING'});}", 1],
    ["console.error('ANTON_MULTI_EXIT_BLOCKED '+p.pair+' BELOW_MIN_OR_UNAVAILABLE');continue;",
     "console.warn('ANTON_MULTI_EXIT_BLOCKED '+JSON.stringify({pair:p.pair,reason:'BELOW_MIN_OR_UNAVAILABLE',qty:p.qty,available:p.free,minSz:p.instrument.minSz,lotSz:p.instrument.lotSz}));continue;", 1]
  ];
  let result = source;
  for (const [before, after, expected] of changes) {
    const count = result.split(before).length - 1;
    if (count !== expected || result.includes(after)) throw Error('SOURCE_PATCH_MISMATCH: '+before);
    result = result.split(before).join(after);
  }
  for (const guard of [
    'const CAP_EUR=200, TP=.05, SL=.02, PERIOD=15*60_000;',
    "const PAIRS=Object.freeze(['BTC-EUR','ETH-EUR','DOGE-EUR']);",
    "if(!d.actionable||d.signal!=='BUY'",
    'if(book.exposureEur+MAX_ORDER>CAP_EUR||book.availableEur<MAX_ORDER)continue;',
    "const LIVE=process.env.MULTI_SPOT_LIVE==='true';"
  ]) if (!result.includes(guard)) throw Error('TRADING_GUARD_SOURCE_MISMATCH: '+guard);
  new vm.Script(result, {filename:sourceFile});
  return result;
}
function main() {
  const patched = prepare(fs.readFileSync(sourceFile, 'utf8'));
  if (process.argv.includes('--verify')) {
    console.log('ORDER_CAP_VERIFY_OK maxOrderCeilingEur=20 capitalCapEur=200 pairs=3 legacyAuto=BLOCKED guards=preserved');
    return;
  }
  const max = Number(process.env.MAX_ORDER_EUR);
  if (!Number.isFinite(max) || max < 1 || max > 20) throw Error('INVALID_MAX_ORDER_EUR');
  console.log('ANTON_ORDER_CAP_CONFIG '+JSON.stringify({maxOrderEur:max,capitalCapEur:200,pairs:3,legacyAuto:'BLOCKED'}));
  const child = new Module(sourceFile, module);
  child.filename = sourceFile;
  child.paths = Module._nodeModulePaths(__dirname);
  child._compile(patched+'\nrun();\n',sourceFile);
}
if (require.main===module) main();
module.exports = {prepare};
