"use strict";
// Guarded, idempotent startup migration; fail closed on unexpected source changes.
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, 'multi-live.js');
let source = fs.readFileSync(target, 'utf8');
const patches = [
  ['const MAX_ORDER=Math.min(5,Number(process.env.MAX_ORDER_EUR||5));', 'const MAX_ORDER=Math.min(20,Number(process.env.MAX_ORDER_EUR||20));'],
  ['requested>5||requested>CAP_EUR', 'requested>MAX_ORDER||requested>CAP_EUR'],
  ["MAX_ORDER>5)throw Error('ORDER_LIMIT_UNSAFE')", "MAX_ORDER>20)throw Error('ORDER_LIMIT_UNSAFE')"]
];
const count = (text, needle) => text.split(needle).length - 1;
const beforeCounts = patches.map(([before]) => count(source, before));
const afterCounts = patches.map(([, after]) => count(source, after));
if (beforeCounts.every(n => n === 1) && afterCounts.every(n => n === 0)) {
  for (const [before, after] of patches) source = source.replace(before, after);
  if (!source.includes('const CAP_EUR=200') || !source.includes('book.exposureEur+MAX_ORDER>CAP_EUR')) throw Error('ORDER_CAP_PATCH_UNSAFE');
  fs.writeFileSync(target, source);
  console.log('ANTON_ORDER_CAP_PATCH_APPLIED maxOrderEur=20 portfolioCapEur=200');
} else if (beforeCounts.every(n => n === 0) && afterCounts.every(n => n === 1) && source.includes('const CAP_EUR=200') && source.includes('book.exposureEur+MAX_ORDER>CAP_EUR')) {
  console.log('ANTON_ORDER_CAP_PATCH_ALREADY_APPLIED maxOrderEur=20 portfolioCapEur=200');
} else {
  throw Error('ORDER_CAP_PATCH_MISMATCH: unsafe or partially modified source');
}
