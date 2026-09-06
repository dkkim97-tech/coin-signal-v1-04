import {STRATEGIES} from './strategies.mjs';
import Decimal from './vendor/decimal.mjs';
export const D = Object.assign(x => new Decimal(x), {max:(...x)=>Decimal.max(...x),min:(...x)=>Decimal.min(...x)});
export const DAY = 86400000;
export const POLICY = Object.freeze({ version:'D5-80-v2.1', horizon:5, threshold:.8, splits:5, coefficients:[.2,.5,.8,1.1,1.4], minSamples:30 });
export const COINS = ['BTC','ETH','XRP','SOL','ADA','DOGE','AVAX','LINK','DOT','UNI','XLM','ONDO'];
export function selection(exchange, coin, strategy) {
  if (!['korbit','bitget'].includes(exchange) || !COINS.includes(coin) || !Number.isInteger(strategy) || strategy<1 || strategy>(exchange==='korbit'?3:6)) throw Error('거래소·종목·전략 조합이 올바르지 않습니다. 코빗은 현물 MACD 1~3입니다.');
  return {exchange,coin,strategy,symbol:exchange==='korbit'?coin.toLowerCase()+'_krw':coin+'USDT',currency:exchange==='korbit'?'KRW':'USDT'};
}
export function positive(v,name) { const d=D(v); if (!d.isFinite() || !d.gt(0) || d.gt('1e15')) throw Error(name+'은 0보다 큰 금액이어야 합니다.'); return d; }
export function validateLimits(input) {
  const total=positive(input.total,'계좌 전체 한도'); const symbols={};
  for(const [coin,amount] of Object.entries(input.symbols||{})) { if(!COINS.includes(coin)) throw Error('지원하지 않는 종목'); const cap=positive(amount,'종목별 한도'); if(cap.gt(total)) throw Error('종목 한도는 전체 한도 이하여야 합니다.'); symbols[coin]=cap.toFixed(); }
  if(!Object.keys(symbols).length) throw Error('종목별 한도를 입력하세요.');
  return {total:total.toFixed(),symbols};
}
export function snap(x,step,up=false) { step=positive(step,'호가·수량 단위'); return D(x).div(step).toDecimalPlaces(0,up?Decimal.ROUND_CEIL:Decimal.ROUND_FLOOR).mul(step); }
export function tickAt(meta,price) {
  if(meta.ticks) { const tiers=meta.ticks.filter(t=>D(price).gte(t.priceGte)).sort((a,b)=>D(b.priceGte).cmp(a.priceGte)); if(!tiers.length) throw Error('호가 정책 없음'); return D(tiers[0].tickSize); }
  return positive(meta.tick,'가격 단위');
}
// Use one common tick over the whole ladder, so tier boundaries cannot destroy equal spacing.
export function ladder(meta,anchor,adr,side) {
  const sign=side==='buy'?-1:1,raw=POLICY.coefficients.map(c=>D(anchor).add(D(adr).mul(String(c)).mul(sign)));
  if(raw.some(p=>!p.gt(0))) throw Error('등간격 지정가가 0 이하입니다.');
  const ticks=raw.map(p=>tickAt(meta,p));
  // Decimal ticks need not divide one another (e.g. 0.02 and 0.05).
  const scale=D(10).pow(Math.max(...ticks.map(t=>t.decimalPlaces()))),ints=ticks.map(t=>BigInt(t.mul(scale).toFixed(0)));
  const gcd=(a,b)=>b?gcd(b,a%b):a; const common=D(ints.reduce((a,b)=>a/gcd(a,b)*b,1n).toString()).div(scale);
  const start=snap(raw[0],common,side==='sell'),step=Decimal.max(common,snap(D(adr).mul('.3'),common,true));
  const prices=Array.from({length:5},(_,i)=>start.add(step.mul(i*sign)));
  if(prices.some(p=>!p.gt(0)||!p.mod(tickAt(meta,p)).isZero())) throw Error('호가 경계에서 등간격 주문 불가');
  return {prices:prices.map(p=>p.toFixed()),step:step.toFixed()};
}
// Caps are gross marked notional, including pending orders; never net a short against a long.
export function usage(snapshot) {
  const byCoin={}; let total=D(0);
  for(const p of snapshot.positions) { const v=D(p.qty).abs().mul(positive(p.price,'평가가격')); byCoin[p.coin]=D(byCoin[p.coin]||0).add(v); total=total.add(v); }
  for(const o of snapshot.pending) {
    // Reducing orders cannot release headroom until execution is confirmed.
    if(o.reduceOnly) continue;
    const v=positive(o.reservePrice,'미체결 평가가격').mul(D(o.remaining).abs()); byCoin[o.coin]=D(byCoin[o.coin]||0).add(v); total=total.add(v);
  }
  return {total,byCoin};
}
export function makePlan({exchange,coin,strategy,limits,snapshot,meta,decision,now=Date.now()}) {
  selection(exchange,coin,strategy); limits=validateLimits(limits);
  const cap=positive(limits.symbols[coin]||0,'선택 종목 한도'),totalCap=D(limits.total);
  if(now-snapshot.at>15000 || snapshot.at>now+1000) throw Error('계좌 조회가 오래되었습니다. 다시 조회하세요.');
  const price=positive(snapshot.price,'현재가'),current=D(snapshot.positions.find(p=>p.coin===coin)?.qty||0),used=usage(snapshot);
  if(exchange==='korbit'&&(decision.target<0||decision.target>1||current.lt(0))) throw Error('현물에서는 숏·레버리지 주문을 허용하지 않습니다.');
  if(decision.target!==0&&!STRATEGIES[strategy].targets.includes(decision.target)) throw Error('목표 비중 오류');
  const budget=Decimal.min(positive(snapshot.equity,'계좌 평가액'),cap.div(STRATEGIES[strategy].maxExposure));
  // A target is based on capped capital. Passive price gains do not expand the strategy budget.
  const desired=budget.mul(String(decision.target)).div(price);
  let delta=desired.sub(current),reduceOnly=false,phase='OPEN';
  if(!current.isZero() && (desired.isZero()||desired.mul(current).lt(0)||desired.abs().lt(current.abs()))) {
    reduceOnly=true; phase=desired.mul(current).lt(0)?'CLOSE_BEFORE_REVERSE':'REDUCE';
    delta=desired.mul(current).lt(0)?current.neg():delta;
  }
  const side=delta.gte(0)?'buy':'sell';
  const completion=decision.kind==='CONFIRMED'||decision.kind==='INITIAL';
  const grid=completion?{prices:Array(5).fill(snap(price.mul(side==='buy'?'1.003':'0.997'),tickAt(meta,price),side==='sell').toFixed()),step:'0'}:ladder(meta,decision.anchor,decision.adr,side);
  const worst=Decimal.max(price,...grid.prices.map(D)).mul('1.005');
  let maxQty=delta.abs();
  if(reduceOnly) maxQty=Decimal.min(maxQty,current.abs());
  else {
    const headroom=Decimal.max(0,Decimal.min(totalCap.sub(used.total),cap.sub(used.byCoin[coin]||0)));
    const cashQty=positive(snapshot.equity,'계좌 평가액');
    maxQty=Decimal.min(maxQty,headroom.div(worst),Decimal.max(0,D(snapshot.available)).div(worst).mul(exchange==='bitget'?2:1),cashQty.mul(2).div(worst));
  }
  // Equal quote amounts at different limit prices, rounded DOWN to the exchange quantity step.
  // Harmonic sizing keeps the sum of base quantities within the residual/cap quantity budget.
  const perOrderAmount=maxQty.div(grid.prices.reduce((sum,p)=>sum.add(D(1).div(p)),D(0)));
  const orders=grid.prices.map((p,i)=>({split:i+1,side,qty:snap(perOrderAmount.div(p),meta.qtyStep).toFixed(),price:p,timeInForce:completion?'ioc':'gtc',reduceOnly}));
  const min=D(meta.minNotional||0),max=D(meta.maxNotional||'1e30');
  const valid=orders.every(o=>{const unit=D(o.qty);return unit.gt(0)&&unit.gte(meta.minQty||0)&&unit.lte(meta.maxQty||'1e30')&&unit.mul(o.price).gte(min)&&unit.mul(o.price).lte(max);});
  return {policy:POLICY.version,exchange,coin,strategy,currency:exchange==='korbit'?'KRW':'USDT',at:now,expires:now+30000,decision,budget:budget.toFixed(),currentQty:current.toFixed(),targetQty:desired.toFixed(),phase,step:grid.step,used:used.total.toFixed(),headroom:Decimal.max(0,totalCap.sub(used.total)).toFixed(),orders:valid?orders:[],reason:valid?null:'한도·잔고·최소 주문 단위로 5분할 주문을 만들 수 없습니다. 잔량을 완료로 처리하지 않습니다.',residual:delta.abs().toFixed()};
}
