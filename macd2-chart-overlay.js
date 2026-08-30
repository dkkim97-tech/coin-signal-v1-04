(function () {
  "use strict";
  const style = document.createElement("style");
  style.textContent = `
    .legend-macd1{background:#72f2bd}.legend-macd2{background:#c891ff}
    .actual-return-line.macd1{stroke:#72f2bd}.actual-return-line.macd2{stroke:#c891ff;stroke-width:2.7}
    .actual-dd-line.macd1{stroke:#f2c572}.actual-dd-line.macd2{stroke:#ff8bd1;stroke-dasharray:6 4}
    .macd-scenario-note{display:grid;grid-template-columns:1fr 1.4fr;gap:10px;margin:12px 0;padding:13px 15px;border:1px solid var(--line);border-radius:11px;background:#0c1110;color:var(--muted);font-size:12px}
    .macd-scenario-note strong{display:block;color:var(--text);margin-bottom:5px}.macd-scenario-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px 12px}.macd-scenario-grid b{color:#c891ff}
    @media(max-width:760px){.macd-scenario-note{grid-template-columns:1fr}.macd-scenario-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const comparisonTitle = document.querySelector("#return-comparison")?.closest(".plot-block")?.querySelector("h3");
  if (comparisonTitle) comparisonTitle.textContent = "MACD 1·MACD 2 수익률 비교";
  const detailTitle = document.querySelector("#actual-equity-chart")?.closest(".live-results")?.querySelector(".detail-heading h3");
  if (detailTitle) detailTitle.textContent = "MACD 1·MACD 2 전략 상세 자산곡선";
  const legend = document.querySelector("#actual-equity-chart")?.previousElementSibling;
  if (legend?.classList.contains("chart-legend")) legend.innerHTML = `<span><i class="legend-macd1"></i>MACD 1 누적수익률</span><span><i class="legend-macd2"></i>MACD 2 누적수익률</span><span><i class="legend-drawdown"></i>MACD 1 낙폭</span><span><i style="background:#ff8bd1"></i>MACD 2 낙폭</span>`;
  const scenario = document.createElement("div");
  scenario.className = "macd-scenario-note";
  scenario.innerHTML = `<div><strong>MACD 1 · 0선 돌파</strong>기존 RSI 30 초과 + MACD 0선 상향돌파 매수, 0선 하향돌파 매도 전략</div><div><strong>MACD 2 · 상태별 보유 비중</strong><div class="macd-scenario-grid"><span>0선 위·골든 <b>100%</b></span><span>0선 위·데드 <b>50%</b></span><span>0선 아래·골든 <b>50%</b></span><span>0선 아래·데드 <b>0%</b></span></div></div>`;
  document.querySelector("#actual-equity-chart")?.insertAdjacentElement("beforebegin", scenario);

  window.drawActualDetail = function drawMacdComparison(result, market) {
    const strategies = ["MACD 1 · 0선 돌파", "MACD 2 · 0선×골든/데드 보유비중"];
    const entries = strategies.map((strategy) => ({
      strategy,
      summary: result.summaries.find((row) => row.market === market && row.strategy === strategy),
      series: result.series.find((row) => row.market === market && row.strategy === strategy),
    })).filter((entry) => entry.summary && entry.series?.equityCurve?.length);
    if (!entries.length) return;
    const svg = document.querySelector("#actual-equity-chart");
    const allPoints = entries.flatMap((entry) => entry.series.equityCurve);
    const returns = allPoints.map((point) => point.return);
    const minReturn = Math.min(0, ...returns), maxReturn = Math.max(0.01, ...returns), returnSpan = maxReturn - minReturn || 1;
    const maxDrawdown = Math.max(0.01, ...allPoints.map((point) => point.drawdown));
    const start = Math.min(...allPoints.map((point) => point.timestamp)), end = Math.max(...allPoints.map((point) => point.timestamp));
    const left = 75, right = 1060, top = 35, returnBottom = 275, ddTop = 330, ddBottom = 400;
    const x = (timestamp) => left + (timestamp - start) / Math.max(1, end - start) * (right - left);
    const yReturn = (value) => returnBottom - (value - minReturn) / returnSpan * (returnBottom - top);
    const yDrawdown = (value) => ddTop + value / maxDrawdown * (ddBottom - ddTop);
    const paths = entries.map((entry, index) => {
      const css = index ? "macd2" : "macd1";
      const returnPath = entry.series.equityCurve.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${x(point.timestamp).toFixed(1)},${yReturn(point.return).toFixed(1)}`).join(" ");
      const drawdownPath = entry.series.equityCurve.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${x(point.timestamp).toFixed(1)},${yDrawdown(point.drawdown).toFixed(1)}`).join(" ");
      return `<path class="actual-return-line ${css}" d="${returnPath}"><title>${entry.strategy} 최종 ${formatPercent(entry.summary.totalReturn)}</title></path><path class="actual-dd-line ${css}" d="${drawdownPath}"><title>${entry.strategy} MDD ${formatPercent(-entry.summary.maxDrawdown)}</title></path>`;
    }).join("");
    const returnTicks = Array.from({ length: 5 }, (_, index) => minReturn + returnSpan * index / 4);
    const grids = returnTicks.map((tick) => `<line class="chart-grid" x1="${left}" y1="${yReturn(tick)}" x2="${right}" y2="${yReturn(tick)}"/><text class="chart-tick" x="${left - 10}" y="${yReturn(tick) + 4}" text-anchor="end">${(tick * 100).toFixed(0)}%</text>`).join("");
    const dates = [start, start + (end - start) / 2, end].map((timestamp) => `<text class="chart-tick" x="${x(timestamp)}" y="425" text-anchor="middle">${new Date(timestamp).toLocaleDateString("ko-KR", { year: "numeric", month: "short" })}</text>`).join("");
    const totals = entries.map((entry) => `${entry.strategy.replace(" · 0선×골든/데드 보유비중", "")}: ${formatPercent(entry.summary.totalReturn)}`).join(" · ");
    svg.innerHTML = `<title>${market.replace("KRW-", "")} MACD 1·MACD 2 누적수익률 비교</title>${grids}<line class="actual-zero" x1="${left}" y1="${yReturn(0)}" x2="${right}" y2="${yReturn(0)}"/>${paths}<line class="chart-grid" x1="${left}" y1="${ddTop}" x2="${right}" y2="${ddTop}"/><text class="chart-tick" x="${left - 10}" y="${ddTop + 4}" text-anchor="end">0%</text><text class="chart-tick" x="${left - 10}" y="${ddBottom}" text-anchor="end">-${(maxDrawdown * 100).toFixed(0)}%</text>${dates}<text class="chart-value" x="${right}" y="22" text-anchor="end">${totals}</text>`;
    document.querySelector("#detail-reading").textContent = `${market.replace("KRW-", "")}의 동일 기간 MACD 1과 MACD 2 누적수익률을 함께 표시합니다. MACD 2는 전일 확정 MACD 상태를 다음 일봉 시가부터 적용하며 수수료 0.05%와 슬리피지 0.08%를 반영했습니다.`;
  };

  function formatPercent(value) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }

  setTimeout(() => {
    if (window.__UPBIT_RESULT__?.summaries?.length && typeof window.renderLatestUpbitSummary === "function") {
      window.renderLatestUpbitSummary(window.__UPBIT_RESULT__);
    }
  }, 0);
})();
