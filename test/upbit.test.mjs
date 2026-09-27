import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {UpbitExchange,signedUpbitRequest,KRW_TICKS} from '../server/upbit.mjs';
import {Exchange,terminal} from '../server/exchanges.mjs';
import {selection,makePlan,DAY,usage} from '../trading/policy.mjs';
import {Store} from '../server/store.mjs';
import {Controller} from '../server/controller.mjs';

test('Upbit HS512 JWT hashes the exact unescaped query including arrays and uses fresh nonce',()=>{
 const key={key:'test-access',secret:'raw-not-base64-secret'},params={market:'KRW-BTC','states[]':['wait','watch']};
 const r=signedUpbitRequest('GET','/v1/orders/open',params,key,'fixed-nonce');
 const [h,p,s]=r.init.headers.Authorization.slice(7).split('.'),payload=JSON.parse(Buffer.from(p,'base64url'));
 assert.equal(JSON.parse(Buffer.from(h,'base64url')).alg,'HS512');assert.equal(payload.nonce,'fixed-nonce');
 assert.equal(payload.query_hash,createHash('sha512').update('market=KRW-BTC&states[]=wait&states[]=watch').digest('hex'));
 assert.equal(s,createHmac('sha512',key.secret).update(h+'.'+p).digest('base64url'));
 assert.deepEqual(new URL(r.url).searchParams.getAll('states[]'),['wait','watch']);
 assert.notEqual(signedUpbitRequest('GET','/v1/accounts',{},key).init.headers.Authorization,signedUpbitRequest('GET','/v1/accounts',{},key).init.headers.Authorization);
 const post=signedUpbitRequest('POST','/v1/orders',{market:'KRW-BTC',volume:'0.001'},key,'n');
 const b=JSON.parse(Buffer.from(post.init.headers.Authorization.split('.')[1],'base64url'));
 assert.equal(b.query_hash,createHash('sha512').update('market=KRW-BTC&volume=0.001').digest('hex'));assert.equal(new URL(post.url).search,'');
});
test('Upbit selection is KRW spot and cannot use leverage/short strategies',()=>{
 assert.equal(selection('upbit','BTC',3).symbol,'KRW-BTC');assert.throws(()=>selection('upbit','BTC',4));assert.ok(new Exchange('upbit') instanceof UpbitExchange);
 const now=Date.now(),input={exchange:'upbit',coin:'BTC',strategy:3,limits:{total:'1000000',symbols:{BTC:'500000'}},snapshot:{at:now,price:'100000',equity:'1000000',available:'1000000',positions:[],pending:[]},meta:{ticks:KRW_TICKS,qtyStep:'0.00000001',minNotional:'5000'},decision:{kind:'INITIAL',target:1,anchor:100000,adr:1000},now};
 const p=makePlan(input);assert.equal(p.currency,'KRW');assert.equal(p.orders.length,5);
 assert.throws(()=>makePlan({...input,decision:{...input.decision,target:-1}}),/현물/);
 assert.throws(()=>makePlan({...input,decision:{...input.decision,target:2}}),/현물/);
});
test('Upbit order payload maps IOC and GTC, identifiers, and partially cancelled fills correctly',async()=>{
 const e=new UpbitExchange(),calls=[];e.call=async(...args)=>{calls.push(args);return {uuid:'order-id'};};
 const o={side:'buy',qty:'0.001',price:'100000000',timeInForce:'ioc',reduceOnly:false};
 assert.deepEqual(await e.place('BTC',o,'unique-id'),{orderId:'order-id'});
 assert.deepEqual(calls[0][1],{market:'KRW-BTC',side:'bid',volume:'0.001',price:'100000000',ord_type:'limit',identifier:'unique-id',time_in_force:'ioc',smp_type:'cancel_taker'});
 await e.place('BTC',{...o,side:'sell',reduceOnly:true,timeInForce:'gtc'},'another');assert.equal(calls[1][1].side,'ask');assert.equal(calls[1][1].time_in_force,undefined);
 await assert.rejects(e.place('BTC',{...o,side:'sell'},'bad'),/현물/);
 const normalized=e.normalizeOrder({uuid:'x',identifier:'id',state:'cancel',side:'bid',volume:'2',executed_volume:'1',remaining_volume:'1',price:'100',trades:[{funds:'100'}]},'BTC','101');
 assert.equal(normalized.remaining,'1');assert.equal(normalized.filled,'1');assert.equal(normalized.filledValue,'100');assert.equal(normalized.status,'canceled');assert.ok(terminal(normalized.status));
});
test('Upbit candles use UTC candle start, exclude incomplete days and paginate using exclusive end',async()=>{
 const e=new UpbitExchange(),start=Math.floor(Date.now()/DAY)*DAY,rows=[start-DAY,start];let sent;
 e.call=async(path,p)=>{sent={path,p};return rows.map(t=>({candle_date_time_utc:new Date(t).toISOString().slice(0,19),opening_price:100,high_price:110,low_price:90,trade_price:105,candle_acc_trade_volume:1}));};
 const result=await e.candlePage('BTC',start);assert.equal(result.length,1);assert.equal(result[0].timestamp,start-DAY);assert.equal(sent.p.to,new Date(start).toISOString());
});
test('Upbit totals include locked balances and all pending orders without double counting locked cash',async()=>{
 const e=new UpbitExchange();e.market=async()=>({exchange:'upbit',coin:'BTC',symbol:'KRW-BTC',at:Date.now(),price:'100',meta:{ticks:KRW_TICKS}});
 const chance={bid_fee:'.0005',ask_fee:'.0005',market:{state:'active',bid_types:['limit','limit_ioc'],ask_types:['limit','limit_ioc'],bid:{min_total:'5000'},ask:{min_total:'5000'},max_total:'1000000000'}};
 e.call=async(path)=>{
  if(path==='/v1/accounts')return [{currency:'KRW',balance:'10000',locked:'105'},{currency:'BTC',balance:'1',locked:'1'}];
  if(path==='/v1/orders/chance')return chance;
  if(path==='/v1/ticker')return [{market:'KRW-BTC',trade_price:100}];
  if(path==='/v1/orders/open')return [{uuid:'o',identifier:'i',market:'KRW-ETH',state:'wait',side:'bid',remaining_volume:'1',executed_volume:'0',price:'100'}];
  throw Error(path);
 };
 const s=await e.snapshot('BTC');assert.equal(s.available,'10000');assert.equal(s.equity,'10305');assert.equal(s.positions[0].available,'1');assert.equal(usage(s).total.toFixed(),'305');
 chance.market.bid_types=['limit'];await assert.rejects(e.snapshot('BTC'),/IOC/);
});
test('Upbit live gate is independent of Bitget demo; readiness never exposes API keys',()=>{
 const s=new Store(':memory:');try{
  const env={TRADING_ENABLED:'true',BITGET_DEMO:'true',UPBIT_API_KEY:'secret-key',UPBIT_API_SECRET:'secret-value'},c=new Controller(s,{env});
  assert.equal(c.serverEnabled('upbit'),false);assert.equal(c.serverEnabled('bitget'),true);
  env.UPBIT_LIVE_ENABLED='true';assert.equal(c.serverEnabled('upbit'),true);assert.equal(c.enabled('upbit'),false);
  assert.equal(c.readiness('upbit').credentialsConfigured,true);assert.equal(JSON.stringify(c.status('upbit')).includes('secret-'),false);
 }finally{s.close();}
});
test('Upbit rejects ambiguous writes once; missing credentials never reach the network',async()=>{
 let calls=0;const e=new UpbitExchange({env:{UPBIT_API_KEY:'k',UPBIT_API_SECRET:'s'},fetcher:async()=>{calls++;throw Error('timeout');}});
 await assert.rejects(e.place('BTC',{side:'buy',qty:'1',price:'10000',timeInForce:'ioc'},'unique'),/timeout/);assert.equal(calls,1);
 e.env={};await assert.rejects(e.call('/v1/accounts',{},'GET',true),/API 키/);assert.equal(calls,1);
});
