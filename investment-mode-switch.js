window.COIN_SIGNAL_VERSION = '2.02';
(function () {
  const path = decodeURIComponent(window.location.pathname || "");
  const params = new URLSearchParams(window.location.search);
  const isFuturesPath = /(^|\/)futures(\/|$)/i.test(path);
  const isFutures = isFuturesPath || params.get("mode") === "futures";
  let target;
  if (isFutures) {
    params.delete("mode");
    const query = params.toString();
    if (isFuturesPath) {
      const spotPath = path.replace(/(^|\/)futures(?=\/|$)/i, "") || "/";
      target = `${spotPath.startsWith("/") ? spotPath : `/${spotPath}`}${query ? `?${query}` : ""}`;
    } else {
      const fileName = path.split("/").filter(Boolean).pop() || "index.html";
      target = `${fileName}${query ? `?${query}` : ""}`;
    }
  } else {
    const isLocal = window.location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    const fileName = path.split("/").filter(Boolean).pop() || "index.html";
    if (isLocal) {
      params.set("mode", "futures");
      target = `${fileName}?${params.toString()}`;
    } else {
      const spotPath = path === "/" ? "/" : path;
      target = `/futures${spotPath}${window.location.search}`;
    }
  }
  const header = document.querySelector("header");
  const actions = document.querySelector(".header-actions") || header;
  if (!header || !actions || document.querySelector("[data-investment-mode-switch]")) return;

  document.documentElement.dataset.investmentMode = isFutures ? "futures" : "spot";
  const style = document.createElement("style");
  style.textContent = `
    .investment-mode-row{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
    .investment-mode-badge{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:999px;font-size:12px;font-weight:900;letter-spacing:.04em;border:1px solid rgba(114,242,189,.48);background:rgba(114,242,189,.10);color:#72f2bd}
    [data-investment-mode="futures"] .investment-mode-badge{border-color:rgba(255,176,92,.62);background:rgba(255,176,92,.13);color:#ffb05c}
    .investment-mode-link{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:900;border:1px solid #ffb05c;background:rgba(255,176,92,.12);color:#ffca86;box-shadow:0 8px 24px rgba(0,0,0,.16)}
    .investment-mode-link:hover{background:#ffb05c;color:#231605}
    .futures-mode-notice{margin:0 auto 18px;max-width:1180px;padding:13px 16px;border:1px solid rgba(255,176,92,.42);border-radius:12px;background:linear-gradient(90deg,rgba(255,176,92,.13),rgba(255,176,92,.04));color:#e9ddd0;font-size:13px;line-height:1.65}
    .futures-mode-notice strong{color:#ffca86}
    .futures-title-tag{display:inline-flex;margin-left:8px;padding:4px 8px;border-radius:7px;background:#ffb05c;color:#241505;font-size:.45em;font-weight:950;vertical-align:middle}
    @media(max-width:800px){.investment-mode-row{justify-content:stretch}.investment-mode-link{width:100%}.investment-mode-badge{justify-content:center;flex:1}}
  `;
  document.head.appendChild(style);

  const row = document.createElement("div");
  row.className = "investment-mode-row";
  row.dataset.investmentModeSwitch = "true";
  row.innerHTML = `<span class="investment-mode-badge">${isFutures ? "비트겟 선물 앱" : "업비트 현물 앱"}</span><a class="investment-mode-link" href="${target}">${isFutures ? "현물 투자 앱으로 돌아가기 →" : "선물 투자 앱 열기 →"}</a>`;
  actions.prepend(row);

  if (isFutures) {
    const originalTitle = document.title;
    const futuresTitle = originalTitle.replace("코인 시그널", "코인 선물 시그널");
    document.title = futuresTitle === originalTitle ? `${originalTitle} · 선물 투자` : futuresTitle;
    const title = header.querySelector("h1");
    if (title) title.insertAdjacentHTML("beforeend", '<span class="futures-title-tag">선물</span>');
    const notice = document.createElement("div");
    notice.className = "futures-mode-notice";
    notice.innerHTML = "<strong>비트겟 선물 · 과거 분석 자료</strong> · MACD(18,39,9) 기준 MACD 5은 0선 위 골든 롱 2배·0선 아래 데드 숏 2배입니다. 위 데드와 아래 골든은 롱 50%입니다. 일봉 고가·저가에서 계좌 가치가 0 이하가 되면 청산 처리하며, 펀딩비와 거래소별 유지증거금률은 미반영입니다.";
    header.insertAdjacentElement("afterend", notice);
  }
})();

if (window.__HALVING_DATA__) {
  const extension = document.createElement('script');
  extension.src = '/halving-latest-costs.js?v=2.02';
  document.body.appendChild(extension);
}
if (window.__COIN_DATA__ && document.querySelector('#candle-chart')) {
  const navigation = document.createElement('script');
  navigation.src = '/chart-wheel-navigation.js?v=2.02';
  document.body.appendChild(navigation);
}

(function publishAppVersion(){
  const version=window.COIN_SIGNAL_VERSION;
  function updateLabels(){
    document.title=/V\d+\.\d+/i.test(document.title)?document.title.replace(/V\d+\.\d+/ig,'V'+version):document.title+' · 앱 V'+version;
    const header=document.querySelector('header');
    if(header){const walker=document.createTreeWalker(header,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(/V2\.01\b/i.test(node.nodeValue))node.nodeValue=node.nodeValue.replace(/V2\.01\b/ig,'V'+version);}
    document.querySelectorAll('.tc-kicker').forEach(el=>{el.textContent='COIN SIGNAL · V'+version;});
    if(!header||document.getElementById('app-release-notes'))return;
    const notes=document.createElement('details');notes.id='app-release-notes';notes.style.cssText='border:1px solid #3b6858;border-radius:9px;padding:10px 14px;color:#d9eee4;background:#10251d;font-size:12px;line-height:1.7;max-width:560px';
    notes.innerHTML=`<summary style="cursor:pointer;font-weight:800">앱 V${version} · 업데이트 내역</summary><p style="margin:8px 0">2026-09-27 업데이트</p><ul style="padding-left:18px;margin:0">
      <li>단순 보유·EMA 35일과 MACD 전략을 12종목에서 비교</li>
      <li>최근 180일·360일 비용 반영 추천 팝업: 수익률·최대 낙폭·선정 이유</li>
      <li>반감기 중첩 차트: 최신 일봉·현재가 잠정 끝점, 비용 설정 유지 및 새로고침 반영</li>
      <li>봉차트·MACD 휠 확대/축소, 드래그 이동, 시간축 동기화</li>
      <li>봉차트 가격축의 억 단위를 소수점 두 자리로 표시 (1.00억)</li>
      <li>업비트 현물·비트겟 선물 자동매매 연결 코드와 서버 설치 구성 준비. 실거래에는 별도 서버·API 연결 필요</li>
    </ul>`;
    (header.querySelector('.header-actions')||header).appendChild(notes);
  }
  updateLabels();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',updateLabels,{once:true});
})();
