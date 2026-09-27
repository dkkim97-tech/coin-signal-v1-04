(function(){
  'use strict';
  function bounded(start,count,total){count=Math.min(total,Math.max(Math.min(16,total),Math.round(count)));return {start:Math.max(0,Math.min(total-count,Math.round(start))),count};}
  function zoomRange(range,total,delta,anchor){
    const count=Math.min(total,Math.max(Math.min(16,total),Math.round(range.count*Math.exp(Math.max(-600,Math.min(600,delta))*.002))));
    return bounded(range.start+Math.max(0,Math.min(1,anchor))*(range.count-count),count,total);
  }
  globalThis.CoinChartViewport={bounded,zoomRange};
  if(typeof document==='undefined'||!globalThis.__COIN_DATA__||typeof applyPeriodNavigation!=='function')return;
  const charts=['candle-chart','macd-chart','rsi-chart','cci-chart'].map(id=>document.getElementById(id)).filter(Boolean);
  if(!charts.length)return;
  const originalCompactPrice=formatCompactPrice;
  formatCompactPrice=function(value){return Math.abs(value)>=100000000&&Math.abs(value)<1000000000000?(value/100000000).toFixed(2)+'억':originalCompactPrice(value);};
  const oldApply=applyPeriodNavigation,oldReset=resetPeriodNavigation,oldMove=moveChartPeriod;
  let viewport=null,frame=0,drag=null,activeData=null,activeTimeframe=null;
  const bar=document.createElement('div');bar.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0;color:#b8cec4;font-size:12px';
  bar.innerHTML='<span>휠: 봉 간격 확대·축소 · 드래그: 시간 이동 · 더블클릭: 초기화</span><button type="button" id="chart-zoom-in">봉 간격 확대</button><button type="button" id="chart-zoom-out">봉 간격 축소</button><button type="button" id="chart-zoom-reset">차트 배율 초기화</button><span id="chart-zoom-reading" role="status" aria-live="polite"></span>';
  charts[0].before(bar);
  function range(){return viewport||{start:state.visibleStartIndex,count:state.visibleWindowLength};}
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;renderChart();});}
  applyPeriodNavigation=function(candles,view){
    if(activeData!==candles||activeTimeframe!==state.timeframe){viewport=null;activeData=candles;activeTimeframe=state.timeframe;}
    let result;
    if(viewport){viewport=bounded(viewport.start,viewport.count,candles.length);state.visibleStartIndex=viewport.start;state.visibleEndIndex=viewport.start+viewport.count-1;state.visibleWindowLength=viewport.count;state.windowShift=0;state.appliedWindowShift=0;updatePeriodNavigationButtons(candles.length);result={candles:candles.slice(viewport.start,viewport.start+viewport.count),splitAfter:null};}
    else result=oldApply(candles,view);
    document.getElementById('chart-zoom-reading').textContent=`${state.visibleWindowLength.toLocaleString()}봉 표시 · 봉차트/MACD 시간축 동기화`;
    return result;
  };
  resetPeriodNavigation=function(){viewport=null;oldReset();};
  moveChartPeriod=function(direction){if(!viewport)return oldMove(direction);viewport=bounded(viewport.start+direction*Math.max(1,Math.floor(viewport.count/2)),viewport.count,DATA.candles[state.timeframe].length);schedule();};
  function reset(){viewport=null;oldReset();schedule();}
  function zoom(delta,anchor=.5){const current=range(),total=DATA.candles[state.timeframe]?.length||0;if(!current.count||!total)return;viewport=zoomRange(current,total,delta,anchor);schedule();}
  function position(svg,event){const matrix=svg.getScreenCTM();if(!matrix)return null;const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(matrix.inverse());}
  for(const svg of charts){
    svg.style.cursor='grab';svg.setAttribute('tabindex','0');
    svg.addEventListener('wheel',event=>{
      if(event.ctrlKey||event.metaKey)return;
      const p=position(svg,event);if(!p||p.x<72||p.x>1120)return;
      event.preventDefault();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?600:1);
      zoom(delta,(p.x-72)/1048);
    },{passive:false});
    svg.addEventListener('pointerdown',event=>{if(event.button!==0||event.pointerType==='touch')return;const p=position(svg,event);if(!p||p.x<72||p.x>1120)return;drag={id:event.pointerId,x:p.x,range:{...range()},svg};svg.setPointerCapture(event.pointerId);svg.style.cursor='grabbing';event.preventDefault();});
    svg.addEventListener('pointermove',event=>{if(!drag||drag.svg!==svg||drag.id!==event.pointerId)return;const p=position(svg,event);if(!p)return;viewport=bounded(drag.range.start-(p.x-drag.x)/1048*drag.range.count,drag.range.count,DATA.candles[state.timeframe].length);schedule();});
    const stop=()=>{drag=null;svg.style.cursor='grab';};svg.addEventListener('pointerup',stop);svg.addEventListener('pointercancel',stop);svg.addEventListener('lostpointercapture',stop);
    svg.addEventListener('dblclick',reset);
    svg.addEventListener('keydown',event=>{if(['+','=','-','Home','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();if(event.key==='Home')reset();else if(event.key==='ArrowLeft'||event.key==='ArrowRight')moveChartPeriod(event.key==='ArrowLeft'?-1:1);else zoom(event.key==='-'?120:-120);}});
  }
  document.getElementById('chart-zoom-in').onclick=()=>zoom(-120);
  document.getElementById('chart-zoom-out').onclick=()=>zoom(120);
  document.getElementById('chart-zoom-reset').onclick=reset;
  renderChart();
})();
