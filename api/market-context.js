const sources = {
  price: 'https://api.upbit.com/v1/ticker?markets=KRW-BTC',
  sentiment: 'https://api.alternative.me/fng/?limit=1',
  funding: 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT',
  openInterest: 'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
  longShort: 'https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1d&limit=1',
};
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const values = await Promise.all(Object.entries(sources).map(async ([name, source]) => {
    try { const r = await fetch(source, { signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return [name, { source, data: await r.json(), fetchedAt: Date.now() }]; }
    catch (e) { return [name, { source, data: null, error: e.message }]; }
  }));
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
  return res.status(200).json({ ...Object.fromEntries(values), etf: { data: null, error: 'ETF flow provider not connected' }, liquidations: { data: null, error: 'Liquidation feed not connected' } });
}
