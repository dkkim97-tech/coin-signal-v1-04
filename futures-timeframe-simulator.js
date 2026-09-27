(function () {
  "use strict";

  const isFutures = /(^|\/)futures(\/|$)/i.test(decodeURIComponent(location.pathname || "")) || new URLSearchParams(location.search).get("mode") === "futures";


  const MARKETS = ["BTC", "ETH", "XRP", "SOL", "ADA", "DOGE", "AVAX", "DOT", "XLM", "UNI", "LINK", "ONDO"];
  const STRATEGIES = [
    { id: "MACD 1", name: "0선 돌파", color: "#72f2bd" },
    { id: "MACD 2", name: "MACD(12,26,9) 비중", color: "#c891ff" },
    { id: "MACD 3", name: "MACD(18,39,9) 비중", color: "#ff9d5c" },
    { id: "MACD 4", name: "MACD(18,39,9) 롱·숏", color: "#4ca6ff" },
    { id: "MACD 5", name: "롱·숏 2배", color: "#ff5fb7" },
  ].filter(s => isFutures || !["MACD 4", "MACD 5"].includes(s.id));
  const TIMEFRAMES = {
    day: { label: "일봉", endpoint: "days", milliseconds: 86400000 },
    240: { label: "4시간봉", endpoint: "minutes/240", milliseconds: 14400000 },
    60: { label: "1시간봉", endpoint: "minutes/60", milliseconds: 3600000 },
  };
  const INITIAL_EQUITY = 100000000;
  const FEE = 0.0005;
  const SLIPPAGE = 0.0008;
  const cache = new Map();

  const style = document.createElement("style");
  style.textContent = `
    .tf-simulator{margin:22px 0;padding:22px;border:1px solid rgba(76,166,255,.35);border-radius:16px;background:linear-gradient(145deg,rgba(11,23,24,.97),rgba(9,15,18,.97));box-shadow:0 18px 44px rgba(0,0,0,.18)}
    .tf-simulator-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:17px}.tf-simulator-head h2{margin:3px 0 7px;font-size:24px}.tf-simulator-head p{margin:0;color:var(--muted);line-height:1.6}.tf-simulator-badge{white-space:nowrap;border:1px solid rgba(76,166,255,.55);border-radius:999px;padding:8px 12px;color:#8fd0ff;background:rgba(76,166,255,.09);font-size:12px;font-weight:850}
    .tf-controls{display:grid;grid-template-columns:repeat(4,minmax(145px,1fr)) auto;gap:11px;align-items:end;padding:14px;border:1px solid var(--line);border-radius:12px;background:#090f10}.tf-controls label{display:grid;gap:6px;color:var(--muted);font-size:12px}.tf-controls select,.tf-controls button{min-height:42px;border:1px solid #34504b;border-radius:9px;background:#0c1515;color:var(--text);padding:0 12px;font:inherit}.tf-controls button{border-color:#4ca6ff;background:#4ca6ff;color:#06101a;font-weight:900;cursor:pointer}.tf-controls button:disabled{opacity:.55;cursor:wait}
    .tf-status{margin:12px 2px;color:#9fb8b1;font-size:13px}.tf-status.is-error{color:#ff8c84}.tf-result-meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.tf-result-meta span{padding:6px 9px;border-radius:7px;background:#111c1b;color:#b9cdc7;font-size:12px}
    .tf-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px;margin:14px 0}.tf-summary-card{padding:12px;border:1px solid var(--line);border-top:3px solid var(--strategy-color);border-radius:10px;background:#0a1111}.tf-summary-card span,.tf-summary-card small{display:block;color:var(--muted);font-size:11px}.tf-summary-card strong{display:block;margin:7px 0 5px;color:var(--strategy-color);font-size:19px}.tf-summary-card em{font-style:normal;color:var(--text);font-size:12px}
    .tf-chart-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:#070c0d}.tf-chart{display:block;width:100%;min-width:760px;height:auto}.tf-table-wrap{overflow:auto;margin-top:13px;max-height:390px;border:1px solid var(--line);border-radius:11px}.tf-table{width:100%;border-collapse:collapse;font-size:12px}.tf-table th{position:sticky;top:0;background:#111b1a;color:#9fb8b1;z-index:1}.tf-table th,.tf-table td{padding:10px 9px;border-bottom:1px solid #20302d;text-align:right;white-space:nowrap}.tf-table th:first-child,.tf-table td:first-child{text-align:left}.tf-positive{color:#72f2bd}.tf-negative{color:#ff776f}.tf-note{margin:12px 0 0;color:#839a94;font-size:11px;line-height:1.65}
    @media(max-width:900px){.tf-controls{grid-template-columns:repeat(2,1fr)}.tf-summary-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.tf-simulator{padding:15px}.tf-simulator-head{display:block}.tf-simulator-badge{display:inline-block;margin-top:10px}.tf-controls{grid-template-columns:1fr}.tf-summary-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const section = document.createElement("section");
  section.className = "tf-simulator";
  section.id = "futures-timeframe-simulator";
  section.innerHTML = `
    <div class="tf-simulator-head"><div><p class="eyebrow">MULTI-TIMEFRAME STRATEGY LAB</p><h2>일봉 · 4시간봉 · 1시간봉 단순 보유 · EMA 35일 · MACD 비교 시뮬레이션</h2><p>종목과 봉 주기를 선택하면 동일한 체결 원칙으로 ${isFutures ? "일곱" : "다섯"} 전략을 동시에 다시 계산합니다.</p></div><span class="tf-simulator-badge">${isFutures ? "선물" : "현물"} 전략 비교</span></div>
    <div class="tf-controls">
      <label>종목<select id="tf-market">${MARKETS.map((symbol) => `<option value="KRW-${symbol}">${symbol}</option>`).join("")}</select></label>
      <label>봉 주기<select id="tf-timeframe"><option value="day">일봉</option><option value="240">4시간봉</option><option value="60">1시간봉</option></select></label>
      <label>분석 봉 수<select id="tf-count"><option value="200">최근 200봉</option><option value="500">최근 500봉</option><option value="1000" selected>최근 1,000봉</option><option value="2000">최근 2,000봉</option></select></label>
      <label>자료<select id="tf-source"><option value="stored">내장 과거 자료</option><option value="latest" selected>최신 공개 시세</option></select></label>
      <label>초기 자산<select id="tf-capital"><option value="100000000">1억원</option><option value="10000000">1천만원</option><option value="1000000">1백만원</option></select></label>
      <button id="tf-run" type="button">단순 보유 · EMA 35일 · MACD 비교 시뮬레이션</button>
    </div>
    <p id="tf-status" class="tf-status">BTC · 최근 1,000개 일봉 기준으로 실행할 수 있습니다.</p>
    <div id="tf-output" hidden><div id="tf-meta" class="tf-result-meta"></div><div id="tf-cards" class="tf-summary-grid"></div><div class="tf-chart-wrap"><svg id="tf-chart" class="tf-chart" viewBox="0 0 1100 430" role="img" aria-label="시간봉별 MACD 1부터 MACD 5까지 누적수익률"></svg></div><div class="tf-table-wrap"><table class="tf-table"><thead><tr><th>전략</th><th>최종 자산</th><th>수익률</th><th>MDD</th><th>비중 변경</th><th>현재 상태</th></tr></thead><tbody id="tf-table-body"></tbody></table></div><p class="tf-note">단순 보유는 첫 평가 봉 다음 시가에 1배 매수 후 보유합니다. EMA는 봉 주기와 무관하게 확정된 35개 일봉으로 계산하며, 종가가 선 위면 롱 100%, 아래면 현금 대기합니다. 확정 일봉 이후 첫 시가에 적용합니다. MACD·RSI는 선택한 봉 주기의 이전 봉 신호를 사용합니다. 종료 보유분은 종가로 평가합니다. 수수료 0.05%, 슬리피지 0.08%를 반영하며 펀딩비·유지증거금·거래소별 강제청산 규칙은 포함하지 않습니다. 진행 중인 최신 봉은 제외되며 결과는 투자 수익을 보장하지 않습니다.</p></div>
  `;
  const anchor = document.querySelector(".live-results") || document.querySelector("main");
  if (anchor?.matches("main")) anchor.prepend(section); else anchor?.insertAdjacentElement("beforebegin", section);

  const dataSource = section.querySelector("#tf-source");
  const marketSelect = section.querySelector("#tf-market");
  const timeframeSelect = section.querySelector("#tf-timeframe");
  const countSelect = section.querySelector("#tf-count");
  const capitalSelect = section.querySelector("#tf-capital");
  const runButton = section.querySelector("#tf-run");
  const status = section.querySelector("#tf-status");
  const output = section.querySelector("#tf-output");

  if (window.__COIN_DATA__?.market) marketSelect.value = window.__COIN_DATA__.market;
  status.textContent = `${marketSelect.value.replace("KRW-", "")} · 최근 1,000개 일봉 기준으로 실행할 수 있습니다.`;
  runButton.addEventListener("click", runSimulation);
  [marketSelect, timeframeSelect, countSelect, capitalSelect, dataSource].forEach((element) => element.addEventListener("change", () => {
    output.hidden = true;
    status.classList.remove("is-error");
    status.textContent = `${marketSelect.value.replace("KRW-", "")} · 최근 ${Number(countSelect.value).toLocaleString()}개 ${TIMEFRAMES[timeframeSelect.value].label} 기준으로 실행할 수 있습니다.`;
  }));

  async function runSimulation() {
    const market = marketSelect.value;
    const timeframe = timeframeSelect.value;
    const count = Number(countSelect.value);
    const initialEquity = Number(capitalSelect.value) || INITIAL_EQUITY;
    runButton.disabled = true;
    [marketSelect, timeframeSelect, countSelect, capitalSelect, dataSource].forEach(el => { el.disabled = true; });
    output.hidden = true;
    status.classList.remove("is-error");
    try {
      status.textContent = `${market.replace("KRW-", "")} ${TIMEFRAMES[timeframe].label} ${count.toLocaleString()}봉 ${dataSource.value === "stored" ? "내장 자료 읽는 중" : "다운로드 중"}…`;
      const candles = dataSource.value === "stored" ? await storedCandles(market, timeframe, count) : await fetchCandles(market, timeframe, count, (loaded) => {
        status.textContent = `${market.replace("KRW-", "")} ${TIMEFRAMES[timeframe].label} 다운로드 ${loaded.toLocaleString()}/${count.toLocaleString()}봉`;
      });
      if (candles.length < 80) throw new Error(`MACD 계산에 필요한 봉이 부족합니다 (${candles.length}봉)`);
      status.textContent = `단순 보유 · EMA 35일 · MACD 비교 전략을 계산하고 있습니다…`;
      const daily = dataSource.value === "stored" ? await storedCandles(market, "day", Infinity) : await fetchCandles(market, "day", Math.min(2000, Math.ceil((Date.now() - candles[0].timestamp) / 86400000) + 200), () => {});
      const results = simulateAll(candles, market, initialEquity, daily);
      renderResults(results, candles, market, timeframe);
      status.textContent = `${market.replace("KRW-", "")} ${TIMEFRAMES[timeframe].label} 단순 보유 · EMA 35일 · MACD 비교 시뮬레이션 완료`;
    } catch (error) {
      status.classList.add("is-error");
      status.textContent = `시뮬레이션 실패: ${String(error?.message || error)}`;
    } finally {
      runButton.disabled = false;
      [marketSelect, timeframeSelect, countSelect, capitalSelect, dataSource].forEach(el => { el.disabled = false; });
    }
  }

  async function storedCandles(market, timeframe, count) {
    const key = { day: "d1", "240": "h4", "60": "h1" }[timeframe];
    let data = window.__COIN_DATA__?.market === market ? window.__COIN_DATA__ : cache.get("stored|" + market);
    if (!data) {
      const response = await fetch(market.replace("KRW-", "") + "-MACD-RSI-V2.3-ALL.html");
      if (!response.ok) throw Error("내장 코인 자료 읽기 실패");
      const text = await response.text(), marker = /window\.__COIN_DATA__\s*=\s*/.exec(text);
      if (!marker) throw Error("내장 가격 데이터 없음");
      const start = marker.index + marker[0].length;
      let depth = 0, quoted = false, escaped = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { data = JSON.parse(text.slice(start, i + 1)); break; }
      }
      if (!data) throw Error("내장 가격 데이터 형식 오류");
      cache.set("stored|" + market, data);
    }
    const rows = window.CoinBaselines.normalize(data.candles[key] || []);
    return rows.filter(c => c.timestamp + TIMEFRAMES[timeframe].milliseconds <= Date.now()).slice(-count);
  }

  async function fetchCandles(market, timeframe, requestedCount, onProgress) {
    const cacheKey = `${market}|${timeframe}|${requestedCount}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const config = TIMEFRAMES[timeframe];
    try {
      onProgress(0);
      const proxy = await fetch(`/api/candles?${new URLSearchParams({ market, timeframe, count: String(requestedCount) })}`, { cache: "no-store" });
      if (proxy.ok) {
        const payload = await proxy.json();
        if (Array.isArray(payload.candles) && payload.candles.length) {
          const candles = payload.candles.map((candle) => ({ timestamp: Number(candle.timestamp), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) })).filter((candle) => Number.isFinite(candle.timestamp) && candle.timestamp + config.milliseconds <= Date.now() && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0).sort((a, b) => a.timestamp - b.timestamp).slice(-requestedCount);
          onProgress(candles.length);
          cache.set(cacheKey, candles);
          return candles;
        }
      }
    } catch {}

    // 로컬 정적 서버에서는 Vercel API가 없으므로 Upbit 공개 API를 직접 사용합니다.
    const rows = new Map();
    const fetchTarget = requestedCount + 1;
    let to = null;
    while (rows.size < fetchTarget) {
      const amount = Math.min(200, fetchTarget - rows.size);
      const query = new URLSearchParams({ market, count: String(amount) });
      if (to) query.set("to", to);
      const response = await fetch(`https://api.upbit.com/v1/candles/${config.endpoint}?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Upbit 시세 연결 오류 (${response.status})`);
      const page = await response.json();
      if (!Array.isArray(page) || !page.length) break;
      for (const candle of page) {
        const timestamp = Date.parse(`${candle.candle_date_time_utc}Z`);
        if (!Number.isFinite(timestamp)) continue;
        rows.set(timestamp, { timestamp, open: Number(candle.opening_price), high: Number(candle.high_price), low: Number(candle.low_price), close: Number(candle.trade_price) });
      }
      onProgress(Math.min(requestedCount, rows.size));
      const oldest = page.at(-1)?.candle_date_time_utc;
      if (!oldest || page.length < amount) break;
      to = new Date(Date.parse(`${oldest}Z`) - 1).toISOString().replace(".000Z", "Z");
      if (rows.size < fetchTarget) await delay(125);
    }
    const now = Date.now();
    const completeCutoff = Math.floor(now / config.milliseconds) * config.milliseconds;
    const candles = [...rows.values()].filter((candle) => candle.timestamp < completeCutoff && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0).sort((a, b) => a.timestamp - b.timestamp).slice(-requestedCount);
    cache.set(cacheKey, candles);
    return candles;
  }

  function simulateAll(candles, market, initialEquity, daily = candles) {
    const closes = candles.map((candle) => candle.close);
    const rsi14 = rsi(closes, 14);
    const macd12 = macd(closes, 12, 26, 9);
    const macd18 = macd(closes, 18, 39, 9);
    const plans = {
      "MACD 1": planMacd1(macd12.line, rsi14),
      "MACD 2": planAllocation(macd12.line, macd12.signal, false, false),
      "MACD 3": planAllocation(macd18.line, macd18.signal, false, false),
      "MACD 4": planAllocation(macd18.line, macd18.signal, true, false),
      "MACD 5": planAllocation(macd18.line, macd18.signal, true, true),
    };
    return [...window.CoinBaselines.run(candles, daily, { market, initialEquity }), ...STRATEGIES.map((strategy) => simulate(candles, plans[strategy.id], strategy, market, initialEquity))];
  }

  function simulate(candles, plan, strategy, market, initialEquity, costs = {}) {
    let cash = initialEquity, quantity = 0, exposure = 0, peak = initialEquity, changes = 0, liquidated = false;
    const curve = [{ timestamp: candles[0].timestamp, equity: initialEquity, return: 0, drawdown: 0 }];
    for (let index = 1; index < candles.length; index += 1) {
      const candle = candles[index];
      if (liquidated) { curve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1 }); continue; }
      const target = Number.isFinite(plan[index - 1]) ? plan[index - 1] : exposure;
      const openingEquity = cash + quantity * candle.open;
      if (!(openingEquity > 0)) { liquidated = true; cash = 0; quantity = 0; exposure = 0; curve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1 }); continue; }
      if (target !== exposure) {
        ({ cash, quantity } = rebalance(cash, quantity, target, candle.open, costs));
        exposure = target;
        changes += 1;
      }
      const adversePrice = quantity > 0 ? candle.low : quantity < 0 ? candle.high : candle.close;
      if (!(cash + quantity * adversePrice > 0)) { liquidated = true; cash = 0; quantity = 0; exposure = 0; curve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1 }); continue; }
      if (costs.dailyHolding) cash -= Math.abs(quantity) * candle.close * costs.dailyHolding;
      if (costs.closeAtEnd && index === candles.length - 1 && quantity) {
        ({ cash, quantity } = rebalance(cash, quantity, 0, candle.close, costs));
        exposure = 0; changes += 1;
      }
      const equity = cash + quantity * candle.close;
      if (!(equity > 0)) { liquidated = true; cash = 0; quantity = 0; exposure = 0; curve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1 }); continue; }
      peak = Math.max(peak, equity);
      curve.push({ timestamp: candle.timestamp, equity, return: equity / initialEquity - 1, drawdown: Math.max(0, 1 - equity / peak) });
    }
    const finalEquity = curve.at(-1).equity;
    return { ...strategy, market, initialEquity, finalEquity, totalReturn: finalEquity / initialEquity - 1, maxDrawdown: Math.max(...curve.map((point) => point.drawdown)), changes, exposure, liquidated, curve };
  }

  function planMacd1(line, rsiValues) {
    const plan = Array(line.length).fill(0);
    let held = false;
    for (let index = 1; index < line.length; index += 1) {
      if (!Number.isFinite(line[index]) || !Number.isFinite(line[index - 1])) { plan[index] = held ? 1 : 0; continue; }
      if (line[index - 1] <= 0 && line[index] > 0 && rsiValues[index] > 30) held = true;
      if (line[index - 1] >= 0 && line[index] < 0) held = false;
      plan[index] = held ? 1 : 0;
    }
    return plan;
  }

  function planAllocation(line, signal, allowShort, firstGoldenLeverage) {
    const plan = Array(line.length).fill(0);
    let previousLine = null, previousDiff = null, firstGoldenArmed = false, firstGoldenActive = false;
    for (let index = 0; index < line.length; index += 1) {
      if (!Number.isFinite(line[index]) || !Number.isFinite(signal[index])) continue;
      const diff = line[index] - signal[index];
      const zeroUp = Number.isFinite(previousLine) && previousLine <= 0 && line[index] > 0;
      const zeroDown = Number.isFinite(previousLine) && previousLine >= 0 && line[index] < 0;
      const golden = Number.isFinite(previousDiff) && previousDiff <= 0 && diff > 0;
      const dead = Number.isFinite(previousDiff) && previousDiff >= 0 && diff < 0;
      if (zeroUp) { firstGoldenArmed = true; firstGoldenActive = false; }
      if (zeroDown) { firstGoldenArmed = false; firstGoldenActive = false; }
      if (golden && line[index] > 0 && firstGoldenArmed) { firstGoldenActive = true; firstGoldenArmed = false; }
      if (dead) firstGoldenActive = false;
      const belowDead = allowShort ? -1 : 0;
      const baseline = line[index] >= 0 ? (diff >= 0 ? 1 : 0.5) : (diff >= 0 ? 0.5 : belowDead);
      plan[index] = firstGoldenLeverage ? (line[index]>=0?(diff>=0?2:.5):(diff>=0?.5:-2)) : baseline;
      previousLine = line[index]; previousDiff = diff;
    }
    return plan;
  }

  function rebalance(cash, quantity, target, rawPrice, costs = {}) {
    const fee = costs.fee ?? FEE, slippage = costs.slippage ?? SLIPPAGE;
    const equity = cash + quantity * rawPrice;
    let targetQuantity = equity * target / rawPrice;
    if (costs.noBorrow && targetQuantity > quantity) targetQuantity = Math.min(targetQuantity, quantity + Math.max(0, cash) / (rawPrice * (1 + slippage) * (1 + fee)));
    const delta = targetQuantity - quantity;
    if (delta > 0) { const price = rawPrice * (1 + slippage); const cost = delta * price; return { cash: cash - cost * (1 + fee), quantity: targetQuantity }; }
    if (delta < 0) { const units = -delta; const price = rawPrice * (1 - slippage); const proceeds = units * price; return { cash: cash + proceeds * (1 - fee), quantity: targetQuantity }; }
    return { cash, quantity };
  }

  function macd(values, fastPeriod, slowPeriod, signalPeriod) {
    const fast = ema(values, fastPeriod), slow = ema(values, slowPeriod);
    const line = values.map((_, index) => Number.isFinite(fast[index]) && Number.isFinite(slow[index]) ? fast[index] - slow[index] : null);
    const finite = line.filter(Number.isFinite), compactSignal = ema(finite, signalPeriod), signal = Array(line.length).fill(null);
    let cursor = 0;
    for (let index = 0; index < line.length; index += 1) if (Number.isFinite(line[index])) signal[index] = compactSignal[cursor++];
    return { line, signal };
  }

  function ema(values, period) {
    const output = Array(values.length).fill(null);
    if (values.length < period) return output;
    output[period - 1] = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    const weight = 2 / (period + 1);
    for (let index = period; index < values.length; index += 1) output[index] = values[index] * weight + output[index - 1] * (1 - weight);
    return output;
  }

  function rsi(values, period) {
    const output = Array(values.length).fill(null);
    if (values.length <= period) return output;
    let gains = 0, losses = 0;
    for (let index = 1; index <= period; index += 1) { const change = values[index] - values[index - 1]; gains += Math.max(0, change); losses += Math.max(0, -change); }
    let averageGain = gains / period, averageLoss = losses / period;
    output[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    for (let index = period + 1; index < values.length; index += 1) { const change = values[index] - values[index - 1]; averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period; averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period; output[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss); }
    return output;
  }

  // The comparison starts every strategy with equal cash, after 120 warm-up bars.
  // Signals use completed previous bars; warm-up profits never enter the ranking.
  function compareCoin(history, market, start, end, costs) {
    const DAY = 86400000;
    for (const key of ['fee', 'slippage', 'dailyHolding']) if (!Number.isFinite(costs[key]) || costs[key] < 0 || costs[key] > .02) throw Error('비용 입력 범위 오류');
    const rows = history.filter(c => c.timestamp <= end).sort((a,b) => a.timestamp-b.timestamp);
    const first = rows.findIndex(c => c.timestamp === start);
    if (first < 120 || rows.at(-1)?.timestamp !== end) throw Error('동일 기간 또는 준비 일봉 부족');
    for (let i = first - 120; i < rows.length; i++) {
      const c = rows[i];
      if (![c.open,c.high,c.low,c.close].every(v => Number.isFinite(v) && v > 0) || c.high < Math.max(c.open,c.close) || c.low > Math.min(c.open,c.close) || (i > first - 120 && c.timestamp - rows[i-1].timestamp !== DAY)) throw Error('일봉 누락 또는 가격 오류');
    }
    const closes=rows.map(c=>c.close), m12=macd(closes,12,26,9), m18=macd(closes,18,39,9), e35=ema(closes,35);
    let held=0;
    const plans={
      '단순 보유': closes.map(()=>1),
      'EMA 35일': closes.map((v,i)=>{if(Number.isFinite(e35[i])) {if(v>e35[i])held=1;else if(v<e35[i])held=0;}return held;}),
      'MACD 1':planMacd1(m12.line,rsi(closes,14)),
      'MACD 2':planAllocation(m12.line,m12.signal,false,false),
      'MACD 3':planAllocation(m18.line,m18.signal,false,false),
      'MACD 4':planAllocation(m18.line,m18.signal,true,false),
      'MACD 5':planAllocation(m18.line,m18.signal,true,true)
    };
    // Include an initial cash anchor; first trade occurs at start's open.
    const bars=rows.slice(first-1), definitions=[{id:'단순 보유',name:'1배 보유'},{id:'EMA 35일',name:'일봉 종가 / EMA35'},...STRATEGIES];
    return definitions.map(strategy=>{
      const plan=plans[strategy.id].slice(first-1), options={...costs,closeAtEnd:true};
      const result=simulate(bars,plan,strategy,market,10000,options);
      const stress=simulate(bars,plan,strategy,market,10000,{...options,fee:costs.fee*2,slippage:costs.slippage*2,dailyHolding:costs.dailyHolding*2});
      const periods=[];
      for(let i=30;i<result.curve.length;i+=30) {const prev=result.curve[i-30].equity;periods.push(prev>0?result.curve[i].equity/prev-1:-1);}
      const positive=periods.filter(v=>v>0).length,frequency=periods.length?positive/periods.length:0;
      return {...result,stressReturn:stress.totalReturn,positive,periods:periods.length,frequency,fee:costs.fee,slippage:costs.slippage,
        score: result.totalReturn>0 ? result.totalReturn/(result.maxDrawdown+.05)*frequency : -Infinity};
    });
  }

  function rankComparisons(results) {
    const sorted=results.filter(r=>Number.isFinite(r.totalReturn)&&Number.isFinite(r.maxDrawdown)).sort((a,b)=>b.totalReturn-a.totalReturn || a.maxDrawdown-b.maxDrawdown || (a.market+a.id).localeCompare(b.market+b.id));
    const candidates=sorted.filter(r=>r.totalReturn>0 && r.stressReturn>0 && !r.liquidated && r.periods>=6 && r.frequency>=2/3 && r.maxDrawdown<=.35).sort((a,b)=>b.score-a.score || b.totalReturn-a.totalReturn || (a.market+a.id).localeCompare(b.market+b.id));
    return {sorted,highest:sorted[0]||null,candidate:candidates[0]||null};
  }

  function renderResults(results, candles, market, timeframe) {
    const label = TIMEFRAMES[timeframe].label;
    const start = candles[0].timestamp, end = candles.at(-1).timestamp;
    section.querySelector("#tf-meta").innerHTML = `<span>${market.replace("KRW-", "")}</span><span>${dataSource.value === "stored" ? "내장 과거 자료" : "최신 공개 시세"}</span><span>${label}</span><span>${candles.length.toLocaleString()}봉</span><span>${formatDate(start, timeframe)} ~ ${formatDate(end, timeframe)}</span><span>다음 봉 시가 체결</span>`;
    section.querySelector("#tf-cards").innerHTML = results.map((result) => `<article class="tf-summary-card" style="--strategy-color:${result.color}"><span>${result.id} · ${result.name}</span><strong>${formatPercent(result.totalReturn)}</strong><em>최종 ${formatWon(result.finalEquity)}</em><small>MDD ${formatPercent(-result.maxDrawdown)} · 변경 ${result.changes}회${result.liquidated ? " · 청산" : ""}</small></article>`).join("");
    section.querySelector("#tf-table-body").innerHTML = results.map((result) => `<tr><td style="color:${result.color};font-weight:850">${result.id} · ${result.name}</td><td>${formatWon(result.finalEquity)}</td><td class="${result.totalReturn >= 0 ? "tf-positive" : "tf-negative"}">${formatPercent(result.totalReturn)}</td><td class="tf-negative">${formatPercent(-result.maxDrawdown)}</td><td>${result.changes}회</td><td>${result.liquidated ? "계좌 청산" : exposureLabel(result.exposure)}</td></tr>`).join("");
    drawChart(results, market, label);
    output.hidden = false;
    output.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function drawChart(results, market, timeframeLabel) {
    const svg = section.querySelector("#tf-chart");
    const points = results.flatMap((result) => result.curve);
    const start = Math.min(...points.map((point) => point.timestamp)), end = Math.max(...points.map((point) => point.timestamp));
    const min = Math.min(0, ...points.map((point) => point.return)), max = Math.max(0.01, ...points.map((point) => point.return)), span = max - min || 1;
    const left = 76, right = 1065, top = 80, bottom = 370;
    const x = (timestamp) => left + (timestamp - start) / Math.max(1, end - start) * (right - left);
    const y = (value) => bottom - (value - min) / span * (bottom - top);
    const ticks = Array.from({ length: 5 }, (_, index) => min + span * index / 4);
    const grid = ticks.map((value) => `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#20302d"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" fill="#829b94" font-size="11">${(value * 100).toFixed(0)}%</text>`).join("");
    const paths = results.map((result) => `<path d="${result.curve.map((point, index) => `${index ? "L" : "M"}${x(point.timestamp).toFixed(1)},${y(point.return).toFixed(1)}`).join(" ")}" fill="none" stroke="${result.color}" stroke-width="2.4"${result.id === "MACD 3" ? ' stroke-dasharray="8 4"' : result.id === "MACD 4" ? ' stroke-dasharray="12 4"' : result.id === "MACD 5" ? ' stroke-dasharray="5 3"' : ""}><title>${result.id} ${formatPercent(result.totalReturn)}</title></path>`).join("");
    const legend = results.map((result, index) => `<g transform="translate(${left + (index % 4) * 247},${18 + Math.floor(index / 4) * 25})"><line x1="0" y1="0" x2="24" y2="0" stroke="${result.color}" stroke-width="4"/><text x="31" y="4" fill="#bdd0cb" font-size="12">${result.id} ${formatPercent(result.totalReturn)}</text></g>`).join("");
    const dates = [start, start + (end - start) / 2, end].map((timestamp) => `<text x="${x(timestamp)}" y="402" text-anchor="middle" fill="#829b94" font-size="11">${new Date(timestamp).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })}</text>`).join("");
    svg.innerHTML = `<title>${market.replace("KRW-", "")} ${timeframeLabel} 단순 보유 · EMA 35일 · MACD 비교 누적수익률</title>${legend}${grid}<line x1="${left}" y1="${y(0)}" x2="${right}" y2="${y(0)}" stroke="#55716a" stroke-dasharray="3 4"/>${paths}${dates}`;
  }

  function exposureLabel(value) { return value === -2 ? "숏 2배" : value === 2 ? "롱 2배" : value === 1 ? "롱 100%" : value === 0.5 ? "롱 50%" : value === -1 ? "숏 100%" : "현금 100%"; }
  function formatPercent(value) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }
  function formatWon(value) { return `${Math.max(0, Math.round(value)).toLocaleString("ko-KR")}원`; }
  function formatDate(timestamp, timeframe) { const options = timeframe === "day" ? { year: "numeric", month: "2-digit", day: "2-digit" } : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }; return new Date(timestamp).toLocaleString("ko-KR", options); }
  function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

  installRecommendation();
  function installRecommendation() {
    const button=document.createElement('button');
    button.type='button';button.textContent='12코인 비용 반영 추천 비교';button.className='rc-launch';
    (document.querySelector('header') || section).appendChild(button);
    const style=document.createElement('style');style.textContent=`
      .rc-launch{padding:12px 18px;border:1px solid #72f2bd;border-radius:10px;background:#133e32;color:#e4fff2;font-weight:800;cursor:pointer;margin-bottom:16px}
      #coin-recommendation{width:min(1040px,94vw);max-height:88vh;box-sizing:border-box;background:#101e1b;color:#e5f6ef;border:1px solid #467565;border-radius:16px;padding:24px;font:15px/1.65 system-ui;overflow:auto}
      #coin-recommendation::backdrop{background:#000b}#coin-recommendation h2{margin:0;font-size:24px}#coin-recommendation h3{margin:0 0 8px;font-size:18px}
      #coin-recommendation button{width:auto;padding:10px 14px;border:1px solid #72f2bd;border-radius:8px;background:#193e32;color:#fff;cursor:pointer}#coin-recommendation button:disabled{opacity:.5;cursor:wait}
      #rc-form{display:block}#coin-recommendation .rc-controls{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}#coin-recommendation label{display:grid;gap:4px;font-size:13px;flex:0 1 190px;width:auto;min-width:0}#coin-recommendation input,#coin-recommendation select{padding:9px;border:1px solid #638779;border-radius:6px;background:#091410;color:#fff;width:100%;box-sizing:border-box}
      #coin-recommendation .rc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}#coin-recommendation article{padding:18px;border:1px solid #456c5f;border-radius:12px;background:#142b23}#coin-recommendation strong{color:#8ff3c4}#coin-recommendation .rc-scroll{overflow:auto}#coin-recommendation table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:13px}#coin-recommendation td,#coin-recommendation th{padding:10px;text-align:right;border-bottom:1px solid #335346}#coin-recommendation th:first-child,#coin-recommendation td:first-child{text-align:left}#coin-recommendation small{color:#b5cabe}#coin-recommendation a{color:#8edbff}#coin-recommendation .rc-close{float:right}
    `;document.head.appendChild(style);
    const dialog=document.createElement('dialog');dialog.id='coin-recommendation';dialog.setAttribute('aria-labelledby','rc-title');
    dialog.innerHTML=`<button class="rc-close" type="button" aria-label="추천 팝업 닫기">닫기</button><h2 id="rc-title">비용 반영 · 12코인 추천 비교</h2>
      <p>${isFutures?'비트겟 USDT 선물 · 7개 전략 (84개 조합)':'업비트 KRW 현물 · 5개 전략 (60개 조합). MACD 4·5는 숏·레버리지 전략이므로 현물에서 제외합니다.'}<br>단순 보유 → EMA 35일 → MACD 순서로 모두 계산합니다. 최신 완성 일봉 기준입니다.</p>
      <form id="rc-form"><div class="rc-controls"><label>최근 비교 기간<select name="days"><option value="180">180일</option><option value="360">360일</option></select></label>
      <label>${isFutures?'수수료 하한 / 편도 (%)':'수수료 가정 / 편도 (%)'}<input name="fee" type="number" min="0" max="2" step="0.001" value="${isFutures?'0.06':'0.05'}" required></label>
      <label>슬리피지 하한 / 편도 (%)<input name="slippage" type="number" min="0" max="2" step="0.001" value="0.08" required></label>
      ${isFutures?'<label>보유 비용 / 일 (%)<input name="holding" type="number" min="0" max="2" step="0.001" value="0.03" required></label>':''}</div>
      <button type="submit" id="rc-run">최신 시세로 비교·추천</button> <button type="button" id="rc-cancel" hidden>조회 중단</button></form>
      <p><small>비용은 체결금액에 부과하며 마지막 날 전량 정리 비용도 포함합니다. 슬리피지는 입력값과 조회 시점 호가 스프레드의 절반 중 큰 값입니다. ${isFutures?'수수료는 입력값과 비트겟 공개 taker 수수료 중 큰 값입니다. 보유 비용은 매일 포지션 절대금액에 차감하는 보수적 가정이며, 실제 과거 펀딩 지급·수취 내역은 아닙니다.':'개인 계정의 실제 수수료를 자동 조회하지 않습니다. 적용 요율을 확인하고 입력하세요.'}</small></p>
      <p role="status" aria-live="polite" id="rc-status">조회 버튼을 누르면 동일 기간으로 비교합니다.</p><div id="rc-results"></div>
      <details><summary>추천 기준과 해석</summary><p>수익률 1위는 비용 차감 후 누적수익률 순입니다. 균형 후보는 수익률과 비용 2배 결과가 모두 양수, 최대 낙폭 35% 이하, 겹치지 않는 30일 구간 6개 이상 중 2/3 이상 수익을 조건으로 합니다. 후보 점수 = 수익률 ÷ (최대 낙폭 + 5%p) × 수익 구간 비율입니다. 조건 미달이면 추천을 보류합니다.</p><p>30일 수익 구간 비율은 과거 보유 성과의 일관성 지표이며 거래 승률이나 미래 성공 확률이 아닙니다. 같은 자료로 여러 조합을 비교하므로 선택 편향이 있고 별도 미래 검증을 거치지 않았습니다. 매매 횟수는 진입·비중 변경·종료 횟수입니다. 120일 이상 지표 준비 기간은 수익에서 제외합니다. 선물 청산은 단순 자산 소진 모델로 실제 유지증거금·장중 체결·세금과 다릅니다.</p><p><a href="https://docs.upbit.com/kr/reference/available-order-information" target="_blank" rel="noopener">업비트 수수료 확인</a> · <a href="https://www.bitget.com/support/articles/12560603808908" target="_blank" rel="noopener">비트겟 펀딩비 안내</a></p></details>`;
    document.body.appendChild(dialog);
    const $=s=>dialog.querySelector(s);let controller=null;
    button.onclick=()=>dialog.showModal();$('.rc-close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{controller?.abort();button.focus();});
    $('#rc-cancel').onclick=()=>controller?.abort();
    $('#rc-form').addEventListener('input',()=>{$('#rc-results').replaceChildren();$('#rc-status').textContent='조건이 변경되었습니다. 다시 비교하세요.';});
    const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const pct=v=>`${(v*100).toFixed(2)}%`;
    async function json(query,signal){const response=await fetch('/api/exchange?'+new URLSearchParams(query),{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});const data=await response.json();if(!response.ok||data.error)throw Error(data.error||'거래소 조회 실패');return data;}
    $('#rc-form').onsubmit=async event=>{
      event.preventDefault();if(controller)return;
      const form=new FormData(event.currentTarget),days=Number(form.get('days')),fee=Number(form.get('fee'))/100,slippage=Number(form.get('slippage'))/100,dailyHolding=isFutures?Number(form.get('holding'))/100:0;
      controller=new AbortController();const signal=controller.signal;
      $('#rc-results').replaceChildren();for(const el of $('#rc-form').querySelectorAll('input,select,button[type="submit"]'))el.disabled=true;$('#rc-cancel').hidden=false;
      const exchange=isFutures?'bitget':'upbit',DAY=86400000, histories=[],excluded=[];
      try {
        // First page determines the last complete exchange day, avoiding client clock skew.
        let end=null,start=null;
        for(const coin of MARKETS){
          if(signal.aborted)throw Error('조회 중단');
          $('#rc-status').textContent=`${coin} 최신 시세·비용 확인 중 (${histories.length+excluded.length+1}/12)`;
          try {
            const quote=await json({exchange,coin},signal),map=new Map();let until=null;
            for(let page=0;page<9;page++){
              const data=await json({exchange,coin,action:'candles',...(until===null?{}:{end:String(until)})},signal);
              if(!data.candles?.length)break;
              for(const c of data.candles)map.set(c.timestamp,c);
              const first=Math.min(...data.candles.map(c=>c.timestamp));
              if(until!==null&&first>=until)throw Error('과거 일봉 페이지 오류');
              const latest=Math.max(...map.keys());if(latest-first>=(days+120)*DAY)break;
              until=isFutures?first+DAY:first-1;
            }
            const rows=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp);
            const last=rows.at(-1)?.timestamp;
            if(!Number.isFinite(last)||!Number.isFinite(Number(quote.at))||Number(quote.at)-(last+DAY)>36*3600000||last+DAY>Number(quote.at))throw Error('최신 완성 일봉 부족');
            if(end===null){end=last;start=end-(days-1)*DAY;}
            const bid=Number(quote.bid),ask=Number(quote.ask),publicFee=isFutures?Number(quote.meta?.fee):fee;
            if(!(bid>0&&ask>=bid)||!Number.isFinite(publicFee)||publicFee<0)throw Error('호가 또는 수수료 누락');
            const costs={fee:Math.max(fee,publicFee),slippage:Math.max(slippage,(ask-bid)/(ask+bid)),dailyHolding,noBorrow:!isFutures};
            const results=compareCoin(rows,coin,start,end,costs);
            histories.push({coin,results,at:quote.at});
          }catch(error){if(signal.aborted)throw error;excluded.push(coin+': '+error.message);}
        }
        if(signal.aborted)throw Error('조회 중단');
        const {sorted,highest,candidate}=rankComparisons(histories.flatMap(h=>h.results));
        if(!highest)throw Error('비교 가능한 종목이 없습니다. '+excluded.join(' / '));
        const title=r=>escape(r.market+' · '+r.id);
        const detail=r=>`비용 반영 수익률 <strong>${pct(r.totalReturn)}</strong> · 최대 낙폭 ${pct(r.maxDrawdown)}<br>30일 수익 구간 ${r.positive}/${r.periods} (${pct(r.frequency)}) · 비중 변경·종료 ${r.changes}회<br>비용 2배 시 수익률 ${pct(r.stressReturn)}`;
        $('#rc-results').innerHTML=`<p>${new Date(start).toISOString().slice(0,10)} ~ ${new Date(end).toISOString().slice(0,10)} (UTC 일봉) · ${histories.length}/12종목 · ${sorted.length}개 조합<br><small>시세 조회 ${escape(new Date(Math.min(...histories.map(h=>Number(h.at)))).toLocaleString('ko-KR'))} · ${isFutures?'USDT':'KRW'} 기준 수익률 · 시작 자금 동일</small></p>
          ${excluded.length?'<p>일부 종목 제외 — 전체 12종목의 1위를 확정할 수 없습니다.<br>'+excluded.map(escape).join('<br>')+'</p>':''}
          <div class="rc-cards"><article><h3>${highest.totalReturn>0?'비교 대상 수익률 1위':'전체 손실 · 가장 작은 손실'}</h3><strong>${title(highest)}</strong><p>${detail(highest)}</p><small>동일 기간 비용 차감 수익률이 가장 높습니다.${highest.totalReturn<=0?' 양수 수익 조합이 없어 투자 추천을 보류합니다.':''}</small></article>
          <article><h3>낙폭·일관성 고려 후보</h3>${candidate?`<strong>${title(candidate)}</strong><p>${detail(candidate)}</p><small>낙폭 35% 이하, 수익 구간 2/3 이상, 비용 2배에서도 양수입니다. 조건 통과 조합 중 수익률·낙폭·일관성 점수가 가장 높습니다.${excluded.length?' 일부 자료가 누락된 잠정 후보입니다.':''}</small>`:'<p>추천 보류</p><small>낙폭·수익 일관성·비용 민감도 조건을 모두 충족한 조합이 없습니다.</small>'}</article></div>
          <p><strong>미래 성공 확률은 산출하지 않습니다.</strong> 아래 비율은 과거 30일 구간 성과입니다.</p>
          <div class="rc-scroll"><table><caption>모든 코인·전략 비용 반영 순위</caption><thead><tr><th>순위 · 코인 / 전략</th><th>수익률</th><th>최대 낙폭</th><th>수익 구간</th><th>비용 2배</th><th>수수료 / 슬리피지 (편도)</th></tr></thead><tbody>${sorted.map((r,i)=>`<tr><td>${i+1}. ${title(r)}</td><td>${pct(r.totalReturn)}</td><td>${pct(r.maxDrawdown)}</td><td>${r.positive}/${r.periods}</td><td>${pct(r.stressReturn)}</td><td>${pct(r.fee)} / ${pct(r.slippage)}</td></tr>`).join('')}</tbody></table></div>`;
        $('#rc-status').textContent='비교 완료 · 주문은 실행되지 않습니다. 시세와 비용은 조회 시점 기준이며 재조회 시 바뀔 수 있습니다.';
      }catch(error){$('#rc-results').replaceChildren();$('#rc-status').textContent=signal.aborted?'조회를 중단했습니다. 다시 실행할 수 있습니다.':'비교 실패: '+error.message;}
      finally{controller=null;for(const el of $('#rc-form').querySelectorAll('input,select,button[type="submit"]'))el.disabled=false;$('#rc-cancel').hidden=true;}
    };
  }
})();
