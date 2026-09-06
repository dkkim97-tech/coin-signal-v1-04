import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/candles.js';
function response() { return { code: 200, headers: {}, status(code) { this.code = code; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(body) { this.body = body; return this; } }; }
test('candle API rejects unsupported methods and unknown markets', async () => {
  const post = response(); await handler({ method: 'POST', query: {} }, post); assert.equal(post.code, 405);
  const bad = response(); await handler({ method: 'GET', query: { market: 'KRW-NOT-ALLOWED' } }, bad); assert.equal(bad.code, 400);
});
test('weekly API includes volume and excludes the incomplete current week', async () => {
  const original = globalThis.fetch, now = Date.now(), day = 86400000;
  const monday = Math.floor(now / day) * day - ((new Date(now).getUTCDay() + 6) % 7) * day;
  globalThis.fetch = async url => {
    assert.ok(String(url).includes('/candles/weeks?'));
    return { ok: true, json: async () => [monday, monday - 7 * day].map(t => ({ candle_date_time_utc: new Date(t).toISOString().slice(0, 19), opening_price: 100, high_price: 120, low_price: 90, trade_price: 110, candle_acc_trade_volume: 42 })) };
  };
  try { const r = response(); await handler({ method: 'GET', query: { market: 'KRW-BTC', timeframe: 'week', count: '80' } }, r); assert.equal(r.code, 200); assert.equal(r.body.candles.length, 1); assert.equal(r.body.candles[0].volume, 42); assert.equal(r.body.candles[0].timestamp, monday - 7 * day); }
  finally { globalThis.fetch = original; }
});
