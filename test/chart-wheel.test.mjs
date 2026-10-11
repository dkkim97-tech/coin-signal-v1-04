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

import vm from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
const source=readFileSync(new URL('../chart-wheel-navigation.js',import.meta.url),'utf8');
function harness(){
 const elements=new Map();
 const node=()=>({style:{},events:{},setAttribute(){},before(){},addEventListener(type,fn){this.events[type]=fn;},getScreenCTM(){return {inverse(){return {};}};},createSVGPoint(){return {matrixTransform(){return {x:this.x,y:this.y};}};}});
 for(const id of ['candle-chart','macd-chart','chart-zoom-reading','chart-zoom-in','chart-zoom-out','chart-zoom-reset'])elements.set(id,node());
 const candles=Array.from({length:500},(_,i)=>[1700000000000+i*86400000]);
 const context={document:{getElementById:id=>elements.get(id),createElement:node},__COIN_DATA__:{},DATA:{candles:{d1:candles}},state:{timeframe:'d1',visibleStartIndex:300,visibleWindowLength:100},formatCompactPrice:String,updatePeriodNavigationButtons(){},resetPeriodNavigation(){},moveChartPeriod(){},applyPeriodNavigation(c){return {candles:c.slice(300,400)};},requestAnimationFrame(fn){context.pending=fn;return 1;},renderChart(){context.view=context.applyPeriodNavigation(context.DATA.candles.d1,{});}};
 vm.runInNewContext(source,context);
 function wheel(id,delta){let prevented=false;elements.get(id).events.wheel({clientX:596,clientY:100,deltaY:delta,deltaMode:0,preventDefault(){prevented=true;}});if(context.pending){const fn=context.pending;context.pending=null;fn();}assert.ok(prevented);}
 return {context,elements,wheel};
}
test('both chart wheel handlers use one viewport and tiny wheel deltas accumulate',()=>{
 const {context:c,wheel}=harness();
 wheel('candle-chart',-120);const count=c.view.candles.length;assert.ok(count<100);
 wheel('macd-chart',120);assert.equal(c.view.candles.length,100);
 for(let i=0;i<10;i++)wheel('candle-chart',-1);assert.ok(c.view.candles.length<100);
 const before=c.view.candles.map(x=>x[0]);c.DATA.candles.d1=[...c.DATA.candles.d1];c.renderChart();assert.deepEqual(c.view.candles.map(x=>x[0]),before);
});
test('all 12 coin pages load wheel controller once and render indicators from candle indices',()=>{
 const root=new URL('../',import.meta.url);const files=readdirSync(root).filter(f=>/^[A-Z]+-MACD-RSI-V2\.3-ALL\.html$/.test(f));assert.equal(files.length,12);
 for(const file of files){const html=readFileSync(new URL(file,root),'utf8');assert.equal((html.match(/chart-wheel-navigation.js/g)||[]).length,1,file);assert.ok(html.includes('renderIndicatorCharts(candles, visibleIndices, xAt)'),file);}
});
