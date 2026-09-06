import { settings, LEGACY_TARGETS } from './config.mjs';
import { DAY, normalize, indicators, avg } from './indicators.mjs';
import { signalAt, scenarios } from './signals.mjs';
import { detect, analogs, riskScores, riskTarget } from './patterns.mjs';
import { account, equity, position, plan, reconcile, fillDay, cancelAll } from './execution.mjs';
import { fetchRecent, FRAME, integrity, connectors, flowContext } from './data.mjs';

const isFutures = document.documentElement.dataset.investmentMode === 'futures';
const isBTC = !window.__COIN_DATA__ || window.__COIN_DATA__.symbol === 'BTC';
if (isBTC && !document.querySelector('#position-lab')) initialize();

function initialize() {
  const root = document.createElement('section'); root.id = 'position-lab'; root.setAttribute('aria-label', 'Bitcoin Position Management'); document.body.classList.add('position-enabled');
  const anchor = document.querySelector('main') || document.querySelector('header')?.parentElement || document.body;
  anchor.prepend(root);
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./dashboard.css', import.meta.url); document.head.append(stylesheet);
  const storageKey = `btc-position-v1:${isFutures ? 'futures' : 'spot'}`;
  const read = suffix => { try { return JSON.parse(localStorage.getItem(`${storageKey}:${suffix}`) || 'null'); } catch { return null; } };
  const save = (suffix, data) => localStorage.setItem(`${storageKey}:${suffix}`, JSON.stringify(data));
  const storedSettings = read('settings') || {};
  let s; try { s = settings({ ...storedSettings, spacingMode:'equal', executionPolicy:'complete-on-confirmation', ...(storedSettings.executionPolicy !== 'complete-on-confirmation' ? {riskModel:null} : {}) }); } catch { s = settings(); }
  save('settings', s);
  let data = {}, candles = [], rows = [], mode = 'SIMULATION', current = 0, paper = null, worker = null, result = null, context = null, lastRefresh = 0, busy = false;
  let signal, detection, quote = null, quoteTime = null;
  const fmt = (v, digits = 0) => Number.isFinite(v) ? v.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
  const pct = v => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = t => Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '—';
  const $ = q => root.querySelector(q);
  const name = key => key ? key.replace('below', '0선 아래').replace('above', '0선 위').replace('_golden', ' · Golden Cross').replace('_dead', ' · Dead Cross') : '교차 예상 없음';
  const table = (headers, body) => `<div class="pl-scroll"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.length ? body.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">표본 / 데이터 없음</td></tr>`}</tbody></table></div>`;
  const metric = (label, value, note = '') => `<div class="pl-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
  const input = (key, label, value, step = 'any') => `<label>${esc(label)}<input name="${key}" type="number" step="${step}" value="${value}" required></label>`;
  root.innerHTML = `<div class="pl-header"><div><span class="pl-kicker">BITCOIN · POSITION MANAGEMENT</span><h2>확률을 확인하고, 다섯 번에 나눠서.</h2><p>MACD 목표 비중 · 3-Day Leading Signal · ADR5 실행</p></div><div class="pl-controls"><label>운용 모드<select id="pl-mode"><option>SIMULATION</option><option>PAPER</option><option>BACKTEST</option><option disabled>LIVE · 실주문 미연결</option></select></label><button id="pl-refresh" type="button">최신 데이터 갱신</button><button id="pl-stop" class="pl-danger" type="button">Paper 긴급 정지</button></div></div>
    <p id="pl-status" class="pl-status" role="status">BTC 확정 일봉을 불러오는 중입니다.</p>
    <div id="pl-metrics" class="pl-metrics"></div><div class="pl-controls"><label>시뮬레이션 현재 BTC 비중 (%)<input id="pl-current" type="number" min="0" max="100" step="1" value="0"></label><button id="pl-paper-init" type="button">이 비중으로 Paper 계좌 초기화</button><button id="pl-paper-resume" type="button">Paper 잔고 유지·새 정책 재개</button><span id="pl-account-note" class="pl-note">BTC + Cash · 기존 MACD 1~5 비교는 아래에서 계속 이용할 수 있습니다.</span></div>
    <div class="pl-grid" style="margin-top:16px"><article class="pl-card"><h3>3-Day Leading Signal</h3><div id="pl-leading"></div></article><article class="pl-card"><h3>ADR5 · Core 3 + Opportunity 2</h3><div id="pl-orders"></div></article></div>
    <details><summary>판단 근거 · 시나리오 7개 · 주문 이력</summary><div id="pl-explain"></div><div id="pl-scenarios"></div><div id="pl-history"></div></details>
    <details><summary>Pattern + Envelope · 고점 / 저점 · 다중 시간봉</summary><div class="pl-grid"><div id="pl-pattern"></div><div id="pl-envelope"></div></div><div class="pl-controls"><label>유사 패턴 시간봉<select id="pl-pattern-frame"><option value="d1">1D</option><option value="w1">1W</option><option value="h4">4H</option><option value="h1">1H</option></select></label><button id="pl-pattern-run" type="button">유사 패턴 분석</button><button id="pl-frames" type="button">1W · 1D · 4H · 1H 확인</button></div><div id="pl-analog"></div><div id="pl-timeframes"></div></details>
    <details><summary>Market Context · 매매 판단의 보조 정보</summary><p class="pl-note">시장 심리·ETF는 참고 정보이며 Core MACD 목표 비중에 직접 적용하지 않습니다.</p><div id="pl-context" class="pl-context"></div><label>ETF 순유입 JSON 불러오기 (timestamp, netFlow; USD)<input id="pl-etf" type="file" accept="application/json,.json"></label><div id="pl-flow"></div></details>
    <details id="pl-settings"><summary>Settings · 기존 목표 비중 / 확률 / 주문 / 안전 한도</summary><form id="pl-form"><div class="pl-fields">
    ${input('fast', 'EMA Fast', s.fast, '1')}${input('slow', 'EMA Slow', s.slow, '1')}${input('signal', 'Signal EMA', s.signal, '1')}${input('threshold', 'Pre-Signal 기준 (%)', s.threshold * 100)}
    ${Object.keys(LEGACY_TARGETS).map(k => input(`target_${k}`, name(k) + ' 목표 (%)', s.targets[k] * 100)).join('')}
    ${input('minSamples', '최소 유사 사례 수', s.minSamples, '1')}${input('maxSamples', '최대 유사 사례 수', s.maxSamples, '1')}${input('similarityRadius', '유사 상태 거리 상한', s.similarityRadius)}${input('capital', '초기 자산 (KRW)', s.capital)}
    <label class="pl-full">ADR5 계수 5개 · 첫값~끝값 사이를 같은 가격 간격으로 자동 배치<input name="coefficients" value="${s.coefficients.join(', ')}" required></label>
    ${input('fee', '수수료 (%)', s.fee * 100)}${input('slippage', '슬리피지 (%)', s.slippage * 100)}${input('envelopePeriod', 'Envelope MA 기간', s.envelopePeriod, '1')}<label>평균선 종류<select name="envelopeMA"><option ${s.envelopeMA === 'SMA' ? 'selected' : ''}>SMA</option><option ${s.envelopeMA === 'EMA' ? 'selected' : ''}>EMA</option></select></label>
    <label>Envelope 밴드 (%)<input name="envelopeBands" value="${s.envelopeBands.join(', ')}" required></label><label>패턴 Window<select name="similarityWindow">${[30, 60, 90, 180].map(n => `<option ${s.similarityWindow === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    ${input('maxPosition', '최대 BTC 비중 (%)', s.maxPosition * 100)}${input('maxTrade', '1개 주문 최대 비중 (%)', s.maxTrade * 100)}${input('maxDailyLoss', 'Paper 최대 일일 손실 (%)', s.maxDailyLoss * 100)}${input('maxVolatility', '비정상 시가 변동 정지 (%)', s.maxVolatility * 100)}
    ${Object.entries(s.timeframeWeights).map(([f, w]) => input(`weight_${f}`, f.toUpperCase() + ' 참고 가중치', w)).join('')}</div><label class="pl-check"><input type="checkbox" name="cancelUnfilled" checked disabled>확률 기준 미달 시 Pre-Signal 미체결 취소</label><p class="pl-note">선행 주문 잔량만 다음 날 재배치합니다. 첫 예상일을 매일 뒤로 미루지 않습니다. 확률·표본 기준 이탈 시 미체결을 취소하고, 실제 교차 확정 시 다음 시가에 목표 잔량을 완료합니다. 완료 후 가격 변동만으로 재주문하지 않습니다.</p><button class="pl-primary" type="submit">설정 저장 · 다시 계산</button> <output id="pl-settings-status" role="status"></output></form></details>
    <details id="pl-backtest"><summary>Backtest Lab · 8개 전략 / 선행 일수 / 기준 확률 / 주문 계수</summary><p>Training: 데이터 시작~2020 · Validation: 2021~2023 · Out-of-Sample: 2024~현재</p><div class="pl-controls"><label>비교 시작일<input id="pl-start" type="date" value="2024-01-01"></label><label>비교 종료일<input id="pl-end" type="date" value="${date(Date.now())}"></label><button id="pl-research" class="pl-primary" type="button">전체 비교 실행</button><button id="pl-cancel" type="button" disabled>계산 중단</button><button id="pl-download" type="button" disabled>결과 JSON 저장</button><button id="pl-model" type="button" disabled>검증 모델을 시뮬레이션에 적용</button></div><p id="pl-research-status" role="status">현재 기본 확률 80%는 비교 결과로 자동 변경되지 않습니다.</p><div id="pl-research-output"></div></details>`;
  function status(message, error = false) { $('#pl-status').textContent = message; $('#pl-status').classList.toggle('pl-error', error); }
  function persistPaper() { if (paper) save('paper', paper); }
  async function locked(fn) { if (navigator.locks) return navigator.locks.request(storageKey + ':paper', fn); return fn(); }
  function priceNow() { return quote && quoteTime && Date.now() - quoteTime < 180000 ? quote : rows.at(-1)?.close; }
  function calculate() {
    rows = indicators(candles, s);
    if (rows.length < Math.max(200, s.slow + s.signal + 1)) throw new Error('지표 계산에 필요한 확정 일봉이 부족합니다.');
    signal = signalAt(rows, rows.length - 1, s, 3, priceNow());
    detection = detect(rows, rows.length - 1, s);
    signal.target = Math.min(s.maxPosition, riskTarget(signal.target, detection, s.riskModel, rows.at(-1).timestamp));
  }
  function render() {
    calculate();
    const p = priceNow(), actual = mode === 'PAPER' && paper ? position(paper, p) : current, capital = mode === 'PAPER' && paper ? equity(paper, p) : s.capital;
    const delta = signal.target - actual, projected = signal.projection.event, statistics = signal.stats, score = riskScores(detection, s.riskModel, rows.at(-1).timestamp);
    const health = integrity(candles);
    const list = mode === 'PAPER' && paper ? paper.orders.filter(o => o.status === 'WAITING') : plan({ timestamp: rows.at(-1).timestamp + DAY, price: p, adr: signal.row.adr, current: actual, target: signal.target, capital, source: signal.source, key: signal.key }, s);
    $('#pl-metrics').innerHTML = metric('BTC · KRW', fmt(p), quoteTime && Date.now() - quoteTime < 180000 ? '현재가 · Upbit' : `마지막 확정 종가 · ${date(rows.at(-1).timestamp)}`) + metric('Market Zone', detection.zone, detection.regime) + metric('Current Position', pct(actual), `Cash ${pct(1 - actual)} · ${mode}`) + metric('Target / Delta', `${pct(signal.target)} / ${delta >= 0 ? '+' : ''}${pct(delta)}`, name(signal.key)) + metric('MACD State', signal.row.histogram >= 0 ? 'Golden' : 'Dead', `${signal.row.line >= 0 ? '0선 위' : '0선 아래'} · ${s.fast}/${s.slow}/${s.signal}`) + metric('Historical Probability', pct(statistics.probability), `${statistics.success}/${statistics.sample} · ${statistics.confidence}`) + metric('Signal ETA', projected ? `${projected.eta.toFixed(2)} Days` : '—', '현재 가격 유지 조건부 계산') + metric('ADR5', `₩${fmt(signal.row.adr)}`, `${pct(signal.row.adr / p)} · 완료 일봉 5개`);
    $('#pl-leading').innerHTML = `<span class="pl-badge">${esc(signal.state)}</span><p>${esc(name(projected?.key))}</p><div class="pl-probability">${pct(statistics.probability)}</div><p class="pl-note">과거 성공 ${statistics.success} / 유사 사례 ${statistics.sample} · 최소 ${s.minSamples}<br>95% Wilson 신뢰구간 ${pct(statistics.interval[0])} ~ ${pct(statistics.interval[1])}<br>기준 ${pct(s.threshold)} · ${esc(statistics.confidence)}</p><div class="pl-timeline"><div>TODAY<b>${signal.row.cross ? esc(signal.row.cross) : 'No Cross'}</b>확정 일봉</div>${signal.projection.days.map((d, i) => `<div>D+${d.day}<b>${esc(d.cross || 'No Cross')}</b>${pct(statistics.timeline[i])} 이내 발생</div>`).join('')}</div><p class="pl-note">교차 예상과 과거 발생 비율은 별개입니다. 두 조건과 최소 표본 조건을 충족해야 선행 주문을 시작합니다.</p>`;
    $('#pl-orders').innerHTML = `<p>Delta <b>${delta >= 0 ? '+' : ''}${pct(delta)}</b> · 각 주문 ${pct(Math.abs(delta) / 5)} · 가격 간격 ₩${fmt((s.coefficients[1]-s.coefficients[0])*signal.row.adr)}</p>${paper && mode === 'PAPER' && paper.completion ? `<p class="pl-badge">${date(paper.completion.timestamp)} UTC 시가 · 잔량 시장가 5분할 완료 대기</p>` : table(['주문', '비중', '구분', '지정가 (KRW)', '상태'], list.map(o => [o.side + ' #' + o.split, pct(o.positionSize), o.group, fmt(o.limit), o.status]))}<p class="pl-note">${mode === 'PAPER' ? 'Paper 실행' : '지정가 배치 예시 · 실제 실행은 신호 상태에 따릅니다'} · 선행 기준 충족 시 D−3 → D−2 → D−1 잔량 재배치. 실제 교차 확정 후 다음 시가에 잔량을 완료합니다. 초기 비중 배치·0선 상태 변경도 다음 시가에 적용합니다.${paper?.campaign && mode === 'PAPER' ? `<br>시작 ${date(paper.campaign.startedAt)} · ${esc(paper.campaign.stage)} · ${esc(paper.campaign.status)}` : ''}${!health.healthy ? '<br>데이터가 오래되었거나 누락되어 Paper 주문 갱신이 중단됩니다.' : ''}</p>`;
    $('#pl-account-note').textContent = mode === 'PAPER' && paper ? `Paper 자산 ₩${fmt(capital)} · 체결 ${paper.fills.length}건 · ${paper.stopped ? '정지: ' + paper.stopReason : '브라우저가 열려 있을 때 확정 일봉으로 갱신'}` : 'SIMULATION / BACKTEST는 실제 계좌와 연결되지 않습니다.';
    $('#pl-explain').textContent = `MACD ${fmt(signal.row.line, 2)}, Signal ${fmt(signal.row.signal, 2)}, Histogram ${fmt(signal.row.histogram, 2)}. 현재가가 유지되면 ${projected ? `${projected.eta.toFixed(2)}일 내 ${name(projected.key)}` : '3일 내 교차가 계산되지 않습니다'}. 과거 ${statistics.sample}개 유사 사례 중 ${statistics.success}개가 같은 0선 위치의 교차로 이어졌습니다. ${signal.source} 기준 목표 ${pct(signal.target)}, 현재 ${pct(actual)}, 차이 ${pct(delta)}를 5분할합니다. 실제 교차가 확정되어도 이미 체결한 수량을 제외한 잔여 비중만 계산합니다. 신뢰구간은 표본 내 이항 추정이며 미래 보장이 아닙니다.`;
    $('#pl-scenarios').innerHTML = table(['Scenario', '고정 가상 가격', '예상 교차', 'ETA'], scenarios({ ...signal.row, close: p }, s).map(x => [esc(x.name), fmt(x.price), esc(name(x.event?.key)), x.event ? x.event.eta.toFixed(2) + ' Days' : '—']));
    $('#pl-history').innerHTML = table(['생성일 UTC', '주문', '구분', '상태', '체결가'], (paper?.orders || []).slice(-30).reverse().map(o => [date(o.createdAt), `${o.side} #${o.split}`, o.group, o.status, fmt(o.fillPrice)]));
    $('#pl-pattern').innerHTML = `<h3>Pattern / Risk</h3><p>Low Zone / Bullish <b>${fmt(score.bull, 1)}</b> · High Risk / Crash <b>${fmt(score.bear, 1)}</b> · Confluence <b>${fmt(score.confluence, 1)}</b></p><span class="pl-badge">${score.bear === null ? 'UNVALIDATED' : score.bear <= 30 ? 'LOW' : score.bear <= 50 ? 'CAUTION' : score.bear <= 70 ? 'HIGH' : score.bear <= 85 ? 'VERY HIGH' : 'CRASH WARNING'}</span><p class="pl-note">${esc(score.status)} · 점수는 확률이 아닙니다. Backtest에서 학습·검증 후 모델을 적용할 수 있습니다.</p><div class="pl-tags">${detection.list.map(f => `<span>${f.side === 'bull' ? '↗' : f.side === 'bear' ? '↘' : '◇'} ${esc(f.name)} ${esc(f.detail)}</span>`).join('') || '탐지된 패턴 없음'}</div><p class="pl-note">Fractal은 오른쪽 2봉이 확정된 뒤 인식합니다. 도형·하모닉은 명시적 규칙에 따른 후보입니다.</p>`;
    $('#pl-envelope').innerHTML = `<h3>Multi Envelope · ${s.envelopeMA}${s.envelopePeriod}</h3><p>평균선 대비 ${fmt(detection.deviation, 2)}% · OBV ${esc(detection.obvState)}</p>${table(['Envelope', '하단', '상단'], detection.bands.map(b => ['±' + b.percent + '%', fmt(b.lower), fmt(b.upper)]))}${table(['MA', '평균선', '지지 횟수', '저항 횟수'], detection.maLevels.map(m => [String(m.period), fmt(m.value), m.support, m.resistance]))}<p class="pl-note">지지·저항: 최근 30봉, 최소 3봉 간격의 접촉만 집계. Envelope 단독으로 비중을 변경하지 않습니다.</p>`;
  }
  async function advancePaper() {
    if (mode !== 'PAPER') return;
    await locked(() => {
      paper = read('paper'); if (!paper || !Array.isArray(paper.orders) || !Array.isArray(paper.fills)) { paper = null; return; }
      if (paper.executionPolicy !== s.executionPolicy) { cancelAll(paper, 'V1.17 정책 변경 · 잔고와 이력 보존'); paper.completion=null; persistPaper(); return; }
      if (!integrity(candles).healthy) { cancelAll(paper, 'DATA FAILURE / STALE'); persistPaper(); return; }
      if (paper.stopped) return;
      const pending = rows.filter(r => r.timestamp >= paper.startedAt && (paper.lastProcessed === null || r.timestamp > paper.lastProcessed));
      for (const r of pending) {
        fillDay(paper, r, s);
        const i = rows.indexOf(r), next = signalAt(rows, i, s);
        next.target = Math.min(s.maxPosition, riskTarget(next.target, detect(rows, i, s), s.riskModel, r.timestamp));
        reconcile(paper, next, s, r.timestamp + DAY, String(paper.revision || 0));
      }
      persistPaper();
    });
  }
  async function refresh() {
    if (busy) return; busy = true; $('#pl-refresh').disabled = true;
    try {
      const recent = await fetchRecent(); candles = normalize([...candles, ...recent]); data.d1 = candles;
      const health = integrity(candles); calculate(); await advancePaper(); render(); lastRefresh = Date.now();
      status(`Upbit · ${candles.length.toLocaleString()} 확정 일봉 · ${date(candles[0].timestamp)}~${date(candles.at(-1).timestamp)} · ${health.gaps ? `누락 ${health.gaps}개 / 주문 정지` : health.stale ? '오래된 데이터 / 주문 정지' : '일봉 경계 UTC 00:00 · 다음 확정 봉에서 Paper 체결 평가'}`, !health.healthy);
    } catch (e) { if (paper && mode === 'PAPER') await locked(() => { paper = read('paper') || paper; cancelAll(paper, 'API FAILURE'); persistPaper(); }); status(`최신 데이터 연결 실패: ${e.message}. 내장 자료 기준으로 표시합니다.`, true); if (candles.length) render(); }
    finally { busy = false; $('#pl-refresh').disabled = false; }
    await marketContext();
  }
  async function marketContext() {
    try { const r = await fetch('/api/market-context', { signal: AbortSignal.timeout(10000) }); if (r.ok) context = await r.json(); } catch {}
    const live = context?.price?.data?.[0];
    if (live && Number.isFinite(live.trade_price) && Number.isFinite(live.timestamp) && Date.now() - live.timestamp < 180000) { quote = live.trade_price; quoteTime = live.timestamp; }
    const fng = context?.sentiment?.data?.data?.[0], funding = context?.funding?.data, oi = context?.openInterest?.data, ls = context?.longShort?.data?.[0];
    const entries = [['Fear & Greed', fng ? `${fng.value} · ${fng.value_classification}` : '미연결', 'Alternative.me'], ['Funding', funding ? pct(Number(funding.lastFundingRate)) : '미연결', 'Binance BTCUSDT'], ['Open Interest', oi ? fmt(Number(oi.openInterest), 2) + ' BTC' : '미연결', 'Binance BTCUSDT'], ['Long / Short', ls ? fmt(Number(ls.longShortRatio), 3) : '미연결', '계정 비율 · Binance'], ['Liquidation', '미연결', '청산 피드 필요'], ['ETF Daily / Weekly / 30D', '미연결', '데이터 파일로 제공 가능']];
    $('#pl-context').innerHTML = entries.map(([title, value, source]) => `<div><span>${esc(title)}</span><b>${esc(value)}</b><small>${esc(source)}</small></div>`).join('');
    if (rows.length) render();
  }
  $('#pl-refresh').onclick = refresh;
  $('#pl-current').oninput = () => { const v = Number($('#pl-current').value); if (!Number.isFinite(v) || v < 0 || v > 100) { status('현재 비중은 0~100%로 입력하세요.', true); return; } current = v / 100; if (rows.length) render(); };
  $('#pl-mode').onchange = async () => { mode = $('#pl-mode').value; if (mode === 'BACKTEST') $('#pl-backtest').open = true; if (mode === 'PAPER') { paper = read('paper'); await advancePaper(); } if (rows.length) render(); };
  $('#pl-paper-init').onclick = async () => {
    if (!rows.length || !integrity(candles).healthy) { status('최신 연속 확정 일봉을 먼저 갱신하세요.', true); return; }
    await locked(() => { paper = account(s.capital, current, priceNow()); paper.executionPolicy=s.executionPolicy; paper.startedAt = (Math.floor(Date.now() / DAY) + 1) * DAY; paper.revision = Date.now(); reconcile(paper, { ...signal, row: { ...signal.row, close: priceNow() } }, s, paper.startedAt, String(paper.revision)); persistPaper(); }); mode = 'PAPER'; $('#pl-mode').value = mode; render(); status(`Paper 계좌를 초기화했습니다. ${date(paper.startedAt)} UTC 일봉부터 주문을 평가합니다. 생성 전 당일 가격으로는 체결하지 않습니다.`);
  };
  $('#pl-paper-resume').onclick = async () => {
    if (!rows.length || !integrity(candles).healthy) { status('최신 연속 확정 일봉을 먼저 갱신하세요.', true); return; }
    await locked(() => {
      paper=read('paper'); if (!paper) return;
      cancelAll(paper,'POLICY RESUME'); paper.stopped=false; paper.stopReason=null; paper.completion=null;
      if (paper.campaign?.status==='ACTIVE') paper.campaign.status='CANCELLED';
      paper.campaign=null; paper.initializedCampaign=false; paper.lastCampaignDecision=null; paper.observedCoreKey=undefined;
      paper.executionPolicy=s.executionPolicy; paper.revision=Date.now(); paper.startedAt=(Math.floor(Date.now()/DAY)+1)*DAY;
      reconcile(paper,{...signal,row:{...signal.row,close:priceNow()}},s,paper.startedAt,String(paper.revision)); persistPaper();
    });
    if (!paper) { status('저장된 Paper 계좌가 없습니다.',true); return; }
    mode='PAPER'; $('#pl-mode').value=mode; render(); status('Paper 잔고·이력을 유지하고 다음 UTC 일봉부터 새 정책을 적용합니다.');
  };
  $('#pl-stop').onclick = async () => { await locked(() => { paper = read('paper'); if (paper) { cancelAll(paper); persistPaper(); } }); if (rows.length) render(); status('Paper 주문을 정지하고 미체결 주문을 취소했습니다.'); };
  $('#pl-form').onsubmit = async event => {
    event.preventDefault();
    try {
      const f = new FormData(event.target), patch = {};
      for (const key of ['fast', 'slow', 'signal', 'minSamples', 'maxSamples', 'similarityRadius', 'capital', 'envelopePeriod', 'similarityWindow']) patch[key] = Number(f.get(key));
      for (const key of ['threshold', 'fee', 'slippage', 'maxPosition', 'maxTrade', 'maxDailyLoss', 'maxVolatility']) patch[key] = Number(f.get(key)) / 100;
      patch.targets = Object.fromEntries(Object.keys(LEGACY_TARGETS).map(k => [k, Number(f.get('target_' + k)) / 100]));
      patch.coefficients = String(f.get('coefficients')).split(',').map(Number); patch.envelopeBands = String(f.get('envelopeBands')).split(',').map(Number); patch.envelopeMA = f.get('envelopeMA'); patch.cancelUnfilled = true;
      patch.timeframeWeights = Object.fromEntries(Object.keys(FRAME).map(k => [k, Number(f.get('weight_' + k))]));
      s = settings({ ...s, ...patch, riskModel: null }); save('settings', s); event.target.elements.coefficients.value=s.coefficients.join(', '); result=null; $('#pl-model').disabled=true; $('#pl-download').disabled=true; calculate();
      if (mode === 'PAPER') await locked(() => { paper = read('paper'); if (paper) { paper.revision = Date.now(); reconcile(paper, { ...signal, row: { ...signal.row, close: priceNow() } }, s, (Math.floor(Date.now() / DAY) + 1) * DAY, String(paper.revision)); persistPaper(); } });
      render(); $('#pl-settings-status').textContent = '저장 완료 · 변경된 설정의 위험 모델은 재검증이 필요합니다.';
    } catch (e) { $('#pl-settings-status').textContent = e.message; }
  };
  $('#pl-pattern-run').onclick = async () => {
    const f = $('#pl-pattern-frame').value; $('#pl-pattern-run').disabled = true;
    try { if (f !== 'd1') { const recent = await fetchRecent(f); data[f] = normalize([...(data[f] || []), ...recent], Date.now(), FRAME[f].duration); } const series = f === 'd1' ? candles : normalize(data[f] || [], Date.now(), FRAME[f].duration); const a = analogs(series, series.length - 1, s.similarityWindow, FRAME[f].duration);
      $('#pl-analog').innerHTML = `<p>${f.toUpperCase()} · ${s.similarityWindow} candles · 로그수익률 상관계수 ≥ 0.60 · 중첩 Window 제외 · ${a.cases.length} 사례</p>${table(['과거 종료일', 'Pattern Similarity'], a.cases.slice(0, 8).map(c => [date(c.timestamp), pct(c.similarity)]))}${table(['이후 기간', '성숙 표본', '양수 확률', '평균 수익률', '평균 최대 상승', '평균 MDD'], a.outcomes.map(o => [o.days + 'D', o.sample, pct(o.probability), pct(o.return), pct(o.gain), pct(o.mdd)]))}`;
    } catch (e) { $('#pl-analog').textContent = e.message; } finally { $('#pl-pattern-run').disabled = false; }
  };
  $('#pl-frames').onclick = async () => {
    $('#pl-frames').disabled = true;
    const results = [];
    for (const f of ['w1', 'd1', 'h4', 'h1']) {
      try { const recent = f === 'd1' ? candles : await fetchRecent(f); const complete = normalize([...(data[f] || []), ...recent], Date.now(), FRAME[f].duration); data[f] = complete; const last = indicators(complete, s).at(-1); results.push({ frame: f, key: last.key, target: s.targets[last.key], weight: s.timeframeWeights[f], timestamp: last.timestamp }); }
      catch (e) { results.push({ frame: f, error: e.message }); }
    }
    const valid = results.filter(r => Number.isFinite(r.target)), weighted = valid.reduce((v, r) => v + r.target * r.weight, 0) / valid.reduce((v, r) => v + r.weight, 0);
    $('#pl-timeframes').innerHTML = `<p>가중 참고 비중 ${pct(weighted)} · 일봉 Core 목표에는 직접 적용하지 않습니다.</p>${table(['시간봉', '확정 상태', '기본 목표', '가중치', '기준일'], results.map(r => [r.frame.toUpperCase(), esc(r.error || name(r.key)), pct(r.target), fmt(r.weight), date(r.timestamp)]))}`; $('#pl-frames').disabled = false;
  };
  $('#pl-etf').onchange = async e => { try { const file = e.target.files[0]; if (!file || file.size > 2000000) throw new Error('2MB 이하 JSON 배열이 필요합니다.'); const values = JSON.parse(await file.text()); if (!Array.isArray(values) || values.some(v => !Number.isFinite(v.timestamp) || !Number.isFinite(v.netFlow))) throw new Error('timestamp(ms), netFlow(USD) 배열을 입력하세요.'); const flow = flowContext(values); $('#pl-flow').textContent = `사용자 제공 · ${date(flow.asOf)} · Daily $${fmt(flow.daily)} / Weekly $${fmt(flow.weekly)} / 30D $${fmt(flow.monthly)} · ${flow.status}`; } catch (err) { $('#pl-flow').textContent = err.message; } };
  $('#pl-research').onclick = () => {
    if (!candles.length || worker) return;
    const start = Date.parse($('#pl-start').value), end = Date.parse($('#pl-end').value) + DAY - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) { $('#pl-research-status').textContent = '시작일과 종료일을 확인하세요.'; return; }
    $('#pl-research').disabled = true; $('#pl-cancel').disabled = false; $('#pl-model').disabled = true;
    worker = new Worker(new URL('./research-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: message }) => { if (message.progress) $('#pl-research-status').textContent = message.progress; else if (message.error) { $('#pl-research-status').textContent = message.error; endWorker(); } else { result = message.result; renderResearch(); $('#pl-download').disabled = false; $('#pl-model').disabled = false; endWorker(); } };
    worker.onerror = e => { $('#pl-research-status').textContent = e.message; endWorker(); };
    worker.postMessage({ candles, settings: s, options: { start, end } });
  };
  function endWorker() { worker?.terminate(); worker = null; $('#pl-research').disabled = false; $('#pl-cancel').disabled = true; }
  $('#pl-cancel').onclick = () => { endWorker(); $('#pl-research-status').textContent = '계산을 중단했습니다.'; };
  function equityChart(results) {
    const all = results.filter(r => r.curve?.length), colors = ['#97f5bf','#78bfff','#ffc684','#e69dfa','#ffa0ab','#9fcec9','#eff380','#bbb'];
    if (!all.length) return '';
    const minT = Math.min(...all.map(r => r.curve[0].timestamp)), maxT = Math.max(...all.map(r => r.curve.at(-1).timestamp)), maxE = Math.max(...all.flatMap(r => r.curve.map(p => p.equity))), minE = Math.min(...all.flatMap(r => r.curve.map(p => p.equity)));
    return `<svg class="pl-chart" viewBox="0 0 1000 310" role="img" aria-label="전략 A부터 H까지 자산곡선 비교"><text x="50" y="20" fill="#a8beb0" font-size="12">₩${fmt(maxE)} · ${date(minT)}~${date(maxT)}</text>${all.map((r, i) => `<polyline fill="none" stroke="${colors[i]}" stroke-width="2" points="${r.curve.map(p => `${50 + (p.timestamp - minT) / (maxT - minT || 1) * 920},${270 - (p.equity - minE) / (maxE - minE || 1) * 230}`).join(' ')}"/><text x="${50 + i * 110}" y="300" fill="${colors[i]}" font-size="12">${r.strategy}</text>`).join('')}</svg>`;
  }
  function renderResearch() {
    const brief = values => table(['전략', '수익률', 'CAGR', 'MDD', 'Win Rate', 'Sharpe', 'Sortino', 'Profit Factor', '거래', '노출', 'False Signal (표본)', 'Buy & Hold'], values.map(r => [esc(r.label || r.strategy), pct(r.totalReturn), pct(r.cagr), pct(r.mdd), pct(r.winRate), fmt(r.sharpe, 2), fmt(r.sortino, 2), fmt(r.profitFactor, 2), fmt(r.trades), pct(r.exposure), `${pct(r.falseSignalRate)} (${r.evaluatedPreSignals || 0})`, pct(r.buyHold)]));
    $('#pl-research-status').textContent = `실제 캔들 ${date(result.dataFrom)}~${date(result.dataTo)}로 계산 완료. 검증 모델 조절 상한 ${pct(result.model.maxAdjustment)} · 확률 기준은 ${pct(s.threshold)} 유지.`;
    const g = result.comparisons.find(r => r.strategy === 'G');
    const priceImprovement = (g?.fillsDetail || []).filter(f => f.group === 'OPPORTUNITY').map(f => { const o = g.orders.find(o => o.id === f.orderId); const core = g.fillsDetail.filter(c => c.group === 'CORE' && c.timestamp === f.timestamp && c.side === f.side); const mean = core.length ? core.reduce((a, c) => a + c.value, 0) / core.reduce((a, c) => a + c.quantity, 0) : null; return mean ? (f.side === 'BUY' ? mean - f.price : f.price - mean) / mean : null; }).filter(Number.isFinite);
    $('#pl-research-output').innerHTML = equityChart(result.comparisons) + brief(result.comparisons) + `<p class="pl-note">${result.caveats.map(esc).join(' · ')}</p><details><summary>상세 성과 · 거래 / 주문 / Regime</summary>${table(['전략', '평균 이익', '평균 손실', '최고 거래', '최악 거래', '평균 보유일', '평균 매수가', '평균 매도가', '정지 사유'], result.comparisons.map(r => [r.strategy, fmt(r.averageProfit), fmt(r.averageLoss), fmt(r.bestTrade), fmt(r.worstTrade), fmt(r.averageHoldingDays, 1), fmt(r.averageBuy), fmt(r.averageSell), esc(r.stopped || r.error || '—')]))}${table(['전략 / Regime', '일수', '구간 수익률', '구간 MDD'], result.comparisons.flatMap(r => (r.regimes || []).map(g => [esc(r.strategy + ' / ' + g.regime), g.days, pct(g.return), pct(g.mdd)])))}</details><details><summary>Confirmed vs D−1 / D−2 / D−3</summary>${brief(result.horizons.map(r => ({ ...r, label: r.horizon ? `D−${r.horizon} Pre-Signal` : 'Confirmed Only' })))}</details><details><summary>Threshold 70 / 75 / 80 / 85 / 90%</summary>${brief(result.thresholds.map(r => ({ ...r, label: pct(r.threshold) })))}</details><details><summary>ADR 계수 A / B / C · Core / Opportunity 체결</summary>${table(['Set', '계수', '수익률', 'MDD', 'Core 체결률', 'Opportunity 체결률', '평균 매수가', '평균 매도가', 'B&H 대비 차이'], result.coefficients.map(r => [r.set, r.coefficients.join(' / '), pct(r.totalReturn), pct(r.mdd), pct(r.rates?.CORE.rate), pct(r.rates?.OPPORTUNITY.rate), fmt(r.averageBuy), fmt(r.averageSell), pct(r.opportunityCost)]))}<p>G 기준 Opportunity 평균 단가 개선: ${priceImprovement.length ? pct(avg(priceImprovement)) : '비교 체결 없음'} · 미체결 관측 ${g?.missedOpportunity?.length || 0}개 · 다음날 평균 종가 변화 ${g?.missedOpportunity?.length ? pct(avg(g.missedOpportunity.map(o => o.nextDayReturn))) : '—'}</p></details><details><summary>Training / Validation / Out-of-Sample · Walk Forward</summary><p>Training 끝 ${date(result.trainingEnd)} · Validation ${date(result.validationStart)}~${date(result.validationEnd)} · 선택 이후에만 모델 적용. 현재 데이터에 2015~2016은 포함되지 않습니다.</p>${table(['검증 조절 상한', 'Validation Return', 'Validation MDD', 'Validation Sharpe'], result.model.validation.map(v => [pct(v.maxAdjustment), pct(v.return), pct(v.mdd), fmt(v.sharpe, 2)]))}${brief(result.walkForward.map(r => ({ ...r, label: String(r.year) })))}</details>`;
  }
  $('#pl-download').onclick = () => { const blob = new Blob([JSON.stringify(result)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'btc-position-research.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); };
  $('#pl-model').onclick = () => { if (!result) return; s = settings({ ...s, riskModel: result.model }); save('settings', s); render(); status('Training·Validation 모델을 시뮬레이션에 적용했습니다. OOS 성과는 별도 비교 결과를 확인하세요.'); };
  window.addEventListener('storage', event => { if (event.key === storageKey + ':paper' && mode === 'PAPER') { paper = read('paper'); if (rows.length) render(); } });
  (async () => {
    try { const r = await fetch(new URL('./data/btc-history.json', import.meta.url)); if (!r.ok) throw new Error('BTC 이력 파일을 읽지 못했습니다.'); const history = await r.json(); data = history.candles; candles = normalize(data.d1); render(); await refresh(); }
    catch (e) { status(e.message, true); }
  })();
  setInterval(() => { if (!document.hidden && Date.now() - lastRefresh >= 60000) refresh(); }, 60000);
}
