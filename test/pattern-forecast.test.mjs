import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../pattern-forecast.js', import.meta.url), 'utf8');
const core = source.slice(source.indexOf('  function calculate('), source.indexOf('  function renderResult('));
const helpers = ['clamp', 'average'].map(name => source.match(new RegExp(`  function ${name}\\([^\\n]+`))[0]).join('\n');
const { calculate } = vm.runInNewContext(`${core}\n${helpers}\n({calculate})`);
const candles = Array.from({length: 500}, (_, i) => {
  const open = 100 + i * .1 + Math.sin(i / 7) * 5, close = open + Math.sin(i / 3);
  return [i * 86400000, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close, 1000 + i];
});

test('all timeframes compare 60 bars and next-bar probabilities remain normalized', () => {
  for (const timeframe of ['d1', 'w1', 'h4', 'h1']) {
    const result = calculate(candles, timeframe);
    assert.equal(result.patternLength, 60);
    assert.equal(result.latestStart, 440);
    assert.equal(result.latestStats.totalReturn, candles[499][4] / candles[439][4] - 1);
    assert.equal(result.latestStats.recentReturn, candles[499][4] / candles[494][4] - 1);
    assert.ok(Math.abs(result.up + result.flat + result.down - 1) < 1e-12);
    for (const match of result.selected) {
      assert.equal(match.patternReturn, candles[match.end][4] / candles[match.end - 60][4] - 1);
      assert.ok(match.end + 1 < result.latestStart);
    }
  }
});

test('insufficient history is rejected for the expanded comparison window', () => {
  assert.throws(() => calculate(candles.slice(0, 181), 'd1'), /과거 봉 자료가 부족/);
  assert.ok(calculate(candles.slice(0, 182), 'd1').selected.length > 0);
});
