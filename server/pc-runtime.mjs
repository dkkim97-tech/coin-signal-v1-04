import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
import {Controller} from './controller.mjs';
import {sameSecret, session, authenticated} from '../api/trading.js';
import {selection} from '../trading/policy.mjs';
import exchangeApi from '../api/exchange.js';
import candlesApi from '../api/candles.js';
import marketApi from '../api/market-context.js';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.md':'text/plain'};
export function createPcRuntime({env=process.env,store=new Store(resolve(root,'server/data/pc-trading.sqlite')),clock=Date.now,exchangeFactory}={}) {
  if(!env.TRADE_OPERATOR_TOKEN||env.TRADE_OPERATOR_TOKEN.length<32)throw Error('PC 설정 파일의 관리자 토큰이 필요합니다.');
  // Sessions never survive a process restart; configured credentials never reach the browser.
  const sessionSecret=randomBytes(32).toString('hex');
  let lastHeartbeat=clock(),suspended=false,closing=false,timer,origin,ticking=false;
  const controller=new Controller(store,{env,clock,...(exchangeFactory?{exchangeFactory}:{})});
  const baseEnabled=controller.serverEnabled.bind(controller);
  controller.serverEnabled=e=>!closing&&!suspended&&clock()-lastHeartbeat<60000&&baseEnabled(e);
  function disarm(reason) {
    store.put('automation','bitget',{on:false,at:clock()});
    for(const c of store.all('campaigns').filter(c=>c.exchange==='bitget'&&c.status!=='STOPPED'))store.put('campaigns','bitget:'+c.coin,{...c,status:'STOPPING'});
    store.put('runtime','pc',{reason,at:clock()});
  }
  disarm('PC 시작: 자동매매 OFF. 이전 미체결 확인 후 직접 다시 시작하세요.');
  function heartbeat(){
    if(clock()-lastHeartbeat>60000){suspended=true;disarm('절전 또는 실행 지연 감지: 자동매매 OFF. 상태를 확인하고 다시 ON 하세요.');}
    lastHeartbeat=clock();
  }
  const server=http.createServer(async(req,res)=>{
    const send=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    if(req.headers.host!==new URL(origin).host)return send(403,{error:'이 PC의 127.0.0.1 주소로 접속하세요.'});
    if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'다른 사이트에서 PC 서버에 접근할 수 없습니다.'});
    try {
      const url=new URL(req.url,origin);
      if(url.pathname==='/api/trading'){
        if(req.method==='GET')return send(200,{configured:true,localPc:true,message:'PC 실행 중 · 이 PC에서만 접속 가능 · 시작 시 자동매매 OFF'});
        if(req.method!=='POST')return send(405,{error:'POST only'});
        if(req.headers.origin!==origin||req.headers['x-trading-ui']!=='1'||!String(req.headers['content-type']).startsWith('application/json'))return send(403,{error:'PC 화면에서 요청하세요.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(413,{error:'요청 크기 초과'});}
        const b=JSON.parse(raw||'{}');
        if(b.action==='login'){
          if(!sameSecret(b.token,env.TRADE_OPERATOR_TOKEN))return send(401,{error:'관리자 접속 토큰을 확인하세요.'});
          res.setHeader('Set-Cookie','pc_session='+session(sessionSecret)+'; HttpOnly; SameSite=Strict; Path=/api/trading; Max-Age=1800');return send(200,{authenticated:true});
        }
        if(b.action==='logout'){res.setHeader('Set-Cookie','pc_session=; HttpOnly; SameSite=Strict; Path=/api/trading; Max-Age=0');return send(200,{authenticated:false});}
        const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pc_session='))?.slice(11)||'';
        if(!authenticated(token,sessionSecret,clock()))return send(401,{error:'관리자 접속이 필요합니다.'});
        if(b.exchange!=='bitget')return send(400,{error:'PC 실행기는 비트겟 선물 전용입니다.'});
        if(!['status','preview','arm','stop','limits','automation','shutdown'].includes(b.action))return send(400,{error:'지원하지 않는 명령'});
        selection('bitget',b.coin||'BTC',Number(b.strategy||1));
        if(b.action==='shutdown'){closing=true;disarm('사용자 종료 요청: 앱 미체결 취소 확인 중');}
        const result=await controller.serial(async()=>{
          switch(b.action){
            case 'status':return {...controller.status('bitget'),localPc:true,pc:store.get('runtime','pc')};
            case 'preview':return controller.preview(b);
            case 'arm':if(store.get('quotes',b.quoteId)?.exchange!=='bitget')throw Error('비트겟 미리보기가 필요합니다.');return controller.arm(b.quoteId);
            case 'stop':return controller.stop('bitget',b.coin);
            case 'limits':return controller.updateLimits('bitget',b.limits);
            case 'automation':if(b.on===true&&!closing){suspended=false;lastHeartbeat=clock();}return controller.automation('bitget',b.on);
            case 'shutdown':await controller.automation('bitget',false);return {stopped:true,message:'앱 미체결 취소 확인 완료. PC 실행기를 종료합니다. 보유 포지션은 유지됩니다.'};
          }
        });
        send(200,result);
        if(b.action==='shutdown'){clearInterval(timer);server.close(()=>store.close());}
        return;
      }
      if(req.method!=='GET')return send(405,{error:'GET only'});
      const api={'/api/exchange':exchangeApi,'/api/candles':candlesApi,'/api/market-context':marketApi}[url.pathname];
      if(api){req.query=Object.fromEntries(url.searchParams);res.status=c=>{res.statusCode=c;return res;};res.json=data=>send(res.statusCode,data);return await api(req,res);}
      let path=decodeURIComponent(url.pathname).replace(/^\/futures(?=\/|$)/,'')||'/';
      if(path==='/'||path==='/pc/')path='/pc/index.html';
      const ext=extname(path),file=resolve(root,'.'+path);
      const allowed=/^\/[^/]+\.(html|js)$/.test(path)||/^\/(pc|trading|position)\/[\w/.-]+\.(html|js|mjs|css|json)$/.test(path)||path==='/docs/auto-trading-setup.md';
      if(!allowed||path.split('/').some(p=>p.startsWith('.'))||!file.startsWith(root+sep))return send(404,{error:'Not found'});
      res.setHeader('Content-Type',(types[ext]||'text/plain')+'; charset=utf-8');res.end(await readFile(file));
    }catch(e){send(400,{error:e.code==='ENOENT'?'파일을 찾지 못했습니다.':e.message});}
  });
  return {server,controller,heartbeat,async listen(port=4187){
    await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
    origin='http://127.0.0.1:'+server.address().port;
    timer=setInterval(()=>{heartbeat();if(ticking||closing)return;ticking=true;controller.serial(()=>controller.tick()).catch(()=>{}).finally(()=>{ticking=false;});},15000);
    return origin;
  },async close(){clearInterval(timer);closing=true;disarm('PC 실행기 종료');await controller.queue;await new Promise(r=>server.close(r));store.close();}};
}
