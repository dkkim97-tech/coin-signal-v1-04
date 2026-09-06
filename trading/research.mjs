import {indicators,DAY,avg} from '../position/indicators.mjs';
import {settings} from '../position/config.mjs';
export const FEE=.0005,SLIP=.0008,COEFF=[.2,.5,.8,1.1,1.4];
export const value=(a,p)=>a.cash+a.q*p;
export function nextState(prev,r,prior,n){
 const state={...prev};if(!Number.isFinite(r.line)||!Number.isFinite(r.signal))return state;
 const zeroUp=Number.isFinite(prior?.line)&&prior.line<=0&&r.line>0,zeroDown=Number.isFinite(prior?.line)&&prior.line>=0&&r.line<0;
 const golden=Number.isFinite(prior?.histogram)&&prior.histogram<=0&&r.histogram>0,dead=Number.isFinite(prior?.histogram)&&prior.histogram>=0&&r.histogram<0;
 if(n===1){if(zeroUp&&r.rsi>30)state.target=.4;if(zeroDown)state.target=0;}
 else {
  if(zeroUp){state.armed=true;state.active=false;}if(zeroDown){state.armed=false;state.active=false;}
  if(golden&&r.line>0&&state.armed){state.active=true;state.armed=false;}if(dead)state.active=false;
  state.target=r.line>=0?(r.histogram>=0?1:.5):(r.histogram>=0?.5:n>=4?-1:0);
  if(n===5&&state.active&&r.line>0&&r.histogram>0)state.target=2;
 }
 state.event=state.target!==prev.target?`${zeroUp?'ZERO_UP':zeroDown?'ZERO_DOWN':golden?'GOLDEN':dead?'DEAD':'STATE'}:${state.target}`:null;
 return state;
}
export function prepare(candles,n,{latestOnly=false}={}){
 const s=settings({fast:n>=3?18:12,slow:n>=3?39:26});const rows=indicators(candles,s),states=[];
 let state={target:0,armed:false,active:false,event:null};
 for(let i=0;i<rows.length;i++){
  if(n!==1||rows[i].timestamp-candles[0].timestamp>=365*DAY)state=nextState(state,rows[i],rows[i-1],n);
  states.push({...state});
 }
 const projections=rows.map((r,i)=>{
  if(i<s.slow+s.signal||n===1&&r.timestamp-candles[0].timestamp<365*DAY)return null;
  let prior=r,st={...states[i]};
  for(let day=1;day<=5;day++){
   const fast=prior.fast+(r.close-prior.fast)*2/(s.fast+1),slow=prior.slow+(r.close-prior.slow)*2/(s.slow+1),line=fast-slow,signal=prior.signal+(line-prior.signal)*2/(s.signal+1);
   const future={...r,fast,slow,line,signal,histogram:line-signal};const ns=nextState(st,future,prior,n);
   if(ns.event)return {day,key:ns.event,target:ns.target};prior=future;st=ns;
  }return null;
 });
 const feature=(r,p)=>{const scale=r.atr||r.close*.01;return [r.line/scale,r.histogram/scale*3,(r.histogram-p.histogram)/scale*6,r.atr/r.close*10];};
 const features=rows.map((r,i)=>i?feature(r,rows[i-1]):[]);
 const predictions=rows.map((r,at)=>{
  if(latestOnly&&at!==rows.length-1)return null;
  const projection=projections[at];if(!projection||at<200)return null;
  const cases=[];
  for(let i=s.slow+s.signal;i+5<=at;i++){
   if(rows[i+5].timestamp-rows[i].timestamp!==5*DAY||!projections[i]||projections[i].key!==projection.key||states[i].target!==states[at].target)continue;
   if(n===5&&(states[i].armed!==states[at].armed||states[i].active!==states[at].active))continue;
   const distance=Math.sqrt(features[i].reduce((a,f,j)=>a+(f-features[at][j])**2,0));if(distance>1.5)continue;
   const hit=states.slice(i+1,i+6).some(x=>x.event===projection.key);cases.push({i,distance,hit});
  }
  cases.sort((a,b)=>a.distance-b.distance);const selected=[];
  for(const c of cases)if(selected.every(x=>Math.abs(x.i-c.i)>5)){selected.push(c);if(selected.length===250)break;}
  const sample=selected.length,success=selected.filter(x=>x.hit).length;
  return {...projection,sample,success,probability:sample?success/sample:null,eligible:sample>=30&&success/sample>=.8};
 });
 return {rows,states,predictions,n};
}
function fill(a,delta,price,time,kind,target){
 if(Math.abs(delta)<1e-12)return;
 const beforeQ=a.q,fee=Math.abs(delta)*price*FEE;a.cash-=delta*price+fee;a.q+=delta;if(Math.abs(a.q)<Number.EPSILON*16*Math.max(1,Math.abs(beforeQ),Math.abs(delta)))a.q=0;
 a.fills.push({time,delta,price,fee,kind,target,beforeQ,afterQ:a.q});
}
export function exactDelta(a,target,raw,price){const sign=target*value(a,raw)-a.q*raw>=0?1:-1;return (target*value(a,raw)-a.q*raw)/(raw+target*(price*(1+sign*FEE)-raw));}
export function market(a,target,raw,time,n,exact=false){
 const E=value(a,raw),change=target*E-a.q*raw;if(Math.abs(change)<1e-8)return;
 const sign=Math.sign(change),price=raw*(1+sign*SLIP);
 if(exact){const total=exactDelta(a,target,raw,price);for(let i=0;i<5;i++)fill(a,total/5,price,time,'COMPLETE',target);a.completions.push({time,target,actual:a.q*raw/value(a,raw)});}
 else if(n<=3){if(sign>0){const amount=Math.min(change,a.cash/(1+FEE));fill(a,amount/price,price,time,'BASE',target);}else fill(a,-Math.min(a.q,-change/raw),price,time,'BASE',target);}
 else fill(a,target*E/raw-a.q,price,time,'BASE',target);
}
function liquidate(a,p,time){if(value(a,p)>0)return false;a.cash=0;a.q=0;a.liquidated=true;a.liquidationTime=time;return true;}
export function intraday(a,c,orders){
 function path(points){const b={...a,fills:[...a.fills]};const waiting=orders.map(o=>({...o}));
  for(let k=0;k<points.length;k++){
   const p=points[k];if(k===0){if(liquidate(b,p,c.timestamp))return b;
    for(const o of waiting.filter(o=>o.sign>0?p<=o.limit:p>=o.limit))execute(o,p);
   }else{
    const from=points[k-1],up=p>from;
    const touched=waiting.filter(o=>!o.done&&(up?o.sign<0&&o.limit>=from&&o.limit<=p:o.sign>0&&o.limit<=from&&o.limit>=p)).sort((x,y)=>up?x.limit-y.limit:y.limit-x.limit);
    for(const o of touched){if(liquidate(b,o.limit,c.timestamp))return b;execute(o,o.limit);}
    if(liquidate(b,p,c.timestamp))return b;
   }
  }return b;
  function execute(o,raw){if(o.done)return;o.done=true;const price=o.sign>0?Math.min(o.limit,raw*(1+SLIP)):Math.max(o.limit,raw*(1-SLIP));
   const cap=exactDelta(b,o.target,raw,price);if(Math.sign(cap)!==o.sign)return;
   const qty=o.sign*Math.min(Math.abs(cap),o.units);fill(b,qty,price,c.timestamp,'LIMIT',o.target);
  }
 }
 // Daily bars do not reveal order; evaluate both conventional OHLC paths and retain the lower terminal equity.
 const lowFirst=path([c.open,c.low,c.high,c.close]),highFirst=path([c.open,c.high,c.low,c.close]);
 return value(lowFirst,c.close)<=value(highFirst,c.close)?lowFirst:highFirst;
}
export function simulate(prepared,{start=-Infinity,end=Infinity,mode='baseline',disablePre=false}={}){
 const {rows,states,predictions,n}=prepared;let a={cash:1e8,q:0,fills:[],completions:[],liquidated:false},lastTarget=0,campaign=null,peak=1e8;
 const curve=[],signals=[],plans=[];let began=false;
 for(let i=1;i<rows.length&&rows[i].timestamp<=end;i++){
  const c=rows[i],prior=rows[i-1];if(c.timestamp<start)continue;
  if(a.liquidated){curve.push({time:c.timestamp,equity:0,drawdown:1});continue;}
  if(liquidate(a,c.open,c.timestamp)){curve.push({time:c.timestamp,equity:0,drawdown:1});continue;}
  const target=states[i-1].target,changed=target!==lastTarget,initial=!began;began=true;
  let orders=[];
  if(mode==='baseline'){if(changed)market(a,target,c.open,c.timestamp,n);}
  else {
   const predicted=predictions[i-1],confirmed=Boolean(states[i-1].event),pre=!disablePre&&predicted?.eligible&&!confirmed&&!changed;
   if(changed||confirmed||initial){market(a,target,c.open,c.timestamp,n,true);campaign=null;}
   else if(pre){
    signals.push({time:prior.timestamp,...predicted});
    if(!campaign||campaign.key!==predicted.key||campaign.cancelled)campaign={key:predicted.key,target:predicted.target,start:c.timestamp,expected:c.timestamp+predicted.day*DAY,complete:false};
    if(!campaign.complete){const delta=campaign.target*value(a,prior.close)-a.q*prior.close;
     if(Math.abs(delta)<1e-6)campaign.complete=true;
     else orders=COEFF.map((coefficient,split)=>{const sign=Math.sign(delta),limit=prior.close-sign*coefficient*prior.adr;return {time:c.timestamp,split:split+1,coefficient,limit,sign,units:Math.abs(delta)/5/limit,target:campaign.target,stage:`D-${Math.max(0,Math.round((campaign.expected-c.timestamp)/DAY))}`};}).filter(o=>o.limit>0);
    }
   }else if(campaign){campaign.cancelled=true;}
  }
  lastTarget=target;
  plans.push(...orders);a=intraday(a,c,orders);
  const E=value(a,c.close);peak=Math.max(peak,E);curve.push({time:c.timestamp,equity:E,drawdown:1-E/peak,quantity:a.q,exposure:E?a.q*c.close/E:0});
 }
 // Main app MACD1 closes remaining holdings at dataset end, including its exit costs.
 if(n===1&&a.q&&!a.liquidated&&curve.length){const c=rows.find(r=>r.timestamp===curve.at(-1).time);fill(a,-a.q,c.close*(1-SLIP),c.timestamp,'END',0);curve.at(-1).equity=a.cash;curve.at(-1).drawdown=1-a.cash/peak;}
 const last=curve.at(-1),shortFills=a.fills.filter(f=>f.delta<0&&f.afterQ<0).length,leverageDays=curve.filter(c=>c.exposure>1.5).length;
 return {n,mode,start:curve[0]?.time,end:last?.time,return:(last?.equity??1e8)/1e8-1,finalEquity:last?.equity,mdd:Math.max(0,...curve.map(c=>c.drawdown)),liquidated:a.liquidated,liquidationTime:a.liquidationTime,fills:a.fills.length,fees:a.fills.reduce((v,f)=>v+f.fee,0),shortFills,leverageDays,eligibleDays:signals.length,completions:a.completions,signals,plans,ledger:a.fills,curve};
}

