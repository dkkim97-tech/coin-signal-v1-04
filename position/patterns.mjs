import { avg, clamp, DAY, wilson } from './indicators.mjs';

export function pivots(rows, at, window = 180) {
  const out = [];
  // A pivot at i requires i+2 to be closed. It is NEVER backdated as a known signal.
  for (let i = Math.max(2, at - window); i + 2 <= at; i++) {
    const neighbors = [rows[i - 2], rows[i - 1], rows[i + 1], rows[i + 2]];
    const high = neighbors.every(r => r.high < rows[i].high), low = neighbors.every(r => r.low > rows[i].low);
    if (high !== low) out.push({ i, value: high ? rows[i].high : rows[i].low, type: high ? 'H' : 'L', confirmedAt: rows[i + 2].timestamp });
  }
  return out;
}
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
function slope(ps) { if (ps.length < 2) return 0; const x = avg(ps.map(p => p.i)), y = avg(ps.map(p => p.value)); return ps.reduce((s, p) => s + (p.i - x) * (p.value - y), 0) / (ps.reduce((s, p) => s + (p.i - x) ** 2, 0) || 1); }
export function detect(rows, at, s) {
  const r = rows[at], prev = rows[Math.max(0, at - 5)], list = [], flags = {};
  const add = (name, side, category = 'pattern', detail = '') => { const key = `${name}:${side}`; if (!flags[key]) { flags[key] = true; list.push({ name, side, category, detail, knownAt: r.timestamp }); } };
  const ps = pivots(rows, at), highs = ps.filter(p => p.type === 'H').slice(-3), lows = ps.filter(p => p.type === 'L').slice(-3), tol = (r.atr || r.close * 0.02) * 0.8;
  const recent = p => p && at - p.i <= 30;
  if (recent(ps.at(-1)) && at - ps.at(-1).i === 2) add('Fractal', ps.at(-1).type === 'L' ? 'bull' : 'bear');
  for (const [points, side, label] of [[highs, 'bear', 'Top'], [lows, 'bull', 'Bottom']]) {
    if (points.length < 2 || !recent(points.at(-1))) continue;
    const [a, b] = points.slice(-2), between = rows.slice(a.i + 1, b.i);
    const neckline = between.length ? (side === 'bear' ? Math.min(...between.map(c => c.low)) : Math.max(...between.map(c => c.high))) : b.value;
    const broken = side === 'bear' ? r.close < neckline : r.close > neckline;
    if (near(a.value, b.value, tol) && b.i - a.i >= 5 && broken) add(`Double ${label}`, side, 'pattern', 'neckline confirmed');
    if (points.length === 3 && Math.max(...points.map(p => p.value)) - Math.min(...points.map(p => p.value)) < tol && broken) add(`Triple ${label}`, side);
    if (side === 'bull' && b.value > a.value) add('Higher Low', side);
    if (side === 'bear' && b.value < a.value) add('Lower High', side);
    if (side === 'bear' && b.value > a.value) add('Higher High', 'bull');
    if (side === 'bull' && b.value < a.value) add('Lower Low', 'bear');
    for (const [field, label2] of [['line', 'MACD'], ['rsi', 'RSI'], ['cci', 'CCI'], ['obv', 'OBV']]) {
      if (rows[a.i][field] === null || rows[b.i][field] === null) continue;
      if ((side === 'bear' ? b.value > a.value && rows[b.i][field] < rows[a.i][field] : b.value < a.value && rows[b.i][field] > rows[a.i][field])) add(`${label2} Divergence`, side);
    }
    if (points.length === 3) {
      const [left, head, right] = points;
      if (near(left.value, right.value, tol) && (side === 'bear' ? head.value > Math.max(left.value, right.value) + tol : head.value < Math.min(left.value, right.value) - tol) && broken) add(side === 'bear' ? 'Head & Shoulders' : 'Inverse Head & Shoulders', side);
    }
  }
  if (highs.length >= 2 && lows.length >= 2 && recent(highs.at(-1)) && recent(lows.at(-1))) {
    const h = slope(highs), l = slope(lows), flat = tol / 20;
    const hi = highs.at(-1).value + h * (at - highs.at(-1).i), lo = lows.at(-1).value + l * (at - lows.at(-1).i);
    const breakout = r.close > hi ? 'bull' : r.close < lo ? 'bear' : null;
    if (Math.abs(h) <= flat && l > flat) add('Ascending Triangle', breakout || 'neutral');
    if (Math.abs(l) <= flat && h < -flat) add('Descending Triangle', breakout || 'neutral');
    if (h < -flat && l > flat) add('Symmetrical Triangle', breakout || 'neutral');
    if (h > flat && l > h && breakout === 'bear') add('Rising Wedge', 'bear');
    if (h < -flat && l < -flat && h < l && breakout === 'bull') add('Falling Wedge', 'bull');
    if (at >= 20) {
      const pole = rows[at - 10].close - rows[at - 20].close, range = Math.max(...rows.slice(at - 9, at + 1).map(x => x.high)) - Math.min(...rows.slice(at - 9, at + 1).map(x => x.low));
      if (Math.abs(pole) > 3 * tol && range < Math.abs(pole) * 0.65) {
        if (h < 0 && l < 0 && pole > 0) add('Bull Flag', 'bull');
        if (h > 0 && l > 0 && pole < 0) add('Bear Flag', 'bear');
        if (h < 0 && l > 0) add('Pennant', pole > 0 ? 'bull' : 'bear');
      }
    }
  }
  // Alternating confirmed swing points, Fibonacci tolerance 0.08; patterns remain candidates.
  const alternating = [];
  for (const p of ps) { const last = alternating.at(-1); if (last?.type === p.type) { if (p.type === 'H' ? p.value > last.value : p.value < last.value) alternating[alternating.length - 1] = p; } else alternating.push(p); }
  if (alternating.length >= 4 && recent(alternating.at(-1))) {
    const q = alternating.slice(-4), ab = Math.abs(q[1].value - q[0].value), bc = Math.abs(q[2].value - q[1].value), cd = Math.abs(q[3].value - q[2].value), side = q[3].type === 'L' ? 'bull' : 'bear';
    if (ab && near(cd / ab, 1, 0.12) && bc / ab >= 0.382 && bc / ab <= 0.886) add('ABCD', side);
    if (alternating.length >= 5) {
      const [x, a, b, c, d] = alternating.slice(-5), xa = Math.abs(a.value - x.value), ba = Math.abs(b.value - a.value), cb = Math.abs(c.value - b.value), dc = Math.abs(d.value - c.value), da = Math.abs(d.value - a.value);
      if (xa && ba && cb) {
        const rb = ba / xa, rc = cb / ba, rd = da / xa, re = dc / cb;
        const rules = [['Gartley', .618, .618, .786, 1.13, 1.618], ['Bat', .382, .5, .886, 1.618, 2.618], ['Butterfly', .786, .786, 1.27, 1.618, 2.618], ['Crab', .382, .618, 1.618, 2.24, 3.618]];
        for (const [name, min, max, end, extMin, extMax] of rules) if (rb >= min - .08 && rb <= max + .08 && rc >= .382 && rc <= .886 && near(rd, end, .08) && re >= extMin - .08 && re <= extMax + .08) add(name, side);
      }
    }
  }
  if (r.rsi !== null && r.rsi < 30) add('RSI Oversold', 'bull', 'oscillator');
  if (r.rsi !== null && r.rsi > 70) add('RSI Overbought', 'bear', 'oscillator');
  if (r.cci !== null && r.cci < -100) add('CCI Oversold', 'bull', 'oscillator');
  if (r.cci !== null && r.cci > 100) add('CCI Overbought', 'bear', 'oscillator');
  if (prev.cci < -100 && r.cci >= -100) add('CCI Recovery', 'bull', 'oscillator');
  if (r.cross) add(`MACD ${r.cross}`, r.cross === 'golden' ? 'bull' : 'bear', 'macd');
  const bands = s.envelopeBands.map(b => ({ percent: b, lower: r.envelope ? r.envelope * (1 - b / 100) : null, upper: r.envelope ? r.envelope * (1 + b / 100) : null }));
  const deviation = r.envelope ? (r.close / r.envelope - 1) * 100 : null;
  if (deviation !== null && Math.abs(deviation) >= Math.min(...s.envelopeBands)) add(deviation < 0 ? 'Envelope Lower' : 'Envelope Upper', deviation < 0 ? 'bull' : 'bear', 'envelope');
  const zone = deviation === null ? 'UNKNOWN' : deviation <= -20 ? 'Extreme Low' : deviation <= -10 ? 'Low' : deviation <= -3 ? 'Mid-Low' : deviation < 3 ? 'Middle' : deviation < 10 ? 'Mid-High' : deviation < 20 ? 'High' : 'Extreme High';
  const maLevels = [];
  for (const n of [20, 50, 100, 120, 200]) {
    let support = 0, resistance = 0, lastSupport = -9, lastResistance = -9;
    for (let i = Math.max(1, at - 29); i <= at; i++) {
      const c = rows[i], m = c.ma[n]; if (!m) continue;
      if (c.low <= m * 1.005 && c.close > m && rows[i - 1].close > rows[i - 1].ma[n] && i - lastSupport >= 3) { support++; lastSupport = i; }
      if (c.high >= m * .995 && c.close < m && rows[i - 1].close < rows[i - 1].ma[n] && i - lastResistance >= 3) { resistance++; lastResistance = i; }
    }
    maLevels.push({ period: n, value: r.ma[n], support, resistance });
    if (support >= 2 && r.close >= r.ma[n]) add(`MA${n} Support`, 'bull', 'ma', `${support} touches / 30 bars`);
    if (resistance >= 2 && r.close <= r.ma[n]) add(`MA${n} Resistance`, 'bear', 'ma', `${resistance} rejections / 30 bars`);
  }
  let obvState = 'UNAVAILABLE';
  if (r.obv !== null && prev.obv !== null) {
    obvState = r.obv > prev.obv ? 'Accumulation' : r.obv < prev.obv ? 'Distribution' : 'Neutral';
    if (r.obv !== prev.obv) add(`OBV ${obvState}`, r.obv > prev.obv ? 'bull' : 'bear', 'volume');
    if (at > 20) {
      const history = rows.slice(at - 20, at), volumeMean = avg(history.map(x => x.volume || 0));
      if (r.volume > volumeMean * 1.5) add('Volume Expansion', r.close > r.open ? 'bull' : 'bear', 'volume');
      if (r.obv > Math.max(...history.map(x => x.obv))) add('OBV Breakout', 'bull', 'volume');
      if (r.obv < Math.min(...history.map(x => x.obv))) add('OBV Breakdown', 'bear', 'volume');
      if (r.close > Math.max(...history.map(x => x.high))) add('Resistance Breakout', 'bull', 'ma');
      if (r.close < Math.min(...history.map(x => x.low))) add('Support Breakdown', 'bear', 'ma');
    }
  }
  const volatility = r.atr / r.close;
  const regime = volatility > .05 ? 'High Volatility' : volatility < .015 ? 'Low Volatility' : r.ma[200] && r.close > r.ma[200] * 1.05 ? 'Bull Trend' : r.ma[200] && r.close < r.ma[200] * .95 ? 'Bear Trend' : 'Sideways';
  return { list, bands, deviation, zone, maLevels, obvState, regime };
}

