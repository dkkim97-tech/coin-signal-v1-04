(function(){
 'use strict';
 const core=window.CoinBaselines;
 if(!core||!window.__UPBIT_RESULT__)return;
 const stored=window.__BASELINE_DAILY__;
 function add(result,latest={}) {
   const names=new Set(core.definitions.map(s=>s.id));
   result.summaries=result.summaries.filter(s=>!names.has(s.strategy));
   result.series=result.series.filter(s=>!names.has(s.strategy));
   const extra=[];
   for(const market of Object.keys(stored)){
     const reference=result.series.find(s=>s.market===market&&s.strategy.startsWith('MACD 1'));
     if(!reference?.equityCurve?.length)continue;
     const daily=core.normalize([...stored[market],...(latest[market]||[])]);
     const start=reference.equityCurve[0].timestamp,end=reference.equityCurve.at(-1).timestamp;
     const rows=daily.filter(c=>c.timestamp>=start&&c.timestamp<=end);
     if(rows.length<2)continue;
     extra.push(...core.run(rows,daily,{market,initialEquity:reference.initialEquity||1e8}));
   }
   const rank=s=>s==='단순 보유'?-2:s==='EMA 35일'?-1:Number(s.match(/^MACD (\d)/)?.[1]||99);
   const order=Object.keys(stored);
   const compare=(a,b)=>order.indexOf(a.market)-order.indexOf(b.market)||rank(a.strategy)-rank(b.strategy);
   result.summaries.push(...extra.map(({curve,equityCurve,trades,...summary})=>summary));
   result.series.push(...extra.map(({curve,...series})=>series));
   result.summaries.sort(compare);result.series.sort(compare);
   return result;
 }
 add(window.__UPBIT_RESULT__);
 const refresh=window.refreshUpbitBacktestFromLatestData;
 if(typeof refresh==='function')window.refreshUpbitBacktestFromLatestData=async function(...args){const response=await refresh.apply(this,args);add(response.result,response.latestCandlesByMarket);return response;};
 const style=document.createElement('style');style.textContent='.bar-hold{fill:#f5d76e!important}.bar-ema35{fill:#6de0ed!important}.actual-return-line.hold,.actual-dd-line.hold{stroke:#f5d76e}.actual-return-line.ema35,.actual-dd-line.ema35{stroke:#6de0ed}.actual-dd-line.hold,.actual-dd-line.ema35{stroke-dasharray:4 3}';document.head.appendChild(style);
 const labels='<span><i style="background:#f5d76e"></i>단순 보유</span><span><i style="background:#6de0ed"></i>EMA 35일</span>';
 document.querySelector('.macd-return-legend')?.insertAdjacentHTML('afterbegin',labels);
 const subtitle=document.querySelector('header .subtitle');if(subtitle)subtitle.textContent='단순 보유 · EMA 35일 비교 / '+subtitle.textContent;
 document.querySelector('#actual-equity-chart')?.closest('.live-results')?.querySelector('.chart-legend')?.insertAdjacentHTML('afterbegin',labels);
 for(const selector of ['.live-results .chart-heading h2','#return-comparison','.detail-heading h3']){
   const el=selector==='#return-comparison'?document.querySelector(selector)?.closest('.plot-block')?.querySelector('h3'):document.querySelector(selector);
   if(el)el.textContent='단순 보유 · EMA 35일 · '+el.textContent;
 }
 document.querySelector('.macd-scenario-note')?.insertAdjacentHTML('afterbegin','<div><strong>단순 보유 · 1배</strong>첫 평가 봉 다음 시가에 전액 매수하고 끝까지 보유합니다. 종료 시점 보유분은 종가 평가합니다.</div><div><strong>EMA 35일 · 롱/현금</strong>35개 일봉 종가로 EMA를 계산합니다. 확정 일봉 종가가 EMA 위면 전액 매수·보유, 아래면 현금 대기합니다. 다음 봉 시가 체결, 수수료 0.05%·슬리피지 0.08% 적용.</div>');
 window.renderLatestUpbitSummary(window.__UPBIT_RESULT__);
})();
