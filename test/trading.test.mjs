import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {POLICY,D,selection,validateLimits,ladder,makePlan,usage,DAY} from '../trading/policy.mjs';
import {signedRequest,Exchange,terminal} from '../server/exchanges.mjs';
import {Store} from '../server/store.mjs';
import {Controller} from '../server/controller.mjs';
import handler,{session,authenticated} from '../api/trading.js';
import {prepare,nextState} from '../trading/research.mjs';
import {decide} from '../trading/decision.mjs';
const now=1788699200000;
const meta={tick:'.1',qtyStep:'.0001',minQty:'.0001',minNotional:'5'};
const snapshot=()=>({at:now,price:'100',equity:'10000',available:'10000',positions:[],pending:[],meta});
const input=()=>({exchange:'bitget',coin:'BTC',strategy:5,limits:{total:'10000',symbols:{BTC:'5000'}},snapshot:snapshot(),meta,decision:{kind:'PRE',target:2,anchor:100,adr:5,bar:now-DAY},now});
test('D5 80% is fixed; spot rejects MACD 4/5; both limits are mandatory',()=>{
  assert.equal(POLICY.horizon,5);assert.equal(POLICY.threshold,.8);assert.throws(()=>selection('korbit','BTC',4));assert.throws(()=>validateLimits({total:100,symbols:{BTC:101}}));assert.throws(()=>validateLimits({total:0,symbols:{BTC:1}}));assert.throws(()=>validateLimits({total:100,symbols:{}}));
});
test('five ladder prices have exact equal gaps on both sides, including different tick tiers',()=>{
  for(const side of ['buy','sell'])for(const m of [meta,{ticks:[{priceGte:'0',tickSize:'.02'},{priceGte:'100',tickSize:'.05'}]}]) {
    const p=ladder(m,'100','5',side);assert.equal(p.prices.length,5);
    for(let i=1;i<5;i++)assert.equal(D(p.prices[i]).sub(p.prices[i-1]).abs().toFixed(),p.step);
  }
});
test('gross portfolio cap includes shorts, other coins and resting open orders',()=>{
  const s=snapshot();s.positions=[{coin:'ETH',qty:'-50',price:'100'}];s.pending=[{coin:'ETH',remaining:'20',reservePrice:'100',reduceOnly:false},{coin:'ETH',remaining:'50',reservePrice:'100',reduceOnly:true}];
  assert.equal(usage(s).total.toFixed(),'7000');const p=makePlan({...input(),snapshot:s});
  assert.equal(p.budget,'2500');assert.equal(p.orders.length,5);
  const extra=p.orders.reduce((a,o)=>a.add(D(o.qty).mul(100).mul('1.005')),D(0));assert.ok(extra.lte(3000));
});
test('symbol cap and portfolio cap both hold as equity grows; zero headroom blocks opens',()=>{
  const s=snapshot();s.equity='999999';s.positions=[{coin:'BTC',qty:'50',price:'100'}];
  const p=makePlan({...input(),snapshot:s});assert.equal(p.budget,'2500');assert.equal(p.orders.length,0);
  s.positions=[{coin:'ETH',qty:'100',price:'100'}];assert.equal(makePlan({...input(),snapshot:s}).orders.length,0);
});
test('limit ladder splits quote amount equally within one quantity-step rounding error',()=>{
  const p=makePlan(input()),amounts=p.orders.map(o=>D(o.qty).mul(o.price)),spread=D.max(...amounts).sub(D.min(...amounts));assert.ok(spread.lte(D(meta.qtyStep).mul(100)));assert.notEqual(p.orders[0].qty,p.orders[4].qty);
});
test('a reversal closes the existing short first with reduce-only; no opening leg mixed in',()=>{
  const s=snapshot();s.positions=[{coin:'BTC',qty:'-20',price:'100'}];const p=makePlan({...input(),snapshot:s});assert.equal(p.phase,'CLOSE_BEFORE_REVERSE');assert.ok(p.orders.every(o=>o.reduceOnly&&o.side==='buy'));const closed=p.orders.reduce((a,o)=>a.add(o.qty),D(0));assert.ok(closed.lte(20)&&closed.gte('19.9995'));
});
test('reduce-only exit works above caps; min-order dust is exposed, not marked filled',()=>{
  const s=snapshot();s.positions=[{coin:'BTC',qty:'100',price:'100'}];const p=makePlan({...input(),snapshot:s,decision:{kind:'CONFIRMED',target:0}});assert.equal(p.orders.length,5);assert.ok(p.orders.every(o=>o.timeInForce==='ioc'&&o.reduceOnly));
  s.positions=[{coin:'BTC',qty:'.001',price:'100'}];const dust=makePlan({...input(),snapshot:s,decision:{kind:'CONFIRMED',target:0}});assert.equal(dust.orders.length,0);assert.ok(D(dust.residual).gt(0));assert.ok(dust.reason);
});
test('stale snapshot and unsupported spot exposure fail closed',()=>{
  assert.throws(()=>makePlan({...input(),now:now+16000}));assert.throws(()=>makePlan({...input(),exchange:'korbit',strategy:3,decision:{target:-1}}));
});
test('exchange signatures cover the exact transmitted bytes; secrets are headers only',()=>{
  const key={key:'key',secret:'secret',passphrase:'pass',demo:true};
  const k=signedRequest('korbit','POST','/v2/orders',{symbol:'btc_krw',qty:'0.1'},key,123);
  const [body,sig]=k.init.body.split('&signature=');assert.equal(sig,createHmac('sha256','secret').update(body).digest('hex'));assert.ok(!k.url.includes('secret'));
  const b=signedRequest('bitget','GET','/api/v3/trade/order-info',{clientOid:'abc'},key,123);assert.equal(b.init.headers['ACCESS-SIGN'],createHmac('sha256','secret').update('123GET/api/v3/trade/order-info?clientOid=abc').digest('base64'));assert.equal(b.init.headers.paptrading,'1');
});
test('Korbit filled can still mean a partially executed IOC; preserve remaining quantity',()=>{
  const e=new Exchange('korbit'),o=e.normalizeOrder({orderId:'9007199254740999',qty:'10',filledQty:'4',filledAmt:'400',price:'100',status:'filled',side:'buy'},'BTC','100');assert.equal(o.remaining,'6');assert.equal(o.filled,'4');assert.ok(terminal(o.status));assert.equal(o.id,'9007199254740999');
});
test('Korbit and Bitget order payloads use correct units, isolated and reduce-only',async()=>{
  for(const name of ['korbit','bitget']) {
    const e=new Exchange(name);let sent;e.call=async(...args)=>(sent=args,{orderId:'1'});
    await e.place('BTC',{side:'sell',price:'100',qty:'.1',timeInForce:'gtc',reduceOnly:true},'abc');
    assert.equal(sent[1].qty,'.1');assert.equal(sent[2],'POST');
    if(name==='bitget'){assert.equal(sent[0],'/api/v3/trade/place-order');assert.equal(sent[1].marginMode,'isolated');assert.equal(sent[1].reduceOnly,'yes');}
    else {assert.equal(sent[0],'/v2/orders');assert.equal(sent[1].symbol,'btc_krw');assert.equal(sent[1].clientOrderId,'abc');}
  }
});
test('durable order journal survives restart; serialized tasks do not overlap',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'coin-trading-test-')),'test.sqlite');let s=new Store(path);s.put('orders','a',{status:'SUBMITTING'});s.close();s=new Store(path);assert.equal(s.get('orders','a').status,'SUBMITTING');
  const c=new Controller(s);const events=[];await Promise.all([c.serial(async()=>{events.push(1);await Promise.resolve();events.push(2);}),c.serial(async()=>events.push(3))]);assert.deepEqual(events,[1,2,3]);s.close();
});
test('ambiguous placement is journaled before POST and is never automatically retried',async()=>{
  const s=new Store(':memory:'),calls=[];s.put('limits','bitget',input().limits);
  const e={exchange:'bitget',snapshot:async()=>snapshot(),place:async()=>{calls.push(s.all('orders').some(o=>o.status==='SUBMITTING'));throw Error('timeout');},order:async()=>{throw Error('not found yet');}};
  const c=new Controller((s.put('automation','bitget',{on:true}),s),{env:{TRADING_ENABLED:'true',BITGET_DEMO:'true'},clock:()=>now});
  const plan=makePlan(input());await assert.rejects(c.submit(e,plan,{}));assert.deepEqual(calls,[true]);assert.equal(c.activeOrders('bitget').length,1);await assert.rejects(c.reconcile(e));assert.equal(calls.length,1);s.close();
});
test('cancel ACK is not terminal; a replacement waits until exchange cancellation is confirmed',async()=>{
  const s=new Store(':memory:');s.put('orders','a',{exchange:'korbit',coin:'BTC',clientId:'a',status:'open'});let cancels=0;
  const c=new Controller(s),e={exchange:'korbit',order:async()=>({status:'partiallyFilled',filled:'1',id:'1'}),cancel:async()=>{cancels++;return {};}};
  await assert.rejects(c.reconcile(e,'BTC',true),/취소 확정/);assert.equal(cancels,1);assert.equal(s.get('orders','a').filled,'1');s.close();
});
test('activation requires explicit server enablement and an unused unexpired preview',async()=>{
  const s=new Store(':memory:'),q={...makePlan(input()),id:'quote',limits:input().limits};s.put('quotes',q.id,q);
  let c=new Controller(s,{env:{},clock:()=>now});await assert.rejects(c.arm(q.id),/꺼져/);
  c=new Controller((s.put('automation','bitget',{on:true}),s),{env:{TRADING_ENABLED:'true',BITGET_DEMO:'true'},clock:()=>now});s.put('quotes',q.id,{...q,connectionId:c.assertConnection('bitget')});await c.arm(q.id);await assert.rejects(c.arm(q.id),/이미/);s.close();
});
test('HMAC sessions reject modifications, expiry, missing/weak secrets',()=>{
  const secret='s'.repeat(32),token=session(secret,now);assert.ok(authenticated(token,secret,now));assert.ok(!authenticated(token+'x',secret,now));assert.ok(!authenticated(token,secret,now+1800001));assert.ok(!authenticated(token,'weak',now));
});
test('private API has no live path when unconfigured and rejects cross-origin calls',async()=>{
  const keys=['TRADE_GATEWAY_URL','TRADE_GATEWAY_TOKEN','TRADE_OPERATOR_TOKEN','TRADING_ALLOWED_ORIGIN'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(x){this.body=x;return this;}});
  try {for(const k of keys)delete process.env[k];let r=res();await handler({method:'POST',headers:{},body:{action:'arm'}},r);assert.equal(r.code,503);
    Object.assign(process.env,{TRADE_GATEWAY_URL:'https://example.com',TRADE_GATEWAY_TOKEN:'a'.repeat(32),TRADE_OPERATOR_TOKEN:'b'.repeat(32),TRADING_ALLOWED_ORIGIN:'https://app.example'});
    r=res();await handler({method:'POST',headers:{origin:'https://evil.example','x-trading-ui':'1'},body:{action:'login'}},r);assert.equal(r.code,403);assert.match(r.headers['Cache-Control'],/no-store/);
  } finally {for(const k of keys)saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];}
});
test('MACD 5 above-zero golden is 2x; closed data is mandatory',()=>{
  const a={target:.5,armed:true,active:false};const b=nextState(a,{line:1,signal:.5,histogram:.5,rsi:50},{line:1,histogram:-.1},5);assert.equal(b.target,2);
  assert.throws(()=>decide([],5),/400/);
});

