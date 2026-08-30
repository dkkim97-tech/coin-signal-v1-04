(function () {
  "use strict";
  const isFutures = /(^|\/)futures(\/|$)/i.test(decodeURIComponent(location.pathname || "")) || new URLSearchParams(location.search).get("mode") === "futures";
  const style = document.createElement("style");
  style.textContent = `
    .legend-macd1{background:#72f2bd}.legend-macd2{background:#c891ff}.legend-macd3{background:#ff9d5c}.legend-macd4{background:#4ca6ff}.legend-macd5{background:#ff5fb7}.legend-macd6{background:#ff4d4d}
    .actual-return-line.macd1{stroke:#72f2bd}.actual-return-line.macd2{stroke:#c891ff;stroke-width:2.7}.actual-return-line.macd3{stroke:#ff9d5c;stroke-width:2.7;stroke-dasharray:8 4}.actual-return-line.macd4{stroke:#4ca6ff;stroke-width:2.9;stroke-dasharray:12 4}.actual-return-line.macd5{stroke:#ff5fb7;stroke-width:2.9;stroke-dasharray:5 3}.actual-return-line.macd6{stroke:#ff4d4d;stroke-width:3;stroke-dasharray:14 3 3 3}
    .actual-dd-line.macd1{stroke:#f2c572}.actual-dd-line.macd2{stroke:#ff8bd1;stroke-dasharray:6 4}.actual-dd-line.macd3{stroke:#ffcd70;stroke-dasharray:2 4}.actual-dd-line.macd4{stroke:#56c8ff;stroke-dasharray:10 4}.actual-dd-line.macd5{stroke:#ff9bd4;stroke-dasharray:5 3}.actual-dd-line.macd6{stroke:#ff8a8a;stroke-dasharray:14 3 3 3}
    .macd-scenario-note{display:grid;grid-template-columns:1fr 1.35fr 1.35fr;gap:10px;margin:12px 0;padding:13px 15px;border:1px solid var(--line);border-radius:11px;background:#0c1110;color:var(--muted);font-size:12px}
    .macd-scenario-note.is-futures{grid-template-columns:repeat(2,minmax(0,1fr))}
    .macd-scenario-note strong{display:block;color:var(--text);margin-bottom:5px}.macd-scenario-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px 12px}.macd-scenario-grid b{color:#c891ff}
    @media(max-width:760px){.macd-scenario-note{grid-template-columns:1fr}.macd-scenario-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  if (isFutures) {
    const subtitle = document.querySelector("header .subtitle");
    if (subtitle) subtitle.textContent = "MACD 1·2·3 현물 기준 · MACD 4(1배)·MACD 5(2배)·MACD 6(5배): MACD(18,39,9) 선물 롱/숏 전략";
    const summaryTitle = document.querySelector(".live-results .chart-heading h2");
    if (summaryTitle) summaryTitle.textContent = "MACD 1·MACD 2·MACD 3·MACD 4·MACD 5·MACD 6 — 12종목 선물 전략 자산 비교 결과";
    const returnLegend = document.querySelector(".macd-return-legend");
    if (returnLegend && !returnLegend.querySelector(".macd4-color")) returnLegend.insertAdjacentHTML("beforeend", '<span><i class="macd4-color"></i>MACD 4 · 선물 1배</span><span><i class="macd5-color"></i>MACD 5 · 선물 2배</span><span><i class="macd6-color"></i>MACD 6 · 선물 5배</span>');
  }

  const comparisonTitle = document.querySelector("#return-comparison")?.closest(".plot-block")?.querySelector("h3");
  if (comparisonTitle) comparisonTitle.textContent = isFutures ? "MACD 1·MACD 2·MACD 3·MACD 4·MACD 5·MACD 6 수익률 비교" : "MACD 1·MACD 2·MACD 3 수익률 비교";
  const detailTitle = document.querySelector("#actual-equity-chart")?.closest(".live-results")?.querySelector(".detail-heading h3");
  if (detailTitle) detailTitle.textContent = isFutures ? "MACD 1·MACD 2·MACD 3·MACD 4·MACD 5·MACD 6 전략 상세 자산곡선" : "MACD 1·MACD 2·MACD 3 전략 상세 자산곡선";
  const legend = document.querySelector("#actual-equity-chart")?.previousElementSibling;
  if (legend?.classList.contains("chart-legend")) legend.innerHTML = `<span><i class="legend-macd1"></i>MACD 1 누적수익률</span><span><i class="legend-macd2"></i>MACD 2 누적수익률</span><span><i class="legend-macd3"></i>MACD 3 누적수익률</span>${isFutures ? '<span><i class="legend-macd4"></i>MACD 4·1배</span><span><i class="legend-macd5"></i>MACD 5·2배</span><span><i class="legend-macd6"></i>MACD 6·5배</span>' : ""}<span><i class="legend-drawdown"></i>MACD 1 낙폭</span><span><i style="background:#ff8bd1"></i>MACD 2 낙폭</span><span><i style="background:#ffcd70"></i>MACD 3 낙폭</span>${isFutures ? '<span><i style="background:#56c8ff"></i>MACD 4 낙폭</span><span><i style="background:#ff9bd4"></i>MACD 5 낙폭</span><span><i style="background:#ff8a8a"></i>MACD 6 낙폭</span>' : ""}`;
  const scenario = document.createElement("div");
  scenario.className = "macd-scenario-note";
  if (isFutures) scenario.classList.add("is-futures");
  scenario.innerHTML = `<div><strong>MACD 1 · 0선 돌파</strong>기존 RSI 30 초과 + MACD 0선 상향돌파 매수, 0선 하향돌파 매도 전략</div><div><strong>MACD 2 · MACD(12,26,9)</strong><div class="macd-scenario-grid"><span>0선 위·골든 <b>롱 100%</b></span><span>0선 위·데드 <b>롱 50%</b></span><span>0선 아래·골든 <b>롱 50%</b></span><span>0선 아래·데드 <b>0%</b></span></div></div><div><strong>MACD 3 · MACD(18,39,9)</strong><div class="macd-scenario-grid"><span>0선 위·골든 <b>롱 100%</b></span><span>0선 위·데드 <b>롱 50%</b></span><span>0선 아래·골든 <b>롱 50%</b></span><span>0선 아래·데드 <b>0%</b></span></div></div>${isFutures ? '<div><strong>MACD 4 · 선물 1배</strong><div class="macd-scenario-grid"><span>0선 위·골든 <b>롱 1배</b></span><span>0선 위·데드 <b>롱 50%</b></span><span>0선 아래·골든 <b>롱 50%</b></span><span>0선 아래·데드 <b>숏 1배</b></span></div></div><div><strong>MACD 5 · 선물 2배</strong><div class="macd-scenario-grid"><span>0선 위·골든 <b>롱 2배</b></span><span>0선 위·데드 <b>롱 50%</b></span><span>0선 아래·골든 <b>롱 50%</b></span><span>0선 아래·데드 <b>숏 2배</b></span></div></div><div><strong>MACD 6 · 선물 5배</strong><div class="macd-scenario-grid"><span>0선 위·골든 <b>롱 5배</b></span><span>0선 위·데드 <b>롱 50%</b></span><span>0선 아래·골든 <b>롱 50%</b></span><span>0선 아래·데드 <b>숏 5배</b></span></div></div>' : ""}`;
  document.querySelector("#actual-equity-chart")?.insertAdjacentElement("beforebegin", scenario);

  window.drawActualDetail = function drawMacdComparison(result, market) {
    const strategies = ["MACD 1 · 0선 돌파", "MACD 2 · 0선×골든/데드 보유비중", "MACD 3 · MACD(18,39,9) 0선×골든/데드 보유비중", ...(isFutures ? ["MACD 4 · MACD(18,39,9) 선물 롱/숏 보유비중", "MACD 5 · MACD(18,39,9) 선물 롱/숏 2배", "MACD 6 · MACD(18,39,9) 선물 롱/숏 5배"] : [])];
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
      const css = entry.strategy.startsWith("MACD 1") ? "macd1" : entry.strategy.startsWith("MACD 2") ? "macd2" : entry.strategy.startsWith("MACD 3") ? "macd3" : entry.strategy.startsWith("MACD 4") ? "macd4" : entry.strategy.startsWith("MACD 5") ? "macd5" : "macd6";
      const returnPath = entry.series.equityCurve.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${x(point.timestamp).toFixed(1)},${yReturn(point.return).toFixed(1)}`).join(" ");
      const drawdownPath = entry.series.equityCurve.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${x(point.timestamp).toFixed(1)},${yDrawdown(point.drawdown).toFixed(1)}`).join(" ");
      return `<path class="actual-return-line ${css}" d="${returnPath}"><title>${entry.strategy} 최종 ${formatPercent(entry.summary.totalReturn)}</title></path><path class="actual-dd-line ${css}" d="${drawdownPath}"><title>${entry.strategy} MDD ${formatPercent(-entry.summary.maxDrawdown)}</title></path>`;
    }).join("");
    const returnTicks = Array.from({ length: 5 }, (_, index) => minReturn + returnSpan * index / 4);
    const grids = returnTicks.map((tick) => `<line class="chart-grid" x1="${left}" y1="${yReturn(tick)}" x2="${right}" y2="${yReturn(tick)}"/><text class="chart-tick" x="${left - 10}" y="${yReturn(tick) + 4}" text-anchor="end">${(tick * 100).toFixed(0)}%</text>`).join("");
    const dates = [start, start + (end - start) / 2, end].map((timestamp) => `<text class="chart-tick" x="${x(timestamp)}" y="425" text-anchor="middle">${new Date(timestamp).toLocaleDateString("ko-KR", { year: "numeric", month: "short" })}</text>`).join("");
    const totals = entries.map((entry) => `${entry.strategy.split(" · ")[0]}: ${formatPercent(entry.summary.totalReturn)}${entry.summary.tradingHalted ? "(청산)" : ""}`).join(" · ");
    svg.innerHTML = `<title>${market.replace("KRW-", "")} ${isFutures ? "MACD 1·2·3·4·5·6" : "MACD 1·MACD 2·MACD 3"} 누적수익률 비교</title>${grids}<line class="actual-zero" x1="${left}" y1="${yReturn(0)}" x2="${right}" y2="${yReturn(0)}"/>${paths}<line class="chart-grid" x1="${left}" y1="${ddTop}" x2="${right}" y2="${ddTop}"/><text class="chart-tick" x="${left - 10}" y="${ddTop + 4}" text-anchor="end">0%</text><text class="chart-tick" x="${left - 10}" y="${ddBottom}" text-anchor="end">-${(maxDrawdown * 100).toFixed(0)}%</text>${dates}<text class="chart-value" x="${right}" y="22" text-anchor="end">${totals}</text>`;
    document.querySelector("#detail-reading").textContent = `${market.replace("KRW-", "")}의 동일 기간 ${isFutures ? "MACD 1·2·3과 MACD 4(1배)·MACD 5(2배)·MACD 6(5배)" : "MACD 1·MACD 2(12,26,9)·MACD 3(18,39,9)"} 누적수익률을 함께 표시합니다. 전일 확정 MACD 상태를 다음 일봉 시가부터 적용하고 수수료 0.05%와 슬리피지 0.08%를 반영했습니다.${isFutures ? " MACD 5·6은 일봉 고가·저가에서 계좌 가치가 0 이하가 되면 청산 처리하며, 펀딩비와 거래소별 유지증거금은 미반영입니다." : ""}`;
  };

  function formatPercent(value) { return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }

  setTimeout(() => {
    if (window.__UPBIT_RESULT__?.summaries?.length && typeof window.renderLatestUpbitSummary === "function") {
      window.renderLatestUpbitSummary(window.__UPBIT_RESULT__);
    }
  }, 0);
})();
