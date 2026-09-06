import { clamp, DAY } from './indicators.mjs';
export const equity = (account, price) => account.cash + account.quantity * price;
export const position = (account, price) => account.quantity * price / equity(account, price);
export function account(capital, current = 0, price = 1, timestamp = Date.now()) { return { cash: capital * (1 - current), quantity: capital * current / price, lots: current ? [{ quantity: capital * current / price, cost: price, timestamp }] : [], trades: [], fills: [], orders: [], dayStart: capital, stopped: false, lastProcessed: null }; }
export function plan({ timestamp, price, adr, current, target, capital, source, key }, s, revision = '') {
  if (![price, adr, current, target, capital].every(Number.isFinite) || price <= 0 || adr <= 0 || capital <= 0) return [];
  const capped = clamp(target, 0, s.maxPosition), delta = capped - current;
  if (Math.abs(delta) < 0.0001) return [];
  const side = delta > 0 ? 'BUY' : 'SELL', size = Math.abs(delta) / 5;
  return s.coefficients.map((coefficient, i) => {
    const limit = price + (side === 'BUY' ? -1 : 1) * coefficient * adr;
    return { id: `${timestamp}:${key}:${side}:${i}:${revision}`, createdAt: timestamp, expiresAt: timestamp + DAY,
      side, split: i + 1, group: i < 3 ? 'CORE' : 'OPPORTUNITY', coefficient, positionSize: size, target: capped,
      limit, referencePrice: price, quantity: limit > 0 ? capital * size / limit : 0, source, key, status: limit > 0 ? 'WAITING' : 'CANCELLED' };
  });
}
export function reconcile(account, signal, s, timestamp, revision = '') {
  if (s.executionPolicy === 'complete-on-confirmation') return reconcileCampaign(account, signal, s, timestamp, revision);
  const price = signal.row.close, key = `${timestamp}:${signal.source}:${signal.key}:${signal.target}:${revision}`;
  if (account.lastPlan === key) return account.orders;
  for (const o of account.orders.filter(x => x.status === 'WAITING')) {
    const opposing = o.side === 'BUY' ? signal.target < position(account, price) : signal.target > position(account, price);
    o.status = opposing || (o.source === 'PRE-SIGNAL' && signal.source !== 'PRE-SIGNAL' && signal.source !== 'CONFIRMED' && s.cancelUnfilled) ? 'CANCELLED' : 'RECALCULATED';
    o.closedAt = timestamp;
  }
  if (!account.stopped) account.orders.push(...plan({ timestamp, price, adr: signal.row.adr, current: position(account, price), target: signal.target, capital: equity(account, price), source: signal.source, key: signal.key }, s, revision));
  account.lastPlan = key;
  return account.orders;
}
export function cancelAll(account, reason = 'EMERGENCY STOP') { account.stopped = true; account.stopReason = reason; for (const o of account.orders) if (o.status === 'WAITING') o.status = 'CANCELLED'; }
export function trade(account, side, units, price, timestamp, s, orderId, target = side === 'BUY' ? 1 : 0, markPrice = price) {
  if (account.fills.some(f => f.orderId === orderId) || account.stopped) return null;
  const before = equity(account, markPrice), currentValue = account.quantity * markPrice;
  // Bound the ACTUAL marked position, including fees, to the requested target.
  units = side === 'BUY'
    ? Math.min(units, account.cash / (price * (1 + s.fee)), Math.max(0, (target * before - currentValue) / (markPrice + target * (price * (1 + s.fee) - markPrice))))
    : Math.min(units, account.quantity, Math.max(0, (currentValue - target * before) / (markPrice - target * (markPrice - price * (1 - s.fee)))));
  if (!(units > 1e-12)) return null;
  const value = units * price, fee = value * s.fee;
  if (side === 'BUY') { account.cash -= value + fee; account.quantity += units; account.lots.push({ quantity: units, cost: price * (1 + s.fee), timestamp }); }
  else {
    account.cash += value - fee; account.quantity -= units;
    let remaining = units, cost = 0, holding = 0;
    for (const lot of account.lots) {
      const used = Math.min(remaining, lot.quantity); cost += used * lot.cost; holding += used * (timestamp - lot.timestamp) / DAY; lot.quantity -= used; remaining -= used; if (remaining <= 1e-12) break;
    }
    account.lots = account.lots.filter(lot => lot.quantity > 1e-12);
    account.trades.push({ timestamp, quantity: units, proceeds: value - fee, cost, pnl: value - fee - cost, return: cost ? (value - fee) / cost - 1 : 0, holdingDays: holding / units });
  }
  const fill = { orderId, timestamp, side, quantity: units, price, fee, value };
  account.fills.push(fill); return fill;
}
export function fillDay(account, candle, s, { enforceSafety = true } = {}) {
  if (account.lastProcessed !== null && candle.timestamp <= account.lastProcessed) return [];
  account.lastProcessed = candle.timestamp;
  account.dayStart = equity(account, candle.open);
  if (s.executionPolicy === 'complete-on-confirmation' && account.completion?.timestamp <= candle.timestamp) {
    return finishCampaign(account, candle, s, enforceSafety);
  }
  const fills = [];
  const waiting = account.orders.filter(o => o.status === 'WAITING');
  for (const o of waiting) {
    if (candle.timestamp >= o.expiresAt) { o.status = 'EXPIRED'; continue; }
    // Planning time is the prior close. Never fill with that same candle's range.
    if (candle.timestamp < o.createdAt) continue;
    if (account.stopped) { o.status = 'CANCELLED'; continue; }
    if (enforceSafety && (o.positionSize > s.maxTrade || (candle.open > 0 && Math.abs(candle.open / (o.referencePrice || candle.open) - 1) > s.maxVolatility))) { o.status = 'CANCELLED'; continue; }
    // Daily OHLC cannot resolve loss-stop/limit intrabar order. Conservative low-first rule.
    if (enforceSafety && equity(account, candle.low) < account.dayStart * (1 - s.maxDailyLoss)) { cancelAll(account, 'MAXIMUM DAILY LOSS (conservative OHLC)'); break; }
    const touched = o.side === 'BUY' ? candle.low <= o.limit : candle.high >= o.limit;
    if (!touched) continue;
    // Limit execution never violates the limit: apply slippage to favorable gap price, capped at limit.
    const price = o.side === 'BUY' ? Math.min(o.limit, Math.min(candle.open, o.limit) * (1 + s.slippage)) : Math.max(o.limit, Math.max(candle.open, o.limit) * (1 - s.slippage));
    const filled = trade(account, o.side, o.quantity, price, candle.timestamp, s, o.id, o.target);
    if (filled) { o.status = 'FILLED'; o.filledAt = candle.timestamp; o.filledQuantity = filled.quantity; o.fillPrice = price; filled.group = o.group; fills.push(filled); }
    else o.status = 'CANCELLED';
  }
  return fills;
}

