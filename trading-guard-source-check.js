"use strict";
const fs=require('node:fs');
const path=require('node:path');
const sourceFile=path.join(__dirname,'multi-live.js');
const GUARDS=Object.freeze([
  "const PAIRS=Object.freeze(['BTC-EUR','ETH-EUR','DOGE-EUR']);",
  "const DERIVATIVE_INSTRUMENTS=Object.freeze({'BTC-EUR':'BTC-USDT-SWAP','ETH-EUR':'ETH-USDT-SWAP','DOGE-EUR':'DOGE-USDT-SWAP'});",
  "const CAP_EUR=Math.min(1000,Math.max(1,Number(process.env.CAPITAL_CAP_EUR||200))), TP=.05, SL=.02, PERIOD=15*60_000;",
  "const LIVE=process.env.MULTI_SPOT_LIVE==='true';",
  "value<1||value>20",
  "if(!(MAX_ORDER>0)||MAX_ORDER>20)throw Error('ORDER_LIMIT_UNSAFE');",
  "if(!d.actionable||d.signal!=='BUY'",
  "if(book.exposureEur+MAX_ORDER>CAP_EUR||book.availableEur<MAX_ORDER)continue;",
  "if(LIVE&&route==='/auto'&&req.method==='POST')",
  "MULTI_COORDINATOR_OWNS_ALL_TRADING",
  "isReconciledDust(p)",
  "ANTON_MULTI_DUST"
]);
function verifySource(source){
  for(const guard of GUARDS)if(!source.includes(guard))throw Error('TRADING_GUARD_SOURCE_MISMATCH: '+guard);
  return true;
}
function main(){
  verifySource(fs.readFileSync(sourceFile,'utf8'));
  console.log('TRADING_GUARD_SOURCE_OK guards='+GUARDS.length);
}
if(require.main===module)main();
module.exports={GUARDS,verifySource};
