'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {freshState,paperBuy,paperSell,exitReason,summary}=require('./paper');

test('paper account starts at 300 EUR and cannot enable live orders',()=>{
  const state=freshState(0), report=summary(state,{});
  assert.equal(report.capitalEur,300);
  assert.equal(report.cashEur,300);
  assert.equal(report.orderEur,20);
  assert.equal(report.intervalMinutes,15);
  assert.equal(report.liveOrdersEnabled,false);
});

test('paper buy spends 20 EUR and TP closes only virtual position',()=>{
  const state=freshState(0);
  paperBuy(state,'BTC-EUR',{ask:100,bid:99,last:100},1000);
  assert.equal(state.cashEur,280);
  assert.equal(state.entries,1);
  const position=state.positions['BTC-EUR'];
  assert.ok(position);
  assert.equal(exitReason(position,position.entryPrice*1.051),'TAKE_PROFIT_5_PERCENT');
  const trade=paperSell(state,'BTC-EUR',{bid:position.entryPrice*1.06,ask:position.entryPrice*1.061,last:position.entryPrice*1.06},'TAKE_PROFIT_5_PERCENT',2000);
  assert.ok(trade.pnlEur>0);
  assert.equal(state.positions['BTC-EUR'],undefined);
  assert.equal(state.trades.length,1);
});