// A campaign belongs to one instruction, not to every change in marked exposure.
function reconcileCampaign(a, signal, s, timestamp, revision) {
  const coreKey = signal.row.key || signal.key;
  const eventId = `${signal.row.timestamp ?? timestamp}:${signal.source}:${signal.key}:${signal.target}:${revision}`;
  if (a.lastCampaignDecision === eventId) return a.orders;
  a.lastCampaignDecision = eventId;
  const observedChange = a.observedCoreKey !== undefined && a.observedCoreKey !== coreKey;
  a.observedCoreKey = coreKey;
  const target = clamp(signal.target, 0, s.maxPosition);
  const confirmed = signal.source === 'CONFIRMED';
  const pre = signal.source === 'PRE-SIGNAL';
  const initial = !a.initializedCampaign;
  a.initializedCampaign = true;
  a.campaigns ||= [];
  if (a.campaign) a.campaign = a.campaigns.find(c => c.id === a.campaign.id) || a.campaign;
  const cancelWaiting = reason => { for (const o of a.orders) if (o.status === 'WAITING') { o.status = reason; o.closedAt = timestamp; } };
  if (a.stopped) { cancelWaiting('CANCELLED'); a.completion = null; return a.orders; }
  if (a.campaign?.status === 'ACTIVE' && a.campaign.source === 'PRE-SIGNAL' && !pre && !confirmed && !observedChange) {
    cancelWaiting('CANCELLED'); a.campaign.status = 'CANCELLED'; a.campaign.reason = 'PRE-SIGNAL GATE LOST'; a.campaign.cancelledAt = timestamp;
    // Losing a forecast is not a new instruction to unwind the already-filled portion.
    return a.orders;
  }
  const riskChange = a.lastInstructionTarget !== undefined && Math.abs(target - a.lastInstructionTarget) > 1e-8 && s.riskModel;
  if (pre && a.campaign?.status === 'COMPLETED' && a.campaign.key === signal.key && Math.abs(a.campaign.target - target) < 1e-8 && !observedChange) return a.orders;
  if (!initial && !pre && !confirmed && !observedChange && !riskChange && a.campaign?.status !== 'ACTIVE') return a.orders;
  if (!initial && !pre && !confirmed && !observedChange && !riskChange && a.campaign?.source === 'PRE-SIGNAL') return a.orders;
  const newInstruction = !a.campaign || a.campaign.status !== 'ACTIVE' || a.campaign.key !== signal.key || Math.abs(a.campaign.target - target) > 1e-8;
  if (newInstruction) {
    if (a.campaign?.status === 'ACTIVE') { a.campaign.status = 'SUPERSEDED'; a.campaign.closedAt = timestamp; }
    a.campaign = { id: `${timestamp}:${signal.key}:${revision}`, source: signal.source, key: signal.key, target, startedAt: timestamp,
      expectedAt: pre ? timestamp + (signal.projection?.event?.day || 3) * DAY : timestamp,
      status: 'ACTIVE', referencePrice:signal.row.close };
    a.campaigns.push(a.campaign);
  }
  a.lastInstructionTarget = target;
  a.completion = null;
  cancelWaiting(confirmed || observedChange ? 'CANCELLED' : 'RECALCULATED');
  a.campaign.stage = confirmed ? 'D0 CONFIRMED' : pre ? `D-${Math.max(0, Math.round((a.campaign.expectedAt - timestamp) / DAY))}` : 'CORE';
  // A confirmed crossover is only known after its candle closes: finish at the next open.
  // Initial allocation / zero-line state transitions have the same next-open baseline rule.
  if (confirmed || observedChange || initial && !pre) {
    a.completion = { id: `${a.campaign.id}:finish:${eventId}`, timestamp, target, reason: confirmed ? 'CONFIRMED' : initial ? 'INITIAL' : 'ZERO-STATE CHANGE' };
    return a.orders;
  }
  const p = signal.row.close;
  const orders = plan({timestamp, price:p, adr:signal.row.adr, current:position(a,p), target, capital:equity(a,p), source:signal.source, key:signal.key},s,revision);
  for (const o of orders) { o.campaignId = a.campaign.id; o.stage = a.campaign.stage; }
  a.orders.push(...orders);
  if (!orders.length) { a.campaign.status = 'COMPLETED'; a.campaign.completedAt = timestamp; }
  return a.orders;
}

