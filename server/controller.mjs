import {randomUUID,createHash} from 'node:crypto';
import {Exchange,terminal} from './exchanges.mjs';
import {selection,validateLimits,makePlan,D,usage,DAY,POLICY} from '../trading/policy.mjs';
import {decide} from '../trading/decision.mjs';
const id=()=>randomUUID().replaceAll('-','');
export class Controller {
  constructor(store,{env=process.env,exchangeFactory=e=>new Exchange(e,{env}),clock=Date.now,decisionFactory=decide}={}) {this.store=store;this.env=env;this.exchangeFactory=exchangeFactory;this.clock=clock;this.decide=decisionFactory;this.queue=Promise.resolve();}
  serial(fn) {const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
  serverEnabled(exchange) {return this.env.TRADING_ENABLED==='true'&&(exchange!=='bitget'||this.env.BITGET_DEMO==='true'||this.env.BITGET_LIVE_ENABLED==='true');}
  enabled(exchange) {return this.serverEnabled(exchange)&&this.store.get('automation',exchange)?.on===true;}
  async automation(exchange,on) {
    if(typeof on!=='boolean')throw Error('자동매매 ON/OFF 값이 필요합니다.');
    if(on){
      if(!this.serverEnabled(exchange))throw Error('서버의 실주문/데모 실행 설정이 꺼져 있습니다.');
      this.assertConnection(exchange);
      if(this.activeOrders(exchange).length||this.store.all('campaigns').some(c=>c.exchange===exchange&&c.status!=='STOPPED'))throw Error('기존 종목의 중지 및 미체결 취소를 먼저 확인하세요.');
    }
    // Persist OFF before any network call. Failed cancellation never restores ON.
    this.store.put('automation',exchange,{on,at:this.clock()});
    this.audit(on?'AUTOMATION_ON':'AUTOMATION_OFF',{exchange});
    if(!on){
      const campaigns=this.store.all('campaigns').filter(c=>c.exchange===exchange&&c.status!=='STOPPED');
      for(const c of campaigns)this.store.put('campaigns',exchange+':'+c.coin,{...c,status:'STOPPING'});
      this.assertConnection(exchange);
      await this.reconcile(this.exchangeFactory(exchange),undefined,true);
      for(const c of campaigns)this.store.put('campaigns',exchange+':'+c.coin,{...c,status:'STOPPED'});
    }
    return this.status(exchange);
  }
  assertConnection(exchange) {
    const fingerprint=createHash('sha256').update(exchange+':'+(exchange==='bitget'&&this.env.BITGET_DEMO==='true'?'demo':'live')+':'+(this.env[exchange.toUpperCase()+'_API_KEY']||'unconfigured')).digest('hex');
    let prior=this.store.get('connection',exchange);
    if(prior?.fingerprint!==fingerprint) {
      if(prior&&(this.activeOrders(exchange).length||this.store.all('campaigns').some(c=>c.exchange===exchange&&c.status!=='STOPPED')))throw Error('실행 계정 또는 데모 모드가 변경되었습니다. 이전 연결로 복구하여 중지·취소를 확인한 뒤 새 연결을 등록하세요.');
      prior={id:id(),fingerprint};this.store.put('connection',exchange,prior);
    }
    return prior.id;
  }
  audit(type,data) {return this.store.put('audit',id(),{at:this.clock(),type,...data});}
  async candles(e,coin) {
    const key=e.exchange+':'+coin,cache=this.store.get('candles',key);if(cache&&this.clock()-cache.checked<300000)return cache.rows;
    const map=new Map((cache?.rows||[]).map(c=>[c.timestamp,c]));let end=this.clock();
    for(let i=0;i<45;i++) {
      const page=await e.candlePage(coin,end);if(!page.length)break;
      for(const c of page)map.set(c.timestamp,c);const earliest=Math.min(...page.map(c=>c.timestamp));
      if(earliest>=end)throw Error('캔들 페이지가 진행되지 않습니다.');
      if(cache?.rows?.length&&earliest<=cache.rows.at(-1).timestamp||map.size>=3500)break;end=e.exchange==='bitget'?earliest+DAY:earliest-1;
    }
    const rows=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp);this.store.put('candles',key,{checked:this.clock(),rows});return rows;
  }
  activeOrders(exchange,coin) {return this.store.all('orders').filter(o=>o.exchange===exchange&&(!coin||o.coin===coin)&&!terminal(o.status));}
  async reconcile(e,coin,cancel=false) {
    for(const o of this.activeOrders(e.exchange,coin)) {
      // Queued writes have never been sent. A SUBMITTING record is ambiguous and must be queried.
      if(o.status==='QUEUED') {if(cancel)this.store.put('orders',o.clientId,{...o,status:'canceled'});continue;}
      let actual=await e.order(o.coin,o.clientId,o.id);
      this.store.put('orders',o.clientId,{...o,...actual,at:this.clock()});
      if(cancel&&!terminal(actual.status)) {
        try {await e.cancel(o.coin,o.clientId,actual.id);} catch {/* Query is authoritative, including cancel/fill races. */}
        actual=await e.order(o.coin,o.clientId,actual.id);this.store.put('orders',o.clientId,{...o,...actual,at:this.clock()});
        if(!terminal(actual.status))throw Error('취소 확정 대기: 잔량 재배치 중지');
      }
    }
  }
  async preview(input) {
    const selected=selection(input.exchange,input.coin,Number(input.strategy));
    const connectionId=this.assertConnection(selected.exchange);
    const limits=validateLimits(input.limits),e=this.exchangeFactory(selected.exchange);
    await this.reconcile(e);
    const candles=await this.candles(e,selected.coin),decision=this.decide(candles,selected.strategy,{now:this.clock(),initial:true});
    const snapshot=await e.snapshot(selected.coin);
    this.store.put('account',selected.exchange,snapshot);
    if(snapshot.pending.some(o=>o.coin===selected.coin))throw Error('선택 종목에 미체결 주문이 있습니다. 해당 주문을 정리한 후 다시 미리보기 하세요.');
    const plan=makePlan({...selected,limits,snapshot,meta:snapshot.meta,decision,now:this.clock()});
    const quote={...plan,id:id(),limits,connectionId};this.store.put('quotes',quote.id,quote);return quote;
  }
  status(exchange) {return {policy:POLICY,enabled:this.enabled(exchange),serverEnabled:this.serverEnabled(exchange),automationOn:this.store.get('automation',exchange)?.on===true,demo:exchange==='bitget'&&this.env.BITGET_DEMO==='true',limits:this.store.get('limits',exchange),account:this.store.get('account',exchange),campaigns:this.store.all('campaigns').filter(c=>c.exchange===exchange),orders:this.store.all('orders').filter(o=>o.exchange===exchange).slice(-100),audit:this.store.all('audit').filter(a=>a.exchange===exchange).slice(-30)};}
  async arm(quoteId) {
    const quote=this.store.get('quotes',quoteId);if(!quote||quote.expires<this.clock()||quote.consumed)throw Error('미리보기가 만료되었거나 이미 실행되었습니다.');
    if(!this.enabled(quote.exchange))throw Error('서버의 실주문/데모 실행 설정이 꺼져 있습니다.');
    if(quote.connectionId!==this.assertConnection(quote.exchange))throw Error('연결이 변경되었습니다. 실계좌 미리보기를 다시 실행하세요.');
    const key=quote.exchange+':'+quote.coin,existing=this.store.get('campaigns',key);
    if(existing&&existing.status!=='STOPPED')throw Error('이미 등록된 종목입니다. 중지 후 다시 시작하세요.');
    // Saving a new global cap must not invalidate other running symbols silently.
    const prior=this.store.get('limits',quote.exchange),limits=validateLimits({total:quote.limits.total,symbols:{...prior?.symbols,...quote.limits.symbols}});
    for(const c of this.store.all('campaigns').filter(c=>c.exchange===quote.exchange&&c.status!=='STOPPED'))if(!limits.symbols[c.coin])throw Error('진행 중인 종목 한도 누락');
    this.store.put('limits',quote.exchange,limits);this.store.put('quotes',quoteId,{...quote,consumed:true});
    const campaign={exchange:quote.exchange,coin:quote.coin,strategy:quote.strategy,status:'ARMED',created:this.clock(),initial:true,lastBar:null,lastDecision:null};
    this.store.put('campaigns',key,campaign);this.audit('ARMED',{exchange:quote.exchange,coin:quote.coin});return campaign;
  }
  async stop(exchange,coin) {
    this.assertConnection(exchange);
    const key=exchange+':'+coin,c=this.store.get('campaigns',key);if(!c)throw Error('진행 중인 종목이 없습니다.');
    // Persist stop intent before network cancellation, so failures cannot resume opening orders.
    c.status='STOPPING';this.store.put('campaigns',key,c);
    await this.reconcile(this.exchangeFactory(exchange),coin,true);c.status='STOPPED';this.store.put('campaigns',key,c);this.audit('STOPPED',{exchange,coin});return c;
  }
  async updateLimits(exchange,input) {
    this.assertConnection(exchange);
    const limits=validateLimits(input);
    for(const c of this.store.all('campaigns').filter(c=>c.exchange===exchange&&c.status!=='STOPPED'))if(!limits.symbols[c.coin])throw Error('진행 중인 종목의 한도를 유지하세요.');
    // Limits can be lowered below holdings. Cancel outstanding app orders; do not liquidate holdings.
    const e=this.exchangeFactory(exchange);await this.reconcile(e,undefined,true);
    this.store.put('limits',exchange,limits);this.audit('LIMITS',{exchange,limits});return limits;
  }
  async submit(e,plan,campaign) {
    if(!this.enabled(e.exchange))throw Error('실행 중지 설정');
    const entries=plan.orders.map(o=>({...o,clientId:id(),exchange:e.exchange,coin:plan.coin,status:'QUEUED',at:this.clock(),bar:plan.decision.bar}));
    for(const o of entries)this.store.put('orders',o.clientId,o);
    for(const o of entries) {
      try {
        // Refresh actual balances before EACH order. Never assume an ACK was a fill.
        await this.reconcile(e);
        const snapshot=await e.snapshot(o.coin),limits=this.store.get('limits',e.exchange),used=usage(snapshot);
        this.store.put('account',e.exchange,snapshot);
        const known=new Set(snapshot.pending.map(p=>p.clientId));
        for(const local of this.activeOrders(e.exchange))if(local.status!=='QUEUED'&&!known.has(local.clientId))throw Error('거래소 미체결·잔고 동기화 대기');
        if(!o.reduceOnly) {
          const reserve=D(o.qty).mul(D.max(o.price,snapshot.price)).mul('1.005');
          if(used.total.add(reserve).gt(limits.total)||D(used.byCoin[o.coin]||0).add(reserve).gt(limits.symbols[o.coin]))throw Error('전체 또는 종목 한도 초과');
          if(reserve.div(e.exchange==='bitget'?2:1).gt(snapshot.available))throw Error('사용 가능 잔고 부족');
        } else {
          const position=snapshot.positions.find(p=>p.coin===o.coin),quantity=D(position?.qty||0);
          if((o.side==='sell'&&!quantity.gt(0))||(o.side==='buy'&&!quantity.lt(0))||D(o.qty).gt(quantity.abs()))throw Error('청산 가능 수량 변경');
          if(e.exchange==='korbit'&&D(o.qty).gt(position.available))throw Error('매도 가능 수량 부족');
        }
        if(!this.enabled(e.exchange))throw Error('자동매매 OFF: 주문 중지');
        this.store.put('orders',o.clientId,{...o,status:'SUBMITTING',attempted:true});
        const ack=await e.place(o.coin,o,o.clientId);this.store.put('orders',o.clientId,{...o,id:ack.orderId?String(ack.orderId):undefined,status:'ACK',attempted:true});
        this.audit('ORDER_ACCEPTED',{exchange:e.exchange,coin:o.coin,clientId:o.clientId});
      } catch(err) {
        for(const queued of this.activeOrders(e.exchange,o.coin).filter(x=>x.status==='QUEUED'))this.store.put('orders',queued.clientId,{...queued,status:'canceled'});
        throw err;
      }
    }
    campaign.initial=false;campaign.lastBar=plan.decision.bar;campaign.lastDecision=plan.decision;campaign.status='RUNNING';campaign.lastPlan=plan;
    this.store.put('campaigns',e.exchange+':'+plan.coin,campaign);
  }
  async tickCampaign(c) {
    this.assertConnection(c.exchange);
    const key=c.exchange+':'+c.coin,e=this.exchangeFactory(c.exchange);
    if(c.status==='STOPPING')return this.stop(c.exchange,c.coin);
    if(c.status==='ERROR'||!this.enabled(c.exchange)){await this.reconcile(e,c.coin,true);return;}
    await this.reconcile(e);
    const candles=await this.candles(e,c.coin),decision=this.decide(candles,c.strategy,{now:this.clock(),initial:c.initial});
    const newDay=decision.bar!==c.lastBar,completion=['INITIAL','CONFIRMED'].includes(decision.kind);
    if(c.lastPlan?.decision.kind==='PRE') {
      const oldBatch=this.store.all('orders').filter(o=>o.exchange===c.exchange&&o.coin===c.coin&&o.bar===c.lastPlan.decision.bar);
      if(oldBatch.length===5&&oldBatch.every(o=>o.status==='filled'&&D(o.filled||0).gte(o.qty)))c.preCompletedEvent=c.lastPlan.decision.event;
    }
    if(decision.kind==='PRE'&&decision.event===c.preCompletedEvent){c.lastBar=decision.bar;c.status='COMPLETED';this.store.put('campaigns',key,c);return;}
    if(decision.kind!=='PRE'||decision.event!==c.lastDecision?.event)c.preCompletedEvent=null;
    // Resting GTC ladder stays untouched during the day. Renew only after a new closed candle.
    if(!newDay&&!completion)return;
    if(c.completedBar===decision.bar)return;
    await this.reconcile(e,c.coin,true);
    if(decision.kind==='WAIT') {c.lastBar=decision.bar;c.lastDecision=decision;c.status='WAITING';this.store.put('campaigns',key,c);return;}
    const snapshot=await e.snapshot(c.coin);if(snapshot.pending.some(o=>o.coin===c.coin))throw Error('외부 미체결 주문이 있어 자동 주문을 중지합니다.');
    const plan=makePlan({...c,limits:this.store.get('limits',c.exchange),snapshot,meta:snapshot.meta,decision,now:this.clock()});
    // A bounded IOC is retried from confirmed remaining holdings, never treated as guaranteed fill.
    if(!plan.orders.length) {c.initial=false;c.status=D(plan.residual).lt(snapshot.meta.qtyStep)?'COMPLETED':'RESIDUAL';c.lastPlan=plan;c.lastDecision=decision;c.lastBar=decision.bar;if(c.status==='COMPLETED')c.completedBar=decision.bar;this.store.put('campaigns',key,c);return;}
    if(!newDay&&completion&&c.lastPlan?.orders?.length) {
      const batch=this.store.all('orders').filter(o=>o.exchange===c.exchange&&o.coin===c.coin&&o.bar===decision.bar&&o.attempted);
      if(batch.length>=25)throw Error('당일 완료 주문 재시도 한도 도달: 잔량 확인 필요');
    }
    await this.submit(e,plan,c);
  }
  async tick() {for(const c of this.store.all('campaigns').filter(c=>c.status!=='STOPPED'))try{await this.tickCampaign(c);}catch(e){this.store.put('campaigns',c.exchange+':'+c.coin,{...this.store.get('campaigns',c.exchange+':'+c.coin),status:'ERROR',error:e.message});this.audit('ERROR',{exchange:c.exchange,coin:c.coin,error:e.message});}}
}
