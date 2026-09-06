import { avg, DAY, indicators, normalize, clamp } from './indicators.mjs';
import { signalAt } from './signals.mjs';
import { detect, fitRisk, riskTarget } from './patterns.mjs';
import { settings } from './config.mjs';
import { account, equity, position, reconcile, fillDay, trade } from './execution.mjs';

export const STRATEGIES = [
  ['A', 'MACD Only · 상태별 비중'], ['B', 'Confirmed Cross Only'], ['C', 'MACD + RSI + CCI'], ['D', 'MACD + Envelope'],
  ['E', 'MACD + Pattern'], ['F', 'MACD + 3-Day Pre-Signal'], ['G', 'Pre-Signal + ADR5 5-Split'], ['H', 'Full Strategy'],
];
export function prepare(candles, s) {
  const rows = indicators(normalize(candles), s), contexts = rows.map((_, i) => i >= 200 ? detect(rows, i, s) : { list: [], regime: 'WARMUP' });
  return { rows, contexts, signalCache: new Map() };
}
export function metrics(a, curve, initial, start, end, baseline) {
  const returns = curve.map((p, i) => p.equity / (i ? curve[i - 1].equity : initial) - 1), mean = avg(returns), std = Math.sqrt(avg(returns.map(r => (r - mean) ** 2))), downside = Math.sqrt(avg(returns.map(r => Math.min(r, 0) ** 2)));
  const wins = a.trades.filter(t => t.pnl > 0), losses = a.trades.filter(t => t.pnl < 0), grossLoss = -losses.reduce((s, t) => s + t.pnl, 0), years = Math.max((end - start) / DAY / 365.25, 1 / 365.25), final = curve.at(-1)?.equity || initial;
  return { totalReturn: final / initial - 1, cagr: (final / initial) ** (1 / years) - 1, mdd: Math.max(0, ...curve.map(p => p.drawdown)),
    winRate: a.trades.length ? wins.length / a.trades.length : null, profitFactor: grossLoss ? wins.reduce((s, t) => s + t.pnl, 0) / grossLoss : null,
    sharpe: std ? mean / std * Math.sqrt(365.25) : null, sortino: downside ? mean / downside * Math.sqrt(365.25) : null,
    trades: a.trades.length, fills: a.fills.length, averageProfit: wins.length ? avg(wins.map(t => t.pnl)) : null, averageLoss: losses.length ? avg(losses.map(t => t.pnl)) : null,
    averageHoldingDays: a.trades.length ? avg(a.trades.map(t => t.holdingDays)) : null, exposure: avg(curve.map(p => p.exposure)),
    bestTrade: a.trades.length ? Math.max(...a.trades.map(t => t.pnl)) : null, worstTrade: a.trades.length ? Math.min(...a.trades.map(t => t.pnl)) : null,
    buyHold: baseline, finalEquity: final, unrealizedValue: a.quantity * (curve.at(-1)?.price || 0), stopped: a.stopReason || null };
}
export function simulate(prepared, config, options = {}) {
  const s = settings(config), { rows, contexts, signalCache } = prepared, strategy = options.strategy || 'G';
  const start = options.start ?? Date.UTC(2024, 0, 1), end = options.end ?? Infinity, horizon = options.horizon || 3;
  const first = rows.findIndex((r, i) => i >= 200 && r.timestamp >= start), a = account(s.capital), curve = [], events = [], missed = [];
  if (first < 0) return { strategy, error: '해당 기간의 확정 일봉이 없습니다.' };
  let peak = s.capital, lastConfirmedTarget = s.targets[rows[first - 1].key], lastTarget = null;
  for (let i = first; i < rows.length && rows[i].timestamp <= end; i++) {
    const r = rows[i], prior = rows[i - 1];
    if (r.timestamp - prior.timestamp !== DAY) { a.stopped = true; a.stopReason = 'DATA GAP'; break; }
    let signal;
    if (['F', 'G', 'H'].includes(strategy)) {
      const cacheKey = `${i - 1}:${s.threshold}:${s.minSamples}:${s.maxSamples}:${s.similarityRadius}:${horizon}`;
      if (!signalCache.has(cacheKey)) signalCache.set(cacheKey, signalAt(rows, i - 1, s, horizon));
      signal = { ...signalCache.get(cacheKey) };
    } else signal = { row: prior, target: s.targets[prior.key], source: 'CORE', key: prior.key, state: prior.cross ? 'CONFIRMED' : 'NO ACTION' };
    if (prior.cross) lastConfirmedTarget = s.targets[prior.key];
    if (strategy === 'B') signal.target = lastConfirmedTarget;
    if (['C', 'D', 'E', 'H'].includes(strategy)) {
      const categories = strategy === 'C' ? ['oscillator', 'macd'] : strategy === 'D' ? ['envelope', 'macd', 'ma'] : strategy === 'E' ? ['pattern', 'macd'] : null;
      signal.target = riskTarget(signal.target, contexts[i - 1], s.riskModel, prior.timestamp, categories);
    }
    signal.target = clamp(signal.target, 0, s.maxPosition);
    if (signal.source === 'PRE-SIGNAL' && (!events.length || events.at(-1).key !== signal.key || events.at(-1).index + 3 < i - 1)) events.push({ index: i - 1, key: signal.key });
    if (['G', 'H'].includes(strategy)) {
      for (const o of a.orders.filter(o => o.status === 'WAITING')) if (o.group === 'OPPORTUNITY') missed.push({ timestamp: r.timestamp, side: o.side, limit: o.limit, nextDayReturn: r.close / prior.close - 1 });
      reconcile(a, signal, s, r.timestamp, strategy);
      for (const o of a.orders.filter(o => o.status === 'WAITING')) o.referencePrice = prior.close;
      // Strategy comparisons share the same cost/exposure rules; operational LIVE/Paper
      // shutdowns are separately tested and must not stop only the split variants.
      fillDay(a, r, s, { enforceSafety: false });
    } else if (!a.stopped && (lastTarget === null || Math.abs(lastTarget - signal.target) > 1e-6)) {
      const current = position(a, r.open), side = signal.target > current ? 'BUY' : 'SELL';
      const price = r.open * (1 + (side === 'BUY' ? s.slippage : -s.slippage));
      trade(a, side, Math.abs(signal.target - current) * equity(a, r.open) / price, price, r.timestamp, s, `${strategy}:${r.timestamp}`, signal.target);
      lastTarget = signal.target;
    }
    const value = equity(a, r.close); peak = Math.max(peak, value);
    curve.push({ timestamp: r.timestamp, equity: value, drawdown: 1 - value / peak, exposure: position(a, r.close), price: r.close, regime: contexts[i].regime });
  }
  const last = curve.at(-1), testedEvents = events.filter(e => e.index + 3 < rows.length && rows[e.index + 3].timestamp <= (last?.timestamp || 0));
  const falseEvents = testedEvents.filter(e => !rows.slice(e.index + 1, e.index + 4).some(r => r.cross && r.key === e.key));
  const baseline = last ? last.price / rows[first].open - 1 : 0;
  const result = metrics(a, curve, s.capital, rows[first].timestamp, (last?.timestamp || rows[first].timestamp) + DAY, baseline);
  const rates = Object.fromEntries(['CORE', 'OPPORTUNITY'].map(group => { const orders = a.orders.filter(o => o.group === group), filled = orders.filter(o => o.status === 'FILLED'); return [group, { placed: orders.length, filled: filled.length, rate: orders.length ? filled.length / orders.length : null }]; }));
  const averageFill = side => { const f = a.fills.filter(f => f.side === side); return f.length ? f.reduce((v, f) => v + f.value, 0) / f.reduce((v, f) => v + f.quantity, 0) : null; };
  const regimes = [...new Set(curve.map(p => p.regime))].map(regime => { let compounded = 1, peak = 1, mdd = 0, count = 0; curve.forEach((p, i) => { if (p.regime === regime) { compounded *= p.equity / (i ? curve[i - 1].equity : s.capital); peak = Math.max(peak, compounded); mdd = Math.max(mdd, 1 - compounded / peak); count++; } }); return { regime, days: count, return: compounded - 1, mdd }; });
  return { strategy, ...result, falseSignalRate: testedEvents.length ? falseEvents.length / testedEvents.length : null, evaluatedPreSignals: testedEvents.length,
    rates, averageBuy: averageFill('BUY'), averageSell: averageFill('SELL'), opportunityCost: baseline - result.totalReturn, missedOpportunity: missed,
    curve, regimes, orders: a.orders, fillsDetail: a.fills, tradeDetails: a.trades, campaigns:a.campaigns || [], riskModelApplied: Boolean(s.riskModel && s.riskModel.trainedThrough < rows[first].timestamp),
    from: rows[first].timestamp, to: last?.timestamp || null };
}
export function research(candles, config, options = {}, progress = () => {}) {
  const s = settings(config), prepared = prepare(candles, s), { rows, contexts } = prepared;
  const trainingEnd = Date.UTC(2021, 0, 1) - 1, validationStart = Date.UTC(2021, 0, 1), validationEnd = Date.UTC(2024, 0, 1) - 1;
  const trained = fitRisk(rows, contexts, trainingEnd);
  progress('Training 완료 · Validation 비중 조절 크기 비교');
  const validation = [0, .1, .2, .3].map(maxAdjustment => {
    const model = { ...trained, maxAdjustment };
    const result = simulate(prepared, { ...s, riskModel: model }, { strategy: 'H', start: validationStart, end: validationEnd });
    return { maxAdjustment, sharpe: result.sharpe, return: result.totalReturn, mdd: result.mdd, error: result.error };
  });
  const best = [...validation].filter(v => Number.isFinite(v.sharpe)).sort((a, b) => b.sharpe - a.sharpe)[0];
  // Selection uses validation only; this artifact cannot act before validation ended.
  const model = { ...trained, maxAdjustment: best?.maxAdjustment || 0, trainedThrough: validationEnd, validation };
  const selected = { start: options.start ?? Date.UTC(2024, 0, 1), end: options.end ?? Infinity };
  const comparisons = STRATEGIES.map(([strategy, label], index) => { progress(`전략 비교 ${index + 1}/8 · ${label}`); return { label, ...simulate(prepared, { ...s, riskModel: model }, { ...selected, strategy }) }; });
  const horizons = [0, 1, 2, 3].map(horizon => ({ horizon, ...simulate(prepared, s, { ...selected, strategy: horizon ? 'F' : 'B', horizon: horizon || 3 }) }));
  const thresholds = [.7, .75, .8, .85, .9].map(threshold => { progress(`확률 기준 ${(threshold * 100).toFixed()}% 비교`); return { threshold, ...simulate(prepared, { ...s, threshold }, { ...selected, strategy: 'G' }) }; });
  const coefficientSets = [[.2, .5, .8, 1.1, 1.4], [.15, .45, .75, 1.05, 1.35], [.25, .5625, .875, 1.1875, 1.5]];
  const coefficients = coefficientSets.map((coefficients, index) => ({ set: 'ABC'[index], coefficients, ...simulate(prepared, { ...s, coefficients }, { ...selected, strategy: 'G' }) }));
  const walkForward = [];
  const lastYear = new Date(rows.at(-1)?.timestamp || Date.now()).getUTCFullYear();
  for (let year = 2021; year <= lastYear; year++) {
    progress(`Walk Forward · ${year}`);
    const cutoff = Date.UTC(year, 0, 1) - 1, foldModel = fitRisk(rows, contexts, cutoff, .2);
    walkForward.push({ year, ...simulate(prepared, { ...s, riskModel: foldModel }, { strategy: 'H', start: cutoff + 1, end: Date.UTC(year + 1, 0, 1) - 1 }) });
  }
  return { generatedAt: Date.now(), model, comparisons, horizons, thresholds, coefficients, walkForward, settings: s,
    dataFrom: rows[0]?.timestamp, dataTo: rows.at(-1)?.timestamp, trainingEnd, validationStart, validationEnd,
    caveats: ['확정 일봉만 사용; 전일 신호 → 다음 봉 주문', '선행 지정가 등간격; 확정 교차·초기 배치·0선 상태 변경은 다음 시가 잔량 완료', '완료 시 동일 시가의 5개 균등 수량으로 모형화; 장중 시간 간격 분할을 뜻하지 않음', '선행 조건 이탈 시 잔량 취소; 예측일만으로 강제 완료하지 않음', 'OHLC 지정가 접촉 모형, 호가 대기열·부분 유동성 미반영', '운영 정지 한도는 Paper에 적용; 전략 비교는 정지 없이 동일 조건으로 수행', 'FIFO 부분청산 기준 거래 통계; 미청산 손익은 자산곡선에 포함', 'Buy & Hold는 비용 전 종가/최초 시가 수익률', 'Walk Forward는 확장 학습, 조절 상한 20% 고정 실험; 최종 모델과 별개'] };
}
