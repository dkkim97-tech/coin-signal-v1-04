(function () {
  "use strict";
  const isFutures = /(^|\/)futures(\/|$)/i.test(decodeURIComponent(location.pathname || "")) || new URLSearchParams(location.search).get("mode") === "futures";
  const feeRate = 0.0005, slippage = 0.0008;
  const baseRefresh = window.refreshUpbitBacktestFromLatestData;
  if (!isFutures || typeof baseRefresh !== "function" || !Array.isArray(window.__MACD5_RESULTS__)) return;

  window.refreshUpbitBacktestFromLatestData = async function refreshAllLeveragedMacdStrategies() {
    const response = await baseRefresh();
    for (const extra of window.__MACD5_RESULTS__) {
      const updated = extendAll(extra, response.latestCandlesByMarket || {});
      response.result.summaries.push(...updated.summaries);
      response.result.series.push(...updated.series);
    }
    response.result.__macd5Applied = true;
    return response;
  };

  function extendAll(base, sharedCandles) {
    const candlesByMarket = new Map(Object.entries(sharedCandles).map(([market, rows]) => [market, rows.map((row) => ({ timestamp: Number(row.timestamp), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) })).filter((row) => Number.isFinite(row.timestamp) && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0).sort((a, b) => a.timestamp - b.timestamp)]));
    const summaries = [], seriesRows = [];
    for (const baseSeries of base.series) {
      const baseSummary = base.summaries.find((row) => row.market === baseSeries.market);
      const candles = candlesByMarket.get(baseSeries.market) || [];
      if (!candles.length) {
        summaries.push(baseSummary); seriesRows.push(baseSeries); continue;
      }
      const extension = extendSeries(baseSeries, candles, base.assumptions || {});
      const trades = [...(baseSeries.trades || []), ...extension.trades];
      const wins = trades.filter((trade) => trade.pnl > 0), losses = trades.filter((trade) => trade.pnl < 0);
      const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0), grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
      const newest = extension.equityCurve.at(-1)?.timestamp || Date.parse(baseSummary.to);
      summaries.push({ ...baseSummary, to: new Date(newest).toISOString(), totalReturn: extension.finalEquity / baseSeries.initialEquity - 1, maxDrawdown: Math.max(baseSummary.maxDrawdown, ...extension.equityCurve.map((point) => point.drawdown)), completedTrades: trades.length, winRate: trades.length ? wins.length / trades.length : 0, profitFactor: grossLoss ? grossProfit / grossLoss : null, grossProfit, grossLoss, tradingHalted: baseSummary.tradingHalted || extension.liquidated });
      seriesRows.push({ ...baseSeries, finalEquity: extension.finalEquity, finalCash: extension.cash, finalQuantity: extension.quantity, finalExposure: extension.exposure, peakEquity: extension.peak, equityCurve: [...baseSeries.equityCurve, ...extension.equityCurve], trades });
    }
    return { summaries, series: seriesRows };
  }

  function extendSeries(base, candles, assumptions) {
    const leverage = Number(assumptions.leverage) || 1;
    const closes = candles.map((row) => row.close), fast = ema(closes, 18), slow = ema(closes, 39);
    const macd = closes.map((_, index) => Number.isFinite(fast[index]) && Number.isFinite(slow[index]) ? fast[index] - slow[index] : null);
    const compactSignal = ema(macd.filter(Number.isFinite), 9), signal = Array(candles.length).fill(null);
    let compactIndex = 0;
    for (let index = 0; index < macd.length; index += 1) if (Number.isFinite(macd[index])) signal[index] = compactSignal[compactIndex++];
    const exposurePlan = buildExposurePlan(macd, signal, assumptions.leverageMode, leverage);
    const cutoff = base.equityCurve.at(-1).timestamp;
    let cash = base.finalCash, quantity = base.finalQuantity, exposure = base.finalExposure, peak = base.peakEquity, liquidated = !(base.finalEquity > 0), segmentStartEquity = base.finalEquity, segmentStartTime = cutoff;
    const equityCurve = [], trades = [];
    for (let index = 1; index < candles.length; index += 1) {
      const candle = candles[index];
      if (candle.timestamp <= cutoff) continue;
      if (liquidated) {
        equityCurve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1, exposure: 0 });
        continue;
      }
      const target = exposurePlan[index - 1];
      const openingEquity = cash + quantity * candle.open;
      if (!(openingEquity > 0)) { liquidate(candle.timestamp, candle.open, "시가 갭으로 계좌 청산"); continue; }
      if (target !== exposure) {
        const reason = target === 2 ? "0선 상향돌파 후 첫 골든크로스: 롱 2배" : target < 0 ? "기본 0선 아래·데드크로스: 숏 1배" : `롱 보유 비중 ${target === 0.5 ? "50%" : "1배"}로 변경`;
        trades.push({ market: base.market, timestamp: candle.timestamp, entryTime: segmentStartTime, price: candle.open, pnl: openingEquity - segmentStartEquity, returnPct: segmentStartEquity ? openingEquity / segmentStartEquity - 1 : 0, reason, side: exposure < 0 ? "short" : "long", type: "allocation" });
        ({ cash, quantity } = rebalance(cash, quantity, target, candle.open));
        exposure = target; segmentStartEquity = cash + quantity * candle.open; segmentStartTime = candle.timestamp;
      }
      const adversePrice = quantity > 0 ? candle.low : quantity < 0 ? candle.high : candle.close;
      if (!(cash + quantity * adversePrice > 0)) { liquidate(candle.timestamp, quantity ? Math.max(0, -cash / quantity) : adversePrice, "일중 변동으로 계좌 청산"); continue; }
      const equity = cash + quantity * candle.close;
      if (!(equity > 0)) { liquidate(candle.timestamp, candle.close, "종가 기준 계좌 청산"); continue; }
      peak = Math.max(peak, equity);
      equityCurve.push({ timestamp: candle.timestamp, equity, return: equity / base.initialEquity - 1, drawdown: Math.max(0, 1 - equity / peak), exposure });
    }
    const lastPrice = candles.at(-1)?.close || 0;
    return { finalEquity: liquidated ? 0 : cash + quantity * lastPrice, cash, quantity, exposure, peak, liquidated, equityCurve, trades };

    function liquidate(timestamp, price, reason) {
      trades.push({ market: base.market, timestamp, entryTime: segmentStartTime, price, pnl: -segmentStartEquity, returnPct: -1, reason, side: exposure < 0 ? "short" : "long", type: "liquidation" });
      cash = 0; quantity = 0; exposure = 0; liquidated = true;
      equityCurve.push({ timestamp, equity: 0, return: -1, drawdown: 1, exposure: 0 });
    }
  }

  function rebalance(cash, quantity, target, rawPrice) {
    const equity = cash + quantity * rawPrice, deltaQuantity = equity * target / rawPrice - quantity;
    if (deltaQuantity > 0) { const price = rawPrice * (1 + slippage), notional = deltaQuantity * price; return { cash: cash - notional * (1 + feeRate), quantity: quantity + deltaQuantity }; }
    if (deltaQuantity < 0) { const units = -deltaQuantity, price = rawPrice * (1 - slippage), proceeds = units * price; return { cash: cash + proceeds * (1 - feeRate), quantity: quantity - units }; }
    return { cash, quantity };
  }
  function buildExposurePlan(macd, signal, mode, leverage) {
    const plan = Array(macd.length).fill(0);
    let previousLine = null, previousDiff = null;
    let firstGoldenArmed = false, firstGoldenActive = false;
    for (let index = 0; index < macd.length; index += 1) {
      const line = macd[index], signalLine = signal[index];
      if (!Number.isFinite(line) || !Number.isFinite(signalLine)) continue;
      const diff = line - signalLine;
      const zeroUp = Number.isFinite(previousLine) && previousLine <= 0 && line > 0;
      const zeroDown = Number.isFinite(previousLine) && previousLine >= 0 && line < 0;
      const goldenCross = Number.isFinite(previousDiff) && previousDiff <= 0 && diff > 0;
      const deadCross = Number.isFinite(previousDiff) && previousDiff >= 0 && diff < 0;
      if (zeroUp) { firstGoldenArmed = true; firstGoldenActive = false; }
      if (zeroDown) { firstGoldenArmed = false; firstGoldenActive = false; }
      if (goldenCross && line > 0 && firstGoldenArmed) { firstGoldenActive = true; firstGoldenArmed = false; }
      if (deadCross) firstGoldenActive = false;
      const baseline = line >= 0 ? (diff >= 0 ? 1 : 0.5) : (diff >= 0 ? 0.5 : -1);
      plan[index] = mode === "firstGoldenAboveZero" && firstGoldenActive && line > 0 && diff > 0 ? leverage : baseline;
      previousLine = line; previousDiff = diff;
    }
    return plan;
  }
  function ema(values, period) { const output = Array(values.length).fill(null); if (values.length < period) return output; output[period - 1] = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period; const weight = 2 / (period + 1); for (let index = period; index < values.length; index += 1) output[index] = values[index] * weight + output[index - 1] * (1 - weight); return output; }
})();
