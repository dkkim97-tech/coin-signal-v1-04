(function () {
  "use strict";
  const DATA = window.__COIN_DATA__;
  if (!DATA?.candles || document.querySelector("#pattern-forecast-panel")) return;
  let lastPatternResult = null;
  let lastAssistantResult = null;
  let latestSignalState = null;
  let signalMarkerRefreshQueued = false;
  const BTC_VERIFIED_CRASH_CASES = [
    ["2018-03-06","2018-03-09",-.2441],["2018-03-12","2018-03-15",-.1880],["2018-03-24","2018-03-29",-.1757],["2018-05-10","2018-05-11",-.1458],["2018-05-22","2018-05-27",-.1247],["2018-06-10","2018-06-14",-.1306],["2018-08-07","2018-08-11",-.1267],["2018-09-05","2018-09-09",-.1079],
    ["2018-11-14","2018-11-19",-.1763],["2018-11-20","2018-11-25",-.2500],["2018-12-02","2018-12-07",-.1965],["2019-07-13","2019-07-17",-.2077],["2019-08-13","2019-08-15",-.1261],["2019-09-21","2019-09-26",-.1868],["2019-10-22","2019-10-24",-.1075],["2019-11-21","2019-11-25",-.1640],
    ["2020-03-09","2020-03-13",-.4185],["2020-03-15","2020-03-16",-.1183],["2020-03-27","2020-03-30",-.1145],["2021-01-20","2021-01-22",-.1825],["2021-04-18","2021-04-23",-.2502],["2021-05-08","2021-05-13",-.1432],["2021-05-14","2021-05-19",-.3135],["2021-05-20","2021-05-24",-.2403],
    ["2021-05-27","2021-05-30",-.1493],["2021-06-04","2021-06-09",-.1599],["2021-06-18","2021-06-22",-.2219],["2021-06-24","2021-06-26",-.1030],["2022-01-05","2022-01-10",-.1387],["2022-01-17","2022-01-22",-.1739],["2022-02-19","2022-02-24",-.1234],["2022-03-03","2022-03-08",-.1230],
    ["2022-05-06","2022-05-11",-.1515],["2022-06-13","2022-06-18",-.1699],["2022-11-05","2022-11-10",-.2402],["2024-01-02","2024-01-03",-.1037],["2024-04-27","2024-05-01",-.1209],["2024-07-02","2024-07-05",-.1135],["2024-08-01","2024-08-05",-.1971],["2025-02-21","2025-02-26",-.1436],
    ["2025-03-05","2025-03-10",-.1067],["2025-11-01","2025-11-05",-.1056],["2025-11-13","2025-11-18",-.1402],["2025-11-19","2025-11-21",-.1104],["2026-01-31","2026-02-05",-.1627],["2026-05-31","2026-06-05",-.1655]
  ].map(([signalDate, troughDate, drawdown]) => ({ signalDate, troughDate, drawdown }));
  const BTC_VERIFIED_CRASH_BY_DATE = new Map(BTC_VERIFIED_CRASH_CASES.map((item) => [item.signalDate, item]));
  normalizeDailySeries();

  const style = document.createElement("style");
  style.textContent = `
    .pattern-panel{background:rgba(17,23,22,.94);border:1px solid var(--line);border-radius:17px;padding:22px;margin-bottom:14px}.pattern-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.pattern-head h2{margin:4px 0 6px}.pattern-head p{color:var(--muted);font-size:12px;margin:0}.pattern-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.pattern-controls label{display:grid;gap:5px;color:var(--muted);font-size:11px}.pattern-controls select,.pattern-controls button{background:#0d1211;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:9px 11px;font:inherit}.pattern-controls button{border-color:var(--mint);color:var(--mint);font-weight:800;cursor:pointer}.pattern-meta{margin:14px 0;color:var(--muted);font-size:12px}.pattern-probabilities{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.pattern-probability{padding:15px;border:1px solid var(--line);border-radius:12px;background:#0d1211}.pattern-probability span{display:block;color:var(--muted);font-size:11px}.pattern-probability strong{display:block;margin-top:6px;font-size:25px}.pattern-probability.up strong{color:var(--mint)}.pattern-probability.flat strong{color:var(--amber)}.pattern-probability.down strong{color:var(--red)}.pattern-bar{display:flex;height:12px;overflow:hidden;border-radius:999px;margin:12px 0;background:#1a211f}.pattern-bar i{display:block;height:100%}.pattern-bar .up{background:var(--mint)}.pattern-bar .flat{background:var(--amber)}.pattern-bar .down{background:var(--red)}.pattern-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}.pattern-summary>div{padding:13px;background:#0d1211}.pattern-summary span{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.pattern-summary strong{font-size:14px}.pattern-matches{margin-top:16px;overflow:auto}.pattern-matches table{width:100%;border-collapse:collapse;min-width:640px}.pattern-matches th,.pattern-matches td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:12px}.pattern-matches th{color:var(--muted)}.pattern-disclaimer{margin:13px 0 0;color:var(--muted);font-size:11px;line-height:1.55}.pattern-error{color:var(--red);padding:12px 0}.pattern-loading{color:var(--muted);padding:12px 0}@media(max-width:800px){.pattern-head{flex-direction:column}.pattern-controls{width:100%}.pattern-controls label{flex:1}.pattern-controls select,.pattern-controls button{width:100%}.pattern-probabilities{grid-template-columns:1fr}.pattern-summary{grid-template-columns:repeat(2,1fr)}}
  `;
  style.textContent += `.assistant-panel{background:rgba(17,23,22,.94);border:1px solid var(--line);border-radius:17px;padding:22px;margin-bottom:14px}.assistant-alert{padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:#0d1211;margin:14px 0;font-weight:800}.assistant-alert.danger{border-color:var(--red);background:#291211;color:#ffaaa5}.assistant-alert.bullish{border-color:var(--mint);background:#10231d;color:var(--mint)}.assistant-alert.watch{border-color:var(--amber);background:#241e0e;color:var(--amber)}.assistant-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.assistant-card{padding:16px;border:1px solid var(--line);border-radius:12px;background:#0d1211}.assistant-card h3{margin:0 0 5px;font-size:15px}.assistant-card .assistant-state{display:inline-block;padding:3px 7px;border-radius:999px;background:#1b2422;color:var(--muted);font-size:10px;font-weight:800}.assistant-card.danger .assistant-state{background:#351716;color:var(--red)}.assistant-card.bullish .assistant-state{background:#173126;color:var(--mint)}.assistant-card.watch .assistant-state{background:#2b2412;color:var(--amber)}.assistant-main-probability{display:block;margin:12px 0 4px;font-size:28px}.assistant-card.danger .assistant-main-probability{color:var(--red)}.assistant-card.bullish .assistant-main-probability{color:var(--mint)}.assistant-card.watch .assistant-main-probability{color:var(--amber)}.assistant-card p{color:var(--muted);font-size:12px;line-height:1.55;margin:8px 0}.assistant-card ul{padding-left:18px;margin:9px 0 0;color:#c5d0cd;font-size:11px;line-height:1.55}.assistant-notify{border:1px solid var(--amber)!important;color:var(--amber)!important}.assistant-foot{margin:12px 0 0;color:var(--muted);font-size:11px;line-height:1.5}.pattern-match-row{cursor:pointer}.pattern-match-row:hover,.pattern-match-row:focus{background:#16231f;outline:none}.pattern-match-open{border:0;background:transparent;color:var(--mint);font:inherit;font-weight:800;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:2px}.pattern-modal{position:fixed;inset:0;z-index:10000;background:rgba(2,5,5,.84);display:grid;place-items:center;padding:20px}.pattern-modal[hidden]{display:none}.pattern-modal-card{width:min(1240px,100%);max-height:94vh;overflow:auto;background:#0d1211;border:1px solid #40504c;border-radius:18px;padding:22px;box-shadow:0 24px 80px #000}.pattern-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.pattern-modal-head h2{margin:4px 0}.pattern-modal-close{border:1px solid var(--line);background:#141b19;color:var(--text);border-radius:9px;padding:9px 12px;font:inherit;cursor:pointer}.pattern-modal-meta{color:var(--muted);font-size:12px;margin:8px 0 16px}.pattern-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pattern-modal-chart{border:1px solid var(--line);border-radius:12px;padding:12px;background:#090d0c}.pattern-modal-chart h3{font-size:14px;margin:0 0 4px}.pattern-modal-chart p{color:var(--muted);font-size:11px;margin:0 0 9px}.pattern-modal-chart svg{display:block;width:100%;height:auto;background:#070a09;border-radius:8px}.pattern-modal-legend{display:flex;gap:13px;flex-wrap:wrap;color:var(--muted);font-size:11px;margin-top:8px}.pattern-modal-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}.legend-history{background:var(--mint)}.legend-actual-future{background:var(--amber)}.legend-current{background:var(--blue)}.legend-predicted{background:#c891ff}.forecast-divider{stroke:#f2c572;stroke-width:1.5;stroke-dasharray:5 4}.forecast-divider.predicted{stroke:#c891ff}@media(max-width:900px){.assistant-grid,.pattern-modal-grid{grid-template-columns:1fr}}`;
  style.textContent += `.pattern-gallery{margin-top:20px;padding-top:18px;border-top:1px solid var(--line)}.pattern-gallery>h3{margin:0 0 5px}.pattern-gallery>p{color:var(--muted);font-size:12px;margin:0 0 13px}.pattern-current-forecast{margin-bottom:14px}.pattern-gallery-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.pattern-gallery-card{min-width:0;border:1px solid var(--line);border-radius:11px;padding:10px;background:#090d0c}.pattern-gallery-card h4{margin:0 0 4px;font-size:12px}.pattern-gallery-card p{margin:0 0 7px;color:var(--muted);font-size:10px}.pattern-gallery-card svg{display:block;width:100%;height:auto;background:#070a09;border-radius:7px}.pattern-gallery-card .pattern-modal-legend{font-size:9px;gap:7px}.pattern-gallery-card .pattern-modal-legend i{width:8px;height:8px}.pattern-table-note{margin:13px 0 5px;color:var(--muted);font-size:11px}@media(max-width:1200px){.pattern-gallery-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.pattern-gallery-grid{grid-template-columns:1fr}}`;
  style.textContent += `.assistant-warning-stack{display:grid;gap:9px;margin:12px 0}.assistant-warning-detail{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;padding:13px 15px;border:1px solid var(--amber);border-radius:11px;background:#241e0e}.assistant-warning-detail.danger{border-color:var(--red);background:#291211}.assistant-warning-detail.bullish{border-color:var(--mint);background:#10231d}.assistant-warning-detail strong{display:block;margin-bottom:4px}.assistant-warning-detail p{margin:0;color:#c5d0cd;font-size:11px;line-height:1.55}.assistant-chart-button{border:1px solid currentColor;border-radius:8px;background:#101715;color:var(--amber);padding:8px 10px;font:inherit;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap}.assistant-card.danger .assistant-chart-button,.assistant-warning-detail.danger .assistant-chart-button{color:var(--red)}.assistant-card.bullish .assistant-chart-button,.assistant-warning-detail.bullish .assistant-chart-button{color:var(--mint)}.assistant-card .assistant-chart-button{margin-top:10px;width:100%}.assistant-modal-warning{padding:14px 16px;border:1px solid var(--amber);border-radius:11px;background:#241e0e;margin:10px 0 14px}.assistant-modal-warning.danger{border-color:var(--red);background:#291211}.assistant-modal-warning.bullish{border-color:var(--mint);background:#10231d}.assistant-modal-warning strong{display:block;font-size:16px;margin-bottom:5px}.assistant-metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:11px;overflow:hidden;margin-bottom:14px}.assistant-metric-grid>div{background:#0b100f;padding:11px}.assistant-metric-grid span{display:block;color:var(--muted);font-size:10px;margin-bottom:4px}.assistant-metric-grid strong{font-size:13px}.assistant-similar-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.assistant-similar-grid .pattern-modal-chart,.assistant-current-chart{position:relative;padding-top:48px}.assistant-similar-grid .pattern-modal-chart.success{border-color:#315f4f}.assistant-similar-grid .pattern-modal-chart.failure{border-color:#633a37}.assistant-chart-probability{position:absolute;top:10px;left:10px;right:10px;display:flex;gap:6px;flex-wrap:wrap;z-index:2}.assistant-chart-probability b{padding:4px 7px;border-radius:999px;background:#17201e;border:1px solid #40504c;color:#eff7f4;font-size:10px}.assistant-chart-probability b.primary{border-color:var(--amber);color:var(--amber)}.assistant-notification-guide{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;margin:10px 0;border:1px solid var(--amber);border-radius:10px;background:#241e0e;color:var(--amber);font-size:11px}.assistant-notification-guide button{border:1px solid currentColor;background:#101715;color:inherit;border-radius:8px;padding:7px 9px;font:inherit;font-weight:800;cursor:pointer}.assistant-notification-guide.enabled{border-color:var(--mint);background:#10231d;color:var(--mint)}.assistant-notification-guide.denied{border-color:var(--red);background:#291211;color:var(--red)}@media(max-width:800px){.assistant-warning-detail{grid-template-columns:1fr}.assistant-metric-grid{grid-template-columns:repeat(2,1fr)}.assistant-similar-grid{grid-template-columns:1fr}.assistant-notification-guide{align-items:flex-start;flex-direction:column}}`;
  style.textContent += `.latest-signal-audit{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 14px;padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:#0d1211;color:var(--muted);font-size:12px}.latest-signal-audit strong{color:var(--text)}.latest-signal-audit.entry{border-color:#315f4f;background:#10231d}.latest-signal-audit.entry strong{color:var(--mint)}.latest-signal-audit.exit{border-color:#633a37;background:#291211}.latest-signal-audit.exit strong{color:var(--red)}.latest-signal-badge{padding:3px 8px;border-radius:999px;background:#1b2422;font-size:10px;font-weight:800}.latest-signal-history{flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;padding-top:2px}.latest-signal-history i{font-style:normal;padding:3px 7px;border-radius:999px;background:#17201e;border:1px solid var(--line);font-size:10px}.latest-signal-history i.entry{color:var(--mint);border-color:#315f4f}.latest-signal-history i.exit{color:var(--red);border-color:#633a37}.live-recalc-entry{stroke:#72f2bd;fill:#72f2bd}.live-recalc-exit{stroke:#ff776f;fill:#ff776f}.live-recalc-line{stroke-width:2;stroke-dasharray:5 4}`;
  style.textContent += `.verified-crash-strip{margin:12px 0;padding:14px 16px;border:1px solid #ff776f;border-radius:12px;background:linear-gradient(135deg,#351716,#24130f);color:#ffd1ce}.verified-crash-strip.watch{border-color:var(--amber);background:#241e0e;color:#ffe0a0}.verified-crash-strip strong{display:block;font-size:15px;margin-bottom:6px}.verified-crash-strip p{margin:0;color:inherit;font-size:12px;line-height:1.55}.verified-crash-overlay text{paint-order:stroke;stroke:#07100d;stroke-width:4px;stroke-linejoin:round}`;
  document.head.appendChild(style);

  const signalAudit = document.createElement("div");
  signalAudit.id = "latest-signal-audit"; signalAudit.className = "latest-signal-audit"; signalAudit.innerHTML = `<span class="latest-signal-badge">LATEST SIGNAL</span><span>최신 확정 일봉 신호를 다시 계산하고 있습니다…</span>`;
  document.querySelector(".data-update-row")?.insertAdjacentElement("afterend", signalAudit);

  const panel = document.createElement("section");
  panel.id = "pattern-forecast-panel";
  panel.className = "pattern-panel";
  panel.innerHTML = `
    <div class="pattern-head">
      <div><p class="eyebrow">WEIGHTED CANDLE PATTERN</p><h2>최근 20봉 유사 패턴 · 다음 봉 확률</h2><p>20봉 전체 상승·하락률을 비교하고 최근 5봉에는 3배 가중치를 적용합니다.</p></div>
      <div class="pattern-controls"><label>봉 간격<select id="pattern-timeframe"><option value="d1">일봉</option><option value="w1">주봉</option><option value="h4">4시간봉</option><option value="h1">1시간봉</option></select></label><button id="pattern-run" type="button">패턴 다시 분석</button></div>
    </div>
    <div id="pattern-output" class="pattern-loading">패턴을 계산하고 있습니다…</div>`;
  document.querySelector(".chart-panel")?.insertAdjacentElement("afterend", panel);
  const assistantPanel = document.createElement("section");
  assistantPanel.id = "market-assistant-panel";
  assistantPanel.className = "assistant-panel";
  assistantPanel.innerHTML = `<div class="pattern-head"><div><p class="eyebrow">MARKET ASSISTANT BOT</p><h2>급락·돌파·연속양봉 비서봇</h2><p>이동평균 저항과 돌파 강도를 과거 후속 움직임으로 확률화합니다.</p></div><div class="pattern-controls"><button id="assistant-notification-toggle" class="assistant-notify" type="button">브라우저 알림 켜기</button></div></div><div id="assistant-output" class="pattern-loading">시장 위험 신호를 분석하고 있습니다…</div>`;
  panel.insertAdjacentElement("afterend", assistantPanel);
  const modal = document.createElement("div");
  modal.id = "pattern-detail-modal"; modal.className = "pattern-modal"; modal.hidden = true; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "과거 유사 패턴과 향후 예측 봉 상세");
  modal.innerHTML = `<div class="pattern-modal-card"><div class="pattern-modal-head"><div><p class="eyebrow">SIMILAR PATTERN DETAIL</p><h2 id="pattern-modal-title">유사 패턴 상세</h2></div><button class="pattern-modal-close" type="button">닫기 ×</button></div><div id="pattern-modal-content"></div></div>`;
  document.body.appendChild(modal);
  const timeframeSelect = panel.querySelector("#pattern-timeframe");
  const output = panel.querySelector("#pattern-output");
  const assistantOutput = assistantPanel.querySelector("#assistant-output"), notificationButton = assistantPanel.querySelector("#assistant-notification-toggle");
  modal.querySelector(".pattern-modal-close").addEventListener("click", closePatternModal); modal.addEventListener("click", (event) => { if (event.target === modal) closePatternModal(); }); document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closePatternModal(); });
  notificationButton.addEventListener("click", toggleNotifications); initializeNotifications();
  assistantOutput.addEventListener("click", (event) => { const button = event.target.closest("[data-assistant-kind]"); if (button) openAssistantPatternModal(button.dataset.assistantKind); });
  panel.querySelector("#pattern-run").addEventListener("click", analyze);
  timeframeSelect.addEventListener("change", analyze);
  document.querySelector("#timeframe-buttons")?.addEventListener("click", (event) => { const value = event.target.closest("button[data-timeframe]")?.dataset.timeframe; if (value && DATA.candles[value]) { timeframeSelect.value = value; setTimeout(() => { analyze(); synchronizeLatestSignals(false); }, 0); } });
  const status = document.querySelector("#latest-data-status");
  if (status) new MutationObserver(() => { if (/완료|최신|갱신/.test(status.textContent)) setTimeout(() => { normalizeDailySeries(); if (typeof window.render === "function") window.render(); analyze(); synchronizeLatestSignals(true); }, 100); }).observe(status, { childList: true, characterData: true, subtree: true });
  installLatestSignalRenderSync();
  setTimeout(() => { if (typeof window.render === "function") window.render(); analyze(); synchronizeLatestSignals(false); setTimeout(() => synchronizeLatestSignals(false), 300); }, 0);

  function analyze() {
    const timeframe = timeframeSelect.value, candles = (DATA.candles[timeframe] || []).filter(validCandle).sort((a, b) => a[0] - b[0]);
    output.className = "pattern-loading"; output.textContent = "최근 20봉과 과거 패턴을 비교하고 있습니다…";
    requestAnimationFrame(() => {
      try { renderResult(calculate(candles, timeframe)); renderAssistant(analyzeAssistant(candles, timeframe)); }
      catch (error) { output.className = "pattern-error"; output.textContent = `패턴 분석 실패: ${error.message}`; assistantOutput.className = "pattern-error"; assistantOutput.textContent = `비서봇 분석 실패: ${error.message}`; }
    });
  }

  function calculate(candles, timeframe) {
    const patternLength = 20, recentWeightStart = 15;
    if (candles.length < patternLength * 3 + 2) throw new Error("분석에 필요한 과거 봉 자료가 부족합니다.");
    const raw = candles.map((candle, index) => candleFeatures(candles, index));
    const dimensions = raw[0].length, means = [], deviations = [];
    for (let dimension = 0; dimension < dimensions; dimension += 1) { const values = raw.slice(1).map((row) => row[dimension]).filter(Number.isFinite), mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length); means.push(mean); deviations.push(Math.max(Math.sqrt(variance), 1e-8)); }
    const features = raw.map((row) => row.map((value, dimension) => (value - means[dimension]) / deviations[dimension]));
    const latestStart = candles.length - patternLength, latestEnd = candles.length - 1, featureWeights = [2.2, 1.8, 1.1, 0.7, 0.7, 0.8, 0.7], matches = [];
    const windowStats = new Map();
    for (let end = patternLength - 1; end < candles.length; end += 1) windowStats.set(end, patternWindowStats(candles, end, patternLength));
    const latestStats = windowStats.get(latestEnd);
    const statKeys = ["totalReturn", "upMove", "downMove", "recentReturn", "recentUpMove", "recentDownMove"];
    const statScales = Object.fromEntries(statKeys.map((key) => [key, Math.max(standardDeviation([...windowStats.values()].map((item) => item[key])), 1e-4)]));
    for (let end = patternLength; end < latestStart - 1; end += 1) {
      const start = end - patternLength + 1; let weightedError = 0, weightTotal = 0;
      for (let offset = 0; offset < patternLength; offset += 1) { const candleWeight = offset >= recentWeightStart ? 3 : 1; for (let dimension = 0; dimension < dimensions; dimension += 1) { const weight = candleWeight * featureWeights[dimension], difference = features[start + offset][dimension] - features[latestStart + offset][dimension]; weightedError += weight * difference * difference; weightTotal += weight; } }
      const shapeDistance = Math.sqrt(weightedError / Math.max(1, weightTotal)), stats = windowStats.get(end);
      const normalized = (key) => clamp(Math.abs(stats[key] - latestStats[key]) / statScales[key], 0, 5);
      const totalReturnError = normalized("totalReturn") ** 2 + .5 * normalized("upMove") ** 2 + .5 * normalized("downMove") ** 2;
      const recentReturnError = normalized("recentReturn") ** 2 + .5 * normalized("recentUpMove") ** 2 + .5 * normalized("recentDownMove") ** 2;
      const directionPenalty = (Math.sign(stats.totalReturn) !== Math.sign(latestStats.totalReturn) ? 1 : 0) + (Math.sign(stats.recentReturn) !== Math.sign(latestStats.recentReturn) ? .5 : 0);
      const distance = Math.sqrt((shapeDistance ** 2 * 2 + totalReturnError + recentReturnError * 3 + directionPenalty) / 11), similarity = 1 / (1 + distance), nextReturn = candles[end + 1][4] / candles[end][4] - 1;
      matches.push({ end, similarity, nextReturn, patternReturn: stats.totalReturn, recent5Return: stats.recentReturn, timestamp: candles[end][0], nextTimestamp: candles[end + 1][0] });
    }
    const selected = matches.sort((a, b) => b.similarity - a.similarity).slice(0, Math.min(40, Math.max(15, Math.round(matches.length * 0.04))));
    if (!selected.length) throw new Error("비교 가능한 과거 패턴이 없습니다.");
    const threshold = timeframe === "h1" ? 0.001 : timeframe === "h4" ? 0.0015 : 0.002, weights = selected.map((item) => Math.max(1e-6, item.similarity ** 5)), totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const probability = (test) => selected.reduce((sum, item, index) => sum + (test(item.nextReturn) ? weights[index] : 0), 0) / totalWeight;
    const up = probability((value) => value > threshold), down = probability((value) => value < -threshold), flat = Math.max(0, 1 - up - down), expected = selected.reduce((sum, item, index) => sum + item.nextReturn * weights[index], 0) / totalWeight, positiveReturns = selected.filter((item) => item.nextReturn > threshold).map((item) => item.nextReturn), negativeReturns = selected.filter((item) => item.nextReturn < -threshold).map((item) => item.nextReturn), averageSimilarity = selected.reduce((sum, item, index) => sum + item.similarity * weights[index], 0) / totalWeight;
    return { timeframe, candles, selected, up, flat, down, expected, averageSimilarity, threshold, averageUp: average(positiveReturns), averageDown: average(negativeReturns), latestStart, patternLength, latestStats };
  }

  function patternWindowStats(candles, end, length) {
    const start = end - length + 1, changes = [];
    for (let index = start; index <= end; index += 1) {
      const previousClose = Math.max(index > 0 ? candles[index - 1][4] : candles[index][1], 1e-12);
      changes.push(candles[index][4] / previousClose - 1);
    }
    const recent = changes.slice(-5), startPrice = Math.max(start > 0 ? candles[start - 1][4] : candles[start][1], 1e-12), recentStart = Math.max(end >= 5 ? candles[end - 5][4] : startPrice, 1e-12);
    return {
      totalReturn: candles[end][4] / startPrice - 1,
      upMove: changes.reduce((sum, value) => sum + Math.max(0, value), 0),
      downMove: changes.reduce((sum, value) => sum + Math.min(0, value), 0),
      recentReturn: candles[end][4] / recentStart - 1,
      recentUpMove: recent.reduce((sum, value) => sum + Math.max(0, value), 0),
      recentDownMove: recent.reduce((sum, value) => sum + Math.min(0, value), 0),
    };
  }

  function standardDeviation(values) {
    const finite = values.filter(Number.isFinite); if (!finite.length) return 0;
    const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
    return Math.sqrt(finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length);
  }

  function candleFeatures(candles, index) {
    const candle = candles[index], previousClose = index ? candles[index - 1][4] : candle[1], [timestamp, open, high, low, close, volume] = candle, scale = Math.max(previousClose, 1e-12), upper = high - Math.max(open, close), lower = Math.min(open, close) - low;
    return [(close - previousClose) / scale, (close - open) / scale, (high - low) / scale, upper / scale, lower / scale, Math.log1p(Math.max(0, volume)), (open - previousClose) / scale];
  }

  function renderResult(result) {
    lastPatternResult = result;
    const { candles, selected, up, flat, down, expected, averageSimilarity, averageUp, averageDown, latestStart } = result, direction = up >= down && up >= flat ? "상승" : down >= up && down >= flat ? "하락" : "보합", directionClass = direction === "상승" ? "positive" : direction === "하락" ? "negative" : "", latest = candles.at(-1), start = candles[latestStart];
    output.className = "";
    output.innerHTML = `
      <div class="pattern-meta">분석 구간 ${date(start[0])} ~ ${date(latest[0])} · 현재 20봉 ${signedPct(result.latestStats.totalReturn)} · 최근 5봉 ${signedPct(result.latestStats.recentReturn)} · 과거 유사 사례 ${selected.length}개 · 최근 5봉 가중치 ×3 · 보합 기준 ±${(result.threshold * 100).toFixed(2)}%</div>
      <div class="pattern-probabilities"><div class="pattern-probability up"><span>다음 봉 상승 확률</span><strong>${pct(up)}</strong></div><div class="pattern-probability flat"><span>다음 봉 보합 확률</span><strong>${pct(flat)}</strong></div><div class="pattern-probability down"><span>다음 봉 하락 확률</span><strong>${pct(down)}</strong></div></div>
      <div class="pattern-bar" aria-label="상승 ${pct(up)}, 보합 ${pct(flat)}, 하락 ${pct(down)}"><i class="up" style="width:${up * 100}%"></i><i class="flat" style="width:${flat * 100}%"></i><i class="down" style="width:${down * 100}%"></i></div>
      <div class="pattern-summary"><div><span>확률 우세 방향</span><strong class="${directionClass}">${direction}</strong></div><div><span>가중 예상 변동률</span><strong class="${expected >= 0 ? "positive" : "negative"}">${signedPct(expected)}</strong></div><div><span>상승 사례 평균</span><strong class="positive">${Number.isFinite(averageUp) ? signedPct(averageUp) : "–"}</strong></div><div><span>하락 사례 평균</span><strong class="negative">${Number.isFinite(averageDown) ? signedPct(averageDown) : "–"}</strong></div></div>
      ${inlinePatternGallery(result)}
      <p class="pattern-table-note">아래 표의 순위와 위 8개 차트가 서로 대응합니다.</p><div class="pattern-matches"><table><thead><tr><th>유사 순위</th><th>과거 패턴 종료일</th><th>과거 20봉 등락률</th><th>과거 최근 5봉</th><th>유사도</th><th>그다음 봉</th><th>다음 봉 결과</th></tr></thead><tbody>${selected.slice(0, 8).map((item, index) => `<tr><td>패턴 ${index + 1}</td><td>${date(item.timestamp)}</td><td class="${item.patternReturn >= 0 ? "positive" : "negative"}">${signedPct(item.patternReturn)}</td><td class="${item.recent5Return >= 0 ? "positive" : "negative"}">${signedPct(item.recent5Return)}</td><td>${pct(item.similarity)}</td><td>${date(item.nextTimestamp)}</td><td class="${item.nextReturn >= 0 ? "positive" : "negative"}">${signedPct(item.nextReturn)}</td></tr>`).join("")}</tbody></table></div>
      <p class="pattern-disclaimer">통계 안내: 20봉 전체 누적 등락률·상승분·하락분과 봉 몸통·꼬리·변동폭·갭·거래량을 비교합니다. 최근 5봉의 누적 등락률·상승분·하락분 및 개별 봉에는 ×3 가중치를 적용합니다. 평균 유사도 ${pct(averageSimilarity)}이며, 표본 수와 시장 환경에 따라 결과가 크게 달라질 수 있습니다. 투자 수익을 보장하는 예측이 아닙니다.</p>`;
  }

  function inlinePatternGallery(result) {
    const current = result.candles.slice(-result.patternLength), predicted = buildPredictedCandles(result, 5), currentChart = candlePopupSvg([...current.map((row) => ({ row, type: "current" })), ...predicted.map((row) => ({ row, type: "predicted" }))], current.length, "predicted"), cards = result.selected.slice(0, 8).map((match, index) => { const history = result.candles.slice(match.end - result.patternLength + 1, match.end + 1), actual = result.candles.slice(match.end + 1, match.end + 6); return `<article class="pattern-gallery-card"><h4>패턴 ${index + 1} · ${date(match.timestamp)}</h4><p>유사도 ${pct(match.similarity)} · 다음 봉 ${signedPct(match.nextReturn)}</p>${candlePopupSvg([...history.map((row) => ({ row, type: "history" })), ...actual.map((row) => ({ row, type: "actual" }))], history.length, "actual")}<div class="pattern-modal-legend"><span><i class="legend-history"></i>과거 20봉</span><span><i class="legend-actual-future"></i>이후 실제 5봉</span></div></article>`; }).join("");
    return `<section class="pattern-gallery"><h3>현재 예측과 과거 유사 패턴 8개 한눈에 보기</h3><p>팝업 없이 모든 차트를 동시에 비교할 수 있습니다.</p><article class="pattern-gallery-card pattern-current-forecast"><h4>현재 최근 20봉 + 향후 예상 5봉</h4><p>상위 유사 사례의 OHLC 경로를 유사도⁵으로 가중 합성했습니다.</p>${currentChart}<div class="pattern-modal-legend"><span><i class="legend-current"></i>현재 최근 20봉</span><span><i class="legend-predicted"></i>향후 예상 5봉</span></div></article><div class="pattern-gallery-grid">${cards}</div></section>`;
  }

  function openPatternFromEvent(event) { if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return; const target = event.target.closest("[data-match-index]"); if (!target || !lastPatternResult) return; if (event.type === "keydown") event.preventDefault(); openPatternModal(Number(target.dataset.matchIndex)); }
  function openPatternModal(index) {
    const result = lastPatternResult, match = result?.selected[index]; if (!match) return; const historical = result.candles.slice(match.end - result.patternLength + 1, match.end + 1), actualFuture = result.candles.slice(match.end + 1, match.end + 6), current = result.candles.slice(-result.patternLength), predicted = buildPredictedCandles(result, 5), content = modal.querySelector("#pattern-modal-content");
    modal.querySelector(".eyebrow").textContent = "SIMILAR PATTERN DETAIL";
    modal.querySelector("#pattern-modal-title").textContent = `${DATA.symbol} 유사 패턴 ${index + 1} · ${date(match.timestamp)}`;
    content.innerHTML = `<p class="pattern-modal-meta">유사도 ${pct(match.similarity)} · 당시 다음 봉 ${signedPct(match.nextReturn)} · 현재 가중 예측 상승 ${pct(result.up)} / 보합 ${pct(result.flat)} / 하락 ${pct(result.down)}</p><div class="pattern-modal-grid"><section class="pattern-modal-chart"><h3>과거 유사 20봉 + 이후 실제 5봉</h3><p>클릭한 과거 패턴 이후 시장이 실제로 움직인 구간입니다.</p>${candlePopupSvg([...historical.map((row) => ({ row, type: "history" })), ...actualFuture.map((row) => ({ row, type: "actual" }))], historical.length, "actual")}<div class="pattern-modal-legend"><span><i class="legend-history"></i>과거 유사 20봉</span><span><i class="legend-actual-future"></i>이후 실제 봉</span></div></section><section class="pattern-modal-chart"><h3>현재 최근 20봉 + 향후 예상 5봉</h3><p>상위 유사 사례의 다음 봉 경로를 유사도 가중 평균한 예상 형태입니다.</p>${candlePopupSvg([...current.map((row) => ({ row, type: "current" })), ...predicted.map((row) => ({ row, type: "predicted" }))], current.length, "predicted")}<div class="pattern-modal-legend"><span><i class="legend-current"></i>현재 최근 20봉</span><span><i class="legend-predicted"></i>향후 예상 봉</span></div></section></div><p class="pattern-disclaimer">보라색 예상 봉은 상위 유사 사례들의 OHLC 변화율을 유사도⁵으로 가중 합성한 통계 경로입니다. 실제 가격이나 봉 모양을 보장하지 않습니다.</p>`;
    modal.hidden = false; document.body.style.overflow = "hidden"; modal.querySelector(".pattern-modal-close").focus();
  }
  function closePatternModal() { modal.hidden = true; document.body.style.overflow = ""; }
  function buildPredictedCandles(result, steps) {
    const interval = result.candles.length > 1 ? result.candles.at(-1)[0] - result.candles.at(-2)[0] : 86_400_000, output = []; let previousClose = result.candles.at(-1)[4], timestamp = result.candles.at(-1)[0];
    for (let step = 1; step <= steps; step += 1) { const paths = result.selected.filter((item) => item.end + step < result.candles.length), weights = paths.map((item) => item.similarity ** 5), total = weights.reduce((sum, value) => sum + value, 0); if (!paths.length || !total) break; const ratio = (field) => paths.reduce((sum, item, position) => { const priorClose = result.candles[item.end + step - 1][4], value = result.candles[item.end + step][field]; return sum + value / priorClose * weights[position]; }, 0) / total, open = previousClose * ratio(1), close = previousClose * ratio(4), high = Math.max(open, close, previousClose * ratio(2)), low = Math.min(open, close, previousClose * ratio(3)); timestamp += interval; output.push([timestamp, open, high, low, close, 0]); previousClose = close; }
    return output;
  }
  function candlePopupSvg(items, dividerIndex, dividerType) {
    if (!items.length) return ""; const width = 1000, height = 360, left = 60, right = 975, top = 24, bottom = 312, highs = items.map((item) => item.row[2]), lows = items.map((item) => item.row[3]), maximum = Math.max(...highs), minimum = Math.min(...lows), padding = Math.max((maximum - minimum) * .08, maximum * .002), highBound = maximum + padding, lowBound = minimum - padding, span = highBound - lowBound || 1, gap = (right - left) / items.length, candleWidth = Math.max(4, gap * .58), y = (value) => top + (highBound - value) / span * (bottom - top), ticks = Array.from({ length: 5 }, (_, index) => lowBound + span * index / 4), grid = ticks.map((value) => `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#26302e"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end" fill="#91a19d" font-size="11">${compact(value)}</text>`).join(""), colors = { history: ["#72f2bd", "#ff776f"], actual: ["#f2c572", "#f2c572"], current: ["#6fb6ff", "#6fb6ff"], predicted: ["#c891ff", "#c891ff"] };
    const candles = items.map((item, index) => { const [timestamp, open, high, low, close] = item.row, x = left + gap * (index + .5), color = colors[item.type][close >= open ? 0 : 1], bodyTop = Math.min(y(open), y(close)), bodyHeight = Math.max(2, Math.abs(y(open) - y(close))); return `<g><line x1="${x}" y1="${y(high)}" x2="${x}" y2="${y(low)}" stroke="${color}" stroke-width="1.5"/><rect x="${x - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" rx="1" fill="${color}" opacity="${item.type === "history" ? .82 : .94}"/><title>${date(timestamp)} · O ${compact(open)} H ${compact(high)} L ${compact(low)} C ${compact(close)}</title></g>`; }).join(""), dividerX = left + gap * dividerIndex;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="과거 유사 패턴과 향후 봉 컬러 비교">${grid}<line class="forecast-divider ${dividerType === "predicted" ? "predicted" : ""}" x1="${dividerX}" y1="${top}" x2="${dividerX}" y2="${bottom}"/><text x="${dividerX + 6}" y="${top + 14}" fill="${dividerType === "predicted" ? "#c891ff" : "#f2c572"}" font-size="11">${dividerType === "predicted" ? "예측 시작" : "실제 이후"}</text>${candles}<text x="${left}" y="342" fill="#91a19d" font-size="11">${date(items[0].row[0])}</text><text x="${right}" y="342" text-anchor="end" fill="#91a19d" font-size="11">${date(items.at(-1).row[0])}</text></svg>`;
  }
  function compact(value) { return new Intl.NumberFormat("ko-KR", { notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 }).format(value); }

  function analyzeAssistant(candles, timeframe) {
    if (candles.length < 150) throw new Error("비서봇 확률 계산에 필요한 과거 봉이 부족합니다.");
    const closes = candles.map((row) => row[4]), emas = { 20: ema(closes, 20), 60: ema(closes, 60), 120: ema(closes, 120) }, lastIndex = candles.length - 1, thresholds = timeframe === "w1" ? { crash: .10, rise: .09, surge: .08 } : timeframe === "d1" ? { crash: .05, rise: .045, surge: .04 } : timeframe === "h4" ? { crash: .03, rise: .028, surge: .025 } : { crash: .018, rise: .016, surge: .015 }, horizon = timeframe === "w1" ? 3 : 5;
    const rejectionStates = candles.map((_, index) => withDirectionalPattern(rejectionState(candles, emas, index, thresholds.crash), candles, index, thresholds.crash)), breakoutStates = candles.map((_, index) => withDirectionalPattern(breakoutState(candles, index, thresholds.rise), candles, index, thresholds.rise)), streakStates = candles.map((_, index) => withDirectionalPattern(streakState(candles, index, thresholds.surge), candles, index, thresholds.surge)), rejection = rejectionStates[lastIndex], breakout = breakoutStates[lastIndex], streak = streakStates[lastIndex];
    const crash = analogProbability(candles, rejectionStates, rejection, horizon, (index) => Math.min(...candles.slice(index + 1, index + horizon + 1).map((row) => row[3])) / candles[index][4] - 1 <= -thresholds.crash);
    const verifiedCrash = verifiedCrashProbability(candles, rejectionStates, rejection, timeframe);
    const continuation = analogProbability(candles, breakoutStates, breakout, horizon, (index) => Math.max(...candles.slice(index + 1, index + horizon + 1).map((row) => row[2])) / candles[index][4] - 1 >= thresholds.rise);
    const pullback = analogProbability(candles, breakoutStates, breakout, horizon, (index, state) => { const future = candles.slice(index + 1, index + horizon + 1); return Math.min(...future.map((row) => row[3])) <= state.referenceHigh * 1.005 && future.at(-1)[4] > state.referenceHigh; });
    const surge = analogProbability(candles, streakStates, streak, Math.min(3, horizon), (index) => Math.max(...candles.slice(index + 1, index + Math.min(3, horizon) + 1).map((row) => row[2])) / candles[index][4] - 1 >= thresholds.surge);
    return { timeframe, timestamp: candles[lastIndex][0], candles, horizon, rejection, breakout, streak, crash, verifiedCrash, continuation, pullback, surge, thresholds };
  }

  function withDirectionalPattern(state, candles, index, scale) {
    if (!state?.vector || index < 20) return state;
    const normalizer = Math.max(scale, 1e-6), directionalChanges = [], directionalWeights = [];
    for (let at = index - 19; at <= index; at += 1) {
      const previousClose = Math.max(candles[at - 1][4], 1e-12), change = candles[at][4] / previousClose - 1;
      directionalChanges.push(clamp(change / normalizer, -2.5, 2.5));
      directionalWeights.push(at > index - 5 ? 3 : 1);
    }
    const recentDirectionalRanges = [];
    for (let at = index - 4; at <= index; at += 1) {
      const row = candles[at], previousClose = Math.max(candles[at - 1][4], 1e-12), direction = row[4] >= previousClose ? 1 : -1, range = (row[2] - row[3]) / previousClose;
      recentDirectionalRanges.push(clamp(direction * range / normalizer, -2.5, 2.5));
    }
    return {
      ...state,
      vector: [...state.vector, ...directionalChanges, ...recentDirectionalRanges],
      vectorWeights: [...state.vector.map(() => 1), ...directionalWeights, ...recentDirectionalRanges.map(() => 2)],
      directionalPattern: { directionalChanges, recentDirectionalRanges }
    };
  }

  function rejectionState(candles, emas, index, crashThreshold) {
    if (index < 125) return null; const [timestamp, open, high, low, close, volume] = candles[index], range = Math.max(high - low, close * 1e-6), averageVolume = average(candles.slice(index - 20, index).map((row) => row[5])), volumeRatio = averageVolume ? volume / averageVolume : 1, recent = candles.slice(index - 4, index + 1), sellVolume = recent.filter((row) => row[4] < row[1]).reduce((sum, row) => sum + row[5], 0), sellPressure = sellVolume / Math.max(1e-9, recent.reduce((sum, row) => sum + row[5], 0)), momentum = close / candles[index - 5][4] - 1, upperWick = (high - Math.max(open, close)) / range;
    let best = { score: 0, emaPeriod: 20, emaValue: emas[20][index] };
    for (const period of [20, 60, 120]) { const value = emas[period][index], prior = emas[period][index - 3]; if (!Number.isFinite(value) || !Number.isFinite(prior)) continue; const fromBelow = candles[index - 3][4] <= prior * 1.012, touched = high >= value * .993 && low <= value * 1.012, rejected = close < value, bearish = close < open, score = clamp((fromBelow ? .18 : 0) + (touched ? .25 : 0) + (rejected ? .18 : 0) + (bearish ? .12 : 0) + upperWick * .16 + clamp((volumeRatio - .8) / 1.5, 0, 1) * .06 + sellPressure * .12 + clamp(-momentum / crashThreshold, 0, 1) * .09, 0, 1); if (score > best.score) best = { score, emaPeriod: period, emaValue: value }; }
    return { ...best, sellPressure, volumeRatio, momentum, upperWick, vector: [best.score, sellPressure, clamp(volumeRatio / 2, 0, 1), clamp(-momentum / crashThreshold, -1, 1), upperWick] };
  }

  function breakoutState(candles, index, riseThreshold) {
    if (index < 25) return null; const [timestamp, open, high, low, close, volume] = candles[index], referenceHigh = Math.max(...candles.slice(index - 20, index).map((row) => row[2])), breakout = close / referenceHigh - 1, range = Math.max(high - low, close * 1e-6), bodyStrength = clamp((close - open) / range, -1, 1), closeLocation = clamp((close - low) / range, 0, 1), averageVolume = average(candles.slice(index - 20, index).map((row) => row[5])), volumeRatio = averageVolume ? volume / averageVolume : 1, risingHighs = [index - 2, index - 1, index].filter((at) => at > 0 && candles[at][2] > candles[at - 1][2]).length / 3, score = clamp((breakout >= 0 ? .26 : 0) + clamp((breakout + .012) / Math.max(.018, riseThreshold), 0, 1) * .24 + clamp((bodyStrength + .1) / 1.1, 0, 1) * .16 + closeLocation * .12 + clamp((volumeRatio - .7) / 1.5, 0, 1) * .12 + risingHighs * .10, 0, 1);
    return { score, referenceHigh, breakout, volumeRatio, bodyStrength, risingHighs, vector: [score, clamp(breakout / riseThreshold, -1, 1.5), clamp(volumeRatio / 2, 0, 1.5), bodyStrength, risingHighs] };
  }

  function streakState(candles, index, surgeThreshold) {
    if (index < 8) return null; let count = 0; for (let at = index; at > Math.max(0, index - 7); at -= 1) { const row = candles[at], previous = candles[at - 1]; if (row[4] > row[1] && row[2] > previous[2]) count += 1; else break; } const momentum = candles[index][4] / candles[index - 5][4] - 1, averageVolume = average(candles.slice(index - 20, index).map((row) => row[5])), volumeRatio = averageVolume ? candles[index][5] / averageVolume : 1, score = clamp(count / 4 * .58 + clamp(momentum / surgeThreshold, 0, 1.5) * .25 + clamp((volumeRatio - .7) / 1.5, 0, 1) * .17, 0, 1);
    return { score, count, momentum, volumeRatio, vector: [score, count / 5, clamp(momentum / surgeThreshold, -1, 1.5), clamp(volumeRatio / 2, 0, 1.5)] };
  }

  function analogProbability(candles, states, current, horizon, outcome) {
    if (!current) return { probability: 0, samples: 0, similarity: 0, matches: [] }; const candidates = [];
    for (let index = 130; index < candles.length - horizon - 1; index += 1) { const state = states[index]; if (!state?.vector || state.vector.length !== current.vector.length) continue; const weights = current.vectorWeights || current.vector.map(() => 1), totalWeight = weights.reduce((sum, value) => sum + value, 0), distance = Math.sqrt(state.vector.reduce((sum, value, dimension) => sum + weights[dimension] * (value - current.vector[dimension]) ** 2, 0) / Math.max(1e-9, totalWeight)), similarity = 1 / (1 + distance); candidates.push({ index, state, similarity }); }
    const selected = candidates.sort((a, b) => b.similarity - a.similarity).slice(0, Math.min(60, Math.max(20, Math.round(candidates.length * .05)))), weights = selected.map((item) => item.similarity ** 5), total = weights.reduce((sum, value) => sum + value, 0), matches = selected.map((item, position) => ({ ...item, weight: weights[position], success: Boolean(outcome(item.index, item.state)) })), success = matches.reduce((sum, item) => sum + (item.success ? item.weight : 0), 0); return { probability: total ? success / total : 0, samples: selected.length, similarity: total ? selected.reduce((sum, item, position) => sum + item.similarity * weights[position], 0) / total : 0, matches };
  }

  function verifiedCrashProbability(candles, states, current, timeframe) {
    if (DATA.symbol !== "BTC" || timeframe !== "d1" || !current?.vector) return null;
    const horizon = 5, independent = [];
    let lastSelected = -Infinity;
    for (let index = 130; index < candles.length - horizon; index += 1) {
      const state = states[index];
      if (!state?.vector || state.score < .52 || index - lastSelected <= horizon) continue;
      independent.push({ index, state });
      lastSelected = index;
    }
    const vectorDistance = (state) => {
      const weights = current.vectorWeights || current.vector.map(() => 1), totalWeight = weights.reduce((sum, value) => sum + value, 0);
      const error = state.vector.reduce((sum, value, dimension) => sum + weights[dimension] * (value - current.vector[dimension]) ** 2, 0);
      return Math.sqrt(error / Math.max(totalWeight, 1e-9));
    };
    const candidates = independent.map((item) => {
      const signalDate = koreaDateKey(candles[item.index][0]), verifiedCase = BTC_VERIFIED_CRASH_BY_DATE.get(signalDate), similarity = 1 / (1 + vectorDistance(item.state));
      return { ...item, signalDate, similarity, weight: similarity ** 6, success: Boolean(verifiedCase), verifiedCase };
    }).sort((a, b) => b.similarity - a.similarity);
    const neighborhood = candidates.slice(0, Math.min(48, candidates.length)), totalWeight = neighborhood.reduce((sum, item) => sum + item.weight, 0), successWeight = neighborhood.reduce((sum, item) => sum + (item.success ? item.weight : 0), 0), probability = totalWeight ? successWeight / totalWeight : 0;
    const verifiedMatches = candidates.filter((item) => item.success).slice(0, 8), matchWeight = verifiedMatches.reduce((sum, item) => sum + item.weight, 0), similarity = matchWeight ? verifiedMatches.reduce((sum, item) => sum + item.similarity * item.weight, 0) / matchWeight : 0, topSimilarity = verifiedMatches[0]?.similarity || 0;
    const matches = verifiedMatches.map((item) => ({ ...item, weight: item.weight, success: true, historicalDrawdown: item.verifiedCase.drawdown, troughDate: item.verifiedCase.troughDate }));
    return { probability, samples: BTC_VERIFIED_CRASH_CASES.length, comparisonSignals: 385, runtimeSignals: independent.length, similarity, topSimilarity, matches, baseRate: 46 / 385, horizon, threshold: .10 };
  }

  function renderAssistant(result) {
    lastAssistantResult = result;
    const detections = assistantDetections(result), rejectionDetection = detections.find((item) => item.kind === "rejection"), rejectionActive = Boolean(rejectionDetection), breakoutActive = detections.some((item) => item.kind === "breakout"), streakActive = detections.some((item) => item.kind === "streak"), danger = rejectionDetection?.css === "danger", bullish = (breakoutActive && result.continuation.probability >= .52) || (streakActive && result.surge.probability >= .52), level = danger ? "danger" : bullish ? "bullish" : detections.length ? "watch" : "", headline = danger ? `사전 매도 주의 · 검증 급락 46사례와 고유사 구간` : bullish ? "상승 시그널 · 돌파 또는 연속양봉 힘 우세" : rejectionActive ? "급락 사전 관찰 · 검증 사례와 유사도 상승" : detections.length ? "주의 관찰 · 유사 패턴이 형성 중입니다" : "현재 강한 선행 경보 없음 · 관찰 유지";
    const crashAnalog = result.verifiedCrash || result.crash, crashThreshold = result.verifiedCrash?.threshold || result.thresholds.crash;
    assistantOutput.className = "";
    assistantOutput.innerHTML = `<div class="assistant-alert ${level}">${DATA.symbol} ${timeframeName(result.timeframe)} · ${headline}</div>${verifiedCrashStrip(result, rejectionDetection)}<div class="assistant-grid">
      ${assistantCard("이동평균 저항·급락", danger ? "danger" : rejectionActive ? "watch" : "", danger ? "사전 매도 주의" : rejectionActive ? "사전 관찰" : "관찰", crashAnalog.probability, `향후 ${result.verifiedCrash?.horizon || result.horizon}봉 내 ${(crashThreshold * 100).toFixed(1)}% 이상 하락 확률`, [`EMA${result.rejection.emaPeriod} 저항 점수 ${(result.rejection.score * 100).toFixed(0)}점`, `EMA 값 ${compact(result.rejection.emaValue)} · 종가와 거리 ${signedPct(result.candles.at(-1)[4] / result.rejection.emaValue - 1)}`, `최근 매도 거래량 비중 ${pct(result.rejection.sellPressure)}`, `거래량 배수 ${result.rejection.volumeRatio.toFixed(2)}배`, result.verifiedCrash ? `검증 46사례 최고 유사도 ${pct(result.verifiedCrash.topSimilarity)}` : `유사도 ${pct(result.crash.similarity)} · 사례 ${result.crash.samples}개`, result.verifiedCrash ? `전체 독립 신호 비교 ${result.verifiedCrash.comparisonSignals}개 · 기준 발생률 ${pct(result.verifiedCrash.baseRate)}` : ""].filter(Boolean), "rejection", rejectionActive)}
      ${assistantCard("고점 돌파 강도", bullish && breakoutActive ? "bullish" : breakoutActive ? "watch" : "", breakoutActive ? "돌파 신호" : "돌파 대기", result.continuation.probability, `향후 추가 상승 확률 · 눌림 후 재상승 ${pct(result.pullback.probability)}`, [`20봉 기준 고점 ${compact(result.breakout.referenceHigh)} · 대비 ${signedPct(result.breakout.breakout)}`, `돌파 강도 ${(result.breakout.score * 100).toFixed(0)}점 · 몸통 힘 ${pct((result.breakout.bodyStrength + 1) / 2)}`, `고점 상승 비중 ${pct(result.breakout.risingHighs)} · 거래량 ${result.breakout.volumeRatio.toFixed(2)}배`, `유사도 ${pct(result.continuation.similarity)} · 사례 ${result.continuation.samples}개`], "breakout", breakoutActive)}
      ${assistantCard("연속 양봉·고점 상승", bullish && streakActive ? "bullish" : streakActive ? "watch" : "", streakActive ? `${result.streak.count}연속 형성` : "관찰", result.surge.probability, `향후 3봉 내 ${(result.thresholds.surge * 100).toFixed(1)}% 이상 급등 확률`, [`연속 양봉·고점 상승 ${result.streak.count}개`, `형성 점수 ${(result.streak.score * 100).toFixed(0)}점 · 최근 5봉 ${signedPct(result.streak.momentum)}`, `거래량 배수 ${result.streak.volumeRatio.toFixed(2)}배`, `유사도 ${pct(result.surge.similarity)} · 사례 ${result.surge.samples}개`], "streak", streakActive)}
    </div>${assistantWarningStack(detections)}<p class="assistant-foot">BTC 일봉 급락 확률은 검증된 46개 성공 사례와 5봉 비중복 전체 신호를 함께 비교해 산출합니다. 유사도는 최근 20봉 상승·하락률, 최근 5봉 가중치 ×3, 방향성 고저 변동폭 ×2와 저항 상태를 사용합니다. “사전 매도 주의”는 위험 관리 확인 신호이며 자동 매도나 미래 하락 보장이 아닙니다.</p>`;
    notifyIfNeeded(result, level, headline, detections);
    requestAnimationFrame(() => drawVerifiedCrashMarker(result, rejectionDetection));
  }

  function verifiedCrashStrip(result, detection) {
    if (!result.verifiedCrash) return "";
    const item = result.verifiedCrash, css = detection?.css === "danger" ? "" : " watch", state = detection?.css === "danger" ? "사전 매도 주의 신호 활성" : detection ? "위험 구간 사전 관찰" : "현재 경보 기준 미충족";
    return `<div class="verified-crash-strip${css}"><strong>검증된 BTC 급락 46사례 · ${state}</strong><p>보정 급락 확률 ${pct(item.probability)} · 최고 유사도 ${pct(item.topSimilarity)} · 46/385 기준 발생률 ${pct(item.baseRate)} · EMA 저항 점수 ${(result.rejection.score * 100).toFixed(0)}점</p></div>`;
  }

  function assistantCard(title, css, state, probability, description, evidence, kind, active) { return `<article class="assistant-card ${css}"><h3>${title}</h3><span class="assistant-state">${state}</span><strong class="assistant-main-probability">${pct(probability)}</strong><p>${description}</p><ul>${evidence.map((item) => `<li>${item}</li>`).join("")}</ul>${active ? `<button class="assistant-chart-button" type="button" data-assistant-kind="${kind}">유사 봉 차트 팝업</button>` : ""}</article>`; }

  function assistantDetections(result) {
    const items = [];
    const verified = result.verifiedCrash, verifiedWatch = verified && result.rejection.score >= .52 && ((verified.probability >= .10 && verified.topSimilarity >= .74) || (verified.probability >= .08 && verified.topSimilarity >= .78)), verifiedDanger = verifiedWatch && verified.probability >= .12 && verified.topSimilarity >= .76;
    if (verifiedWatch) items.push({ kind: "rejection", title: "검증 46사례 사전 매도 주의", css: verifiedDanger ? "danger" : "watch", probability: verified.probability, analog: verified, horizon: 5, threshold: .10, warning: `EMA${result.rejection.emaPeriod} 저항 흐름이 검증 급락 사례와 ${pct(verified.topSimilarity)} 유사합니다.`, metrics: [["보정 급락 확률", pct(verified.probability)], ["최고 유사도", pct(verified.topSimilarity)], ["기준 발생률", pct(verified.baseRate)], ["비교 신호", `${verified.comparisonSignals}개`], ["저항 점수", `${(result.rejection.score * 100).toFixed(0)}점`], ["EMA 기준값", compact(result.rejection.emaValue)], ["매도량 비중", pct(result.rejection.sellPressure)], ["5봉 모멘텀", signedPct(result.rejection.momentum)]] });
    else if (!verified && result.rejection.score >= .52) items.push({ kind: "rejection", title: "이동평균 저항 급락", css: result.crash.probability >= .5 ? "danger" : "watch", probability: result.crash.probability, analog: result.crash, horizon: result.horizon, threshold: result.thresholds.crash, warning: `EMA${result.rejection.emaPeriod} 부근 저항과 매도압력 ${(result.rejection.sellPressure * 100).toFixed(1)}%가 감지됐습니다.`, metrics: [["저항 점수", `${(result.rejection.score * 100).toFixed(0)}점`], ["EMA 기준값", compact(result.rejection.emaValue)], ["종가↔EMA", signedPct(result.candles.at(-1)[4] / result.rejection.emaValue - 1)], ["하락 확률", pct(result.crash.probability)], ["매도량 비중", pct(result.rejection.sellPressure)], ["거래량", `${result.rejection.volumeRatio.toFixed(2)}배`], ["5봉 모멘텀", signedPct(result.rejection.momentum)], ["평균 유사도", pct(result.crash.similarity)]] });
    if (result.breakout.score >= .58) items.push({ kind: "breakout", title: "고점 돌파 강도", css: result.continuation.probability >= .52 ? "bullish" : "watch", probability: result.continuation.probability, analog: result.continuation, horizon: result.horizon, threshold: result.thresholds.rise, warning: `20봉 고점 ${compact(result.breakout.referenceHigh)} 대비 ${signedPct(result.breakout.breakout)} 위치이며 돌파 강도 ${(result.breakout.score * 100).toFixed(0)}점입니다.`, metrics: [["돌파 강도", `${(result.breakout.score * 100).toFixed(0)}점`], ["20봉 고점", compact(result.breakout.referenceHigh)], ["고점 대비", signedPct(result.breakout.breakout)], ["추가 상승", pct(result.continuation.probability)], ["눌림 재상승", pct(result.pullback.probability)], ["거래량", `${result.breakout.volumeRatio.toFixed(2)}배`], ["고점 상승 비중", pct(result.breakout.risingHighs)], ["평균 유사도", pct(result.continuation.similarity)]] });
    if (result.streak.count >= 2) items.push({ kind: "streak", title: "연속 양봉·고점 상승", css: result.surge.probability >= .52 ? "bullish" : "watch", probability: result.surge.probability, analog: result.surge, horizon: Math.min(3, result.horizon), threshold: result.thresholds.surge, warning: `${result.streak.count}개 연속 양봉과 고점 상승, 최근 5봉 모멘텀 ${signedPct(result.streak.momentum)}가 감지됐습니다.`, metrics: [["연속 형성", `${result.streak.count}개`], ["형성 점수", `${(result.streak.score * 100).toFixed(0)}점`], ["5봉 모멘텀", signedPct(result.streak.momentum)], ["급등 확률", pct(result.surge.probability)], ["급등 기준", signedPct(result.thresholds.surge)], ["거래량", `${result.streak.volumeRatio.toFixed(2)}배`], ["유사 사례", `${result.surge.samples}개`], ["평균 유사도", pct(result.surge.similarity)]] });
    return items;
  }

  function assistantWarningStack(detections) {
    if (!detections.length) return "";
    return `<section class="assistant-warning-stack" aria-label="비서봇 상세 워닝">${detections.map((item) => `<div class="assistant-warning-detail ${item.css}"><div><strong>⚠ ${item.title} 유사 패턴 워닝 · ${pct(item.probability)}</strong><p>${item.warning} 과거 유사도 ${pct(item.analog.similarity)}, 표본 ${item.analog.samples}개를 확인했습니다.</p></div><button class="assistant-chart-button" type="button" data-assistant-kind="${item.kind}">유사 봉 차트 팝업</button></div>`).join("")}</section>`;
  }

  function openAssistantPatternModal(kind) {
    const result = lastAssistantResult; if (!result) return; const detection = assistantDetections(result).find((item) => item.kind === kind); if (!detection) return;
    const current = result.candles.slice(-20), allMatches = [...detection.analog.matches].sort((a, b) => b.weight - a.weight), matches = allMatches.slice(0, 8), totalWeight = allMatches.reduce((sum, item) => sum + item.weight, 0), content = modal.querySelector("#pattern-modal-content");
    modal.querySelector(".eyebrow").textContent = "MARKET ASSISTANT WARNING";
    modal.querySelector("#pattern-modal-title").textContent = `${DATA.symbol} ${detection.title} · 유사 패턴 워닝`;
    const metricHtml = detection.metrics.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
    const charts = matches.map((match, index) => { const start = Math.max(0, match.index - 19), history = result.candles.slice(start, match.index + 1), actual = result.candles.slice(match.index + 1, match.index + detection.horizon + 1), share = totalWeight ? match.weight / totalWeight : 0, verifiedDetail = Number.isFinite(match.historicalDrawdown) ? ` · 실제 최저 낙폭 ${signedPct(match.historicalDrawdown)} · 저점 ${match.troughDate}` : ""; return `<section class="pattern-modal-chart ${match.success ? "success" : "failure"}"><div class="assistant-chart-probability"><b>유사도 ${pct(match.similarity)}</b><b>가중 비중 ${pct(share)}</b></div><h3>확률 순위 ${index + 1} · ${date(result.candles[match.index][0])} · ${match.success ? "조건 발생" : "조건 미발생"}</h3><p>유사도와 가중 비중이 높은 순서 · 이후 ${detection.horizon}봉 실제 결과${verifiedDetail}</p>${candlePopupSvg([...history.map((row) => ({ row, type: "history" })), ...actual.map((row) => ({ row, type: "actual" }))], history.length, "actual")}<div class="pattern-modal-legend"><span><i class="legend-history"></i>과거 유사 20봉</span><span><i class="legend-actual-future"></i>이후 실제 ${detection.horizon}봉</span></div></section>`; }).join("");
    content.innerHTML = `<div class="assistant-modal-warning ${detection.css}"><strong>⚠ ${detection.title} 확률 ${pct(detection.probability)}</strong><span>${detection.warning} 향후 ${detection.horizon}봉 기준 변동폭 ${signedPct(detection.kind === "rejection" ? -detection.threshold : detection.threshold)} 조건을 과거 ${detection.analog.samples}개 사례와 비교했습니다.</span></div><div class="assistant-metric-grid">${metricHtml}</div><div class="pattern-modal-chart pattern-current-forecast assistant-current-chart"><div class="assistant-chart-probability"><b class="primary">현재 발생확률 ${pct(detection.probability)}</b><b>평균 유사도 ${pct(detection.analog.similarity)}</b><b>표본 ${detection.analog.samples}개</b></div><h3>현재 최근 20봉 · ${date(current[0][0])} ~ ${date(current.at(-1)[0])}</h3><p>워닝을 만든 현재 봉 흐름입니다. 각 봉에 마우스를 올리면 OHLC 값을 확인할 수 있습니다.</p>${candlePopupSvg(current.map((row) => ({ row, type: "current" })), current.length, "predicted")}<div class="pattern-modal-legend"><span><i class="legend-current"></i>현재 최근 20봉</span></div></div><h3>확률·유사도 가중치가 높은 과거 사례 8개</h3><div class="assistant-similar-grid">${charts}</div><p class="pattern-disclaimer">과거 사례 8개의 상단 배지는 현재 패턴과의 유사도와 전체 표본에서 해당 사례가 차지하는 가중 비중입니다. 전체 발생확률은 팝업 상단의 종합 워닝과 현재 패턴 영역에서만 표시합니다. 초록 테두리는 지정 변동폭 조건이 실제 발생한 과거 사례, 빨간 테두리는 미발생 사례입니다. 실제 가격 방향을 보장하지 않습니다.</p>`;
    modal.hidden = false; document.body.style.overflow = "hidden"; modal.querySelector(".pattern-modal-close").focus();
  }

  async function initializeNotifications() {
    if (!("Notification" in window)) { updateNotificationButton(); return; }
    if (Notification.permission === "granted") { localStorage.setItem("coin-assistant-notifications", "on"); updateNotificationButton(); return; }
    updateNotificationButton();
    if (Notification.permission === "default" && sessionStorage.getItem("coin-assistant-notification-auto-requested") !== "yes") { sessionStorage.setItem("coin-assistant-notification-auto-requested", "yes"); try { const permission = await Notification.requestPermission(); if (permission === "granted") localStorage.setItem("coin-assistant-notifications", "on"); } catch {} updateNotificationButton(); }
  }
  async function toggleNotifications() { if (!("Notification" in window)) { updateNotificationButton(); return; } if (localStorage.getItem("coin-assistant-notifications") === "on" && Notification.permission === "granted") { localStorage.removeItem("coin-assistant-notifications"); updateNotificationButton(); return; } try { const permission = await Notification.requestPermission(); if (permission === "granted") localStorage.setItem("coin-assistant-notifications", "on"); updateNotificationButton(); } catch { updateNotificationButton(); } }
  function updateNotificationButton() {
    let guide = assistantPanel.querySelector("#assistant-notification-guide"); if (!guide) { guide = document.createElement("div"); guide.id = "assistant-notification-guide"; assistantOutput.insertAdjacentElement("beforebegin", guide); }
    if (!("Notification" in window)) { notificationButton.textContent = "브라우저 알림 미지원"; guide.className = "assistant-notification-guide denied"; guide.innerHTML = `<span>이 브라우저에서는 시스템 알림을 지원하지 않습니다. 비서봇 화면 팝업은 계속 작동합니다.</span>`; return; }
    const enabled = Notification.permission === "granted" && localStorage.getItem("coin-assistant-notifications") === "on";
    if (enabled) { notificationButton.textContent = "브라우저 알림 끄기"; guide.className = "assistant-notification-guide enabled"; guide.innerHTML = `<span>✓ 브라우저 알림이 켜졌습니다. 강한 급락·돌파·연속양봉 신호가 나오면 시스템 알림과 화면 팝업을 함께 표시합니다.</span>`; return; }
    if (Notification.permission === "denied") { notificationButton.textContent = "브라우저 알림 차단됨"; guide.className = "assistant-notification-guide denied"; guide.innerHTML = `<span>브라우저에서 알림이 차단되어 있습니다. 주소창의 사이트 권한에서 알림을 허용해 주세요. 화면 팝업은 계속 표시됩니다.</span>`; return; }
    notificationButton.textContent = "브라우저 알림 켜기"; guide.className = "assistant-notification-guide"; guide.innerHTML = `<span>브라우저 권한 확인이 필요합니다. 아래 버튼을 한 번 누르면 비서봇 시스템 알림이 켜집니다.</span><button type="button" id="assistant-notification-guide-button">알림 권한 허용</button>`; guide.querySelector("button").addEventListener("click", toggleNotifications);
  }
  function notifyIfNeeded(result, level, headline, detections = []) { if (!level || level === "watch" || localStorage.getItem("coin-assistant-notifications") !== "on" || !("Notification" in window) || Notification.permission !== "granted") return; const key = `${DATA.market}|${result.timeframe}|${result.timestamp}|${level}`, previous = localStorage.getItem("coin-assistant-last-alert"); if (previous === key) return; const detail = detections.map((item) => `${item.title} ${pct(item.probability)} · 유사도 ${pct(item.analog.similarity)} · ${item.warning}`).join(" / "); try { new Notification(`${DATA.symbol} 시장 비서봇`, { body: `${headline}${detail ? `\n${detail}` : ""}`, tag: `${DATA.market}-${result.timeframe}` }); localStorage.setItem("coin-assistant-last-alert", key); } catch {} }
  function ema(values, period) { const output = Array(values.length).fill(null); if (values.length < period) return output; output[period - 1] = average(values.slice(0, period)); const weight = 2 / (period + 1); for (let index = period; index < values.length; index += 1) output[index] = values[index] * weight + output[index - 1] * (1 - weight); return output; }
  function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
  function timeframeName(value) { return ({ d1: "일봉", w1: "주봉", h4: "4시간봉", h1: "1시간봉" })[value] || value; }

  function normalizeDailySeries() {
    const rows = (DATA.candles.d1 || []).filter(validCandle).sort((a, b) => a[0] - b[0]), normalized = new Map();
    for (const row of rows) { const shifted = new Date(row[0] + 9 * 3_600_000), timestamp = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 9 * 3_600_000; normalized.set(timestamp, [timestamp, ...row.slice(1)]); }
    DATA.candles.d1 = [...normalized.values()].sort((a, b) => a[0] - b[0]);
  }
  function synchronizeLatestSignals(fromDownload) {
    latestSignalState = calculateLatestSignals(); renderLatestSignalAudit(latestSignalState, fromDownload); drawLatestSignalMarkers(latestSignalState);
  }
  function installLatestSignalRenderSync() {
    const charts = [document.querySelector("#candle-chart"), document.querySelector("#macd-chart")].filter(Boolean); if (!charts.length || typeof MutationObserver !== "function") return;
    const isSignalOverlay = (node) => node?.nodeType === 1 && (node.classList?.contains("live-recalc-overlay") || node.classList?.contains("verified-crash-overlay")), observer = new MutationObserver((mutations) => {
      const chartWasRedrawn = mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !isSignalOverlay(node))); if (!chartWasRedrawn || signalMarkerRefreshQueued) return;
      signalMarkerRefreshQueued = true; requestAnimationFrame(() => { signalMarkerRefreshQueued = false; if (latestSignalState) drawLatestSignalMarkers(latestSignalState); if (lastAssistantResult) drawVerifiedCrashMarker(lastAssistantResult, assistantDetections(lastAssistantResult).find((item) => item.kind === "rejection")); });
    });
    charts.forEach((chart) => observer.observe(chart, { childList: true }));
  }
  function calculateLatestSignals() {
    const candles = (DATA.candles.d1 || []).filter(validCandle).sort((a, b) => a[0] - b[0]); if (candles.length < 40) return { events: [], candles, position: false };
    const closes = candles.map((row) => row[4]), fast = ema(closes, DATA.systemConfig?.macdFast ?? 12), slow = ema(closes, DATA.systemConfig?.macdSlow ?? 26), line = closes.map((_, index) => Number.isFinite(fast[index]) && Number.isFinite(slow[index]) ? fast[index] - slow[index] : null), rsiValues = rsiSeries(closes, DATA.systemConfig?.rsiPeriod ?? 14), threshold = DATA.systemConfig?.rsiOversold ?? 30, cutoff = Math.max(...Object.values(DATA.summaries || {}).map((summary) => Date.parse(summary.to)).filter(Number.isFinite), 0), today = new Date(Date.now() + 9 * 3_600_000), todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 9 * 3_600_000, lastClosed = candles.at(-1)[0] >= todayStart ? candles.length - 2 : candles.length - 1, events = []; let position = false;
    for (let index = Math.max(26, candles.findIndex((row) => row[0] > cutoff) - 1); index <= lastClosed; index += 1) { if (index < 1 || !Number.isFinite(line[index - 1]) || !Number.isFinite(line[index])) continue; const entrySignal = line[index - 1] <= 0 && line[index] > 0 && rsiValues[index] > threshold, exitSignal = line[index - 1] >= 0 && line[index] < 0; if (!position && entrySignal && index + 1 < candles.length) { events.push({ type: "entry", signalTimestamp: candles[index][0], executionTimestamp: candles[index + 1][0], price: candles[index + 1][1], macd: line[index], priorMacd: line[index - 1], rsi: rsiValues[index] }); position = true; } else if (position && exitSignal && index + 1 < candles.length) { events.push({ type: "exit", signalTimestamp: candles[index][0], executionTimestamp: candles[index + 1][0], price: candles[index + 1][1], macd: line[index], priorMacd: line[index - 1], rsi: rsiValues[index] }); position = false; } }
    return { events, candles, position, cutoff, lastClosed };
  }
  function renderLatestSignalAudit(state, fromDownload) {
    const latest = state.events.at(-1); signalAudit.className = `latest-signal-audit${latest ? ` ${latest.type}` : ""}`;
    if (!latest) { signalAudit.innerHTML = `<span class="latest-signal-badge">LATEST SIGNAL</span><span><strong>저장 백테스트 이후 새 확정 신호 없음</strong>${fromDownload ? " · 최신 일봉 재계산 완료" : " · 최신 자료 다운로드 시 다시 계산"}</span>`; return; }
    const label = latest.type === "entry" ? "매수" : "매도", statusText = state.position ? "현재 매수 신호 유지" : latest.type === "exit" ? "현재 청산 상태" : "신호 확인";
    const history = state.events.map((event) => `<i class="${event.type}">${date(event.signalTimestamp)} ${event.type === "entry" ? "매수" : "매도"} → ${date(event.executionTimestamp)} 시가</i>`).join("");
    signalAudit.innerHTML = `<span class="latest-signal-badge">최신 재계산 ${label}</span><span><strong>${date(latest.signalTimestamp)} ${label} 조건 → ${date(latest.executionTimestamp)} 시가 신호</strong> · MACD ${Math.round(latest.priorMacd).toLocaleString()} → ${Math.round(latest.macd).toLocaleString()} · RSI ${latest.rsi.toFixed(2)} · ${statusText} · 저장 백테스트 이후 ${state.events.length}건</span><span class="latest-signal-history">${history}</span>`;
  }
  function drawLatestSignalMarkers(state) {
    document.querySelectorAll(".live-recalc-overlay").forEach((node) => node.remove());
    const activeDaily = document.querySelector('[data-timeframe="d1"]')?.classList.contains("active"); if (!activeDaily || !state.events.length) return;
    const svg = document.querySelector("#candle-chart"), macdSvg = document.querySelector("#macd-chart"), targets = [...svg.querySelectorAll(".hover-target")], candleRects = [...svg.querySelectorAll(".candle-up,.candle-down")]; if (!targets.length) return;
    const indexByTimestamp = new Map(targets.map((target, index) => [Number(target.dataset.timestamp), index]));
    for (const event of state.events) {
      const entry = event.type === "entry", color = entry ? "#72f2bd" : "#ff776f", executionIndex = indexByTimestamp.get(event.executionTimestamp), signalIndex = indexByTimestamp.get(event.signalTimestamp);
      if (Number.isInteger(executionIndex)) {
        const target = targets[executionIndex], rect = candleRects[executionIndex]; if (target && rect) { const x = Number(target.dataset.x), bodyY = Number(rect.getAttribute("y")), bodyHeight = Number(rect.getAttribute("height")), labelY = entry ? Math.max(18, bodyY - 38) : Math.min(462, bodyY + bodyHeight + 45), lineStart = entry ? labelY + 7 : labelY - 13, lineEnd = entry ? bodyY - 7 : bodyY + bodyHeight + 7, triangle = entry ? `${x},${bodyY - 2} ${x - 7},${bodyY - 12} ${x + 7},${bodyY - 12}` : `${x},${bodyY + bodyHeight + 2} ${x - 7},${bodyY + bodyHeight + 12} ${x + 7},${bodyY + bodyHeight + 12}`; svg.insertAdjacentHTML("beforeend", `<g class="live-recalc-overlay" data-marker="execution" data-event-type="${event.type}" pointer-events="none"><line x1="${x}" y1="${lineStart}" x2="${x}" y2="${lineEnd}" stroke="${color}" stroke-width="3"/><polygon points="${triangle}" fill="${color}"/><text x="${x}" y="${labelY}" text-anchor="middle" fill="${color}" font-size="12" font-weight="800">최신 ${entry ? "매수" : "매도"} 실행</text><title>${date(event.signalTimestamp)} MACD 0선 ${entry ? "상향" : "하향"}돌파 · ${date(event.executionTimestamp)} 시가 ${entry ? "진입" : "청산"}</title></g>`); }
      }
      if (Number.isInteger(signalIndex) && macdSvg) {
        const x = Number(targets[signalIndex].dataset.x), labelY = entry ? 174 : 30, zeroY = 99; macdSvg.insertAdjacentHTML("beforeend", `<g class="live-recalc-overlay" data-marker="zero-cross" data-event-type="${event.type}" pointer-events="none"><line class="live-recalc-line" x1="${x}" y1="18" x2="${x}" y2="180" stroke="${color}"/><circle cx="${x}" cy="${zeroY}" r="6" fill="${color}" stroke="#07100d" stroke-width="2"/><text x="${x}" y="${labelY}" text-anchor="middle" fill="${color}" font-size="11" font-weight="800">0선 ${entry ? "상향돌파·매수" : "하향돌파·매도"}</text><title>${date(event.signalTimestamp)} MACD ${Math.round(event.priorMacd).toLocaleString()} → ${Math.round(event.macd).toLocaleString()} · 0선 ${entry ? "상향" : "하향"}돌파</title></g>`);
      }
    }
  }
  function drawVerifiedCrashMarker(result, detection) {
    document.querySelectorAll(".verified-crash-overlay").forEach((node) => node.remove());
    if (!detection || !result.verifiedCrash || result.timeframe !== "d1" || DATA.symbol !== "BTC") return;
    const activeDaily = document.querySelector('[data-timeframe="d1"]')?.classList.contains("active"); if (!activeDaily) return;
    const svg = document.querySelector("#candle-chart"), targets = [...svg?.querySelectorAll(".hover-target") || []], candleRects = [...svg?.querySelectorAll(".candle-up,.candle-down") || []], index = targets.findIndex((target) => Number(target.dataset.timestamp) === result.timestamp); if (index < 0 || !candleRects[index]) return;
    const target = targets[index], rect = candleRects[index], x = Number(target.dataset.x), bodyY = Number(rect.getAttribute("y")), labelY = Math.max(18, bodyY - 58), lineEnd = Math.max(labelY + 16, bodyY - 8), color = detection.css === "danger" ? "#ff776f" : "#f2c572", text = detection.css === "danger" ? `사전 매도 주의 ${pct(detection.probability)}` : `급락 사전 관찰 ${pct(detection.probability)}`;
    svg.insertAdjacentHTML("beforeend", `<g class="verified-crash-overlay" pointer-events="none"><line x1="${x}" y1="${labelY + 7}" x2="${x}" y2="${lineEnd}" stroke="${color}" stroke-width="3" stroke-dasharray="5 4"/><polygon points="${x},${bodyY - 2} ${x - 8},${bodyY - 14} ${x + 8},${bodyY - 14}" fill="${color}"/><text x="${x}" y="${labelY}" text-anchor="middle" fill="${color}" font-size="12" font-weight="900">${text}</text><title>검증 급락 46사례 · 보정 확률 ${pct(result.verifiedCrash.probability)} · 최고 유사도 ${pct(result.verifiedCrash.topSimilarity)} · 향후 5봉 -10% 위험</title></g>`);
  }
  function rsiSeries(values, period) { const output = Array(values.length).fill(null); if (values.length <= period) return output; let gain = 0, loss = 0; for (let index = 1; index <= period; index += 1) { const change = values[index] - values[index - 1]; gain += Math.max(change, 0); loss += Math.max(-change, 0); } let averageGain = gain / period, averageLoss = loss / period; output[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss); for (let index = period + 1; index < values.length; index += 1) { const change = values[index] - values[index - 1]; averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period; averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period; output[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss); } return output; }

  function validCandle(row) { return Array.isArray(row) && row.length >= 6 && row.slice(0, 6).every(Number.isFinite) && row[4] > 0; }
  function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN; }
  function pct(value) { return `${(value * 100).toFixed(1)}%`; }
  function signedPct(value) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }
  function date(timestamp) { return new Date(timestamp).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }); }
  function koreaDateKey(timestamp) { return new Date(timestamp + 9 * 3_600_000).toISOString().slice(0, 10); }
})();
