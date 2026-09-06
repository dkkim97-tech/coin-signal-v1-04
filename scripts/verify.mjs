import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { research } from '../position/backtest.mjs';
import { settings } from '../position/config.mjs';
const files = (await readdir(new URL('../position/', import.meta.url))).filter(f => f.endsWith('.mjs'));
for (const file of files) { const r = spawnSync(process.execPath, ['--check', new URL('../position/' + file, import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); }
const data = JSON.parse(await readFile(new URL('../position/data/btc-history.json', import.meta.url)));
const started = Date.now();
const results = research(data.candles.d1, settings(), {}, message => console.log(message));
const directory = new URL('../reports/', import.meta.url); await mkdir(directory, { recursive: true });
await writeFile(new URL('btc-position-research.json', directory), JSON.stringify(results));
const summary = {
  elapsedSeconds: (Date.now() - started) / 1000,
  candles: data.candles.d1.length,
  dataFrom: new Date(results.dataFrom).toISOString(), dataTo: new Date(results.dataTo).toISOString(),
  model: { maxAdjustment: results.model.maxAdjustment, weightedFeatures: Object.values(results.model.weights).filter(w => w.weight > 0).length },
  comparisons: results.comparisons.map(r => ({ strategy: r.strategy, totalReturn: r.totalReturn, mdd: r.mdd, sharpe: r.sharpe, fills: r.fills, preSignals: r.evaluatedPreSignals, stopped: r.stopped, error: r.error, core: r.rates?.CORE, opportunity: r.rates?.OPPORTUNITY })),
};
await writeFile(new URL('verification-summary.json', directory), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
