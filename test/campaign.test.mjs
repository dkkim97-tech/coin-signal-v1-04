import test from 'node:test';
import assert from 'node:assert/strict';
import {settings} from '../position/config.mjs';
import {DAY} from '../position/indicators.mjs';
import {account,reconcile,fillDay,position} from '../position/execution.mjs';
const s=settings({maxDailyLoss:1}), t=Date.UTC(2026,0,1);
const signal=(day,source='PRE-SIGNAL',target=.5,key='below_golden')=>({row:{timestamp:t+(day-1)*DAY,close:100,adr:10,key:source==='CONFIRMED'?key:'below_dead'},source,key,target,projection:{event:{day:3}}});
const candle=(day,low=99,high=101,open=100)=>({timestamp:t+day*DAY,open,high,low,close:open});
test('equal price spacing is symmetric across all five buy/sell orders',()=>{
  for(const [current,target,key] of [[0,.5,'below_golden'],[.8,.5,'above_dead']]) {
    const a=account(1000,current,100,t-DAY);reconcile(a,signal(0,'PRE-SIGNAL',target,key),s,t);
    const orders=a.orders.filter(o=>o.status==='WAITING');assert.equal(orders.length,5);
    for(let i=1;i<5;i++) assert.ok(Math.abs(Math.abs(orders[i].limit-orders[i-1].limit)-3)<1e-9);
    orders.forEach(o=>assert.ok(Math.abs(o.positionSize-Math.abs(target-current)/5)<1e-9));
  }
});
test('D-3 -> D-2 -> D-1 preserves start date and only resplits residual; D0 completes after fees and slippage',()=>{
  const a=account(1000);
  for(let day=0;day<3;day++) {
    const current=position(a,100); reconcile(a,signal(day),s,t+day*DAY);
    assert.equal(a.campaign.startedAt,t);assert.equal(a.campaign.stage,`D-${3-day}`);
    const waiting=a.orders.filter(o=>o.status==='WAITING');assert.equal(waiting.length,5);
    waiting.forEach(o=>assert.ok(Math.abs(o.positionSize-(.5-current)/5)<1e-9));
    fillDay(a,candle(day,97.5),s); // Core #1 only.
  }
  assert.ok(position(a,100)>0&&position(a,100)<.5);
  const count=a.fills.length;
  reconcile(a,signal(3,'CONFIRMED'),s,t+3*DAY);
  assert.equal(a.orders.filter(o=>o.status==='WAITING').length,0);
  fillDay(a,candle(3,119,121,120),s);
  assert.equal(a.campaign.status,'COMPLETED');assert.ok(Math.abs(position(a,120)-.5)<1e-9);
  assert.equal(a.fills.length-count,5);
  const units=a.fills.slice(-5).map(f=>f.quantity);units.forEach(q=>assert.ok(Math.abs(q-units[0])<1e-9));
  assert.equal(fillDay(a,candle(3,80,160,120),s).length,0);
});
test('sell residual must reach zero even if no favorable limit was ever touched',()=>{
  const a=account(1000,.5,100,t-DAY);
  for(let day=0;day<3;day++){reconcile(a,signal(day,'PRE-SIGNAL',0,'below_dead'),s,t+day*DAY);fillDay(a,candle(day),s);}
  assert.equal(a.fills.length,0);reconcile(a,signal(3,'CONFIRMED',0,'below_dead'),s,t+3*DAY);
  fillDay(a,candle(3,79,81,80),s);
  assert.ok(a.quantity<1e-9);assert.equal(a.campaign.status,'COMPLETED');assert.ok(a.cash<1000);
});
test('completed instruction does not rebalance daily mark-to-market drift',()=>{
  const a=account(1000);reconcile(a,signal(0,'CONFIRMED'),s,t);fillDay(a,candle(0),s);
  const fills=a.fills.length,orders=a.orders.length;
  for(let day=1;day<=4;day++) {
    reconcile(a,{...signal(day,'CORE'),row:{...signal(day).row,key:'below_golden',close:120}},s,t+day*DAY);
    fillDay(a,candle(day,119,121,120),s);
  }
  assert.equal(a.fills.length,fills);assert.equal(a.orders.length,orders);assert.ok(position(a,120)>.5);
});
test('loss of pre-signal eligibility cancels residual without automatic unwind',()=>{
  const a=account(1000);reconcile(a,signal(0),s,t);fillDay(a,candle(0,97.5),s);const q=a.quantity;
  reconcile(a,signal(1,'CORE',0,'below_dead'),s,t+DAY);fillDay(a,candle(1,70,130),s);
  assert.equal(a.campaign.status,'CANCELLED');assert.equal(a.quantity,q);assert.equal(a.orders.filter(o=>o.status==='WAITING').length,0);
});
test('reversal cancels opposite pending limits and completes the new confirmed target',()=>{
  const a=account(1000);reconcile(a,signal(0),s,t);fillDay(a,candle(0,97.5),s);
  reconcile(a,signal(1,'CONFIRMED',0,'below_dead'),s,t+DAY);fillDay(a,candle(1),s);
  assert.ok(a.quantity<1e-9);assert.equal(a.orders.filter(o=>o.status==='WAITING').length,0);
});
test('a missed completion bar fails closed instead of retrospectively filling',()=>{
  const a=account(1000);reconcile(a,signal(0,'CONFIRMED'),s,t);fillDay(a,candle(1),s);
  assert.ok(a.stopped);assert.equal(a.fills.length,0);
});
test('completed pre-signal does not restart on the next day solely for price drift',()=>{
  const a=account(1000,.5,100,t-DAY);reconcile(a,signal(0),s,t);
  assert.equal(a.campaign.status,'COMPLETED');
  reconcile(a,{...signal(1),row:{...signal(1).row,close:120}},s,t+DAY);
  assert.equal(a.orders.length,0);assert.equal(a.campaigns.length,1);
});
test('serialized Paper campaign history remains linked to the current campaign',()=>{
  let a=account(1000);reconcile(a,signal(0),s,t);a=JSON.parse(JSON.stringify(a));
  reconcile(a,signal(1,'CONFIRMED'),s,t+DAY);fillDay(a,candle(1),s);
  assert.equal(a.campaigns[0].status,'COMPLETED');assert.equal(a.campaigns[0].finalPosition,a.campaign.finalPosition);
});
