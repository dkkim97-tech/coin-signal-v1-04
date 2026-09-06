import http from 'node:http';
import {resolve} from 'node:path';
import {Store} from './store.mjs';
import {Controller} from './controller.mjs';
import {sameSecret} from '../api/trading.js';
import {selection} from '../trading/policy.mjs';
const env=process.env;
if(!env.TRADE_GATEWAY_TOKEN||env.TRADE_GATEWAY_TOKEN.length<32)throw Error('TRADE_GATEWAY_TOKEN must have at least 32 characters');
const store=new Store(resolve(env.TRADING_DATA_PATH||'server/data/trading.sqlite')),controller=new Controller(store);
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  const send=(code,data)=>{res.statusCode=code;res.end(JSON.stringify(data));};
  if(req.url!=='/command'||req.method!=='POST')return send(404,{error:'Not found'});
  if(!sameSecret(req.headers.authorization,'Bearer '+env.TRADE_GATEWAY_TOKEN))return send(401,{error:'Unauthorized'});
  try {
    let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw Error('Request too large');}
    const b=JSON.parse(text);if(b.action!=='arm')selection(b.exchange,b.coin||'BTC',Number(b.strategy||1));
    const result=await controller.serial(async()=>{
      switch(b.action) {
        case 'status':return controller.status(b.exchange);
        case 'automation':return controller.automation(b.exchange,b.on);
        case 'preview':return controller.preview(b);
        case 'arm':return controller.arm(b.quoteId);
        case 'stop':return controller.stop(b.exchange,b.coin);
        case 'limits':return controller.updateLimits(b.exchange,b.limits);
        default:throw Error('Unknown action');
      }
    });send(200,result);
  }catch(e){send(400,{error:e.message});}
});
server.listen(Number(env.TRADING_PORT||4190),env.TRADING_HOST||'127.0.0.1',()=>console.log('Trading worker listening; live enabled:',env.TRADING_ENABLED==='true'));
// Single durable worker; the SQLite exclusive lock prevents two processes on one ledger.
let ticking=false;
const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await controller.serial(()=>controller.tick());}finally{ticking=false;}},15000);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{clearInterval(timer);server.close(()=>{store.close();process.exit(0);});});
