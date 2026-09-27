import {createHash,createHmac,randomUUID} from 'node:crypto';
import {D,DAY,selection,tickAt,positive} from '../trading/policy.mjs';
import {normalize} from '../position/indicators.mjs';

// KRW price tiers, effective 2025-07-31. Cross-check the current tier with Upbit.
export const KRW_TICKS=[[1000000,1000],[500000,500],[100000,100],[50000,50],[10000,10],[5000,5],[100,1],[10,.1],[1,.01],[.1,.001],[.01,.0001],[.001,.00001],[.0001,.000001],[.00001,.0000001],[0,.00000001]].map(([priceGte,tickSize])=>({priceGte:String(priceGte),tickSize:String(tickSize)}));
const query=params=>{const q=new URLSearchParams();for(const [k,v] of Object.entries(params))for(const x of Array.isArray(v)?v:[v])q.append(k,String(x));return q.toString();};
export function signedUpbitRequest(method,path,params,key,nonce=randomUUID()) {
  const encoded=query(params),payload={access_key:key.key,nonce};
  if(encoded){payload.query_hash=createHash('sha512').update(decodeURIComponent(encoded)).digest('hex');payload.query_hash_alg='SHA512';}
  const header=Buffer.from(JSON.stringify({alg:'HS512',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token=header+'.'+body+'.'+createHmac('sha512',key.secret).update(header+'.'+body).digest('base64url');
  return {url:'https://api.upbit.com'+path+(method!=='POST'&&encoded?'?'+encoded:''),init:{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(params)}:{})}};
}
let nextSlot=0;
export class UpbitExchange {
  constructor({fetcher=fetch,env=process.env}={}){this.exchange='upbit';this.fetcher=fetcher;this.env=env;}
  symbol(coin){return selection('upbit',coin,1).symbol;}
  async call(path,params={},method='GET',priv=false,attempt=0){
    const now=Date.now(),slot=Math.max(now,nextSlot);nextSlot=slot+220;
    if(slot>now)await new Promise(r=>setTimeout(r,slot-now));
    let request={url:'https://api.upbit.com'+path+'?'+query(params),init:{method}};
    if(priv){const key={key:this.env.UPBIT_API_KEY,secret:this.env.UPBIT_API_SECRET};if(!key.key||!key.secret)throw Error('업비트 API 키가 실행 서버에 설정되지 않았습니다.');request=signedUpbitRequest(method,path,params,key);}
    const response=await this.fetcher(request.url,{...request.init,signal:AbortSignal.timeout(10000)});
    if(!response.ok){
      if(method==='GET'&&[429,502,503,504].includes(response.status)&&attempt<2){await new Promise(r=>setTimeout(r,1000*(attempt+1)));return this.call(path,params,method,priv,attempt+1);}
      // Never retry a write after an ambiguous response.
      throw Error('업비트 응답 HTTP '+response.status+' · 키 권한·허용 IP·주문 조건을 확인하세요.');
    }
    const data=await response.json();if(data?.error)throw Error('업비트 오류: '+String(data.error.name).slice(0,80));return data;
  }
  async market(coin){
    const symbol=this.symbol(coin);
    const [tickers,books,instruments]=await Promise.all([this.call('/v1/ticker',{markets:symbol}),this.call('/v1/orderbook',{markets:symbol}),this.call('/v1/orderbook/instruments',{markets:symbol})]);
    const t=tickers.find(t=>t.market===symbol),book=books.find(t=>t.market===symbol),instrument=instruments.find(t=>t.market===symbol);
    if(!t||!book?.orderbook_units?.length||!instrument)throw Error('업비트 KRW 거래지원/호가 정보를 확인할 수 없습니다.');
    const price=positive(t.trade_price,'현재가').toFixed(),meta={ticks:KRW_TICKS,qtyStep:'0.00000001',minQty:'0.00000001',minNotional:'5000'};
    if(!tickAt(meta,price).eq(instrument.tick_size))throw Error('업비트 호가 정책이 변경되었습니다. 주문을 중지합니다.');
    if(Date.now()-Number(book.timestamp)>15000)throw Error('업비트 호가가 오래되었습니다.');
    return {exchange:'upbit',coin,symbol,at:Date.now(),price,bid:String(book.orderbook_units[0].bid_price),ask:String(book.orderbook_units[0].ask_price),meta};
  }
  async candlePage(coin,end=Date.now()){
    const rows=await this.call('/v1/candles/days',{market:this.symbol(coin),to:new Date(end).toISOString(),count:200});
    return normalize(rows.map(r=>({timestamp:Date.parse(r.candle_date_time_utc+'Z'),open:r.opening_price,high:r.high_price,low:r.low_price,close:r.trade_price,volume:r.candle_acc_trade_volume})),Date.now());
  }
  normalizeOrder(o,coin,mark){
    if(!o.uuid||!['bid','ask'].includes(o.side)||!['wait','watch','done','cancel'].includes(o.state))throw Error('업비트 주문 응답 형식 오류');
    const remaining=D(o.remaining_volume??0),price=D(o.price||0),active=['wait','watch'].includes(o.state);
    if(active&&(!price.gt(0)||o.remaining_volume==null||!D(mark).gt(0)))throw Error('평가할 수 없는 업비트 미체결 주문이 있습니다.');
    return {coin,id:o.uuid,clientId:o.identifier,status:({wait:'live',watch:'live',done:'filled',cancel:'canceled'})[o.state],filled:String(o.executed_volume||0),filledValue:(o.trades||[]).reduce((v,t)=>v.add(t.funds),D(0)).toFixed(),remaining:remaining.toFixed(),price:price.toFixed(),reservePrice:D.max(price,mark).toFixed(),reduceOnly:o.side==='ask',side:o.side==='bid'?'buy':'sell'};
  }
  async snapshot(coin){
    const market=await this.market(coin);
    const [balances,chance]=await Promise.all([this.call('/v1/accounts',{},'GET',true),this.call('/v1/orders/chance',{market:market.symbol},'GET',true)]);
    if(chance.market?.state!=='active'||!chance.market.bid_types?.includes('limit')||!chance.market.ask_types?.includes('limit')||!chance.market.bid_types.includes('limit_ioc')||!chance.market.ask_types.includes('limit_ioc'))throw Error('업비트 지정가/IOC 주문 지원을 확인하세요.');
    for(const f of [chance.bid_fee,chance.ask_fee])if(!D(f).isFinite()||D(f).lt(0)||D(f).gt('.002'))throw Error('업비트 수수료 안전 여유 범위 초과');
    const assets=balances.filter(b=>b.currency!=='KRW'&&D(b.balance).add(b.locked).gt(0));
    const tickers=[];for(let i=0;i<assets.length;i+=50)tickers.push(...await this.call('/v1/ticker',{markets:assets.slice(i,i+50).map(b=>'KRW-'+b.currency).join(',')}));
    const positions=assets.map(b=>{const t=tickers.find(t=>t.market==='KRW-'+b.currency);if(!t)throw Error('전체 자산 KRW 평가가격 누락: '+b.currency);return {coin:b.currency,qty:D(b.balance).add(b.locked).toFixed(),available:b.balance,price:positive(t.trade_price,'평가가격').toFixed()};});
    const pending=[],seen=new Set();
    for(let page=1;;page++){
      const rows=await this.call('/v1/orders/open',{'states[]':['wait','watch'],page,limit:100,order_by:'asc'},'GET',true);
      for(const o of rows){if(!o.market?.startsWith('KRW-'))throw Error('업비트 KRW 외 미체결 주문이 있습니다.');if(seen.has(o.uuid))throw Error('업비트 미체결 페이지가 중복되었습니다.');seen.add(o.uuid);const c=o.market.slice(4),mark=c===coin?market.price:tickers.find(t=>t.market===o.market)?.trade_price||o.price;pending.push(this.normalizeOrder(o,c,mark));}
      if(rows.length<100)break;if(page>=10)throw Error('업비트 미체결 주문 조회 한도 초과');
    }
    const krw=balances.find(b=>b.currency==='KRW')||{balance:'0',locked:'0'};
    // Count all locked KRW, including fees or reservations absent from a racing order response.
    const reserved=pending.filter(o=>!o.reduceOnly).reduce((s,o)=>s.add(D(o.remaining).mul(o.reservePrice)),D(0));
    const other=D.max(0,D(krw.locked).sub(reserved));if(other.gt(0))pending.push({coin:'OTHER',remaining:'1',reservePrice:other.toFixed(),reduceOnly:false,external:true});
    const equity=positions.reduce((s,p)=>s.add(D(p.qty).mul(p.price)),D(krw.balance).add(krw.locked));
    return {...market,equity:equity.toFixed(),available:krw.balance,positions,pending,meta:{...market.meta,minNotional:D.max(chance.market.bid.min_total,chance.market.ask.min_total).toFixed(),maxNotional:chance.market.max_total},fees:{bid:chance.bid_fee,ask:chance.ask_fee}};
  }
  async order(coin,clientId,id){const o=await this.call('/v1/order',id?{uuid:id}:{identifier:clientId},'GET',true);if(o.market!==this.symbol(coin))throw Error('주문 종목 불일치');return this.normalizeOrder(o,coin,o.price||'1');}
  async cancel(coin,clientId,id){this.symbol(coin);return this.call('/v1/order',id?{uuid:id}:{identifier:clientId},'DELETE',true);}
  async place(coin,o,clientId){
    if(!['buy','sell'].includes(o.side)||!['gtc','ioc'].includes(o.timeInForce)||o.side==='sell'&&!o.reduceOnly)throw Error('업비트 현물 주문 조건 오류');
    const ack=await this.call('/v1/orders',{market:this.symbol(coin),side:o.side==='buy'?'bid':'ask',volume:o.qty,price:o.price,ord_type:'limit',identifier:clientId,...(o.timeInForce==='ioc'?{time_in_force:'ioc'}:{}),smp_type:'cancel_taker'},'POST',true);
    if(!ack.uuid)throw Error('업비트 주문 접수 확인 불가');return {orderId:ack.uuid};
  }
}
