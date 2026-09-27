import test from 'node:test';
import assert from 'node:assert/strict';
import '../halving-latest-costs.js';
const {mergeCandles,applyCosts}=globalThis.HalvingCosts,DAY=86400000;
const cycle={base:100,points:[1,2,1.5].map((ratio,i)=>({timestamp:i*DAY,day:i,ratio,highRatio:ratio+.1,lowRatio:ratio-.1}))};
test('fresh quotes extend display only and failed quotes cannot masquerade as current prices',()=>{
 const candles=[[DAY,1,2,1,2]],quote={ok:true,price:3,at:3*DAY};
 const display=globalThis.HalvingCosts.withQuote(candles,quote);
 assert.equal(display.length,2);assert.equal(display[1][4],3);assert.equal(candles.length,1);
 assert.equal(globalThis.HalvingCosts.withQuote(candles,{...quote,ok:false}),candles);
 assert.equal(globalThis.HalvingCosts.withQuote(candles,{...quote,at:0}),candles);
});
test('overlap replaces the same Korean calendar date rather than adding a duplicate day',()=>{
 const old=[[DAY-9*3600000,100,110,90,100]],live=[{timestamp:DAY,open:101,high:112,low:90,close:105}];
 const merged=mergeCandles(old,live,3*DAY);assert.equal(merged.length,1);assert.equal(merged[0][4],105);assert.equal(merged[0][0],DAY);
});
test('incomplete and invalid incoming bars are rejected and old future bars excluded',()=>{
 assert.throws(()=>mergeCandles([],[{timestamp:DAY,open:1,high:1,low:1,close:1}],DAY+1));
 assert.throws(()=>mergeCandles([],[{timestamp:DAY,open:1,high:1,low:1,close:NaN}],3*DAY));
 assert.equal(mergeCandles([[5*DAY,1,1,1,1]],[],3*DAY).length,0);
});
test('cost-adjusted ratios include one entry and one hypothetical exit, without mutating price data',()=>{
 const before=JSON.stringify(cycle),r=applyCosts([cycle],{fee:.001,slippage:.002,holding:0})[0];
 assert.ok(Math.abs(r.points[1].ratio-2*.999*.998/(1.001*1.002))<1e-12);
 assert.equal(JSON.stringify(cycle),before);assert.equal(r.high.day,1);assert.equal(r.low.day,0);
});
test('holding costs use elapsed marked notional, remain separate from fees, and never resurrect depleted capital',()=>{
 const r=applyCosts([cycle],{fee:0,slippage:0,holding:.01})[0];assert.equal(r.points[2].ratio,1.465);
 const long={points:[{timestamp:0,ratio:1,highRatio:1,lowRatio:1},{timestamp:200*DAY,ratio:1,highRatio:1,lowRatio:1},{timestamp:201*DAY,ratio:100,highRatio:100,lowRatio:100}]};
 assert.equal(applyCosts([long],{fee:0,slippage:0,holding:.01})[0].points[2].ratio,0);
 assert.throws(()=>applyCosts([],{fee:NaN,slippage:0,holding:0}));
});
