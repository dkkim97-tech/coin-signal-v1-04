(function (root) {
  'use strict';
  const DAY = 86400000;
  const definitions = [
    { id: '단순 보유', name: '1배 매수 후 보유', color: '#f5d76e' },
    { id: 'EMA 35일', name: '일봉 종가 기준 · 롱/현금', color: '#6de0ed' },
  ];
  function normalize(rows) {
    return [...new Map(rows.map(r => { const c = Array.isArray(r) ? {timestamp:r[0],open:r[1],high:r[2],low:r[3],close:r[4]} : r; return [Number(c.timestamp), {...c,timestamp:Number(c.timestamp),high:c.high??Math.max(c.open,c.close),low:c.low??Math.min(c.open,c.close)}]; })).values()]
      .filter(c => Number.isFinite(c.timestamp) && [c.open,c.high,c.low,c.close].every(v => Number.isFinite(v) && v > 0)).sort((a,b)=>a.timestamp-b.timestamp);
  }
  function dailySignals(daily) {
    const rows = normalize(daily), signals = []; let average = null, held = 0;
    for (let i=0;i<rows.length;i++) {
      if (i===34) average=rows.slice(0,35).reduce((sum,c)=>sum+c.close,0)/35;
      else if (i>34) average=rows[i].close/18+average*17/18;
      if (average===null) continue;
      if (rows[i].close>average) held=1;
      else if (rows[i].close<average) held=0;
      signals.push({availableAt:rows[i].timestamp+DAY,target:held,ema:average});
    }
    return signals;
  }
  function run(candles, daily, options={}) {
    const rows=normalize(candles), initialEquity=options.initialEquity??1e8;
    const fee=options.fee??.0005, slippage=options.slippage??.0008, market=options.market??'';
    if (rows.length<2) throw Error('시뮬레이션에는 최소 2개 봉이 필요합니다.');
    if (!(initialEquity>0) || fee<0 || slippage<0 || slippage>=1) throw Error('잘못된 자산 또는 비용 설정입니다.');
    const signals=dailySignals(daily);
    return definitions.map((definition, strategyIndex)=>{
      let cash=initialEquity,quantity=0,exposure=0,peak=initialEquity,cursor=-1,entry=null;
      const curve=[],trades=[];let changes=0;
      for(let i=0;i<rows.length;i++) {
        const c=rows[i];
        while(cursor+1<signals.length && signals[cursor+1].availableAt<=c.timestamp) cursor++;
        // First point is the common capital anchor; all executions start at the next bar.
        const target=i===0?0:strategyIndex===0?1:cursor<0?0:signals[cursor].target;
        if(target!==exposure){
          if(target===1){
            const price=c.open*(1+slippage),before=cash;
            quantity=cash/(price*(1+fee));cash=0;
            entry={entryTime:c.timestamp,entryEquity:before};
          } else {
            const price=c.open*(1-slippage);cash=quantity*price*(1-fee);quantity=0;
            const pnl=cash-entry.entryEquity;
            trades.push({market,timestamp:c.timestamp,entryTime:entry.entryTime,price,pnl,returnPct:cash/entry.entryEquity-1,side:'long',type:'close',reason:'EMA 35일선 아래 · 현금 전환'});entry=null;
          }
          exposure=target;changes++;
        }
        const equity=cash+quantity*c.close;peak=Math.max(peak,equity);
        curve.push({timestamp:c.timestamp,equity,return:equity/initialEquity-1,drawdown:Math.max(0,1-equity/peak),exposure});
      }
      const finalEquity=curve.at(-1).equity,wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0);
      return {...definition,market,strategy:definition.id,initialEquity,finalEquity,finalCash:cash,finalQuantity:quantity,finalExposure:exposure,peakEquity:peak,totalReturn:finalEquity/initialEquity-1,maxDrawdown:Math.max(...curve.map(p=>p.drawdown)),changes,exposure,liquidated:false,tradingHalted:false,curve,equityCurve:curve,trades,from:new Date(rows[0].timestamp).toISOString(),to:new Date(rows.at(-1).timestamp).toISOString(),completedTrades:trades.length,winRate:trades.length?wins.length/trades.length:0,grossProfit:wins.reduce((s,t)=>s+t.pnl,0),grossLoss:-losses.reduce((s,t)=>s+t.pnl,0),profitFactor:losses.length?wins.reduce((s,t)=>s+t.pnl,0)/-losses.reduce((s,t)=>s+t.pnl,0):null};
    });
  }
  root.CoinBaselines=Object.freeze({definitions,normalize,dailySignals,run});
})(typeof window==='undefined'?globalThis:window);
