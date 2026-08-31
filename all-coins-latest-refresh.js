(function () {
  "use strict";

  const data = window.__COIN_DATA__;
  const button = document.querySelector("#refresh-latest-data");
  const status = document.querySelector("#latest-data-status");
  if (!data || !button || !status) return;

  const markets = ["BTC", "ETH", "XRP", "SOL", "ADA", "DOGE", "AVAX", "DOT", "XLM", "UNI", "LINK", "ONDO"].map((symbol) => `KRW-${symbol}`);
  const supabaseFunctionUrl = "https://lkoxeiugmrczdhbmjlcm.supabase.co/functions/v1/coin-candle-sync";
  const supabasePublishableKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxrb3hlaXVnbXJjemRoYm1qbGNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NTU5MTEsImV4cCI6MjEwMjQzMTkxMX0.eXJpG6izPr4mIZ2r6V-cjD6x4TdyxcgblNanrV1WZ3M";
  const databaseName = "coin-invest-system-all-latest-v1";
  const storeName = "market-snapshots";
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("coin-invest-system-all-latest") : null;
  let running = false;

  button.textContent = "↻ 전체 코인 최신 자료 다운로드 및 차트 갱신";
  button.addEventListener("click", refreshAllMarkets, true);
  restoreMarketSnapshot(data.market, true).finally(() => repairCurrentMarketWindow());
  channel?.addEventListener("message", (event) => {
    if (event.data?.type === "market-updated" && event.data.market === data.market) restoreMarketSnapshot(data.market, true);
  });

  async function refreshAllMarkets(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (running) return;
    running = true;
    button.disabled = true;
    button.classList.remove("is-error");
    const failures = [];
    let completedMarkets = 0;
    let savedRows = 0;

    for (const market of markets) {
      const symbol = market.replace("KRW-", "");
      button.textContent = `↻ 수파베이스 증분 갱신 중 ${completedMarkets + 1}/${markets.length}`;
      status.textContent = `${symbol} · 이전 저장 봉 이후 자료 확인·저장 중…`;
      try {
        const synced = await syncMarketThroughSupabase(market);
        const candles = Object.fromEntries(Object.entries(synced.timeframes || {}).map(([timeframe, result]) => [timeframe, result.candles || []]));
        savedRows += Object.values(synced.timeframes || {}).reduce((sum, result) => sum + Number(result.saved || 0), 0);
        const previous = await getSnapshot(market);
        const snapshot = {
          market,
          updatedAt: synced.syncedAt || new Date().toISOString(),
          source: "supabase",
          candles: Object.fromEntries(Object.keys(candles).map((timeframe) => [timeframe, mergeCandles(previous?.candles?.[timeframe] || [], candles[timeframe])])),
        };
        await putSnapshot(snapshot);
        if (market === data.market) applySnapshot(snapshot, true);
        channel?.postMessage({ type: "market-updated", market });
      } catch (error) {
        failures.push(`${symbol}: ${String(error?.message || error).slice(0, 80)}`);
      }
      completedMarkets += 1;
    }

    if (failures.length === markets.length) {
      button.classList.add("is-error");
      button.textContent = "수파베이스 최신 자료 연결 실패";
      status.textContent = "수파베이스 또는 Upbit 공개 API 연결 상태를 확인해 주세요";
    } else {
      button.textContent = failures.length ? "△ 수파베이스 부분 갱신 완료" : "✓ 수파베이스 증분 저장 완료";
      status.textContent = failures.length
        ? `전체 ${markets.length}종목 중 실패 ${failures.length}개: ${failures.slice(0, 3).join(" / ")}${failures.length > 3 ? " 외" : ""}`
        : `수파베이스 전체 ${markets.length}종목 증분 저장 완료 · 확인·업서트 ${savedRows.toLocaleString()}봉`;
    }
    setTimeout(() => {
      running = false;
      button.disabled = false;
      button.classList.remove("is-error");
      button.textContent = "↻ 전체 코인 최신 자료 다운로드 및 차트 갱신";
    }, 2500);
  }

  async function syncMarketThroughSupabase(market) {
    const response = await fetch(supabaseFunctionUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ market }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Supabase ${response.status}`);
    return payload;
  }

  async function restoreMarketSnapshot(market, announce) {
    try {
      const snapshot = await getSnapshot(market);
      if (snapshot) applySnapshot(snapshot, announce);
    } catch {}
  }

  async function repairCurrentMarketWindow() {
    if (!needsWindowRepair(data.candles?.d1 || [])) return;
    status.textContent = `${data.market.replace("KRW-", "")} · 누락된 연속 봉 자동 복구 중…`;
    try {
      const synced = await syncMarketThroughSupabase(data.market);
      const incoming = Object.fromEntries(Object.entries(synced.timeframes || {}).map(([timeframe, result]) => [timeframe, result.candles || []]));
      const previous = await getSnapshot(data.market);
      const snapshot = {
        market: data.market,
        updatedAt: synced.syncedAt || new Date().toISOString(),
        source: "supabase-window-repair",
        candles: Object.fromEntries(Object.keys(incoming).map((timeframe) => [timeframe, mergeCandles(previous?.candles?.[timeframe] || [], incoming[timeframe])])),
      };
      await putSnapshot(snapshot);
      applySnapshot(snapshot, false);
      status.textContent = `${data.market.replace("KRW-", "")} · 최근 6개월 연속 봉 자동 복구 완료`;
    } catch (error) {
      status.textContent = `${data.market.replace("KRW-", "")} · 자동 복구 실패, 갱신 버튼으로 다시 시도해 주세요`;
    }
  }

  function needsWindowRepair(candles) {
    if (!candles.length) return true;
    const day = 86_400_000;
    const recent = candles.map((row) => Number(row[0])).filter(Number.isFinite).sort((a, b) => a - b).filter((timestamp) => timestamp >= Date.now() - 220 * day);
    if (!recent.length || recent.at(-1) < Date.now() - 2.5 * day) return true;
    return recent.some((timestamp, index) => index > 0 && timestamp - recent[index - 1] > 1.5 * day);
  }

  function applySnapshot(snapshot, announce) {
    for (const [timeframe, candles] of Object.entries(snapshot.candles || {})) {
      data.candles[timeframe] = mergeCandles(data.candles[timeframe] || [], candles);
    }
    const freshest = Object.values(snapshot.candles || {}).flat().sort((a, b) => b[0] - a[0])[0];
    if (freshest) data.latest = { timestamp: freshest[0], price: freshest[4] };
    if (typeof window.updateDataPeriod === "function") window.updateDataPeriod();
    if (typeof window.render === "function") window.render();
    if (typeof window.renderLivePrice === "function" && freshest) {
      window.renderLivePrice(`전체 코인 최신 다운로드 · ${new Date(freshest[0]).toLocaleString("ko-KR")}`);
    }
    if (announce) status.textContent = `전체 코인 캐시 반영 완료 · ${new Date(snapshot.updatedAt).toLocaleString("ko-KR")}`;
  }

  function mergeCandles(existing, incoming) {
    const rows = new Map(existing.map((candle) => [candle[0], candle]));
    for (const candle of incoming) rows.set(candle[0], candle);
    return [...rows.values()].sort((a, b) => a[0] - b[0]);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "market" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putSnapshot(snapshot) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(snapshot);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  async function getSnapshot(market) {
    const db = await openDatabase();
    const snapshot = await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(market);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return snapshot;
  }

})();
