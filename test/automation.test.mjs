import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {Controller} from '../server/controller.mjs';

test('automation defaults OFF, cannot bypass server gate, and is exchange-specific',async()=>{
 const store=new Store(':memory:');
 try{
  const env={TRADING_ENABLED:'true',BITGET_DEMO:'true'},c=new Controller(store,{env});
  assert.equal(c.enabled('korbit'),false);
  await c.automation('korbit',true);assert.equal(c.enabled('korbit'),true);assert.equal(c.enabled('bitget'),false);
  assert.equal(new Controller(store,{env}).enabled('korbit'),true);
  env.TRADING_ENABLED='false';assert.equal(c.enabled('korbit'),false);
  await assert.rejects(c.automation('bitget',true),/꺼져/);
  await assert.rejects(c.automation('korbit','true'),/값/);
 }finally{store.close();}
});

test('OFF persists before cancellation, retries failures, and ON never restarts stopped campaigns',async()=>{
 const store=new Store(':memory:');let fail=true,cancels=0,placements=0;
 const env={TRADING_ENABLED:'true',BITGET_DEMO:'true'};
 const remote={status:'live',filled:'1',remaining:'1',id:'order'};
 const exchange={exchange:'bitget',order:async()=>{assert.equal(store.get('automation','bitget').on,false);return {...remote};},cancel:async()=>{cancels++;if(fail)throw Error('offline');remote.status='cancelled';},place:async()=>{placements++;}};
 const c=new Controller(store,{env,exchangeFactory:()=>exchange});
 try{
  await c.automation('bitget',true);
  store.put('campaigns','bitget:BTC',{exchange:'bitget',coin:'BTC',strategy:5,status:'RUNNING'});
  store.put('orders','client',{exchange:'bitget',coin:'BTC',clientId:'client',status:'live'});
  await assert.rejects(c.automation('bitget',false),/취소/);
  assert.equal(c.enabled('bitget'),false);assert.equal(store.get('campaigns','bitget:BTC').status,'STOPPING');
  await assert.rejects(c.automation('bitget',true),/취소/);
  fail=false;await c.tick();assert.equal(store.get('campaigns','bitget:BTC').status,'STOPPED');
  await c.automation('bitget',true);await c.tick();assert.equal(placements,0);assert.equal(cancels,2);
  await c.automation('bitget',false);assert.equal(c.status('bitget').automationOn,false);
 }finally{store.close();}
});

test('OFF blocks order submission even if server execution remains enabled',async()=>{
 const store=new Store(':memory:');try{
  const c=new Controller(store,{env:{TRADING_ENABLED:'true'}});
  await assert.rejects(c.submit({exchange:'korbit'},{orders:[]},{}),/중지/);
  assert.equal(store.all('orders').length,0);
 }finally{store.close();}
});
