import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {Store} from '../server/store.mjs';
import {createPcRuntime} from '../server/pc-runtime.mjs';
const env={TRADE_OPERATOR_TOKEN:'a'.repeat(64),TRADING_ENABLED:'true',BITGET_DEMO:'true',BITGET_API_KEY:'fake',BITGET_API_SECRET:'fake',BITGET_PASSPHRASE:'fake'};

test('PC startup and sleep disarm campaigns; runtime blocks orders before heartbeat recovery',async()=>{
 const store=new Store(':memory:');let now=Date.now();
 store.put('automation','bitget',{on:true});store.put('campaigns','bitget:BTC',{exchange:'bitget',coin:'BTC',strategy:1,status:'RUNNING'});
 const runtime=createPcRuntime({env,store,clock:()=>now});await runtime.listen(0);
 try{
  assert.equal(runtime.controller.enabled('bitget'),false);assert.equal(store.get('campaigns','bitget:BTC').status,'STOPPING');
  store.put('automation','bitget',{on:true});assert.equal(runtime.controller.enabled('bitget'),true);
  now+=61000;assert.equal(runtime.controller.enabled('bitget'),false);
  runtime.heartbeat();assert.equal(store.get('automation','bitget').on,false);assert.equal(runtime.controller.serverEnabled('bitget'),false);
 }finally{await runtime.close();}
});

test('PC server binds loopback, denies private files, foreign origins and unauthenticated commands',async()=>{
 const runtime=createPcRuntime({env,store:new Store(':memory:')});const origin=await runtime.listen(0);
 const post=(body,extra={},cookie='')=>fetch(origin+'/api/trading',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Trading-UI':'1',Cookie:cookie,...extra},body:JSON.stringify(body)});
 try{
  assert.equal(runtime.server.address().address,'127.0.0.1');
  for(const path of ['/.env.pc','/server/store.mjs','/deploy/.env','/server/data/pc-trading.sqlite','/pc/%2e%2e/server/store.mjs'])assert.equal((await fetch(origin+path)).status,404);
  assert.equal((await fetch(origin+'/pc/')).status,200);
  assert.equal((await post({action:'status',exchange:'bitget'})).status,401);
  assert.equal((await post({action:'login',token:env.TRADE_OPERATOR_TOKEN},{Origin:'https://evil.example'})).status,403);
  const hostileHost=await new Promise((ok,fail)=>{const req=request(origin+'/api/trading',{headers:{Host:'evil.example'}},res=>{res.resume();ok(res.statusCode);});req.on('error',fail);req.end();});assert.equal(hostileHost,403);
  const login=await post({action:'login',token:env.TRADE_OPERATOR_TOKEN});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const state=await post({action:'status',exchange:'bitget'}, {},cookie);const value=await state.json();assert.equal(value.localPc,true);assert.equal(value.automationOn,false);assert.ok(!JSON.stringify(value).includes(env.TRADE_OPERATOR_TOKEN));
  assert.equal((await post({action:'automation',exchange:'upbit',on:true},{},cookie)).status,400);
 }finally{await runtime.close();}
});

test('failed cancellation on PC shutdown keeps OFF persisted and server available for retry',async()=>{
 const store=new Store(':memory:');const runtime=createPcRuntime({env,store,exchangeFactory:()=>({exchange:'bitget',order:async()=>{throw Error('offline');}})});const origin=await runtime.listen(0);
 const post=(body,cookie='')=>fetch(origin+'/api/trading',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Trading-UI':'1',Cookie:cookie},body:JSON.stringify(body)});
 try{
  runtime.controller.assertConnection('bitget');store.put('automation','bitget',{on:true});store.put('orders','abc',{exchange:'bitget',coin:'BTC',clientId:'abc',status:'ACK'});
  const login=await post({action:'login',token:env.TRADE_OPERATOR_TOKEN});const cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await post({action:'shutdown',exchange:'bitget'},cookie);assert.equal(response.status,400);assert.equal(store.get('automation','bitget').on,false);assert.equal(runtime.controller.enabled('bitget'),false);assert.equal((await fetch(origin+'/api/trading')).status,200);
 }finally{await runtime.close();}
});

test('authenticated shutdown finishes only after cancellation and closes the listener',async()=>{
 const runtime=createPcRuntime({env,store:new Store(':memory:')});const origin=await runtime.listen(0);
 const post=(body,cookie='')=>fetch(origin+'/api/trading',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Trading-UI':'1',Cookie:cookie},body:JSON.stringify(body)});
 const login=await post({action:'login',token:env.TRADE_OPERATOR_TOKEN});const cookie=login.headers.get('set-cookie').split(';')[0];
 const closed=new Promise(r=>runtime.server.once('close',r));
 const response=await post({action:'shutdown',exchange:'bitget'},cookie);assert.equal(response.status,200);assert.equal((await response.json()).stopped,true);await closed;assert.equal(runtime.server.listening,false);
});
