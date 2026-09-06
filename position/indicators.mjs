export const DAY = 86400000;
export const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export function normalize(rows, asOf = Date.now(), duration = DAY) {
  const map = new Map();
  for (const row of rows) {
    const r = Array.isArray(row) ? { timestamp: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] } : row;
    const c = Object.fromEntries(['timestamp', 'open', 'high', 'low', 'close'].map(k => [k, Number(r[k])]));
    c.volume = r.volume == null ? null : Number(r.volume);
    if (Object.values(c).some(v => v !== null && !Number.isFinite(v)) || c.timestamp < 0 || c.timestamp + duration > asOf || c.low <= 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || (c.volume !== null && c.volume < 0)) continue;
    map.set(c.timestamp, c);
  }
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}
export function ema(a, n) {
  const out = Array(a.length).fill(null); if (a.length < n) return out;
  out[n - 1] = avg(a.slice(0, n)); const k = 2 / (n + 1);
  for (let i = n; i < a.length; i++) out[i] = a[i] * k + out[i - 1] * (1 - k);
  return out;
}
export function sma(a, n) { let sum = 0; return a.map((v, i) => { sum += v; if (i >= n) sum -= a[i - n]; return i >= n - 1 ? sum / n : null; }); }
export function cross(prev, next) { return prev < 0 && next >= 0 ? 'golden' : prev >= 0 && next < 0 ? 'dead' : null; }
export const zoneKey = (line, direction) => `${line >= 0 ? 'above' : 'below'}_${direction}`;
export function indicators(candles, s) {
  const closes = candles.map(c => c.close), fast = ema(closes, s.fast), slow = ema(closes, s.slow);
  const line = closes.map((_, i) => fast[i] === null || slow[i] === null ? null : fast[i] - slow[i]);
  const signal = Array(s.slow - 1).fill(null).concat(ema(line.slice(s.slow - 1), s.signal)).slice(0, closes.length);
  const histogram = line.map((v, i) => v === null || signal[i] == null ? null : v - signal[i]);
  let gain = 0, loss = 0, obv = 0;
  const typical = candles.map(c => (c.high + c.low + c.close) / 3), mean = sma(typical, 20);
  const tr = candles.map((c, i) => Math.max(c.high - c.low, i ? Math.abs(c.high - closes[i - 1]) : 0, i ? Math.abs(c.low - closes[i - 1]) : 0));
  const atr = sma(tr, 14), adr = sma(candles.map(c => c.high - c.low), 5);
  const ma = Object.fromEntries([20, 50, 100, 120, 200].map(n => [n, (s.envelopeMA === 'EMA' ? ema : sma)(closes, n)]));
  const envelope = (s.envelopeMA === 'EMA' ? ema : sma)(closes, s.envelopePeriod);
  const volumeKnown = candles.every(c => c.volume !== null);
  return candles.map((c, i) => {
    if (i) {
      const d = c.close - closes[i - 1];
      gain = i <= 14 ? gain + Math.max(d, 0) / 14 : (gain * 13 + Math.max(d, 0)) / 14;
      loss = i <= 14 ? loss + Math.max(-d, 0) / 14 : (loss * 13 + Math.max(-d, 0)) / 14;
      obv += Math.sign(d) * (c.volume || 0);
    }
    const deviation = i >= 19 ? avg(typical.slice(i - 19, i + 1).map(v => Math.abs(v - mean[i]))) : 0;
    return { ...c, fast: fast[i], slow: slow[i], line: line[i], signal: signal[i], histogram: histogram[i],
      cross: i && histogram[i - 1] !== null && histogram[i] !== null ? cross(histogram[i - 1], histogram[i]) : null,
      key: histogram[i] === null ? null : zoneKey(line[i], histogram[i] >= 0 ? 'golden' : 'dead'),
      rsi: i < 14 ? null : gain + loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss),
      cci: i < 19 ? null : deviation ? (typical[i] - mean[i]) / (0.015 * deviation) : 0,
      obv: volumeKnown ? obv : null, atr: atr[i], adr: adr[i], envelope: envelope[i],
      ma: Object.fromEntries(Object.entries(ma).map(([n, series]) => [n, series[i]])) };
  });
}
export function forecast(row, s, price = row.close, horizon = 3) {
  if (row.histogram === null) return { days: [], event: null };
  let fast = row.fast, slow = row.slow, signal = row.signal, prev = row.histogram;
  const days = [];
  for (let d = 1; d <= horizon; d++) {
    fast += (price - fast) * 2 / (s.fast + 1); slow += (price - slow) * 2 / (s.slow + 1);
    const line = fast - slow; signal += (line - signal) * 2 / (s.signal + 1);
    const histogram = line - signal, direction = cross(prev, histogram);
    days.push({ day: d, fast, slow, line, signal, histogram, cross: direction, key: direction ? zoneKey(line, direction) : null,
      eta: direction ? d - 1 + Math.abs(prev) / (Math.abs(prev) + Math.abs(histogram) || 1) : null });
    prev = histogram;
  }
  return { days, event: days.find(r => r.cross) || null };
}
export function wilson(success, total) {
  if (!total) return [null, null]; const p = success / total, z = 1.96, den = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / den, radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / den;
  return [clamp(center - radius), clamp(center + radius)];
}
