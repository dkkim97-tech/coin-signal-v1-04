(function () {
  "use strict";
  const macd1Name = "MACD 1 · 0선 돌파";
  const macd2Name = "MACD 2 · 0선×골든/데드 보유비중";
  const feeRate = 0.0005;
  const slippage = 0.0008;
  const baseRefresh = window.__MACD1_REFRESH__;
  if (typeof baseRefresh !== "function" || !window.__MACD2_RESULT__) return;

  window.refreshUpbitBacktestFromLatestData = async function refreshBothMacdStrategies() {
    const response = await baseRefresh();
    for (const row of response.result.summaries || []) row.strategy = macd1Name;
    for (const row of response.result.series || []) row.strategy = macd1Name;
    const updatedMacd2 = await extendAll(window.__MACD2_RESULT__, response.latestCandlesByMarket);
    response.result.__macd2Applied = true;
    response.result.summaries.push(...updatedMacd2.summaries);
    response.result.series.push(...updatedMacd2.series);
    return response;
  };

  async function extendAll(base, sharedCandles = {}) {
    const fetched = Object.entries(sharedCandles).map(([market, rows]) => [market, rows.map((row) => ({ timestamp: Number(row.timestamp), open: Number(row.open), close: Number(row.close) })).filter((row) => Number.isFinite(row.timestamp) && row.open > 0 && row.close > 0).sort((a, b) => a.timestamp - b.timestamp)]);
    if (!fetched.length) {
      await delay(900);
      for (const series of base.series) {
        try {
          const payload = await fetchDailyCandles(series.market);
          fetched.push([series.market, payload.map((row) => ({ timestamp: Date.parse(`${row.candle_date_time_utc}Z`), open: Number(row.opening_price), close: Number(row.trade_price) })).filter((row) => Number.isFinite(row.timestamp) && row.open > 0 && row.close > 0).sort((a, b) => a.timestamp - b.timestamp)]);
        } catch (error) {
          console.warn(error.message);
        }
        await delay(140);
      }
    }
    const candlesByMarket = new Map(fetched);
    const summaries = [];
    const seriesRows = [];
    for (const baseSeries of base.series) {
      const baseSummary = base.summaries.find((row) => row.market === baseSeries.market);
      const candles = candlesByMarket.get(baseSeries.market) || [];
      if (!candles.length) {
        summaries.push({ ...baseSummary, strategy: macd2Name });
        seriesRows.push({ ...baseSeries, strategy: macd2Name });
        continue;
      }
      const extension = extendSeries(baseSeries, candles);
      const trades = [...baseSeries.trades, ...extension.trades];
      const wins = trades.filter((trade) => trade.pnl > 0), losses = trades.filter((trade) => trade.pnl < 0);
      const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0), grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
      const newest = extension.equityCurve.at(-1)?.timestamp || Date.parse(baseSummary.to);
      summaries.push({ ...baseSummary, strategy: macd2Name, to: new Date(newest).toISOString(), totalReturn: extension.finalEquity / baseSeries.initialEquity - 1, maxDrawdown: Math.max(baseSummary.maxDrawdown, ...extension.equityCurve.map((point) => point.drawdown)), completedTrades: trades.length, winRate: trades.length ? wins.length / trades.length : 0, profitFactor: grossLoss ? grossProfit / grossLoss : null, grossProfit, grossLoss });
      seriesRows.push({ ...baseSeries, strategy: macd2Name, finalEquity: extension.finalEquity, finalCash: extension.cash, finalQuantity: extension.quantity, finalExposure: extension.exposure, peakEquity: extension.peak, equityCurve: [...baseSeries.equityCurve, ...extension.equityCurve], trades });
    }
    return { summaries, series: seriesRows };
  }

  async function fetchDailyCandles(market) {
    const url = `https://api.upbit.com/v1/candles/days?market=${encodeURIComponent(market)}&count=200`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${url}&_=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.ok) return response.json();
      if (response.status !== 429 || attempt === 2) throw new Error(`${market} MACD 2 최신 일봉 연결 실패 (${response.status})`);
      await delay(1000 * (attempt + 1));
    }
    return [];
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function extendSeries(base, candles) {
    const closes = candles.map((row) => row.close), fast = ema(closes, 12), slow = ema(closes, 26);
    const macd = closes.map((_, index) => Number.isFinite(fast[index]) && Number.isFinite(slow[index]) ? fast[index] - slow[index] : null);
    const compactSignal = ema(macd.filter(Number.isFinite), 9), signal = Array(candles.length).fill(null);
    let compactIndex = 0;
    for (let index = 0; index < macd.length; index += 1) if (Number.isFinite(macd[index])) signal[index] = compactSignal[compactIndex++];
    const cutoff = base.equityCurve.at(-1).timestamp;
    let cash = base.finalCash, quantity = base.finalQuantity, exposure = base.finalExposure, peak = base.peakEquity;
    let segmentStartEquity = base.finalEquity, segmentStartTime = cutoff;
    const equityCurve = [], trades = [];
    for (let index = 1; index < candles.length; index += 1) {
      const candle = candles[index];
      if (candle.timestamp <= cutoff) continue;
      const target = targetExposure(macd[index - 1], signal[index - 1]);
      if (target !== exposure) {
        const before = cash + quantity * candle.open;
        trades.push({ market: base.market, timestamp: candle.timestamp, entryTime: segmentStartTime, price: candle.open, pnl: before - segmentStartEquity, returnPct: segmentStartEquity ? before / segmentStartEquity - 1 : 0, reason: `보유 비중 ${(target * 100).toFixed(0)}%로 변경`, side: "long", type: "allocation" });
        ({ cash, quantity } = rebalance(cash, quantity, target, candle.open));
        exposure = target; segmentStartEquity = cash + quantity * candle.open; segmentStartTime = candle.timestamp;
      }
      const value = cash + quantity * candle.close;
      peak = Math.max(peak, value);
      equityCurve.push({ timestamp: candle.timestamp, return: value / base.initialEquity - 1, drawdown: Math.max(0, 1 - value / peak), exposure });
    }
    const lastPrice = candles.at(-1)?.close || 0;
    return { finalEquity: cash + quantity * lastPrice, cash, quantity, exposure, peak, equityCurve, trades };
  }

  function rebalance(cash, quantity, target, rawPrice) {
    const before = cash + quantity * rawPrice, targetValue = before * target, currentValue = quantity * rawPrice;
    if (targetValue > currentValue) {
      const notional = Math.min(targetValue - currentValue, cash / (1 + feeRate));
      cash -= notional * (1 + feeRate); quantity += notional / (rawPrice * (1 + slippage));
    } else if (targetValue < currentValue) {
      const units = Math.min(quantity, (currentValue - targetValue) / rawPrice), proceeds = units * rawPrice * (1 - slippage);
      cash += proceeds * (1 - feeRate); quantity -= units;
    }
    return { cash, quantity };
  }

  function targetExposure(line, signal) {
    if (!Number.isFinite(line) || !Number.isFinite(signal)) return 0;
    return line >= 0 ? (line >= signal ? 1 : 0.5) : (line >= signal ? 0.5 : 0);
  }

  function ema(values, period) {
    const output = Array(values.length).fill(null);
    if (values.length < period) return output;
    output[period - 1] = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    const weight = 2 / (period + 1);
    for (let index = period; index < values.length; index += 1) output[index] = values[index] * weight + output[index - 1] * (1 - weight);
    return output;
  }
})();
