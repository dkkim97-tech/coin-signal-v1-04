import { normalize, DAY } from './indicators.mjs';
export const FRAME = { d1: { api: 'day', endpoint: 'days', duration: DAY }, w1: { api: 'week', endpoint: 'weeks', duration: 7 * DAY }, h4: { api: '240', endpoint: 'minutes/240', duration: DAY / 6 }, h1: { api: '60', endpoint: 'minutes/60', duration: DAY / 24 } };
export async function fetchRecent(frame = 'd1', count = 200) {
  const f = FRAME[frame];
  let rows;
  try {
    const response = await fetch(`/api/candles?market=KRW-BTC&timeframe=${f.api}&count=${count}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`API ${response.status}`);
    rows = (await response.json()).candles;
  } catch {
    const response = await fetch(`https://api.upbit.com/v1/candles/${f.endpoint}?market=KRW-BTC&count=${Math.min(count, 200)}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Upbit ${response.status}`);
    rows = (await response.json()).map(c => ({ timestamp: Date.parse(c.candle_date_time_utc + 'Z'), open: c.opening_price, high: c.high_price, low: c.low_price, close: c.trade_price, volume: c.candle_acc_trade_volume }));
  }
  const result = normalize(rows || [], Date.now(), f.duration);
  if (!result.length) throw new Error('완료 캔들이 없습니다.');
  return result;
}
export function integrity(rows, now = Date.now()) {
  const gaps = rows.slice(1).filter((r, i) => r.timestamp - rows[i].timestamp !== DAY);
  const stale = !rows.length || now - rows.at(-1).timestamp >= 2 * DAY;
  return { gaps: gaps.length, stale, healthy: !gaps.length && !stale, lastClosedAt: rows.at(-1)?.timestamp + DAY };
}
export const connectors = Object.fromEntries(['upbit', 'bithumb', 'coinone', 'korbit'].map(name => [name, {
  name, capabilities: { marketData: name === 'upbit', balances: false, orders: false, borrowing: false },
  tradingFee: null, borrowFee: null, collateralRule: null, liquidationRule: null,
  marketData: name === 'upbit' ? fetchRecent : async () => { throw new Error(`${name} 데이터 미연결`); },
  balance: async () => { throw new Error('계좌 미연결'); },
  orders: async () => { throw new Error('실주문 미연결'); },
}]));
export function borrowSimulation({ proceeds, repurchaseCost, tradingFees, slippageCost, borrowRateDaily, days, enabled, available }) {
  if (!enabled || !available) throw new Error('대여 서비스 가용성 확인과 사용자 활성화가 필요합니다.');
  if (![proceeds, repurchaseCost, tradingFees, slippageCost, borrowRateDaily, days].every(v => Number.isFinite(v) && v >= 0)) throw new Error('대여 비용 자료가 필요합니다.');
  const gross = proceeds - repurchaseCost, borrowFee = proceeds * borrowRateDaily * days;
  return { gross, borrowFee, net: gross - borrowFee - tradingFees - slippageCost };
}
export function flowContext(entries, now = Date.now()) {
  const rows = entries.filter(r => Number.isFinite(r.timestamp) && Number.isFinite(r.netFlow) && r.timestamp <= now).sort((a, b) => a.timestamp - b.timestamp);
  const sum = days => rows.filter(r => r.timestamp > now - days * DAY).reduce((s, r) => s + r.netFlow, 0);
  if (!rows.length) return { status: 'UNAVAILABLE', daily: null, weekly: null, monthly: null };
  const monthly = sum(30), meanAbs = rows.filter(r => r.timestamp > now - 30 * DAY).reduce((s, r) => s + Math.abs(r.netFlow), 0) / 30;
  const daily = rows.at(-1).netFlow;
  return { daily, weekly: sum(7), monthly, asOf: rows.at(-1).timestamp, status: Math.abs(daily) < meanAbs * .1 ? 'Neutral' : daily > meanAbs * 2 ? 'Strong Inflow' : daily > 0 ? 'Inflow' : daily < -meanAbs * 2 ? 'Strong Outflow' : 'Outflow' };
}
