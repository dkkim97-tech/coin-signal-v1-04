import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settings, LEGACY_TARGETS } from '../position/config.mjs';
import { normalize, indicators, DAY, forecast } from '../position/indicators.mjs';
import { signalAt, historical } from '../position/signals.mjs';
import { pivots, detect, analogs, fitRisk, riskTarget } from '../position/patterns.mjs';
import { account, plan, reconcile, fillDay, position, equity, guardLive } from '../position/execution.mjs';
import { prepare, simulate } from '../position/backtest.mjs';
import { borrowSimulation, connectors, integrity } from '../position/data.mjs';
const s = settings();
function synthetic(n = 600) { return Array.from({ length: n }, (_, i) => { const p = 100 + Math.sin(i / 11) * 15 + Math.sin(i / 47) * 10 + i * .02; return { timestamp: Date.UTC(2018, 0, 1) + i * DAY, open: p, high: p + 3, low: p - 3, close: p, volume: 10 + i % 7 }; }); }
const samples = synthetic();
test('preserve legacy target map and reject malformed settings', () => {
  assert.deepEqual(s.targets, { below_golden: .5, below_dead: 0, above_golden: 1, above_dead: .5 });
  assert.throws(() => settings({ coefficients: [.2, .4, 1.2, 1.1, 1.4] }));
  assert.throws(() => settings({ targets: { above_golden: NaN } }));
  assert.throws(() => settings({ threshold: 1.1 }));
});
test('completed candles only; invalid ranges and duplicates excluded; ADR five daily ranges', () => {
  const rows = normalize([...samples.slice(0, 40), samples[10], { ...samples[2], high: 1 }], samples[39].timestamp + DAY / 2);
  assert.equal(rows.length, 39); const r = indicators(rows, s).at(-1); assert.equal(r.adr, 6);
  assert.equal(rows.at(-1).timestamp, samples[38].timestamp);
});
test('flat-price forecast matches appending hypothetical candles; does not consume future', () => {
  const base = samples.slice(0, 400), row = indicators(base, s).at(-1), projection = forecast(row, s);
  const future = [1, 2, 3].map(d => ({ ...base.at(-1), timestamp: base.at(-1).timestamp + d * DAY }));
  const appended = indicators([...base, ...future], s).slice(-3);
  projection.days.forEach((p, i) => { assert.ok(Math.abs(p.line - appended[i].line) < 1e-9); assert.ok(Math.abs(p.signal - appended[i].signal) < 1e-9); });
});
test('historical labels mature before T, do not overlap, exact prefix invariance', () => {
  const full = indicators(samples, s); const at = full.findIndex((r, i) => i > 350 && forecast(r, s).event); assert.ok(at > 0);
  const a = signalAt(full, at, s), b = signalAt(indicators(samples.slice(0, at + 1), s), at, s);
  assert.deepEqual(a, b);
  for (const c of a.stats.cases) { assert.ok(c.index + 3 <= at); assert.ok(c.labelEnd <= full[at].timestamp); }
  a.stats.cases.forEach((c, i, all) => all.slice(i + 1).forEach(o => assert.ok(Math.abs(c.index - o.index) > 3)));
});
test('insufficient historical sample never activates pre-signal', () => { const full = indicators(samples, settings({ minSamples: 1000, maxSamples: 1000 })); for (let i = 200; i < full.length; i++) assert.notEqual(signalAt(full, i, settings({ minSamples: 1000, maxSamples: 1000 })).source, 'PRE-SIGNAL'); });
test('confirmed pivots and pattern detection are causal', () => {
  const full = indicators(samples, s), at = 400;
  assert.deepEqual(detect(full, at, s), detect(full.slice(0, at + 1), at, s));
  assert.ok(pivots(full, at).every(p => p.i + 2 <= at));
  assert.deepEqual(analogs(full, at, 30), analogs(full.slice(0, at + 1), at, 30));
});
test('delta is split into five not entire account; core and opportunity symmetric', () => {
  for (const [current, target, size, side] of [[0, .5, .1, 'BUY'], [.3, .5, .04, 'BUY'], [.8, .5, .06, 'SELL'], [.5, 0, .1, 'SELL']]) {
    const orders = plan({ timestamp: 0, price: 100, adr: 10, current, target, capital: 1000, source: 'PRE-SIGNAL', key: 'below_golden' }, s);
    assert.equal(orders.length, 5); orders.forEach(o => { assert.ok(Math.abs(o.positionSize - size) < 1e-9); assert.equal(o.side, side); assert.equal(o.limit, 100 + (side === 'BUY' ? -1 : 1) * o.coefficient * 10); });
    assert.equal(orders.filter(o => o.group === 'CORE').length, 3);
  }
});
test('no same-bar fills, no chasing, idempotent execution, no overshoot or negative cash', () => {
  const a = account(1000), t = Date.UTC(2026, 0, 1), ss = settings({ maxDailyLoss: 1 });
  a.orders = plan({ timestamp: t, price: 100, adr: 10, current: 0, target: .5, capital: 1000, source: 'PRE-SIGNAL', key: 'below_golden' }, ss);
  assert.equal(fillDay(a, { timestamp: t - DAY, open: 100, low: 50, high: 110, close: 100 }, ss).length, 0);
  assert.equal(fillDay(a, { timestamp: t, open: 100, low: 93, high: 110, close: 100 }, ss).length, 2);
  assert.equal(fillDay(a, { timestamp: t, open: 100, low: 50, high: 110, close: 100 }, ss).length, 0);
  assert.equal(a.orders.filter(o => o.group === 'OPPORTUNITY' && o.status === 'FILLED').length, 0);
  assert.ok(a.cash >= 0); assert.ok(position(a, 100) < .5);
});
test('reversal and probability cancellation remove opposing waiting orders; confirmation plans remaining only', () => {
  const a = account(1000, .3, 100), row = { close: 100, adr: 10 }, t = Date.UTC(2026, 0, 1);
  reconcile(a, { row, target: .5, source: 'PRE-SIGNAL', key: 'below_golden' }, s, t);
  reconcile(a, { row, target: .5, source: 'PRE-SIGNAL', key: 'below_golden' }, s, t);
  assert.equal(a.orders.length, 5);
  reconcile(a, { row, target: .5, source: 'CONFIRMED', key: 'below_golden' }, s, t + DAY);
  a.orders.filter(o => o.status === 'WAITING').forEach(o => assert.ok(Math.abs(o.positionSize - .04) < 1e-9));
  reconcile(a, { row, target: 0, source: 'CORE', key: 'below_dead' }, s, t + 2 * DAY);
  assert.ok(a.orders.filter(o => o.status === 'WAITING').every(o => o.side === 'SELL'));
});
test('LIVE never runs without explicit enablement and capable adapter; borrowing is opt-in', () => {
  assert.throws(() => guardLive({ mode: 'SIMULATION' }, s)); assert.throws(() => guardLive({ mode: 'LIVE', explicitlyEnabled: true, connector: connectors.upbit }, s));
  assert.throws(() => borrowSimulation({ enabled: false, available: false }));
  assert.equal(borrowSimulation({ enabled: true, available: true, proceeds: 1000, repurchaseCost: 900, tradingFees: 2, slippageCost: 1, borrowRateDaily: .001, days: 10 }).net, 87);
});
test('backtest does not change when unseen future prices change', () => {
  const a = prepare(samples, s), end = samples[450].timestamp, options = { strategy: 'G', start: samples[250].timestamp, end };
  const one = simulate(a, s, options), changed = samples.map((r, i) => i > 450 ? { ...r, open: r.open * 8, high: r.high * 8, low: r.low * 8, close: r.close * 8 } : r);
  const two = simulate(prepare(changed, s), s, options);
  assert.deepEqual(one, two); assert.ok(one.curve.every(p => Number.isFinite(p.equity) && p.equity > 0));
});
test('actual BTC history has UTC daily boundaries and enough train/validation/OOS data', () => {
  const history = JSON.parse(readFileSync(new URL('../position/data/btc-history.json', import.meta.url))), rows = normalize(history.candles.d1);
  assert.ok(rows.length > 3000); assert.ok(rows.every(r => r.timestamp % DAY === 0));
  assert.equal(integrity(rows).gaps, 0);
});
test('all buy/sell fills respect limit and requested target including fees', () => {
  const t = Date.UTC(2026, 0, 1), config = settings({ maxDailyLoss: 1 });
  for (const [initial, target, open] of [[0, .5, 80], [.8, .5, 130], [.5, 0, 130]]) {
    const a = account(1000, initial, 100, t - DAY), side = target > initial ? 'BUY' : 'SELL';
    a.orders = plan({ timestamp: t, price: 100, adr: 10, current: initial, target, capital: 1000, source: 'CONFIRMED', key: 'above_dead' }, config);
    fillDay(a, { timestamp: t, open, high: 150, low: 70, close: open }, config, { enforceSafety: false });
    assert.ok(a.cash >= -1e-8 && a.quantity >= -1e-8);
    for (const o of a.orders.filter(o => o.status === 'FILLED')) assert.ok(side === 'BUY' ? o.fillPrice <= o.limit : o.fillPrice >= o.limit);
    assert.ok(side === 'BUY' ? position(a, open) <= target + 1e-8 : position(a, open) >= target - 1e-8);
  }
});
test('expired limits cannot use a subsequent day range; safety shutdown cancels outstanding orders', () => {
  const a = account(1000), t = Date.UTC(2026, 0, 1);
  a.orders = plan({ timestamp: t, price: 100, adr: 10, current: 0, target: .5, capital: 1000, source: 'CORE', key: 'above_dead' }, s);
  assert.equal(fillDay(a, { timestamp: t + DAY, open: 100, high: 130, low: 70, close: 100 }, s).length, 0);
  assert.ok(a.orders.every(o => o.status === 'EXPIRED'));
  const b = account(1000, .5, 100, t - DAY);
  b.orders = plan({ timestamp: t, price: 100, adr: 10, current: .5, target: 1, capital: 1000, source: 'CORE', key: 'above_golden' }, s);
  fillDay(b, { timestamp: t, open: 100, high: 130, low: 70, close: 100 }, s);
  assert.ok(b.stopped); assert.ok(b.orders.every(o => o.status === 'CANCELLED'));
});
