(function () {
  "use strict";

  const isFutures = /(^|\/)futures(\/|$)/i.test(decodeURIComponent(location.pathname || "")) || new URLSearchParams(location.search).get("mode") === "futures";
  if (!isFutures) return;

  const MARKETS = ["BTC", "ETH", "XRP", "SOL", "ADA", "DOGE", "AVAX", "DOT", "XLM", "UNI", "LINK", "ONDO"];
  const STRATEGIES = [
    { id: "MACD 1", name: "0선 돌파", color: "#72f2bd" },
    { id: "MACD 2", name: "MACD(12,26,9) 비중", color: "#c891ff" },
    { id: "MACD 3", name: "MACD(18,39,9) 비중", color: "#ff9d5c" },
    { id: "MACD 4", name: "MACD(18,39,9) 롱·숏", color: "#4ca6ff" },
    { id: "MACD 5", name: "첫 골든 롱 2배", color: "#ff5fb7" },
  ];
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
    .tf-summary-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin:14px 0}.tf-summary-card{padding:12px;border:1px solid var(--line);border-top:3px solid var(--strategy-color);border-radius:10px;background:#0a1111}.tf-summary-card span,.tf-summary-card small{display:block;color:var(--muted);font-size:11px}.tf-summary-card strong{display:block;margin:7px 0 5px;color:var(--strategy-color);font-size:19px}.tf-summary-card em{font-style:normal;color:var(--text);font-size:12px}
    .tf-chart-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:#070c0d}.tf-chart{display:block;width:100%;min-width:760px;height:auto}.tf-table-wrap{overflow:auto;margin-top:13px;max-height:390px;border:1px solid var(--line);border-radius:11px}.tf-table{width:100%;border-collapse:collapse;font-size:12px}.tf-table th{position:sticky;top:0;background:#111b1a;color:#9fb8b1;z-index:1}.tf-table th,.tf-table td{padding:10px 9px;border-bottom:1px solid #20302d;text-align:right;white-space:nowrap}.tf-table th:first-child,.tf-table td:first-child{text-align:left}.tf-positive{color:#72f2bd}.tf-negative{color:#ff776f}.tf-note{margin:12px 0 0;color:#839a94;font-size:11px;line-height:1.65}
    @media(max-width:900px){.tf-controls{grid-template-columns:repeat(2,1fr)}.tf-summary-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.tf-simulator{padding:15px}.tf-simulator-head{display:block}.tf-simulator-badge{display:inline-block;margin-top:10px}.tf-controls{grid-template-columns:1fr}.tf-summary-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const section = document.createElement("section");
  section.className = "tf-simulator";
  section.id = "futures-timeframe-simulator";
  section.innerHTML = `
    <div class="tf-simulator-head"><div><p class="eyebrow">MULTI-TIMEFRAME FUTURES LAB</p><h2>일봉 · 4시간봉 · 1시간봉 MACD 1~5 시뮬레이션</h2><p>종목과 봉 주기를 선택하면 동일한 체결 원칙으로 다섯 전략을 동시에 다시 계산합니다.</p></div><span class="tf-simulator-badge">선물 투자 전용</span></div>
    <div class="tf-controls">
      <label>종목<select id="tf-market">${MARKETS.map((symbol) => `<option value="KRW-${symbol}">${symbol}</option>`).join("")}</select></label>
      <label>봉 주기<select id="tf-timeframe"><option value="day">일봉</option><option value="240">4시간봉</option><option value="60">1시간봉</option></select></label>
      <label>분석 봉 수<select id="tf-count"><option value="200">최근 200봉</option><option value="500">최근 500봉</option><option value="1000" selected>최근 1,000봉</option><option value="2000">최근 2,000봉</option></select></label>
      <label>초기 자산<select id="tf-capital"><option value="100000000">1억원</option><option value="10000000">1천만원</option><option value="1000000">1백만원</option></select></label>
      <button id="tf-run" type="button">MACD 1~5 시뮬레이션</button>
    </div>
    <p id="tf-status" class="tf-status">BTC · 최근 1,000개 일봉 기준으로 실행할 수 있습니다.</p>
    <div id="tf-output" hidden><div id="tf-meta" class="tf-result-meta"></div><div id="tf-cards" class="tf-summary-grid"></div><div class="tf-chart-wrap"><svg id="tf-chart" class="tf-chart" viewBox="0 0 1100 430" role="img" aria-label="시간봉별 MACD 1부터 MACD 5까지 누적수익률"></svg></div><div class="tf-table-wrap"><table class="tf-table"><thead><tr><th>전략</th><th>최종 자산</th><th>수익률</th><th>MDD</th><th>비중 변경</th><th>현재 상태</th></tr></thead><tbody id="tf-table-body"></tbody></table></div><p class="tf-note">확정된 이전 봉의 MACD·RSI 상태를 다음 봉 시가에 적용합니다. 수수료 0.05%, 슬리피지 0.08%를 반영하며 펀딩비·유지증거금·거래소별 강제청산 규칙은 포함하지 않습니다. 진행 중인 최신 봉은 제외되며 결과는 투자 수익을 보장하지 않습니다.</p></div>
  `;
  document.querySelector(".live-results")?.insertAdjacentElement("beforebegin", section);

  const marketSelect = section.querySelector("#tf-market");
  const timeframeSelect = section.querySelector("#tf-timeframe");
  const countSelect = section.querySelector("#tf-count");
  const capitalSelect = section.querySelector("#tf-capital");
  const runButton = section.querySelector("#tf-run");
  const status = section.querySelector("#tf-status");
  const output = section.querySelector("#tf-output");

  runButton.addEventListener("click", runSimulation);
  [marketSelect, timeframeSelect, countSelect].forEach((element) => element.addEventListener("change", () => {
    status.classList.remove("is-error");
    status.textContent = `${marketSelect.value.replace("KRW-", "")} · 최근 ${Number(countSelect.value).toLocaleString()}개 ${TIMEFRAMES[timeframeSelect.value].label} 기준으로 실행할 수 있습니다.`;
  }));

  async function runSimulation() {
    const market = marketSelect.value;
    const timeframe = timeframeSelect.value;
    const count = Number(countSelect.value);
    const initialEquity = Number(capitalSelect.value) || INITIAL_EQUITY;
    runButton.disabled = true;
    output.hidden = true;
    status.classList.remove("is-error");
    try {
      status.textContent = `${market.replace("KRW-", "")} ${TIMEFRAMES[timeframe].label} ${count.toLocaleString()}봉 다운로드 중…`;
      const candles = await fetchCandles(market, timeframe, count, (loaded) => {
        status.textContent = `${market.replace("KRW-", "")} ${TIMEFRAMES[timeframe].label} 다운로드 ${loaded.toLocaleString()}/${count.toLocaleString()}봉`;
      });
      if (candles.length < 80) throw new Error(`MACD 계산에 필요한 봉이 부족합니다 (${candles.length}봉)`);
      status.textContent = `MACD 1~5 전략을 계산하고 있습니다…`;
      const results = simulateAll(candles, market, initialEquity);
      renderResults(results, candles, market, timeframe);
      status.textContent = `${market.replace("KRW-", "")} ${TIMEFRAMES[timeframe].label} MACD 1~5 시뮬레이션 완료`;
    } catch (error) {
      status.classList.add("is-error");
      status.textContent = `시뮬레이션 실패: ${String(error?.message || error)}`;
    } finally {
      runButton.disabled = false;
    }
  }

  async function fetchCandles(market, timeframe, requestedCount, onProgress) {
    const cacheKey = `${market}|${timeframe}|${requestedCount}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const config = TIMEFRAMES[timeframe];
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

  function simulateAll(candles, market, initialEquity) {
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
    return STRATEGIES.map((strategy) => simulate(candles, plans[strategy.id], strategy, market, initialEquity));
  }

  function simulate(candles, plan, strategy, market, initialEquity) {
    let cash = initialEquity, quantity = 0, exposure = 0, peak = initialEquity, changes = 0, liquidated = false;
    const curve = [{ timestamp: candles[0].timestamp, equity: initialEquity, return: 0, drawdown: 0 }];
    for (let index = 1; index < candles.length; index += 1) {
      const candle = candles[index];
      if (liquidated) { curve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1 }); continue; }
      const target = Number.isFinite(plan[index - 1]) ? plan[index - 1] : exposure;
      const openingEquity = cash + quantity * candle.open;
      if (!(openingEquity > 0)) { liquidated = true; cash = 0; quantity = 0; exposure = 0; curve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1 }); continue; }
      if (target !== exposure) {
        ({ cash, quantity } = rebalance(cash, quantity, target, candle.open));
        exposure = target;
        changes += 1;
      }
      const adversePrice = quantity > 0 ? candle.low : quantity < 0 ? candle.high : candle.close;
      if (!(cash + quantity * adversePrice > 0)) { liquidated = true; cash = 0; quantity = 0; exposure = 0; curve.push({ timestamp: candle.timestamp, equity: 0, return: -1, drawdown: 1 }); continue; }
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
      plan[index] = firstGoldenLeverage && firstGoldenActive && line[index] > 0 && diff > 0 ? 2 : baseline;
      previousLine = line[index]; previousDiff = diff;
    }
    return plan;
  }

  function rebalance(cash, quantity, target, rawPrice) {
    const equity = cash + quantity * rawPrice;
    const targetQuantity = equity * target / rawPrice;
    const delta = targetQuantity - quantity;
    if (delta > 0) { const price = rawPrice * (1 + SLIPPAGE); const cost = delta * price; return { cash: cash - cost * (1 + FEE), quantity: targetQuantity }; }
    if (delta < 0) { const units = -delta; const price = rawPrice * (1 - SLIPPAGE); const proceeds = units * price; return { cash: cash + proceeds * (1 - FEE), quantity: targetQuantity }; }
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

  function renderResults(results, candles, market, timeframe) {
    const label = TIMEFRAMES[timeframe].label;
    const start = candles[0].timestamp, end = candles.at(-1).timestamp;
    section.querySelector("#tf-meta").innerHTML = `<span>${market.replace("KRW-", "")}</span><span>${label}</span><span>${candles.length.toLocaleString()}봉</span><span>${formatDate(start, timeframe)} ~ ${formatDate(end, timeframe)}</span><span>다음 봉 시가 체결</span>`;
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
    const left = 76, right = 1065, top = 40, bottom = 370;
    const x = (timestamp) => left + (timestamp - start) / Math.max(1, end - start) * (right - left);
    const y = (value) => bottom - (value - min) / span * (bottom - top);
    const ticks = Array.from({ length: 5 }, (_, index) => min + span * index / 4);
    const grid = ticks.map((value) => `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#20302d"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" fill="#829b94" font-size="11">${(value * 100).toFixed(0)}%</text>`).join("");
    const paths = results.map((result) => `<path d="${result.curve.map((point, index) => `${index ? "L" : "M"}${x(point.timestamp).toFixed(1)},${y(point.return).toFixed(1)}`).join(" ")}" fill="none" stroke="${result.color}" stroke-width="2.4"${result.id === "MACD 3" ? ' stroke-dasharray="8 4"' : result.id === "MACD 4" ? ' stroke-dasharray="12 4"' : result.id === "MACD 5" ? ' stroke-dasharray="5 3"' : ""}><title>${result.id} ${formatPercent(result.totalReturn)}</title></path>`).join("");
    const legend = results.map((result, index) => `<g transform="translate(${left + index * 185},18)"><line x1="0" y1="0" x2="24" y2="0" stroke="${result.color}" stroke-width="4"/><text x="31" y="4" fill="#bdd0cb" font-size="12">${result.id} ${formatPercent(result.totalReturn)}</text></g>`).join("");
    const dates = [start, start + (end - start) / 2, end].map((timestamp) => `<text x="${x(timestamp)}" y="402" text-anchor="middle" fill="#829b94" font-size="11">${new Date(timestamp).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })}</text>`).join("");
    svg.innerHTML = `<title>${market.replace("KRW-", "")} ${timeframeLabel} MACD 1~5 누적수익률</title>${legend}${grid}<line x1="${left}" y1="${y(0)}" x2="${right}" y2="${y(0)}" stroke="#55716a" stroke-dasharray="3 4"/>${paths}${dates}`;
  }

  function exposureLabel(value) { return value === 2 ? "롱 2배" : value === 1 ? "롱 100%" : value === 0.5 ? "롱 50%" : value === -1 ? "숏 100%" : "현금 100%"; }
  function formatPercent(value) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }
  function formatWon(value) { return `${Math.max(0, Math.round(value)).toLocaleString("ko-KR")}원`; }
  function formatDate(timestamp, timeframe) { const options = timeframe === "day" ? { year: "numeric", month: "2-digit", day: "2-digit" } : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }; return new Date(timestamp).toLocaleString("ko-KR", options); }
  function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
})();
