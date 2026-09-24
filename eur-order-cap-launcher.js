"use strict";
// Compatibility validator only. It never rewrites or executes multi-live.js.
function validateOrderConfig(env=process.env){
  const max=Number(env.MAX_ORDER_EUR);
  if(env.MAX_ORDER_EUR===undefined||env.MAX_ORDER_EUR===''||!Number.isFinite(max)||max<1||max>20)throw Error('INVALID_MAX_ORDER_EUR');
  const cap=Number(env.CAPITAL_CAP_EUR||200);
  if(!Number.isFinite(cap)||cap<1||cap>1000)throw Error('INVALID_CAPITAL_CAP_EUR');
  return {maxOrderEur:max,capitalCapEur:cap};
}
function main(){
  const config=validateOrderConfig();
  console.log('ORDER_CAP_VERIFY_OK '+JSON.stringify({...config,pairs:3,legacyAuto:'BLOCKED',runtimePatch:false}));
}
if(require.main===module)main();
module.exports={validateOrderConfig};
