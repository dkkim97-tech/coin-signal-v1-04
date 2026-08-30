(function () {
  const path = decodeURIComponent(window.location.pathname || "");
  const params = new URLSearchParams(window.location.search);
  const isFuturesPath = /(^|\/)futures(\/|$)/i.test(path);
  const isFutures = isFuturesPath || params.get("mode") === "futures";
  const fileName = path.split("/").filter(Boolean).pop() || "index.html";
  let target;
  if (isFutures) {
    params.delete("mode");
    const query = params.toString();
    target = isFuturesPath ? `../${fileName}${query ? `?${query}` : ""}` : `${fileName}${query ? `?${query}` : ""}`;
  } else {
    const isLocal = window.location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    if (isLocal) {
      params.set("mode", "futures");
      target = `${fileName}?${params.toString()}`;
    } else {
      target = `futures/${fileName}${window.location.search}`;
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
  row.innerHTML = `<span class="investment-mode-badge">${isFutures ? "선물 투자 앱" : "현물 투자 앱"}</span><a class="investment-mode-link" href="${target}">${isFutures ? "현물 투자 앱으로 돌아가기 →" : "선물 투자 앱 열기 →"}</a>`;
  actions.prepend(row);

  if (isFutures) {
    const originalTitle = document.title;
    const futuresTitle = originalTitle.replace("코인 시그널", "코인 선물 시그널");
    document.title = futuresTitle === originalTitle ? `${originalTitle} · 선물 투자` : futuresTitle;
    const title = header.querySelector("h1");
    if (title) title.insertAdjacentHTML("beforeend", '<span class="futures-title-tag">선물</span>');
    const notice = document.createElement("div");
    notice.className = "futures-mode-notice";
    notice.innerHTML = "<strong>선물 투자 앱 독립 개발 영역</strong> · MACD 4는 MACD(18,39,9) 기준으로 0선 아래·데드크로스에서 1배 숏 100%를 적용하고, 나머지 상태에서는 롱 100%·50%를 적용합니다. 펀딩비·증거금·강제청산 가격은 아직 반영하지 않은 백테스트입니다.";
    header.insertAdjacentElement("afterend", notice);
  }
})();
