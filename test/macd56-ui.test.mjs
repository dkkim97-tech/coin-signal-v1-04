import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {regimeTarget} from '../trading/strategies.mjs';
const source=readFileSync(new URL('../futures-timeframe-simulator.js',import.meta.url),'utf8');
const extension=readFileSync(new URL('../macd5-latest-extension.js',import.meta.url),'utf8');
const plan=vm.runInNewContext('('+source.slice(source.indexOf('function planAllocation('),source.indexOf('function rebalance(')).trim()+')');
const extend=vm.runInNewContext('('+extension.slice(extension.indexOf('function buildExposurePlan('),extension.indexOf('function ema(')).trim()+')');
test('timeframe and latest-refresh MACD 5 allocations agree with execution policy',()=>{
 const line=[1,1,-1,-1,1,1,-1,-1],hist=[1,-1,1,-1,1,-1,1,-1],signal=line.map((v,i)=>v-hist[i]);
 for(const n of [5]){
  const expected=line.map((v,i)=>regimeTarget(n,v,hist[i]));
  assert.deepEqual(Array.from(plan(line,signal,true,true)),expected);
  assert.deepEqual(Array.from(extend(line,signal,'regime'+n,2)),expected);
 }
 assert.match(source,/value === -2 \? "숏 2배"/);
});
