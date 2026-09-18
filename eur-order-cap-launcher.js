"use strict";
// Temporary compatibility bootstrap for the existing multi-pair coordinator.
// Fail closed if upstream source changes. Never manufacture BUY/SELL signals.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const sourceFile = path.join(__dirname, 'multi-live.js');
function prepare(source) {
  const changes = [
    ['const MAX_ORDER=Math.min(5,Number(process.env.MAX_ORDER_EUR||5));', 'const MAX_ORDER=Math.min(20,Number(process.env.MAX_ORDER_EUR||5));', 1],
    ['requested>5', 'requested>20', 1],
    ['MAX_ORDER>5', 'MAX_ORDER>20', 2]
  ];
  let result = source;
  for (const [before, after, expected] of changes) {
    const count = result.split(before).length - 1;
    if (count !== expected || result.includes(after)) throw Error('ORDER_CAP_PATCH_MISMATCH: ' + before);
    result = result.split(before).join(after);
  }
  if (!result.includes('const CAP_EUR=200, TP=.05, SL=.02, PERIOD=15*60_000;') ||
      !result.includes("const PAIRS=Object.freeze(['BTC-EUR','ETH-EUR','DOGE-EUR']);") ||
      !result.includes("if(!d.actionable||d.signal!=='BUY'") ||
      !result.includes("if(book.exposureEur+MAX_ORDER>CAP_EUR||book.availableEur<MAX_ORDER)continue;")) {
    throw Error('TRADING_GUARD_SOURCE_MISMATCH');
  }
  new vm.Script(result, {filename:sourceFile});
  return result;
}
const patched = prepare(fs.readFileSync(sourceFile, 'utf8'));
if (process.argv.includes('--verify')) {
  console.log('ORDER_CAP_VERIFY_OK maxOrderCeilingEur=20 capitalCapEur=200 pairs=3 guards=preserved');
} else {
  const max = Number(process.env.MAX_ORDER_EUR);
  if (!Number.isFinite(max) || max < 1 || max > 20) throw Error('INVALID_MAX_ORDER_EUR');
  console.log('ANTON_ORDER_CAP_CONFIG ' + JSON.stringify({maxOrderEur:max, capitalCapEur:200, pairs:3}));
  const child = new Module(sourceFile, module);
  child.filename = sourceFile;
  child.paths = Module._nodeModulePaths(__dirname);
  child._compile(patched + '\nrun();\n', sourceFile);
}
