"use strict";
// Fail closed if the expected source changes. Applied before npm start's syntax checks and tests.
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, 'multi-live.js');
let source = fs.readFileSync(target, 'utf8');
const patches = [
  ['const MAX_ORDER=Math.min(5,Number(process.env.MAX_ORDER_EUR||5));', 'const MAX_ORDER=Math.min(20,Number(process.env.MAX_ORDER_EUR||20));'],
  ['requested>5||requested>CAP_EUR', 'requested>MAX_ORDER||requested>CAP_EUR'],
  ['MAX_ORDER>5)throw Error(\'ORDER_LIMIT_UNSAFE\')', 'MAX_ORDER>20)throw Error(\'ORDER_LIMIT_UNSAFE\')']
];
for (const [before, after] of patches) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw Error(`ORDER_CAP_PATCH_MISMATCH: expected exactly one occurrence, got ${count} for ${before}`);
  source = source.replace(before, after);
}
if (!source.includes('const CAP_EUR=200') || !source.includes('book.exposureEur+MAX_ORDER>CAP_EUR')) {
  throw Error('ORDER_CAP_PATCH_UNSAFE: portfolio limit not found');
}
fs.writeFileSync(target, source);
console.log('ANTON_ORDER_CAP_PATCH_APPLIED maxOrderEur=20 portfolioCapEur=200');
