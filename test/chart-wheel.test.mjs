import test from 'node:test';
import assert from 'node:assert/strict';
import '../chart-wheel-navigation.js';
const {bounded,zoomRange}=globalThis.CoinChartViewport;
test('wheel zoom preserves cursor anchor away from data boundaries',()=>{
 const r={start:300,count:200},next=zoomRange(r,2000,-120,.75);
 assert.ok(next.count<r.count);assert.ok(Math.abs(next.start+.75*next.count-(r.start+.75*r.count))<=.5);
 assert.ok(zoomRange(r,2000,120,.5).count>r.count);
});
test('zoom and pan stay in history and work with short series',()=>{
 assert.deepEqual(bounded(-100,20,100),{start:0,count:20});assert.deepEqual(bounded(99,20,100),{start:80,count:20});
 assert.deepEqual(bounded(10,2,3),{start:0,count:3});
 let r={start:50,count:100};for(let i=0;i<100;i++)r=zoomRange(r,300,-120,1);assert.equal(r.count,16);
 for(let i=0;i<100;i++)r=zoomRange(r,300,120,1);assert.deepEqual(r,{start:0,count:300});
});
