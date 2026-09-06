import { mkdir, writeFile } from 'node:fs/promises';
const frames = { d1: 'days', w1: 'weeks', h4: 'minutes/240', h1: 'minutes/60' }, candles = {};
for (const [frame, endpoint] of Object.entries(frames)) {
  const wanted = frame === 'd1' ? 4000 : frame === 'w1' ? 600 : 1200;
  const rows = new Map(); let to;
  while (rows.size < wanted) {
    const query = new URLSearchParams({ market: 'KRW-BTC', count: '200' }); if (to) query.set('to', to);
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch(`https://api.upbit.com/v1/candles/${endpoint}?${query}`, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
      if (response.status !== 429) break;
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    if (!response.ok) throw new Error(`Upbit ${response.status} ${frame}`);
    const page = await response.json(); if (!page.length) break;
    for (const c of page) { const t = Date.parse(c.candle_date_time_utc + 'Z'); rows.set(t, [t, c.opening_price, c.high_price, c.low_price, c.trade_price, c.candle_acc_trade_volume]); }
    to = new Date(Date.parse(page.at(-1).candle_date_time_utc + 'Z') - 1).toISOString();
    if (page.length < 200) break;
    await new Promise(resolve => setTimeout(resolve, 160));
  }
  candles[frame] = [...rows.values()].sort((a, b) => a[0] - b[0]);
  console.log(frame, rows.size, new Date(candles[frame][0][0]).toISOString(), new Date(candles[frame].at(-1)[0]).toISOString());
}
await mkdir(new URL('../position/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../position/data/btc-history.json', import.meta.url), JSON.stringify({ source: 'Upbit public OHLCV API; candle_date_time_utc; no synthetic candles', generatedAt: new Date().toISOString(), market: 'KRW-BTC', systemConfig: { macdFast: 12, macdSlow: 26, macdSignal: 9 }, candles }));
