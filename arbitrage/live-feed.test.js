'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scan, parseBinary, bestAsk } = require('./live-feed');
const market = {id:123, question:'Synthetic market',slug:'synthetic-market',active:true,closed:false,acceptingOrders:true,enableOrderBook:true,negRisk:false,outcomes:JSON.stringify(['Yes','No']),clobTokenIds:JSON.stringify(['123456789012345','123456789012346'])};
test('accept only eligible genuine binary markets',()=>{assert.ok(parseBinary(market));assert.equal(parseBinary({...market,negRisk:true}),null);assert.equal(parseBinary({...market,acceptingOrders:false}),null);assert.equal(parseBinary({...market,outcomes:'["Yes","Maybe"]'}),null);});
test('sort orderbook asks numerically rather than trusting API order',()=>assert.deepEqual(bestAsk({asks:[{price:'0.8',size:'100'},{price:'0.18',size:'5'}]}),{price:.18,size:5}));
test('live quotes are labeled gross-only, never executable net trades',async()=>{const get=async url=>url.includes('/markets?')?[market]:url.includes('123456789012345')?{asks:[{price:'0.18',size:'5'}]}:{asks:[{price:'0.78',size:'7'}]};const output=await scan({limit:1,get});assert.equal(output.rows.length,1);assert.equal(output.rows[0].grossSpreadPerPair,0.040000000000000036);assert.equal(output.rows[0].executableOpportunity,false);assert.equal(output.rows[0].feesVerified,false);assert.equal(output.tradesEnabled,false);});
