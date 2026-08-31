import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedMarkets = new Set(["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-ADA", "KRW-DOGE", "KRW-AVAX", "KRW-DOT", "KRW-XLM", "KRW-UNI", "KRW-LINK", "KRW-ONDO"]);
const endpoints = { w1: "candles/weeks", d1: "candles/days", h4: "candles/minutes/240", h1: "candles/minutes/60" } as const;
const timeframeMs = { w1: 7 * 86_400_000, d1: 86_400_000, h4: 14_400_000, h1: 3_600_000 } as const;
const sixMonthsMs = 184 * 86_400_000;
const windowPaddingMs = 8 * 86_400_000;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

type Timeframe = keyof typeof endpoints;
type Candle = [number, number, number, number, number, number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await fetch(url, init);
    if (last.ok || last.status !== 429) return last;
    await delay(Number(last.headers.get("retry-after") || 1) * 1000);
  }
  return last!;
}

function parseCandle(row: Record<string, unknown>, endpoint: string): Candle | null {
  const timestamp = endpoint === "candles/days"
    ? Date.parse(`${String(row.candle_date_time_kst).slice(0, 10)}T00:00:00+09:00`)
    : Date.parse(`${String(row.candle_date_time_utc)}Z`);
  const candle: Candle = [timestamp, Number(row.opening_price), Number(row.high_price), Number(row.low_price), Number(row.trade_price), Number(row.candle_acc_trade_volume)];
  return candle.every(Number.isFinite) && candle[1] > 0 && candle[2] >= Math.max(candle[1], candle[4]) && candle[3] <= Math.min(candle[1], candle[4]) && candle[5] >= 0 ? candle : null;
}

async function latestTimestamp(supabaseUrl: string, serviceKey: string, market: string, timeframe: Timeframe) {
  const query = new URLSearchParams({ market: `eq.${market}`, timeframe: `eq.${timeframe}`, select: "candle_time", order: "candle_time.desc", limit: "1" });
  const response = await fetch(`${supabaseUrl}/rest/v1/coin_market_candles?${query}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!response.ok) throw new Error(`watermark ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  return rows[0]?.candle_time ? Date.parse(rows[0].candle_time) : null;
}

async function downloadIncrement(market: string, timeframe: Timeframe, watermark: number | null) {
  const endpoint = endpoints[timeframe];
  const lowerBound = watermark === null ? Date.now() - sixMonthsMs : watermark - timeframeMs[timeframe];
  const collected: Candle[] = [];
  let to: string | null = null;
  for (let page = 0; page < 30; page += 1) {
    const query = new URLSearchParams({ market, count: "200", _: String(Date.now()) });
    if (to) query.set("to", to);
    const response = await apiFetch(`https://api.upbit.com/v1/${endpoint}?${query}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Upbit ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || !payload.length) break;
    const pageCandles = payload.map((row) => parseCandle(row, endpoint)).filter((row): row is Candle => Boolean(row));
    collected.push(...pageCandles.filter((row) => row[0] >= lowerBound));
    const oldest = Math.min(...pageCandles.map((row) => row[0]));
    if (!Number.isFinite(oldest) || oldest <= lowerBound || payload.length < 200) break;
    to = new Date(oldest - 1).toISOString();
    await delay(130);
  }
  return [...new Map(collected.map((row) => [row[0], row])).values()].sort((a, b) => a[0] - b[0]);
}

async function upsertCandles(supabaseUrl: string, serviceKey: string, market: string, timeframe: Timeframe, candles: Candle[]) {
  let saved = 0;
  for (let start = 0; start < candles.length; start += 500) {
    const records = candles.slice(start, start + 500).map(([timestamp, open, high, low, close, volume]) => ({
      market, timeframe, candle_time: new Date(timestamp).toISOString(), open, high, low, close, volume, source: "upbit", collected_at: new Date().toISOString(),
    }));
    const response = await fetch(`${supabaseUrl}/rest/v1/coin_market_candles?on_conflict=market,timeframe,candle_time`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(records),
    });
    if (!response.ok) throw new Error(`upsert ${response.status}: ${await response.text()}`);
    saved += records.length;
  }
  return saved;
}

async function loadStoredWindow(supabaseUrl: string, serviceKey: string, market: string) {
  const result = Object.fromEntries((Object.keys(endpoints) as Timeframe[]).map((timeframe) => [timeframe, [] as Candle[]])) as Record<Timeframe, Candle[]>;
  const cutoff = new Date(Date.now() - sixMonthsMs - windowPaddingMs).toISOString();
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const query = new URLSearchParams({
      market: `eq.${market}`,
      candle_time: `gte.${cutoff}`,
      select: "timeframe,candle_time,open,high,low,close,volume",
      order: "candle_time.asc",
      limit: "1000",
      offset: String(offset),
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/coin_market_candles?${query}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!response.ok) throw new Error(`window ${response.status}: ${await response.text()}`);
    const rows = await response.json();
    for (const row of rows) {
      const timeframe = String(row.timeframe) as Timeframe;
      if (!(timeframe in result)) continue;
      const candle: Candle = [Date.parse(row.candle_time), Number(row.open), Number(row.high), Number(row.low), Number(row.close), Number(row.volume)];
      if (candle.every(Number.isFinite)) result[timeframe].push(candle);
    }
    if (rows.length < 1000) break;
  }
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase runtime is not configured" }, 500);

  try {
    const body = await request.json();
    const market = String(body?.market || "");
    if (!allowedMarkets.has(market)) return json({ error: "Unsupported market" }, 400);
    const metadata: Record<string, { previousTimestamp: number | null; latestTimestamp: number | null; saved: number }> = {};
    for (const timeframe of Object.keys(endpoints) as Timeframe[]) {
      const previous = await latestTimestamp(supabaseUrl, serviceKey, market, timeframe);
      const candles = await downloadIncrement(market, timeframe, previous);
      const saved = await upsertCandles(supabaseUrl, serviceKey, market, timeframe, candles);
      metadata[timeframe] = { previousTimestamp: previous, latestTimestamp: candles.at(-1)?.[0] ?? previous, saved };
    }
    const storedWindow = await loadStoredWindow(supabaseUrl, serviceKey, market);
    const result = Object.fromEntries((Object.keys(endpoints) as Timeframe[]).map((timeframe) => [
      timeframe,
      { ...metadata[timeframe], candles: storedWindow[timeframe] },
    ]));
    return json({ market, syncedAt: new Date().toISOString(), timeframes: result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Synchronization failed" }, 500);
  }
});

