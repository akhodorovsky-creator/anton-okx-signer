"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseTradeCallback}=require("./telegram-bot");

test("trade callback parser accepts only approval button format",()=>{
  assert.deepEqual(parseTradeCallback("trade:approve:Abcdef12"),{decision:"approve",id:"Abcdef12"});
  assert.deepEqual(parseTradeCallback("trade:reject:abc_DEF-123"),{decision:"reject",id:"abc_DEF-123"});
  assert.equal(parseTradeCallback("trade:buy:abc_DEF-123"),null);
  assert.equal(parseTradeCallback("approve:abc_DEF-123"),null);
  assert.equal(parseTradeCallback("trade:approve:x"),null);
});
