'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {analyse,scan}=require('./alt-assets');
const NOW=Date.UTC(2026,8,19,15,10);const INTERVAL=300000;
function fixtures(){const candles=Array.from({length:70},(_,i)=>{const ts=NOW-(70-i)*INTERVAL;const price=100+i*0.15+(i%4===0?-0.17:0);return [String(ts/1000),'0','0','0',String(price),'0',String(i===69?120:15),'0'];});return {candles,book:{asks:[['111','10']],bids:[['110.8','10']]},meta:{status:'online',quote:'ZEUR',ordermin:'0.01',costmin:'1',wsname:'SOL/EUR'}};}
test('valid complete candles produce safe paper data and positive breakeven',()=>{const f=fixtures();const v=analyse({symbol:'SOL',pair:'SOLEUR'},f.candles,f.book,f.meta,NOW);assert.equal(v.ordersEnabled,false);assert.equal(v.actionable,false);assert.ok(v.requiredBidRisePct>1.8);assert.ok(v.orderSizeValid);assert.ok(['HOLD','WATCH_UP'].includes(v.signal));});
test('stale inputs and non-online markets fail closed',()=>{const f=fixtures();assert.throws(()=>analyse({symbol:'SOL',pair:'SOLEUR'},f.candles,f.book,{...f.meta,status:'cancel_only'},NOW),/PAIR_ELIGIBILITY/);assert.throws(()=>analyse({symbol:'SOL',pair:'SOLEUR'},f.candles,f.book,f.meta,NOW+3600000),/STALE_CANDLES/);});
test('all public fetch errors return unavailable without orders',async()=>{const value=await scan({get:async()=>{throw Error('blocked')},now:NOW});assert.equal(value.tradesEnabled,false);assert.equal(value.markets.length,3);assert.ok(value.markets.every(x=>x.signal==='UNAVAILABLE'&&x.actionable===false));});
