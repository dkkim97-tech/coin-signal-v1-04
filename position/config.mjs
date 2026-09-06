// Preserved from macd-allocation-advisor.js calculateLatest and MACD 2/3 targetExposure.
export const LEGACY_TARGETS = Object.freeze({ below_golden: 0.5, below_dead: 0, above_golden: 1, above_dead: 0.5 });
export const DEFAULTS = Object.freeze({
  fast: 12, slow: 26, signal: 9, targets: LEGACY_TARGETS,
  threshold: 0.8, minSamples: 30, maxSamples: 250, similarityRadius: 1.5,
  coefficients: [0.2, 0.5, 0.8, 1.1, 1.4], cancelUnfilled: true,
  spacingMode: 'equal', executionPolicy: 'complete-on-confirmation',
  fee: 0.0005, slippage: 0.0008, capital: 100000000,
  envelopePeriod: 100, envelopeMA: 'SMA', envelopeBands: [3, 5, 7, 10, 15, 20],
  similarityWindow: 60, timeframeWeights: { w1: 4, d1: 3, h4: 2, h1: 1 },
  // Risk weights/adjustments must be fitted on a past training interval before activation.
  riskModel: null, maxPosition: 1, maxTrade: 0.2, maxDailyLoss: 0.05, maxVolatility: 0.25,
});
export function settings(input = {}) {
  const s = { ...DEFAULTS, ...input, targets: { ...LEGACY_TARGETS, ...input.targets } };
  for (const key of ['fast', 'slow', 'signal', 'minSamples', 'maxSamples', 'envelopePeriod', 'similarityWindow'])
    if (!Number.isInteger(s[key]) || s[key] < 2) throw new Error(`${key}: 2 이상의 정수가 필요합니다.`);
  if (s.fast >= s.slow || s.slow > 300 || s.signal > 100 || s.maxSamples < s.minSamples) throw new Error('MACD 기간 / 표본 수 설정을 확인하세요.');
  if (!(s.threshold >= 0.6 && s.threshold <= 1)) throw new Error('확률 기준은 60~100%입니다.');
  if (Object.values(s.targets).some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('기본 BTC 목표 비중은 0~100%입니다.');
  if (!Array.isArray(s.coefficients) || s.coefficients.length !== 5 || s.coefficients.some((v, i) => !Number.isFinite(v) || v <= 0 || (i < 3 ? v >= 1 : v < 1) || (i > 0 && v <= s.coefficients[i - 1]))) throw new Error('계수는 오름차순 5개이며 Core 3개는 1 미만, Opportunity 2개는 1 이상이어야 합니다.');
  if (!['equal', 'legacy'].includes(s.spacingMode) || !['legacy', 'complete-on-confirmation'].includes(s.executionPolicy)) throw new Error('주문 정책 오류');
  if (s.spacingMode === 'equal') {
    const first = s.coefficients[0], step = (s.coefficients[4] - first) / 4;
    s.coefficients = Array.from({length:5}, (_,i) => Number((first + i * step).toFixed(10)));
    if (s.coefficients[2] >= 1 || s.coefficients[3] < 1) throw new Error('등간격 배치에서도 Core 3 / Opportunity 2 경계를 충족해야 합니다.');
  }
  for (const key of ['fee', 'slippage']) if (!(s[key] >= 0 && s[key] <= 0.05)) throw new Error('거래 비용 범위 오류');
  for (const key of ['maxPosition', 'maxTrade', 'maxDailyLoss', 'maxVolatility']) if (!(s[key] > 0 && s[key] <= 1)) throw new Error('안전 한도 범위 오류');
  if (!(s.capital > 0) || !Number.isFinite(s.capital) || !(s.similarityRadius > 0)) throw new Error('초기 자산 / 유사도 반경 오류');
  if (!['SMA', 'EMA'].includes(s.envelopeMA) || !s.envelopeBands?.length || s.envelopeBands.some(v => !Number.isFinite(v) || v <= 0 || v > 50)) throw new Error('Envelope 설정 오류');
  if (Object.values(s.timeframeWeights).some(v => !Number.isFinite(v) || v < 0) || !Object.values(s.timeframeWeights).some(v => v > 0)) throw new Error('시간봉 가중치 오류');
  return s;
}
