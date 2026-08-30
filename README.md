# 마이웨이 75 · 코인 시그널 V1.04

Upbit KRW 12종목의 MACD·RSI 백테스트, MACD 1·2 자산곡선 비교, 최근 20봉 유사 패턴 분석을 제공하는 정적 웹 앱입니다.

## 주요 화면

- `index.html`: 전체 코인 전략 수익률·MDD·자산곡선 비교
- `BTC-MACD-RSI-V2.3-ALL.html` 등: 12개 코인별 봉차트와 보조지표·유사 패턴 분석
- 최신 자료 버튼: Supabase Edge Function을 통해 12종목의 누락 구간을 증분 동기화

## 데이터·보안

- Supabase 프로젝트의 공개용 키만 브라우저에 포함됩니다.
- 데이터 쓰기는 Supabase Edge Function에서 처리하며 `service_role` 키는 저장소와 브라우저에 포함하지 않습니다.
- `coin_market_candles` 테이블에는 RLS가 활성화되어 있습니다.

## 주의

백테스트와 유사 패턴 확률은 과거 데이터 기반 통계이며 실제 수익이나 미래 가격을 보장하지 않습니다.