test('MACD 5 use all four regimes regardless of first-cross history',()=>{
  for(const n of [5])for(const armed of [true,false])for(const active of [true,false]){
    const targets=[2,.5,.5,-2];
    [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([line,histogram],i)=>{
      const r={line,histogram,signal:line-histogram,rsi:50};
      assert.equal(nextState({target:0,armed,active},r,r,n).target,targets[i]);
    });
  }
  assert.throws(()=>selection('bitget','BTC',6));
  assert.throws(()=>prepare([],6),/지원하지/);
  for(const n of [4,5,6])assert.throws(()=>selection('korbit','BTC',n));
  assert.throws(()=>selection('bitget','BTC',7));
});

test('MACD 5 short 2x obeys both gross caps and closes long before reversal',()=>{
  for(const strategy of [5]){
    const config={...input(),strategy,decision:{kind:'CONFIRMED',target:-2}};
    const p=makePlan(config);assert.equal(p.budget,'2500');assert.equal(p.targetQty,'-50');
    assert.equal(p.orders.length,5);assert.ok(p.orders.every(o=>o.side==='sell'&&!o.reduceOnly));
    assert.ok(p.orders.reduce((s,o)=>s.add(D(o.qty).mul(o.price).mul('1.005')),D(0)).lte(5000));
    const s=snapshot();s.positions=[{coin:'BTC',qty:'10',price:'100'}];
    const exit=makePlan({...config,snapshot:s});assert.equal(exit.phase,'CLOSE_BEFORE_REVERSE');assert.ok(exit.orders.every(o=>o.reduceOnly&&o.side==='sell'));
    s.positions=[{coin:'ETH',qty:'100',price:'100'}];assert.equal(makePlan({...config,snapshot:s}).orders.length,0);
  }
});


