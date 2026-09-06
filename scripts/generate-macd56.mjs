import {readFile,writeFile} from 'node:fs/promises';
import {prepare,simulate} from '../trading/research.mjs';
import {COINS} from '../trading/policy.mjs';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
function embedded(t){const marker=/window\.__COIN_DATA__\s*=\s*/g,m=marker.exec(t);if(!m)throw Error('Missing embedded data');const start=m.index+m[0].length;let depth=0,q=false,esc=false;for(let i=start;i<t.length;i++){const c=t[i];if(q){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')q=false;}else if(c==='"')q=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return JSON.parse(t.slice(start,i+1));}throw Error('Incomplete data');}
const comparison=JSON.parse(await read('trading/comparison.json')).filter(r=>r.n<5);
const extras=[5].map(n=>({strategy:'MACD 5 · 롱/숏 2배',assumptions:{fastPeriod:18,slowPeriod:39,signalPeriod:9,feeRate:.0005,slippage:.0008,leverage:2,leverageMode:'regime'+n},summaries:[],series:[]}));
for(const coin of COINS){
 const data=embedded(await read(`${coin}-MACD-RSI-V2.3-ALL.html`)),candles=data.candles.d1.map(([timestamp,open,high,low,close,volume])=>({timestamp,open,high,low,close,volume}));
 for(const n of [5]){
  const p=prepare(candles,n),baseline=simulate(p,{mode:'baseline'}),updated=simulate(p,{mode:'split'}),extra=extras[n-5];
  comparison.push({coin,n,baseline:baseline.return,updated:updated.return,mdd:updated.mdd,start:updated.start,end:updated.end});
  let cash=1e8,quantity=0;for(const f of baseline.ledger){cash-=f.delta*f.price+f.fee;quantity=f.afterQ;}
  const rowIndex=new Map(p.rows.map((r,i)=>[r.timestamp,i]));
  const curve=baseline.curve.map(c=>({timestamp:c.time,equity:c.equity,return:c.equity/1e8-1,drawdown:c.drawdown,exposure:p.states[Math.max(0,rowIndex.get(c.time)-1)].target}));
  // Trade rows report marked account changes between allocation events, not per-fill wins.
  let segmentEquity=1e8,segmentTime=baseline.start,side='long',runningCash=1e8,runningQty=0,started=false;const trades=[];
  for(const f of baseline.ledger){const opening=runningCash+runningQty*p.rows[rowIndex.get(f.time)].open;if(started)trades.push({market:'KRW-'+coin,timestamp:f.time,entryTime:segmentTime,price:f.price,pnl:opening-segmentEquity,returnPct:segmentEquity?opening/segmentEquity-1:0,side,type:'allocation',reason:`목표 ${f.target<0?'숏':'롱'} ${Math.abs(f.target)*100}%`});segmentEquity=opening;segmentTime=f.time;side=f.target<0?'short':'long';runningCash-=f.delta*f.price+f.fee;runningQty=f.afterQ;started=true;}
  if(started)trades.push({market:'KRW-'+coin,timestamp:baseline.end,entryTime:segmentTime,price:candles.at(-1).close,pnl:baseline.finalEquity-segmentEquity,returnPct:segmentEquity?baseline.finalEquity/segmentEquity-1:0,side,type:baseline.liquidated?'liquidation':'close',reason:'데이터 종료 평가'});
  if(Math.abs(trades.reduce((s,t)=>s+t.pnl,0)-(baseline.finalEquity-1e8))>1)throw Error('Trade PnL reconciliation failed');
  if(baseline.liquidated){cash=0;quantity=0;}
  const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),grossProfit=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=-losses.reduce((s,t)=>s+t.pnl,0);
  extra.summaries.push({market:'KRW-'+coin,strategy:extra.strategy,from:new Date(baseline.start).toISOString(),to:new Date(baseline.end).toISOString(),totalReturn:baseline.return,maxDrawdown:baseline.mdd,completedTrades:trades.length,winRate:trades.length?wins.length/trades.length:0,profitFactor:grossLoss?grossProfit/grossLoss:null,grossProfit,grossLoss,tradingHalted:baseline.liquidated});
  extra.series.push({market:'KRW-'+coin,strategy:extra.strategy,initialEquity:1e8,finalEquity:baseline.finalEquity,finalCash:cash,finalQuantity:quantity,finalExposure:curve.at(-1).exposure,peakEquity:Math.max(1e8,...curve.map(c=>c.equity)),equityCurve:curve,trades});
 }
 console.log(coin+' MACD5 recalculated; MACD6 removed');
}
await writeFile(new URL('trading/comparison.json',root),JSON.stringify(comparison));
await writeFile(new URL('macd5-result.js',root),`(function(){const futures=/(^|\\/)futures(\\/|$)/.test(location.pathname)||new URLSearchParams(location.search).get('mode')==='futures';const r=window.__UPBIT_RESULT__;if(!futures||!r||r.__macd56Applied)return;const extras=${JSON.stringify(extras)};r.summaries=r.summaries.filter(x=>!/^MACD [56]/.test(x.strategy));r.series=r.series.filter(x=>!/^MACD [56]/.test(x.strategy));for(const e of extras){r.summaries.push(...e.summaries);r.series.push(...e.series);}r.__macd56Applied=true;r.__macd5Applied=true;window.__MACD5_RESULTS__=extras;})();\n`);
