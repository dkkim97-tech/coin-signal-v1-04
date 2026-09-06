import { forecast, wilson, DAY } from './indicators.mjs';
function features(rows, i) {
  const r = rows[i], p = rows[i - 1], scale = r.atr || r.close * 0.01;
  return [r.line / scale, r.histogram / scale * 3, (r.histogram - p.histogram) / scale * 6, r.atr / r.close * 10];
}
export function historical(rows, at, projection, s) {
  if (!projection.event) return { sample: 0, success: 0, probability: null, confidence: 'NO PROJECTION', interval: [null, null], timeline: [null, null, null], cases: [] };
  const now = features(rows, at), candidates = [], event = projection.event;
  // A historical label is admitted only after ALL three subsequent daily candles closed by T.
  for (let i = s.slow + s.signal; i + 3 <= at; i++) {
    if (rows[i + 3].timestamp - rows[i].timestamp !== 3 * DAY || rows[i].key !== rows[at].key) continue;
    const hypothetical = forecast(rows[i], s).event;
    if (!hypothetical || hypothetical.key !== event.key) continue;
    const f = features(rows, i), distance = Math.sqrt(f.reduce((sum, v, j) => sum + (v - now[j]) ** 2, 0));
    if (distance > s.similarityRadius) continue;
    let hit = 0;
    for (let d = 1; d <= 3; d++) if (rows[i + d].cross === event.cross && rows[i + d].key === event.key) { hit = d; break; }
    candidates.push({ index: i, timestamp: rows[i].timestamp, labelEnd: rows[i + 3].timestamp, distance, hit });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  // Non-overlapping event windows avoid counting a single crossover three times.
  const selected = [];
  for (const c of candidates) if (selected.every(p => Math.abs(p.index - c.index) > 3)) { selected.push(c); if (selected.length >= s.maxSamples) break; }
  const sample = selected.length, success = selected.filter(c => c.hit).length, interval = wilson(success, sample);
  return { sample, success, probability: sample ? success / sample : null, interval,
    confidence: sample < s.minSamples ? 'LOW SAMPLE' : interval[1] - interval[0] <= 0.15 ? 'HIGH' : 'MEDIUM',
    timeline: [1, 2, 3].map(d => sample ? selected.filter(c => c.hit && c.hit <= d).length / sample : null), cases: selected };
}
export function signalAt(rows, at, s, horizon = 3, price = rows[at].close) {
  const row = rows[at], projection = forecast(row, s, price), stats = historical(rows, at, projection, s);
  const eligible = projection.event && projection.event.day <= horizon && stats.sample >= s.minSamples && stats.probability >= s.threshold;
  // An actual crossing wins over a conflicting projection on the same day.
  const state = row.cross ? 'CONFIRMED' : eligible ? 'PRE-SIGNAL ACTIVE' : stats.probability >= 0.7 ? 'PREPARE' : stats.probability >= 0.6 ? 'WATCH' : 'NO ACTION';
  return { row, projection, stats, state, source: row.cross ? 'CONFIRMED' : eligible ? 'PRE-SIGNAL' : 'CORE',
    target: s.targets[eligible && !row.cross ? projection.event.key : row.key],
    key: eligible && !row.cross ? projection.event.key : row.key };
}
export function scenarios(row, s) {
  return [['현재 가격 유지', row.close], ['+0.5%', row.close * 1.005], ['−0.5%', row.close * 0.995], ['+1%', row.close * 1.01], ['−1%', row.close * 0.99], ['ATR 상단', row.close + row.atr], ['ATR 하단', Math.max(1, row.close - row.atr)]]
    .map(([name, price]) => ({ name, price, ...forecast(row, s, price) }));
}
