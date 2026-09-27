import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../baseline-core.js';
const core=globalThis.CoinBaselines,DAY=86400000;
const rows=values=>values.map((close,i)=>({timestamp:i*DAY,open:close,high:close,low:close,close}));
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('hold buys once, never borrows for fees, and marks open holdings to last close',()=>{
 const candles=rows([100,100,120,90,150]),r=core.run(candles,candles,{initialEquity:1000})[0];
 assert.equal(r.changes,1);assert.equal(r.finalCash,0);assert.equal(r.completedTrades,0);
 assert.ok(Math.abs(r.finalEquity-1000/(100*1.0008*1.0005)*150)<1e-9);
 assert.ok(Math.abs(r.maxDrawdown-.25)<1e-12);
});
test('EMA uses 35 daily closes, trades only after daily close, retains position at equality',()=>{
 const daily=rows([...Array(35).fill(100),136,80,100]);
 const signals=core.dailySignals(daily);assert.equal(signals[0].ema,100);assert.equal(signals[1].ema,102);
 const intraday=[35*DAY,35*DAY+20*3600000,36*DAY,36*DAY+20*3600000,37*DAY].map(timestamp=>({timestamp,open:100,close:100,high:100,low:100}));
 const r=core.run(intraday,daily,{fee:0,slippage:0})[1];
 assert.deepEqual(r.curve.map(p=>p.exposure),[0,0,1,1,0]);
 assert.equal(r.completedTrades,1);assert.equal(r.finalEquity,1e8);
});
test('modifying unseen daily candles cannot affect prior results',()=>{
 const daily=rows(Array.from({length:100},(_,i)=>100+Math.sin(i/6)*20)),future=daily.map(c=>c.timestamp>=70*DAY?{...c,close:10000}:c);
 const a=core.run(daily.slice(0,70),daily)[1],b=core.run(daily.slice(0,70),future)[1];
 assert.deepEqual(a,b);
});
test('insufficient EMA history stays in cash; flat hold only loses entry costs',()=>{
 const daily=rows(Array(34).fill(100)),[hold,ema]=core.run(daily,daily);
 assert.equal(ema.changes,0);assert.equal(ema.totalReturn,0);
 assert.ok(hold.totalReturn<0);assert.ok(hold.totalReturn>-.002);
});
test('overview has 12 coins with both baselines before original strategies in both modes',()=>{
 for(const mode of ['spot','futures']){
  const context={window:{},location:{pathname:mode==='futures'?'/futures/':'/',search:''},URLSearchParams,setTimeout:()=>{},document:{createElement:()=>({}),head:{appendChild(){}},querySelector:()=>null}};
  context.window=context;vm.createContext(context);
  const assignment=read('index.html').match(/<script>(window\.__UPBIT_RESULT__=[\s\S]*?)<\/script>/)[1];
  vm.runInContext(assignment,context);
  for(const file of ['macd2-result.js','macd3-result.js','macd4-result.js','macd5-result.js','baseline-core.js','baseline-data.js'])vm.runInContext(read(file),context);
  context.renderLatestUpbitSummary=()=>{};
  vm.runInContext(read('baseline-overview.js'),context);
  const r=context.__UPBIT_RESULT__,markets=[...new Set(r.summaries.map(s=>s.market))];assert.equal(markets.length,12);
  for(const market of markets){const list=r.summaries.filter(s=>s.market===market);assert.deepEqual(Array.from(list.slice(0,2).map(s=>s.strategy)),['단순 보유','EMA 35일']);assert.equal(list.length,mode==='futures'?7:5);for(const row of list.slice(0,2)){assert.ok(Number.isFinite(row.totalReturn));assert.ok(row.maxDrawdown>=0&&row.maxDrawdown<=1);}}
 }
});
test('all 12 detail pages and both overviews load shared simulator; all markets/timeframes produce valid baseline curves',()=>{
 for(const file of ['index.html','MACD-RSI-V2.3-전체코인-백테스트.html',...fs.readdirSync(new URL('../',import.meta.url)).filter(f=>/^[A-Z]+-MACD-RSI-V2.3-ALL.html$/.test(f))]){
  const html=read(file);assert.match(html,/baseline-core.js/);assert.match(html,/futures-timeframe-simulator.js\?v=3.0/);
  if(!/^[A-Z]+-MACD/.test(file))continue;
  const assignment=html.match(/window\.__COIN_DATA__\s*=\s*({[^\n]+})/);const data=JSON.parse(assignment[1]);
  const daily=core.normalize(data.candles.d1);
  for(const frame of ['d1','h4','h1'])for(const count of [200,500,1000,2000]){
   const candles=core.normalize(data.candles[frame]).slice(-count),r=core.run(candles,daily,{market:data.market});
   for(const result of r){assert.equal(result.curve.length,candles.length);assert.ok(result.curve.every(p=>Number.isFinite(p.equity)&&p.equity>=0));assert.ok(result.finalCash>=0);}
  }
 }
});
test('existing MACD 1-5 results are unchanged by baseline integration',()=>{
 const original=fs.readFileSync(new URL('./fixtures/original-timeframe.js',import.meta.url),'utf8');
 const updated=read('futures-timeframe-simulator.js');
 const strategies=Array.from({length:5},(_,i)=>({id:'MACD '+(i+1)}));
 const get=source=>vm.runInNewContext(source.slice(source.indexOf('function simulateAll('),source.indexOf('function renderResults('))+'\nsimulateAll', {STRATEGIES:strategies,FEE:.0005,SLIPPAGE:.0008,window:{CoinBaselines:core}});
 const before=get(original),after=get(updated);
 for(const file of fs.readdirSync(new URL('../',import.meta.url)).filter(f=>/^[A-Z]+-MACD-RSI-V2.3-ALL.html$/.test(f))){
  const data=JSON.parse(read(file).match(/window\.__COIN_DATA__\s*=\s*({[^\n]+})/)[1]);
  for(const frame of ['d1','h4','h1']){
   const candles=core.normalize(data.candles[frame]).slice(-1000);
   const a=before(candles,data.market,1e6),b=after(candles,data.market,1e6,core.normalize(data.candles.d1)).slice(2);
   assert.equal(JSON.stringify(a),JSON.stringify(b),data.market+' '+frame);
  }
 }
});
test('latest refresh retains both baselines without duplicates and includes new candles',async()=>{
 const daily=rows(Array.from({length:60},(_,i)=>100+i));
 const result={summaries:[{market:'KRW-BTC',strategy:'MACD 1'}],series:[{market:'KRW-BTC',strategy:'MACD 1',initialEquity:1e8,equityCurve:daily.map(c=>({timestamp:c.timestamp}))}]};
 const context={CoinBaselines:core,__UPBIT_RESULT__:result,__BASELINE_DAILY__:{'KRW-BTC':daily},document:{createElement:()=>({}),head:{appendChild(){}},querySelector:()=>null},renderLatestUpbitSummary:()=>{}};
 context.window=context;
 context.refreshUpbitBacktestFromLatestData=async()=>{
  const extended=structuredClone(result);extended.series.find(s=>s.strategy==='MACD 1').equityCurve.push({timestamp:60*DAY});
  return {result:extended,latestCandlesByMarket:{'KRW-BTC':[{timestamp:60*DAY,open:160,close:165}]}};
 };
 vm.runInNewContext(read('baseline-overview.js'),context);
 for(let i=0;i<2;i++){
  const updated=await context.refreshUpbitBacktestFromLatestData();
  assert.equal(updated.result.summaries.length,3);
  for(const name of ['단순 보유','EMA 35일'])assert.equal(updated.result.series.find(s=>s.strategy===name).equityCurve.at(-1).timestamp,60*DAY);
 }
});