export function fitRisk(rows, contexts, endTimestamp, maxAdjustment = .2) {
  const stats = {};
  for (let i = 200; i + 7 < rows.length; i++) {
    if (rows[i + 7].timestamp > endTimestamp) break;
    const ret = rows[i + 7].close / rows[i].close - 1;
    for (const f of contexts[i].list) {
      if (f.side === 'neutral') continue;
      const key = `${f.name}:${f.side}`, a = stats[key] ||= { count: 0, wins: 0, returns: 0, category: f.category, side: f.side };
      a.count++; a.wins += (f.side === 'bull' ? ret > 0 : ret < 0) ? 1 : 0; a.returns += (f.side === 'bull' ? ret : -ret);
    }
  }
  const weights = {};
  for (const [key, a] of Object.entries(stats)) if (a.count >= 30) weights[key] = { ...a, weight: Math.max(0, wilson(a.wins, a.count)[0] - .5), probability: a.wins / a.count };
  return { trainedThrough: endTimestamp, maxAdjustment, weights, method: '7-day directional hit rate; Wilson lower bound minus 0.5; min 30 cases; training only' };
}
export function riskScores(context, model, timestamp, categories = null) {
  if (!model || model.trainedThrough >= timestamp) return { bull: null, bear: null, confluence: null, status: 'UNVALIDATED' };
  const eligible = Object.entries(model.weights).filter(([, v]) => !categories || categories.includes(v.category));
  const active = new Set(context.list.map(f => `${f.name}:${f.side}`));
  const score = side => { const pool = eligible.filter(([, v]) => v.side === side), total = pool.reduce((v, [, f]) => v + f.weight, 0); return total ? clamp(pool.filter(([k]) => active.has(k)).reduce((v, [, f]) => v + f.weight, 0) / total) * 100 : null; };
  const bull = score('bull'), bear = score('bear');
  return { bull, bear, confluence: bull === null && bear === null ? null : Math.max(bull || 0, bear || 0), status: 'TRAINED / OOS 검증 필요' };
}
export function riskTarget(target, context, model, timestamp, categories) {
  const score = riskScores(context, model, timestamp, categories);
  // Envelope alone is never an order trigger: require two independent categories.
  const directional = context.list.filter(f => f.side !== 'neutral' && (!categories || categories.includes(f.category)));
  if (score.confluence === null || new Set(directional.map(f => f.category)).size < 2) return target;
  return clamp(target + model.maxAdjustment * ((score.bull || 0) - (score.bear || 0)) / 100);
}
export function analogs(rows, at, window = 60, duration = DAY) {
  const horizonDays = [3, 7, 14, 30, 60, 90, 180], maxSteps = Math.ceil(180 * DAY / duration);
  if (at < window * 2) return { cases: [], outcomes: [] };
  const changes = (end) => { const a = []; for (let i = end - window + 2; i <= end; i++) a.push(Math.log(rows[i].close / rows[i - 1].close)); const mean = avg(a), sd = Math.sqrt(avg(a.map(x => (x - mean) ** 2))) || 1; return a.map(x => (x - mean) / sd); };
  const current = changes(at), candidates = [];
  for (let end = window - 1; end + Math.max(window, Math.ceil(3 * DAY / duration)) < at; end++) {
    const past = changes(end), corr = avg(past.map((v, i) => v * current[i]));
    if (corr >= .6) candidates.push({ index: end, timestamp: rows[end].timestamp, similarity: clamp(corr) });
  }
  candidates.sort((a, b) => b.similarity - a.similarity);
  const cases = [];
  for (const c of candidates) if (cases.every(p => Math.abs(p.index - c.index) >= window)) { cases.push(c); if (cases.length === 100) break; }
  const outcomes = horizonDays.map(days => {
    const steps = Math.ceil(days * DAY / duration), available = cases.filter(c => c.index + steps <= at);
    const values = available.map(c => { const future = rows.slice(c.index + 1, c.index + steps + 1), price = rows[c.index].close; let peak = price, mdd = 0; for (const r of future) { peak = Math.max(peak, r.high); mdd = Math.max(mdd, 1 - r.low / peak); } return { return: future.at(-1).close / price - 1, gain: Math.max(...future.map(r => r.high)) / price - 1, mdd }; });
    const positive = values.filter(v => v.return > 0).length;
    return { days, sample: values.length, positive, probability: values.length ? positive / values.length : null, return: values.length ? avg(values.map(v => v.return)) : null, gain: values.length ? avg(values.map(v => v.gain)) : null, mdd: values.length ? avg(values.map(v => v.mdd)) : null };
  });
  return { cases, outcomes, window, maxSteps };
}
