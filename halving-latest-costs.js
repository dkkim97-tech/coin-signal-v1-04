(function () {
  'use strict';
  const DAY=86400000;
  // Embedded timestamps encode KST calendar dates; live candles use UTC midnight.
  // Align by the displayed Korean calendar date before replacing overlapping bars.
  function dayKey(t){return Math.floor((Number(t)+9*3600000)/DAY)*DAY;}
  function mergeCandles(stored,latest,now){
    const map=new Map();
    for(const c of stored)if(c.length>=5&&c.slice(0,5).every(Number.isFinite)&&c.slice(1,5).every(v=>v>0)&&dayKey(c[0])+DAY<=now)map.set(dayKey(c[0]),[dayKey(c[0]),...c.slice(1,5)]);
    for(const c of latest){
      if(![c.timestamp,c.open,c.high,c.low,c.close].every(Number.isFinite)||![c.open,c.high,c.low,c.close].every(v=>v>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.timestamp+DAY>now)throw Error('일봉 가격 또는 완료 시각 오류');
      map.set(dayKey(c.timestamp),[dayKey(c.timestamp),c.open,c.high,c.low,c.close]);
    }
    return [...map.values()].sort((a,b)=>a[0]-b[0]);
  }
  function applyCosts(cycles,{fee,slippage,holding}){
    if(![fee,slippage,holding].every(v=>Number.isFinite(v)&&v>=0&&v<=.02))throw Error('비용은 0~2% 범위로 입력하세요.');
    const entry=(1+fee)*(1+slippage),exit=(1-fee)*(1-slippage);
    return cycles.map(c=>{
      let accumulated=0,previous=c.points[0].timestamp,depleted=false;
      const points=c.points.map((p,i)=>{
        // Buy once at the first available close; holding cost uses each day's
        // marked notional and the observed elapsed days. No compounding fiction.
        if(i)accumulated+=p.ratio*holding*Math.max(0,(p.timestamp-previous)/DAY);
        previous=p.timestamp;
        const net=r=>depleted?0:Math.max(0,(r*exit-accumulated)/entry);
        const result={...p,ratio:net(p.ratio),highRatio:net(i?p.highRatio:p.ratio),lowRatio:net(i?p.lowRatio:p.ratio)};
        if(result.ratio===0)depleted=true;
        return result;
      });
      return {...c,points,high:points.reduce((a,b)=>b.highRatio>a.highRatio?b:a),low:points.reduce((a,b)=>b.lowRatio<a.lowRatio?b:a)};
    });
  }
  function withQuote(candles,quote){
    if(!quote?.ok||!Number.isFinite(quote.price)||quote.price<=0||!Number.isFinite(quote.at)||quote.at<=candles.at(-1)?.[0])return candles;
    return [...candles,[quote.at,quote.price,quote.price,quote.price,quote.price]];
  }
  globalThis.HalvingCosts=Object.freeze({dayKey,mergeCandles,applyCosts,withQuote});
  if(typeof document==='undefined'||!globalThis.__HALVING_DATA__||typeof render!=='function')return;
  const data=globalThis.__HALVING_DATA__,futures=/(^|\/)futures(\/|$)/.test(location.pathname)||new URLSearchParams(location.search).get('mode')==='futures';
  const chart=document.querySelector('#cycle-chart'),panel=chart.closest('section'),statusByCoin=new Map();
  const controls=document.createElement('div');controls.id='halving-live-controls';
  controls.innerHTML=`<form id="hc-form" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:18px 0">
    <label>표시 기준<select id="hc-view"><option value="net">비용 반영 수익 배수</option><option value="price">기존 가격 배수</option></select></label>
    <label>편도 수수료 (%)<input id="hc-fee" type="number" min="0" max="2" step="0.001" value="0.05" required></label>
    <label>편도 슬리피지 (%)<input id="hc-slip" type="number" min="0" max="2" step="0.001" value="0.08" required></label>
    ${futures?'<label>일 보유 비용 가정 (%)<input id="hc-hold" type="number" min="0" max="2" step="0.001" value="0.03" required></label>':''}
    <button class="copy-button" type="submit">비용 적용</button><button class="copy-button" id="hc-refresh" type="button">12종목 최신 가격 갱신</button></form>
    <p class="notice">두 화면 모두 업비트 KRW 가격 사이클을 비교합니다. 새로고침 시 최신 일봉과 현재가를 다시 조회합니다. 선의 마지막 점은 조회 시점 현재가를 반영한 잠정값이며 확정 일봉이 아닙니다. 최고·최저 배수 표도 잠정 현재가를 포함합니다. 비용 반영 모드는 첫 이용 가능 종가에 1회 매수한 뒤 각 평가 시점에 전량 매도한다고 가정한 순자산 배수입니다. 1배 미만은 원금 손실입니다.</p>
    <p class="notice">입력한 현재 비용 조건을 과거 모든 사이클에 동일하게 적용합니다. 개인 계정 수수료와 과거 실제 체결 비용은 자동 조회하지 않습니다.${futures?' 일 보유 비용은 포지션 금액에 대한 가정이며 실제 비트겟 선물 수익률·펀딩 지급/수취·레버리지·청산을 재현하지 않습니다.':''} 사이클 유사도와 연간 급등락 표는 비용 차감 전 가격 기준입니다.</p>
    <p id="hc-progress" role="status" class="notice"></p><p id="hc-latest" class="notice" aria-live="polite"></p>`;
  panel.insertBefore(controls,chart);
  const style=document.createElement('style');style.textContent='#hc-form label{display:grid;gap:6px}#hc-form input{width:150px;padding:9px;border:1px solid #456358;border-radius:8px;background:#0d1211;color:#eff7f4}#hc-form button:disabled{opacity:.5}';document.head.appendChild(style);
  const $=s=>document.querySelector(s),originalBuild=buildCycles,originalRender=render,originalCorrelation=correlationLabel;
  let settings={fee:.0005,slippage:.0008,holding:futures?.0003:0},mode='net',busy=false;
  const storageKey='halving-cost-settings-v1:'+(futures?'futures':'spot');
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved){applyCosts([],saved.settings);settings={...saved.settings,holding:futures?saved.settings.holding:0};mode=saved.mode==='price'?'price':'net';}}catch{}
  $('#hc-fee').value=String(settings.fee*100);$('#hc-slip').value=String(settings.slippage*100);if(futures)$('#hc-hold').value=String(settings.holding*100);$('#hc-view').value=mode;
  function readSettings(){
    if(!$('#hc-form').reportValidity())return false;
    const next={fee:Number($('#hc-fee').value)/100,slippage:Number($('#hc-slip').value)/100,holding:futures?Number($('#hc-hold').value)/100:0};
    applyCosts([],next);settings=next;mode=$('#hc-view').value;
    try{localStorage.setItem(storageKey,JSON.stringify({settings,mode}));}catch{}
    return true;
  }
  buildCycles=function(candles){const cycles=originalBuild(withQuote(candles,statusByCoin.get(state.symbol)));return mode==='net'?applyCosts(cycles,settings):cycles;};
  correlationLabel=function(){return originalCorrelation(originalBuild(data.coins[state.symbol].candles));};
  render=function(){
    originalRender();
    const net=mode==='net';
    chart.setAttribute('aria-label',net?'반감기별 4년 비용 반영 수익 배수 중첩 선 그래프':'반감기별 4년 가격 배수 중첩 선 그래프');
    chart.querySelector('title').textContent=state.symbol+' · '+(net?'비용 반영 수익 배수':'가격 배수');
    const ranges=buildCycles(data.coins[state.symbol].candles);
    const summary=ranges.map(c=>{const p=c.points.at(-1);return `${c.number}차 ${formatDate(p.timestamp)} · ${formatRatio(p.ratio)}${net?' / 순수익률 '+((p.ratio-1)*100).toFixed(2)+'%':''}`;}).join(' | ');
    $('#chart-detail').textContent=(net?'비용 반영 · ':'가격 기준 · ')+summary;
    for(const th of $('#extreme-table').closest('table').querySelectorAll('th')){
      if(/최고.*배수/.test(th.textContent))th.textContent=net?'최고 순자산 배수':'최고 배수';
      if(/최저.*배수/.test(th.textContent))th.textContent=net?'최저 순자산 배수':'최저 배수';
    }
    const info=statusByCoin.get(state.symbol);
    if(info?.ok&&info.price){
      $('#data-range').textContent=`${formatDate(data.coins[state.symbol].candles[0][0])} ~ ${formatDate(info.at)} (현재가 잠정)`;
      const latest=ranges.at(-1)?.points.at(-1);
      if(latest&&latest.timestamp===info.at){
        $('#chart-detail').textContent+=' | 현재가 잠정 '+formatRatio(latest.ratio);
        // Mark the rendered endpoint without changing confirmed daily history.
        const paths=chart.querySelectorAll('path.cycle-line'),lastPath=paths[paths.length-1];
        if(lastPath){const point=lastPath.getPointAtLength(lastPath.getTotalLength());const ns='http://www.w3.org/2000/svg',dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);dot.setAttribute('r','6');dot.setAttribute('fill','#fff');dot.setAttribute('stroke',ranges.at(-1).color);dot.setAttribute('stroke-width','3');const title=document.createElementNS(ns,'title');title.textContent='조회 시점 현재가 · 잠정 '+formatKrw(info.price)+' · '+formatRatio(latest.ratio);dot.appendChild(title);chart.appendChild(dot);}
      }
    }
    $('#hc-latest').textContent=info?.ok?`${state.symbol} · ${info.price?'현재가 '+formatKrw(info.price):'현재가 확인 실패 ('+info.quoteError+')'} (조회 ${new Date(info.at).toLocaleString('ko-KR')}) · 차트 마지막 완성 일봉 ${formatDate(data.coins[state.symbol].candles.at(-1)[0])}`:`${state.symbol} · ${info?.error||'내장 자료 표시 중 · 최신 시세 확인 대기'} · 자료 끝 ${formatDate(data.coins[state.symbol].candles.at(-1)[0])}`;
    // Log axes cannot represent zero. Disclose the floor rather than imply capital remains.
    if(net&&ranges.some(c=>c.points.some(p=>p.ratio===0)))$('#hc-latest').textContent+=' · 순자산 0 구간은 로그축 하한에 표시됩니다.';
  };
  $('#hc-form').onsubmit=e=>{
    e.preventDefault();
    try{if(!readSettings())return;render();$('#hc-progress').textContent='표시 기준과 비용 조건을 저장·적용했습니다. 새로고침 후에도 유지됩니다.';}catch(error){$('#hc-progress').textContent=error.message;}
  };
  $('#hc-view').onchange=()=>{if(readSettings())render();};
  async function json(query){const r=await fetch('/api/exchange?'+new URLSearchParams({...query,_refresh:String(Date.now())}),{cache:'no-store',signal:AbortSignal.timeout(25000)}),p=await r.json();if(!r.ok||p.error)throw Error(p.error||'시세 조회 실패');return {...p,observedAt:Date.parse(r.headers.get('date'))};}
  async function refresh(){
    if(busy||!readSettings())return;busy=true;$('#hc-refresh').disabled=true;let successes=0;const failures=[];
    for(const symbol of [state.symbol,...data.symbols.filter(s=>s!==state.symbol)]){
      $('#hc-progress').textContent=`최신 가격 갱신 ${successes+failures.length+1}/12 · ${symbol}`;
      try{
        let quote=null,quoteError='현재가 조회 오류';
        try{quote=await json({exchange:'upbit',coin:symbol});if(!(Number(quote.price)>0)||!Number.isFinite(Number(quote.at)))quote=null;}catch(error){quoteError=error.message;}
        const old=data.coins[symbol].candles,cutoff=dayKey(old.at(-1)[0]),rows=new Map();let until,observedAt=Number(quote?.at)||0;
        for(let i=0;i<30;i++){
          const page=await json({exchange:'upbit',coin:symbol,action:'candles',...(until===undefined?{}:{end:String(until)})});
          if(Number.isFinite(page.observedAt))observedAt=Math.max(observedAt,page.observedAt);
          if(!page.candles?.length)break;
          for(const c of page.candles)rows.set(c.timestamp,c);
          const first=Math.min(...page.candles.map(c=>c.timestamp));
          if(until!==undefined&&first>=until)throw Error('일봉 페이지 반복');
          if(first<=cutoff)break;until=first-1;
        }
        const incoming=[...rows.values()].sort((a,b)=>a.timestamp-b.timestamp);
        if(!observedAt||!incoming.length||incoming[0].timestamp>cutoff||observedAt-(incoming.at(-1).timestamp+DAY)>36*3600000)throw Error('최신 자료 또는 기존 자료와 연결 구간 부족');
        const merged=mergeCandles(old,incoming,observedAt);
        data.coins[symbol].candles=merged;statusByCoin.set(symbol,{ok:true,price:Number(quote?.price)||null,quoteError,at:observedAt});successes++;
      }catch(error){failures.push(symbol);statusByCoin.set(symbol,{ok:false,error:'갱신 실패 · 기존 자료 유지 ('+error.message+')'});}
      if(state.symbol===symbol)render();
    }
    busy=false;$('#hc-refresh').disabled=false;
    $('#hc-progress').textContent=`최신 완성 일봉 갱신 ${successes}/12 완료${failures.length?' · 실패: '+failures.join(', ')+' (종목 선택 후 상태 확인)':''}. 차트·최고/최저점·연간 급등락 표에 함께 반영했습니다.`;
  }
  $('#hc-refresh').onclick=refresh;
  document.querySelector('footer').textContent='업비트 KRW 기준. 선의 마지막 현재가 점과 최고·최저 배수는 잠정값을 포함합니다. 확정 일봉 및 연간 급등락·유사도 계산에는 현재가를 합치지 않습니다. 비용은 저장된 입력 가정이며 자동 조회한 실제 계정 요율이 아닙니다.';
  render();refresh();
})();
