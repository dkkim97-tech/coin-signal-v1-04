import {createHmac} from 'node:crypto';
import {D,selection,COINS,DAY} from '../trading/policy.mjs';
import {normalize} from '../position/indicators.mjs';
const CAT='USDT-FUTURES';
const nextSlot=new Map();
async function throttle(exchange){const now=Date.now(),slot=Math.max(now,nextSlot.get(exchange)||0);nextSlot.set(exchange,slot+220);if(slot>now)await new Promise(r=>setTimeout(r,slot-now));}
export function signedRequest(exchange,method,path,params,key,stamp) {
  if(exchange==='korbit') {
    const q=new URLSearchParams({...params,timestamp:String(stamp),recvWindow:'5000'});
    q.set('signature',createHmac('sha256',key.secret).update(q.toString()).digest('hex'));
    return {url:'https://api.korbit.co.kr'+path+(method==='POST'?'':'?'+q),init:{method,headers:{'X-KAPI-KEY':key.key,'Content-Type':'application/x-www-form-urlencoded'},...(method==='POST'?{body:q.toString()}:{})}};
  }
  const q=new URLSearchParams(Object.entries(params).sort(([a],[b])=>a.localeCompare(b))).toString(),body=method==='GET'?'':JSON.stringify(params),suffix=method==='GET'&&q?'?'+q:'';
  return {url:'https://api.bitget.com'+path+suffix,init:{method,headers:{'ACCESS-KEY':key.key,'ACCESS-PASSPHRASE':key.passphrase,'ACCESS-TIMESTAMP':String(stamp),'ACCESS-SIGN':createHmac('sha256',key.secret).update(String(stamp)+method+path+suffix+body).digest('base64'),'Content-Type':'application/json',...(key.demo?{paptrading:'1'}:{})},...(body?{body}:{})}};
}
export class Exchange {
  constructor(exchange,{fetcher=fetch,env=process.env}={}) { this.exchange=exchange;this.fetcher=fetcher;this.env=env; }
  async call(path,params={},method='GET',priv=false,attempt=0) {
    await throttle(this.exchange);
    const base=this.exchange==='korbit'?'https://api.korbit.co.kr':'https://api.bitget.com';
    let request={url:base+path+'?'+new URLSearchParams(params),init:{method}};
    if(priv) {
      const prefix=this.exchange.toUpperCase(),key={key:this.env[prefix+'_API_KEY'],secret:this.env[prefix+'_API_SECRET'],passphrase:this.env.BITGET_PASSPHRASE,demo:this.env.BITGET_DEMO==='true'};
      if(!key.key||!key.secret||(this.exchange==='bitget'&&!key.passphrase)) throw Error('거래소 API 키가 서버에 설정되지 않았습니다.');
      let stamp=Date.now();
      if(this.exchange==='korbit') {const t=await this.call('/v2/time');stamp=Number(t.time);if(!Number.isFinite(stamp))throw Error('거래소 시각 조회 실패');}
      request=signedRequest(this.exchange,method,path,params,key,stamp);
    }
    const response=await this.fetcher(request.url,{...request.init,signal:AbortSignal.timeout(10000)});
    if(!response.ok){
      if(method==='GET'&&[429,502,503,504].includes(response.status)&&attempt<3){const retry=Number(response.headers?.get?.('retry-after'));await new Promise(r=>setTimeout(r,Math.min(5000,Math.max(1000,Number.isFinite(retry)?retry*1000:1000*(attempt+1)))));return this.call(path,params,method,priv,attempt+1);}
      throw Error('거래소 응답 HTTP '+response.status);
    }
    // Korbit order IDs can exceed Number.MAX_SAFE_INTEGER. Preserve integral JSON IDs as strings.
    const raw=await response.text(),data=JSON.parse(raw.replace(/("(?:orderId|tradeId)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,'$1"$2"'));
    if(this.exchange==='korbit'?data.success!==true:data.code!=='00000')throw Error('거래소 오류: '+String(data.code||data.error?.code||'응답 검증 실패').slice(0,80));
    return data.data;
  }
  symbol(coin) {return selection(this.exchange,coin,1).symbol;}
  async market(coin) {
    const symbol=this.symbol(coin);
    if(this.exchange==='korbit') {
      const [pairs,ticks,tickers]=await Promise.all([this.call('/v2/currencyPairs'),this.call('/v2/tickSizePolicy',{symbol}),this.call('/v2/tickers',{symbol})]);
      const pair=pairs.find(p=>p.symbol===symbol),t=tickers[0];if(pair?.status!=='launched'||!t)throw Error('코빗 거래지원 중인 종목이 아닙니다.');
      return {exchange:this.exchange,coin,symbol,at:Date.now(),price:t.close,bid:t.bestBidPrice,ask:t.bestAskPrice,meta:{ticks:ticks.find(x=>x.symbol===symbol)?.tickSizePolicy,qtyStep:'0.00000001',minQty:'0.00000001',minNotional:pair.minOrderValue||'5000',maxNotional:pair.maxOrderValue||'1000000000'}};
    }
    const [instruments,tickers]=await Promise.all([this.call('/api/v3/market/instruments',{category:CAT,symbol}),this.call('/api/v3/market/tickers',{category:CAT,symbol})]);
    const m=instruments.find(x=>x.symbol===symbol),t=tickers.find(x=>x.symbol===symbol);if(m?.status!=='online'||m.type!=='perpetual'||!t)throw Error('비트겟 USDT 무기한 거래지원 종목이 아닙니다.');
    return {exchange:this.exchange,coin,symbol,at:Date.now(),price:t.lastPrice,bid:t.bid1Price,ask:t.ask1Price,fundingRate:t.fundingRate,meta:{tick:m.priceMultiplier,qtyStep:m.quantityMultiplier,minQty:m.minOrderQty,maxQty:m.maxOrderQty==='0'?undefined:m.maxOrderQty,minNotional:m.minOrderAmount,fee:m.takerFeeRate}};
  }
  async candlePage(coin,end=Date.now()) {
    const symbol=this.symbol(coin),rows=this.exchange==='korbit'?await this.call('/v2/candles',{symbol,interval:'1D',limit:200,end:String(end)}):await this.call('/api/v3/market/history-candles',{category:CAT,symbol,interval:'1D',limit:90,endTime:String(end),startTime:String(end-89*DAY)});
    return normalize(rows,Date.now());
  }
  async snapshot(coin) {
    const market=await this.market(coin),symbol=market.symbol;
    if(this.exchange==='korbit') {
      const [balances,tickers,open,fees]=await Promise.all([this.call('/v2/balance',{},'GET',true),this.call('/v2/tickers'),this.call('/v2/openOrders',{symbol,limit:1000},'GET',true),this.call('/v2/tradingFeePolicy',{symbol},'GET',true)]);
      if(open.length>=1000)throw Error('미체결 목록이 잘렸습니다. 주문 중지');
      const krw=balances.find(b=>b.currency==='krw')||{balance:'0',available:'0',tradeInUse:'0'};
      const positions=balances.filter(b=>b.currency!=='krw'&&D(b.balance).gt(0)).map(b=>{const t=tickers.find(t=>t.symbol===b.currency+'_krw');if(!t||!D(t.close).gt(0))throw Error('전체 자산 평가가격 누락: '+b.currency);return {coin:b.currency.toUpperCase(),qty:b.balance,available:b.available,price:t.close};});
      const pending=open.map(o=>this.normalizeOrder(o,coin,market.price));
      const reserved=pending.filter(o=>!o.reduceOnly).reduce((v,o)=>v.add(D(o.remaining).mul(o.reservePrice)),D(0));
      const other=D.max(0,D(krw.tradeInUse).sub(reserved));
      if(other.gt(0))pending.push({coin:'OTHER',remaining:'1',reservePrice:other.toFixed(),reduceOnly:false,external:true});
      const equity=positions.reduce((a,p)=>a.add(D(p.qty).mul(p.price)),D(krw.balance));
      const fee=fees.find(f=>f.symbol===symbol);if(!fee||D(fee.maxFeeRate).gt('.002'))throw Error('수수료 안전 여유 범위를 초과합니다.');
      return {...market,equity:equity.toFixed(),available:krw.available,positions,pending,fees};
    }
    const [account,settings,positionsRaw,coinM,usdcM,tickers]=await Promise.all([this.call('/api/v3/account/assets',{},'GET',true),this.call('/api/v3/account/settings',{},'GET',true),this.call('/api/v3/position/current-position',{category:CAT},'GET',true),this.call('/api/v3/position/current-position',{category:'COIN-FUTURES'},'GET',true),this.call('/api/v3/position/current-position',{category:'USDC-FUTURES'},'GET',true),this.call('/api/v3/market/tickers',{category:CAT})]);
    if(coinM.list.length||usdcM.list.length)throw Error('USDT 선물 전용 계좌가 필요합니다. 다른 결제통화 포지션이 있습니다.');
    if(settings.holdMode!=='one_way_mode'||!['unified','hybrid'].includes(settings.accountMode))throw Error('비트겟 UTA 단방향 모드가 필요합니다.');
    const config=settings.symbolConfigList?.find(x=>x.category===CAT&&x.symbol===symbol);
    if(config?.marginMode!=='isolated'||String(config?.leverage)!=='2')throw Error('선택 종목을 비트겟에서 격리·레버리지 2배로 설정하세요.');
    const positions=positionsRaw.list.map(p=>{if(p.holdMode!=='one_way_mode'||p.marginMode!=='isolated')throw Error('계좌의 선물 포지션은 모두 단방향·격리여야 합니다.');return {coin:p.symbol.replace(/USDT$/,''),qty:D(p.total).abs().mul(p.posSide==='short'?-1:1).toFixed(),price:p.markPrice,liquidationPrice:p.liquidationPrice,margin:p.positionBalance,funding:p.totalFunding};});
    let cursor; const pending=[];const cursors=new Set();
    do {const page=await this.call('/api/v3/trade/unfilled-orders',{limit:100,...(cursor?{cursor}:{})},'GET',true);if(page.list.some(o=>o.category!==CAT))throw Error('USDT 선물 외 미체결 주문이 있습니다.');pending.push(...page.list.map(o=>this.normalizeOrder(o,o.symbol.replace(/USDT$/,''),tickers.find(t=>t.symbol===o.symbol)?.markPrice||'0')));cursor=page.cursor;if(cursor&&cursors.has(cursor))throw Error('미체결 페이지 반복');cursors.add(cursor);if(pending.length>500)throw Error('미체결 주문 한도 초과');}while(cursor);
    const usdt=account.assets.find(a=>a.coin==='USDT');if(!usdt)throw Error('USDT 잔고가 없습니다.');
    if(account.assets.some(a=>D(a.debt||0).gt(0)))throw Error('차입이 있는 통합 계좌는 지원하지 않습니다.');
    return {...market,equity:usdt.equity,available:usdt.available,positions,pending,accountMode:settings.accountMode};
  }
  normalizeOrder(o,coin,mark) {
    const korbit=this.exchange==='korbit',qty=o.qty||'0',filled=korbit?o.filledQty:o.cumExecQty,price=o.price||'0';
    const remaining=D.max(0,D(qty).sub(filled||0)).toFixed();
    if(D(remaining).gt(0)&&(!D(price).gt(0)||!D(mark).gt(0)))throw Error('평가할 수 없는 미체결 주문이 있습니다.');
    return {coin,id:String(o.orderId),clientId:korbit?o.clientOrderId:o.clientOid,status:korbit?o.status:o.orderStatus,filled:filled||'0',filledValue:(korbit?o.filledAmt:o.cumExecValue)||'0',remaining,price,reservePrice:D.max(price||0,mark||0).toFixed(),reduceOnly:korbit?o.side==='sell':String(o.reduceOnly).toLowerCase()==='yes',side:o.side};
  }
  async order(coin,clientId,id) { const symbol=this.symbol(coin),o=this.exchange==='korbit'?await this.call('/v2/orders',{symbol,...(id?{orderId:id}:{clientOrderId:clientId})},'GET',true):await this.call('/api/v3/trade/order-info',id?{orderId:id}:{clientOid:clientId},'GET',true);return this.normalizeOrder(o,coin,o.price||'1'); }
  async cancel(coin,clientId,id) {return this.exchange==='korbit'?this.call('/v2/orders',{symbol:this.symbol(coin),...(id?{orderId:id}:{clientOrderId:clientId})},'DELETE',true):this.call('/api/v3/trade/cancel-order',{category:CAT,symbol:this.symbol(coin),...(id?{orderId:id}:{clientOid:clientId})},'POST',true);}
  async place(coin,o,clientId) {
    const symbol=this.symbol(coin);
    return this.exchange==='korbit'?this.call('/v2/orders',{symbol,side:o.side,orderType:'limit',price:o.price,qty:o.qty,timeInForce:o.timeInForce,clientOrderId:clientId},'POST',true):this.call('/api/v3/trade/place-order',{category:CAT,symbol,side:o.side,orderType:'limit',price:o.price,qty:o.qty,timeInForce:o.timeInForce,reduceOnly:o.reduceOnly?'yes':'no',marginMode:'isolated',clientOid:clientId,stpMode:'cancel_both'},'POST',true);
  }
}
export const terminal = s => ['filled','canceled','partiallyFilledCanceled','expired','cancelled'].includes(s);
