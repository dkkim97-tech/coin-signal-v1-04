(function () {
  "use strict";

  const DATA = window.__COIN_DATA__;
  if (!DATA?.candles?.d1 || document.querySelector("#macd-allocation-advisor")) return;

  const style = document.createElement("style");
  style.textContent = `
    .macd-advisor-wrap{position:relative}.macd-advisor-popup{position:absolute;z-index:24;top:12px;left:12px;right:auto;width:min(350px,calc(100% - 24px));border:1px solid #40504c;border-radius:14px;background:rgba(9,13,12,.76);box-shadow:0 14px 36px rgba(0,0,0,.32);overflow:hidden;backdrop-filter:blur(1.5px);-webkit-backdrop-filter:blur(1.5px)}
    .macd-advisor-popup[data-target="100"]{border-color:var(--mint)}.macd-advisor-popup[data-target="50"]{border-color:var(--amber)}.macd-advisor-popup[data-target="0"]{border-color:var(--red)}
    .macd-advisor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:13px 14px 10px}.macd-advisor-kicker{display:block;color:var(--muted);font-size:9px;font-weight:900;letter-spacing:.14em}.macd-advisor-head h3{margin:4px 0 0;font-size:15px}.macd-advisor-toggle{border:1px solid var(--line);border-radius:7px;background:#111917;color:var(--muted);font:inherit;font-size:10px;padding:5px 7px;cursor:pointer}
    .macd-advisor-main{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;padding:0 14px 12px}.macd-advisor-state{font-size:13px;font-weight:800}.macd-advisor-date{display:block;margin-top:4px;color:var(--muted);font-size:10px}.macd-advisor-target{text-align:right}.macd-advisor-target span{display:block;color:var(--muted);font-size:9px}.macd-advisor-target strong{display:block;font-size:31px;line-height:1.05}.macd-advisor-popup[data-target="100"] .macd-advisor-target strong{color:var(--mint)}.macd-advisor-popup[data-target="50"] .macd-advisor-target strong{color:var(--amber)}.macd-advisor-popup[data-target="0"] .macd-advisor-target strong{color:var(--red)}
    .macd-advisor-values{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(38,48,46,.72);border-top:1px solid rgba(64,80,76,.78);border-bottom:1px solid rgba(64,80,76,.78)}.macd-advisor-values>div{background:rgba(12,18,16,.68);padding:9px 10px}.macd-advisor-values span{display:block;color:var(--muted);font-size:8px;margin-bottom:3px}.macd-advisor-values strong{font-size:11px}
    .macd-advisor-rules{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:11px 12px}.macd-advisor-rule{padding:8px 9px;border:1px solid rgba(64,80,76,.76);border-radius:9px;background:rgba(13,18,17,.64);color:var(--muted);font-size:9px;line-height:1.4}.macd-advisor-rule strong{display:block;color:var(--text);font-size:10px}.macd-advisor-rule.active{border-color:currentColor;background:rgba(23,32,30,.68);color:var(--mint)}.macd-advisor-popup[data-target="50"] .macd-advisor-rule.active{color:var(--amber);background:rgba(36,30,14,.7)}.macd-advisor-popup[data-target="0"] .macd-advisor-rule.active{color:var(--red);background:rgba(41,18,17,.7)}
    .macd-advisor-note{margin:0;padding:0 13px 11px;color:var(--muted);font-size:9px;line-height:1.45}.macd-advisor-popup.is-collapsed .macd-advisor-values,.macd-advisor-popup.is-collapsed .macd-advisor-rules,.macd-advisor-popup.is-collapsed .macd-advisor-note{display:none}.macd-advisor-popup.is-collapsed .macd-advisor-main{padding-bottom:10px}.macd-advisor-cross{display:inline-block;margin-left:5px;padding:2px 5px;border-radius:999px;background:#17201e;color:var(--blue);font-size:8px;vertical-align:1px}
    @media(max-width:800px){.macd-advisor-popup{position:relative;top:auto;left:auto;right:auto;width:100%;margin:8px 0 0;background:rgba(9,13,12,.9)}.macd-advisor-rules{grid-template-columns:1fr}.macd-advisor-target strong{font-size:27px}}
    @media print{.macd-advisor-popup{position:relative;top:auto;left:auto;right:auto;width:100%;box-shadow:none;margin-top:8px}.macd-advisor-toggle{display:none}}
  `;
  document.head.appendChild(style);

  const chart = document.querySelector("#macd-chart");
  if (!chart) return;
  const wrap = document.createElement("div");
  wrap.className = "macd-advisor-wrap";
  chart.parentNode.insertBefore(wrap, chart);
  wrap.appendChild(chart);

  const popup = document.createElement("aside");
  popup.id = "macd-allocation-advisor";
  popup.className = "macd-advisor-popup";
  popup.setAttribute("role", "status");
  popup.setAttribute("aria-live", "polite");
  wrap.appendChild(popup);

  popup.addEventListener("click", (event) => {
    if (!event.target.closest(".macd-advisor-toggle")) return;
    popup.classList.toggle("is-collapsed");
    const button = popup.querySelector(".macd-advisor-toggle");
    if (button) button.textContent = popup.classList.contains("is-collapsed") ? "펼치기" : "접기";
  });

  const originalRenderIndicatorCharts = window.renderIndicatorCharts;
  if (typeof originalRenderIndicatorCharts === "function") {
    window.renderIndicatorCharts = function (...args) {
      const result = originalRenderIndicatorCharts.apply(this, args);
      queueMicrotask(update);
      return result;
    };
  }

  const status = document.querySelector("#latest-data-status");
  if (status) new MutationObserver(() => setTimeout(update, 130)).observe(status, { childList: true, characterData: true, subtree: true });
  document.querySelector("#refresh-latest-data")?.addEventListener("click", () => setTimeout(update, 800));
  setTimeout(update, 0);
  setTimeout(update, 400);

  function update() {
    const result = calculateLatest();
    if (!result) {
      popup.dataset.target = "50";
      popup.innerHTML = `<div class="macd-advisor-head"><div><span class="macd-advisor-kicker">BACKTEST ALLOCATION</span><h3>추천 비중 계산 대기</h3></div><button class="macd-advisor-toggle" type="button">접기</button></div><p class="macd-advisor-note">MACD(12·26·9) 계산에 필요한 일봉 자료가 부족합니다.</p>`;
      return;
    }
    const wasCollapsed = popup.classList.contains("is-collapsed");
    popup.dataset.target = String(result.target);
    popup.innerHTML = `
      <div class="macd-advisor-head"><div><span class="macd-advisor-kicker">BACKTEST ALLOCATION · DAILY MACD</span><h3>${DATA.symbol} 추천 보유 비중</h3></div><button class="macd-advisor-toggle" type="button">${wasCollapsed ? "펼치기" : "접기"}</button></div>
      <div class="macd-advisor-main"><div><div class="macd-advisor-state">${result.zeroZone} · ${result.relation}<span class="macd-advisor-cross">${result.crossEvent}</span></div><span class="macd-advisor-date">${result.dateLabel} ${result.isOpen ? "· 진행 중 일봉" : "· 확정 일봉"}</span></div><div class="macd-advisor-target"><span>추천 보유 비중</span><strong>${result.target}%</strong></div></div>
      <div class="macd-advisor-values"><div><span>MACD</span><strong>${formatValue(result.macd)}</strong></div><div><span>시그널</span><strong>${formatValue(result.signal)}</strong></div><div><span>히스토그램</span><strong>${formatValue(result.histogram)}</strong></div></div>
      <div class="macd-advisor-rules">${result.rules.map((rule) => `<div class="macd-advisor-rule${rule.active ? " active" : ""}"><strong>${rule.label}</strong>${rule.target}% 보유</div>`).join("")}</div>
      <p class="macd-advisor-note">백테스트 규칙을 최신 일봉 MACD 상태에 적용한 참고 비중입니다. 진행 중 일봉의 값은 종가 확정 전 바뀔 수 있으며 투자 수익을 보장하지 않습니다.</p>`;
    popup.classList.toggle("is-collapsed", wasCollapsed);
  }

  function calculateLatest() {
    const candles = (DATA.candles.d1 || []).filter((row) => Array.isArray(row) && row.length >= 5 && row.slice(0, 5).every(Number.isFinite)).sort((a, b) => a[0] - b[0]);
    if (candles.length < 40) return null;
    const closes = candles.map((row) => row[4]);
    const fast = ema(closes, Number(DATA.systemConfig?.macdFast) || 12);
    const slow = ema(closes, Number(DATA.systemConfig?.macdSlow) || 26);
    const macd = closes.map((_, index) => Number.isFinite(fast[index]) && Number.isFinite(slow[index]) ? fast[index] - slow[index] : null);
    const compact = macd.filter(Number.isFinite);
    const compactSignal = ema(compact, Number(DATA.systemConfig?.macdSignal) || 9);
    const signal = Array(macd.length).fill(null);
    let cursor = 0;
    for (let index = 0; index < macd.length; index += 1) if (Number.isFinite(macd[index])) { signal[index] = compactSignal[cursor]; cursor += 1; }
    let index = macd.length - 1;
    while (index >= 0 && (!Number.isFinite(macd[index]) || !Number.isFinite(signal[index]))) index -= 1;
    if (index < 1) return null;
    const zeroAbove = macd[index] >= 0;
    const golden = macd[index] >= signal[index];
    const target = zeroAbove ? (golden ? 100 : 50) : (golden ? 50 : 0);
    let crossEvent = "교차 유지";
    if (Number.isFinite(macd[index - 1]) && Number.isFinite(signal[index - 1])) {
      if (macd[index - 1] < signal[index - 1] && macd[index] >= signal[index]) crossEvent = "골든 교차";
      else if (macd[index - 1] >= signal[index - 1] && macd[index] < signal[index]) crossEvent = "데드 교차";
    }
    const latestTimestamp = candles[index][0];
    const kstNow = new Date(Date.now() + 9 * 3_600_000);
    const todayKstStart = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3_600_000;
    const key = `${zeroAbove ? "above" : "below"}-${golden ? "golden" : "dead"}`;
    const rules = [
      { key: "above-golden", label: "0선 위 · 골든", target: 100 },
      { key: "above-dead", label: "0선 위 · 데드", target: 50 },
      { key: "below-golden", label: "0선 아래 · 골든", target: 50 },
      { key: "below-dead", label: "0선 아래 · 데드", target: 0 },
    ].map((rule) => ({ ...rule, active: rule.key === key }));
    return {
      macd: macd[index], signal: signal[index], histogram: macd[index] - signal[index], target, rules, crossEvent,
      zeroZone: zeroAbove ? "MACD 0선 위" : "MACD 0선 아래", relation: golden ? "골든 상태" : "데드 상태",
      dateLabel: new Date(latestTimestamp).toLocaleDateString("ko-KR"), isOpen: latestTimestamp >= todayKstStart,
    };
  }

  function ema(values, period) {
    const output = Array(values.length).fill(null);
    if (values.length < period) return output;
    output[period - 1] = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    const weight = 2 / (period + 1);
    for (let index = period; index < values.length; index += 1) output[index] = values[index] * weight + output[index - 1] * (1 - weight);
    return output;
  }

  function formatValue(value) {
    const absolute = Math.abs(value);
    const digits = absolute >= 1_000_000 ? 1 : absolute >= 1_000 ? 0 : absolute >= 10 ? 1 : 3;
    return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
  }
})();
