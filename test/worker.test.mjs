import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

test('durable worker starts with health and authenticated OFF status; rejects unauthenticated commands',async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const folder=await mkdtemp(join(tmpdir(),'coin-worker-test-')),token=randomBytes(32).toString('hex');
 const child=spawn(process.execPath,['server/main.mjs'],{cwd:new URL('../',import.meta.url),windowsHide:true,env:{...process.env,TRADING_PORT:String(port),TRADING_HOST:'127.0.0.1',TRADING_ENABLED:'false',UPBIT_LIVE_ENABLED:'false',BITGET_LIVE_ENABLED:'false',TRADE_GATEWAY_TOKEN:token,TRADING_DATA_PATH:join(folder,'ledger.sqlite')}});
 const exited=new Promise(r=>child.once('exit',r));let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{
  await new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(output.includes('Trading worker listening')){clearInterval(timer);resolve();}else if(++attempts>100||child.exitCode!==null){clearInterval(timer);reject(Error('Worker failed to start'));}},50);});
  const url='http://127.0.0.1:'+port;
  assert.equal((await fetch(url+'/healthz')).status,200);
  assert.equal((await fetch(url+'/command',{method:'POST',body:'{}'})).status,401);
  const response=await fetch(url+'/command',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'status',exchange:'upbit'})});
  const status=await response.json();assert.equal(response.status,200);assert.equal(status.enabled,false);assert.equal(status.automationOn,false);assert.equal(status.worker.intervalMs,15000);assert.ok(status.worker.startedAt>0);assert.equal(output.includes(token),false);
 }finally{child.kill();await exited;await rm(folder,{recursive:true,force:true});}
});