test('D5 predictions use matured history only and optimized latest matches full research',()=>{
  const candles=Array.from({length:450},(_,i)=>{const close=100+Math.sin(i/9)*8+i*.01;return {timestamp:now-(450-i)*DAY,open:close,high:close+2,low:close-2,close,volume:10};});
  const full=prepare(candles,5),fast=prepare(candles,5,{latestOnly:true});assert.deepEqual(fast.predictions.at(-1),full.predictions.at(-1));
  const prefix=prepare(candles.slice(0,-20),5);assert.deepEqual(prefix.predictions.at(-1),full.predictions.at(-21));
  const d=decide(candles,5,{now});assert.ok(['WAIT','PRE','CONFIRMED'].includes(d.kind));if(d.kind==='PRE'){assert.ok(d.probability>=.8);assert.ok(d.sample>=30);assert.ok(d.day<=5);}
});
test('D-5 to D-1 cancels confirmed remainder, keeps equal ladder, and D0 uses only residual IOC',async()=>{
  const s=new Store(':memory:');s.put('limits','bitget',{total:'10000',symbols:{BTC:'5000'}});
  let t=now,q=D(0),cash=D(10000),next={kind:'PRE',target:1,anchor:100,adr:5,bar:now-DAY,event:'GOLDEN:1'},counter=0;
  const remote=new Map(),history=[];
  const fill=o=>{if(o.status==='filled')return;o.filled=o.qty;o.remaining='0';o.status='filled';const change=D(o.qty).mul(o.side==='buy'?1:-1);q=q.add(change);cash=cash.sub(change.mul(100));};
  const e={exchange:'bitget',snapshot:async()=>({...snapshot(),at:t,positions:q.isZero()?[]:[{coin:'BTC',qty:q.toFixed(),price:'100'}],available:cash.toFixed(),equity:cash.add(q.mul(100)).toFixed(),pending:[...remote.values()].filter(o=>!terminal(o.status)).map(o=>({...o,reservePrice:o.price}))}),order:async(_,cid)=>({...remote.get(cid)}),cancel:async(_,cid)=>{remote.get(cid).status='cancelled';},place:async(_,o,cid)=>{const r={...o,clientId:cid,id:String(++counter),coin:'BTC',status:'live',filled:'0',remaining:o.qty};remote.set(cid,r);history.push(r);if(o.timeInForce==='ioc')fill(r);return {orderId:r.id};}};
  const c=new Controller((s.put('automation','bitget',{on:true}),s),{env:{TRADING_ENABLED:'true',BITGET_DEMO:'true'},exchangeFactory:()=>e,clock:()=>t,decisionFactory:()=>next});c.candles=async()=>[];
  const campaign={exchange:'bitget',coin:'BTC',strategy:3,status:'ARMED',initial:true};s.put('campaigns','bitget:BTC',campaign);
  await c.tick();assert.equal(history.length,5);fill(history[0]);fill(history[1]);const held=q;
  for(let d=1;d<5;d++){t+=DAY;next={...next,bar:next.bar+DAY};await c.tick();const last=history.slice(-5);assert.ok(last.every(o=>o.timeInForce==='gtc'));const gap=D(last[1].price).sub(last[0].price);for(let i=2;i<5;i++)assert.ok(D(last[i].price).sub(last[i-1].price).eq(gap));assert.ok(q.eq(held));}
  assert.ok(history.slice(2,5).every(o=>o.status==='cancelled'));
  t+=DAY;next={...next,bar:next.bar+DAY,kind:'CONFIRMED'};await c.tick();assert.ok(history.slice(-5).every(o=>o.timeInForce==='ioc'));assert.ok(q.gt(held));assert.ok(q.mul(100).lte(5000));
  const state=s.get('campaigns','bitget:BTC');assert.equal(state.lastDecision.kind,'CONFIRMED');s.close();
});
test('every order is checked against changed external positions before sending next split',async()=>{
  const s=new Store(':memory:');s.put('limits','bitget',input().limits);let placed=0;
  const e={exchange:'bitget',snapshot:async()=>({...snapshot(),positions:placed?[{coin:'ETH',qty:'100',price:'100'}]:[]}),order:async()=>({status:'filled',filled:'1',remaining:'0'}),place:async()=>{placed++;return {orderId:'1'};}};
  const c=new Controller((s.put('automation','bitget',{on:true}),s),{env:{TRADING_ENABLED:'true',BITGET_DEMO:'true'},clock:()=>now});await assert.rejects(c.submit(e,makePlan(input()),{}),/한도 초과/);assert.equal(placed,1);s.close();
});
test('switching demo/live or API accounts cannot resume a previously armed campaign',()=>{
  const s=new Store(':memory:'),env={BITGET_DEMO:'true',BITGET_API_KEY:'demo-key'},c=new Controller(s,{env});c.assertConnection('bitget');s.put('campaigns','bitget:BTC',{exchange:'bitget',coin:'BTC',status:'ARMED'});
  env.BITGET_DEMO='false';env.BITGET_API_KEY='live-key';assert.throws(()=>c.assertConnection('bitget'),/변경/);env.BITGET_DEMO='true';env.BITGET_API_KEY='demo-key';assert.doesNotThrow(()=>c.assertConnection('bitget'));s.close();
});
