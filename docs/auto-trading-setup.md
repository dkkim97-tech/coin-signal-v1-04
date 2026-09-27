# 업비트 현물 · 비트겟 선물 자동매매 설치

## 현재 가능한 범위

웹 앱의 현물 거래 관리 화면은 업비트 KRW, 선물은 비트겟 UTA USDT 무기한 선물에 연결됩니다. 현물 MACD 1~3, 선물 MACD 1~5를 실행합니다. 단순 보유와 EMA 35일은 비교 시뮬레이션 전용입니다. 기존 D−5 / 80% 신호와 5분할 주문 규칙을 유지합니다.

서버는 약 15초마다 등록 종목의 주문·체결·취소를 점검합니다. 매매 신호는 **완성된 일봉**을 기준으로 갱신합니다. 초단타나 틱마다 매매하는 전략이 아닙니다. 최초 설정은 자동매매 OFF이며, 웹사이트 배포만으로 실주문이 시작되지 않습니다.

필요한 준비물은 고정 출구 IPv4가 있는 상시 Linux 서버, 그 서버를 가리키는 도메인, Docker Engine와 Compose, 거래소 API 키입니다. 영구 디스크가 필요하며 Vercel 함수의 임시 디스크에 원장을 두지 않습니다. 서버 비용 결제·도메인 구매·API 키 발급은 계정 소유자가 진행합니다.

## 1. 서버에 설치

서버의 DNS A 레코드를 고정 IP로 연결하고 인바운드 80/443만 웹 접근에 개방합니다. SSH는 관리자 접근 범위로 제한합니다. 포트 4190은 외부에 공개하지 않습니다. 서버 시간 동기화도 켜 둡니다.

```sh
git clone https://github.com/dkkim97-tech/coin-signal-v1-04.git
cd coin-signal-v1-04
node scripts/init-trading-config.mjs trading.your-domain.com
```

Node 22.13 이상이 설정 생성에 필요합니다. 실제 실행 컨테이너는 Node 24를 사용합니다. 위 명령은 기존 설정을 덮어쓰지 않으며 `deploy/.env`와 `deploy/.env.vercel`에 서로 다른 인증 토큰을 생성합니다. 토큰·API 키는 채팅이나 GitHub에 올리지 않습니다.

`deploy/.env`를 서버에서 편집합니다. 처음에는 `TRADING_ENABLED=false`, `UPBIT_LIVE_ENABLED=false`, `BITGET_LIVE_ENABLED=false`를 유지합니다.

```sh
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
docker compose -f deploy/compose.yaml --env-file deploy/.env ps
curl https://trading.your-domain.com/healthz
```

Caddy가 HTTPS 인증서를 발급합니다. `healthz`는 상태만 반환하며 계좌·키를 노출하지 않습니다. `ledger` 볼륨에 SQLite 주문 원장을 저장하고 컨테이너를 재시작합니다. 동일 거래 계좌로 여러 서버나 복제 원장을 동시에 실행하지 않습니다. `down -v`는 원장을 삭제하므로 사용하지 않습니다.

## 2. 거래소 설정

**업비트**: `UPBIT_API_KEY`, `UPBIT_API_SECRET`를 서버에 입력합니다. 자산 조회·주문 조회·주문하기 권한과 서버의 고정 출구 IP를 설정합니다. 출금 권한은 사용하지 않습니다. 업비트에는 이 앱에서 사용하는 가상 체결 데모 계좌가 없으며, 모의 계산은 주문을 전송하지 않는 계산 기능입니다. 실거래 활성화 전 잔고·권한 검증이 필요합니다. KRW 평가가 불가능한 보유 자산이나 KRW 외 미체결 주문이 있으면 주문을 중지합니다.

**비트겟**: UTA 통합계좌의 API key/secret/passphrase를 `BITGET_API_KEY`, `BITGET_API_SECRET`, `BITGET_PASSPHRASE`에 입력합니다. UTA 자산 조회·거래 조회/쓰기 권한, IP 제한을 설정합니다. 지원 계좌는 단방향, 종목별 격리, 거래소 레버리지 2배입니다. 클래식 계좌·헤지 모드·교차 모드는 이 구현의 실행 대상이 아닙니다. 앱은 계좌 모드를 임의로 바꾸지 않습니다. 다른 결제통화 선물 포지션·미체결 주문·부채가 있으면 실행을 거절합니다.

먼저 비트겟에서 발급한 별도 **데모 키**와 `BITGET_DEMO=true`로 확인합니다. 실거래 키와 데모 키를 혼용하지 않습니다. 데모 시작도 실제로 데모 계좌 설정·권한을 확인한 후 진행합니다.

