const TIMEFRAMES = {
  day: { endpoint: "days", milliseconds: 86400000 },
  240: { endpoint: "minutes/240", milliseconds: 14400000 },
  60: { endpoint: "minutes/60", milliseconds: 3600000 },
};

const ALLOWED_MARKETS = new Set(["BTC", "ETH", "XRP", "SOL", "ADA", "DOGE", "AVAX", "DOT", "XLM", "UNI", "LINK", "ONDO"].map((symbol) => `KRW-${symbol}`));

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "GET 요청만 지원합니다." });
  const market = String(request.query.market || "");
  const timeframe = String(request.query.timeframe || "day");
  const requestedCount = Math.min(2000, Math.max(80, Number(request.query.count) || 200));
  const config = TIMEFRAMES[timeframe];
  if (!ALLOWED_MARKETS.has(market) || !config) return response.status(400).json({ error: "지원하지 않는 종목 또는 봉 주기입니다." });

  try {
    const rows = new Map();
    const fetchTarget = requestedCount + 1;
    let to = null;
    while (rows.size < fetchTarget) {
      const amount = Math.min(200, fetchTarget - rows.size);
      const query = new URLSearchParams({ market, count: String(amount) });
      if (to) query.set("to", to);
      const upstream = await fetch(`https://api.upbit.com/v1/candles/${config.endpoint}?${query}`, { headers: { Accept: "application/json", "User-Agent": "coin-signal-v1.14" } });
      if (!upstream.ok) throw new Error(`Upbit ${upstream.status}`);
      const page = await upstream.json();
      if (!Array.isArray(page) || !page.length) break;
      for (const candle of page) {
        const timestamp = Date.parse(`${candle.candle_date_time_utc}Z`);
        if (!Number.isFinite(timestamp)) continue;
        rows.set(timestamp, { timestamp, open: Number(candle.opening_price), high: Number(candle.high_price), low: Number(candle.low_price), close: Number(candle.trade_price) });
      }
      const oldest = page.at(-1)?.candle_date_time_utc;
      if (!oldest || page.length < amount) break;
      to = new Date(Date.parse(`${oldest}Z`) - 1).toISOString().replace(".000Z", "Z");
      if (rows.size < fetchTarget) await new Promise((resolve) => setTimeout(resolve, 125));
    }

    const completeCutoff = Math.floor(Date.now() / config.milliseconds) * config.milliseconds;
    const candles = [...rows.values()].filter((candle) => candle.timestamp < completeCutoff && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0).sort((a, b) => a.timestamp - b.timestamp).slice(-requestedCount);
    response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return response.status(200).json({ market, timeframe, requestedCount, candles });
  } catch (error) {
    return response.status(502).json({ error: `Upbit 시세 연결 실패: ${String(error?.message || error)}` });
  }
}