function finishCampaign(a, candle, s, enforceSafety) {
  const instruction = a.completion;
  if (candle.timestamp !== instruction.timestamp) {
    a.completion = null; cancelAll(a, 'MISSED COMPLETION BAR / DATA GAP'); return [];
  }
  if (a.stopped) return [];
  const delta = instruction.target - position(a, candle.open);
  if (enforceSafety && (Math.abs(delta) / 5 > s.maxTrade + 1e-10 || Math.abs(candle.open / (a.campaign.referencePrice || candle.open) - 1) > s.maxVolatility)) {
    cancelAll(a, 'COMPLETION SAFETY LIMIT'); a.completion = null; return [];
  }
  const side = delta > 0 ? 'BUY' : 'SELL', price = candle.open * (1 + (side === 'BUY' ? s.slippage : -s.slippage));
  const before = equity(a,candle.open), currentValue = a.quantity*candle.open, target = instruction.target;
  const units = Math.max(0, side === 'BUY' ? (target*before-currentValue)/(candle.open+target*(price*(1+s.fee)-candle.open)) : (currentValue-target*before)/(candle.open-target*(candle.open-price*(1-s.fee))));
  const fills = [];
  for (let i=0;i<5;i++) {
    const id = `${instruction.id}:${i}`;
    const fill = trade(a,side,i===4 ? units : units/5,price,candle.timestamp,s,id,target,candle.open);
    if (fill) {
      fill.group='COMPLETION'; fill.reason=instruction.reason; fill.campaignId=a.campaign.id; fills.push(fill);
      a.orders.push({id,side,split:i+1,group:'COMPLETION',createdAt:instruction.timestamp,filledAt:candle.timestamp,fillPrice:price,filledQuantity:fill.quantity,quantity:fill.quantity,status:'FILLED',orderType:'MARKET',source:instruction.reason,campaignId:a.campaign.id,stage:'D0',target,positionSize:Math.abs(delta)/5});
    }
  }
  a.campaign.status = Math.abs(position(a,candle.open)-target) < 1e-8 ? 'COMPLETED' : 'INCOMPLETE';
  a.campaign.completedAt=candle.timestamp; a.campaign.finalPosition=position(a,candle.open); a.campaign.reason=instruction.reason;
  a.completion=null;
  return fills;
}
export function guardLive({ mode, explicitlyEnabled, connector, apiHealthy, dataFresh, signalConflict, volatility, dailyLoss, size, exposure, emergencyStop }, s) {
  if (mode !== 'LIVE' || !explicitlyEnabled) throw new Error('LIVE 명시적 활성화가 필요합니다.');
  if (!connector?.capabilities?.orders) throw new Error('검증된 실주문 Connector가 연결되지 않았습니다.');
  if (!apiHealthy || !dataFresh || signalConflict || emergencyStop || volatility > s.maxVolatility || dailyLoss >= s.maxDailyLoss || size > s.maxTrade || exposure > s.maxPosition) throw new Error('LIVE 안전 조건 미충족: 주문 중단');
  return true;
}