서버에서 다음 명령으로 주문 전송 없이 연결을 검사할 수 있습니다.

```sh
npm ci --ignore-scripts
node scripts/check-trading.mjs
node --env-file=deploy/.env scripts/check-trading.mjs --private --upbit
node --env-file=deploy/.env scripts/check-trading.mjs --private --bitget
```

공개 검사에서는 12코인 시세·호가, 비공개 검사에서는 잔고·미체결·수수료/주문 정책과 비트겟 계좌 모드를 조회합니다. 주문 쓰기 권한과 실제 체결까지 검증됐다는 의미는 아닙니다. 테스트가 실패한 종목은 활성화하지 않습니다.

## 3. Vercel 연결

기존 `coin-signal-v1-04` 프로젝트의 Production 환경 변수에 `deploy/.env.vercel`의 다음 네 값을 입력한 뒤 재배포합니다.

- `TRADE_GATEWAY_URL`: 서버 HTTPS 주소
- `TRADE_GATEWAY_TOKEN`: 서버와 동일한 게이트웨이 토큰
- `TRADE_OPERATOR_TOKEN`: 별도로 생성한 앱 관리자 접속 토큰
- `TRADING_ALLOWED_ORIGIN`: `https://coin-signal-v1-04.vercel.app`

거래소 API secret은 Vercel/브라우저가 아닌 실행 서버에만 보관합니다. Vercel의 관리자 토큰과 게이트웨이 토큰은 서로 다릅니다.

## 4. 계좌별 활성화

1. 앱에서 관리자 접속 → 전체·종목별 한도 저장 → 실계좌 미리보기로 잔고·계좌 모드를 확인합니다.
2. 비트겟 데모는 서버에서 `TRADING_ENABLED=true`, `BITGET_DEMO=true`로 재시작합니다. 업비트 실행은 계속 차단됩니다.
3. 앱에서 해당 거래소 ON → 종목별 실계좌 미리보기 → 데모 시작을 눌러 체결·부분 체결·취소·재시작을 거래소와 대조합니다.
4. 업비트 실거래는 `TRADING_ENABLED=true` 및 `UPBIT_LIVE_ENABLED=true`가 모두 필요합니다. 비트겟 실거래는 실키, `BITGET_DEMO=false`, `BITGET_LIVE_ENABLED=true`, `TRADING_ENABLED=true`가 필요합니다. 설정 변경 후 컨테이너를 재생성합니다.
5. 실제 사용할 전략과 한도는 사용자가 입력하고 확인합니다. 업비트는 5개 주문 각각 최소 5,000원 조건이 있으므로 총액 25,000원에 비용 여유까지 필요합니다. 잔고·주문단위에 따라 주문을 만들 수 없으면 잔량 상태로 표시합니다.

```sh
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

계좌 또는 데모/실거래 키를 바꾸기 전 기존 자동매매를 OFF하고 미체결 취소를 확인합니다. 로그아웃·브라우저 종료는 자동매매를 중지하지 않습니다. OFF는 앱 미체결 취소 및 신규 주문 중지이며 보유 자산을 시장가 청산하지 않습니다. 장애 시 취소가 완료되지 않을 수 있으므로 거래소에서도 확인합니다. 서버 재시작 후에는 저장된 ON·등록 종목이 유지됩니다.

## 검증 상태와 제한

- 2026-09-27 업비트 KRW 12종목, 비트겟 USDT 12종목 공개 시세·호가 조회 성공.
- 두 거래소 BTC 실제 일봉 수집과 MACD 신호 계산 확인.
- 자동 테스트: 업비트 JWT 서명·IOC·부분 체결·잠긴 잔고·실거래 차단과 기존 주문 원장/한도 검증 포함.
- API 키 없는 환경이므로 실제 계좌 권한·실주문·실제 체결은 아직 검증하지 않았습니다.
- Docker Compose 구문 검증 완료. 로컬 Docker 데몬이 실행되지 않아 이미지 빌드와 서버 HTTPS 배치는 실제 Linux 서버에서 추가 확인해야 합니다.

공식 사양: [업비트 인증](https://docs.upbit.com/kr/reference/auth), [주문 생성](https://docs.upbit.com/kr/reference/new-order), [KRW 호가·최소금액](https://docs.upbit.com/kr/docs/krw-market-info), [비트겟 UTA 주문](https://www.bitget.com/docs/catalog/trading/order-management), [계좌 모드](https://www.bitget.com/docs/catalog/account/account-settings).
