import { readFile, mkdir, writeFile } from 'node:fs/promises';
const html = await readFile(new URL('../BTC-MACD-RSI-V2.3-ALL.html', import.meta.url), 'utf8');
const match = html.match(/window\.__COIN_DATA__=(\{.*?\});?\s*<\/script>/s);
if (!match) throw new Error('BTC embedded data not found');
const data = JSON.parse(match[1]);
await mkdir(new URL('../position/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../position/data/btc-history.json', import.meta.url), JSON.stringify({ market: data.market, systemConfig: data.systemConfig, source: 'Existing BTC-MACD-RSI-V2.3-ALL.html / Upbit', generatedAt: data.generatedAt, candles: data.candles }));
console.log(JSON.stringify({ config: { fast: data.systemConfig.macdFast, slow: data.systemConfig.macdSlow, signal: data.systemConfig.macdSignal }, frames: Object.fromEntries(Object.entries(data.candles).map(([k, v]) => [k, { count: v.length, first: v[0]?.[0], last: v.at(-1)?.[0] }])) }));
