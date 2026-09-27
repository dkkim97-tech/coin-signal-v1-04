import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../futures-timeframe-simulator.js',import.meta.url),'utf8');
const engine=spot=>vm.runInNewContext(source.slice(source.indexOf('function simulateAll('),source.indexOf('function renderResults('))+'\n({compareCoin,rankComparisons})',{STRATEGIES:Array.from({length:spot?3:5},(_,i)=>({id:'MACD '+(i+1)})),FEE:.0005,SLIPPAGE:.0008});
const DAY=86400000,rows=Array.from({length:400},(_,i)=>{const close=100*Math.exp(i*.003);return {timestamp:i*DAY,open:close,close,high:close*1.001,low:close*.999};});
const costs={fee:.0005,slippage:.0008,dailyHolding:0,noBorrow:true};
test('all 12 coins have 7 futures / 5 spot combinations and six disjoint monthly observations',()=>{
 for(const spot of [true,false])for(const coin of ['BTC','ETH','XRP','SOL','ADA','DOGE','AVAX','DOT','XLM','UNI','LINK','ONDO']){
  const r=engine(spot).compareCoin(rows,coin,220*DAY,399*DAY,{...costs,noBorrow:spot});
  assert.equal(r.length,spot?5:7);assert.equal(r[0].id,'단순 보유');assert.equal(r[1].id,'EMA 35일');
  for(const x of r){assert.equal(x.curve.length,181);assert.equal(x.periods,6);assert.equal(x.exposure,0);assert.ok(Number.isFinite(x.totalReturn));}
 }
});
test('buy and hold pays both entry and terminal costs, excludes warmup gains, and stress doubles costs',()=>{
 const r=engine(true).compareCoin(rows,'BTC',220*DAY,399*DAY,costs)[0];
 const expected=rows[399].close/rows[220].open*(1-costs.slippage)*(1-costs.fee)/((1+costs.slippage)*(1+costs.fee))-1;
 assert.ok(Math.abs(r.totalReturn-expected)<1e-12);assert.ok(r.stressReturn<r.totalReturn);assert.equal(r.changes,2);
});
test('invalid, stale-ended, missing, or insufficient warmup data is rejected',()=>{
 const {compareCoin}=engine(true);
 assert.throws(()=>compareCoin(rows,'BTC',100*DAY,399*DAY,costs));
 assert.throws(()=>compareCoin(rows.slice(0,-1),'BTC',220*DAY,399*DAY,costs));
 assert.throws(()=>compareCoin(rows.filter((_,i)=>i!==300),'BTC',220*DAY,399*DAY,costs));
 assert.throws(()=>compareCoin(rows,'BTC',220*DAY,399*DAY,{...costs,fee:NaN}));
});
test('future unseen prices cannot change the evaluated interval',()=>{
 const {compareCoin}=engine(true),a=compareCoin(rows,'BTC',180*DAY,359*DAY,costs),b=compareCoin(rows.map((r,i)=>i>359?{...r,close:99999}:r),'BTC',180*DAY,359*DAY,costs);
 assert.deepEqual(a,b);
});
test('holding cost lowers returns and no candidate is forced for losses or unstable results',()=>{
 const {compareCoin,rankComparisons}=engine(false);
 const a=compareCoin(rows,'BTC',220*DAY,399*DAY,costs),b=compareCoin(rows,'BTC',220*DAY,399*DAY,{...costs,dailyHolding:.001});
 assert.ok(b[0].totalReturn<a[0].totalReturn);
 assert.ok(rankComparisons(a).candidate);
 assert.equal(rankComparisons(a.map(r=>({...r,totalReturn:-.1}))).candidate,null);
 assert.equal(rankComparisons(a.map(r=>({...r,stressReturn:-.1}))).candidate,null);
 assert.equal(rankComparisons(a.map(r=>({...r,frequency:.5}))).candidate,null);
 assert.equal(rankComparisons(a.map(r=>({...r,maxDrawdown:.36}))).candidate,null);
 assert.equal(rankComparisons([]).highest,null);
});
