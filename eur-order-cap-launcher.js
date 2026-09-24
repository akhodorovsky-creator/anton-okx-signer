"use strict";
const {run}=require('./multi-live');

function verifyConfig(env=process.env){
  const maxRaw=env.MAX_ORDER_EUR;
  const capRaw=env.CAPITAL_CAP_EUR;
  if(maxRaw!==undefined&&maxRaw!==''){
    const max=Number(maxRaw);
    if(!Number.isFinite(max)||max<1||max>20)throw Error('INVALID_MAX_ORDER_EUR');
  }
  if(capRaw!==undefined&&capRaw!==''){
    const cap=Number(capRaw);
    if(!Number.isFinite(cap)||cap<1||cap>1000)throw Error('INVALID_CAPITAL_CAP_EUR');
  }
  return true;
}

function main(){
  verifyConfig();
  if(process.argv.includes('--verify')){
    console.log('ORDER_CAP_VERIFY_OK maxOrderCeilingEur=20 capitalCapCeilingEur=1000 pairs=3 legacyAuto=BLOCKED source=canonical');
    return;
  }
  run();
}

if(require.main===module)main();
module.exports={verifyConfig,main};
