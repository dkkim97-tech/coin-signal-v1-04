# BTC Position Management V1.16

## Existing architecture and preserved behavior

Baseline commit: `3f4550f`. Static HTML with embedded historical data and independent IIFE JavaScript extensions. Vercel rewrites `/futures/` to the same HTML while `investment-mode-switch.js` scopes the UI. No build framework or package manager dependency existed.

`macd-allocation-advisor.js` reads the embedded systemConfig (12,26,9), SMA-seeds EMAs, classifies MACD against zero and its signal, and uses targets 100/50/50/0. `macd2-latest-extension.js` uses the same allocation map; MACD3 uses 18/39/9. MACD4 and MACD5 add short/leverage policies. These existing algorithms, strategies and 12-coin comparisons are unchanged. The new module is a BTC+cash allocation strategy, also accessible from the futures page, and does not redefine futures leverage or borrowing.

Existing `api/candles.js` reads public Upbit candles. Existing Supabase `coin-candle-sync` stores market/timeframe/candle_time OHLCV in `coin_market_candles`; the repository contains the Edge Function but not a complete live schema or account/order tables. No database migrations or production DB writes were made. Existing account balances cannot be inferred. New Paper state is local to the browser, with separate futures and spot keys and Web Locks for same-origin multi-tab serialization.

## Phase delivery ledger

| Phase | Analysis / implementation | Modified files | New files | Existing impact / tests / issues / next step |
|---|---|---|---|---|
| 1 Architecture | Static HTML, IIFEs, Vercel API, Supabase candle-only storage examined | None | This report | No changes to old calculations; start target verification |
| 2 Targets | Read 100/50/50/0 and 12/26/9 from existing code; editable persisted settings | None | position/config.mjs | Legacy-map regression passes; proceed to projections |
| 3 Leading | Constant hypothetical close iterates EMA Fast/Slow/Signal for D+1~3; 7 scenarios; interpolated ETA | None | position/indicators.mjs | Appended-hypothetical-candle numerical parity passes |
| 4 Probability | Direction+zero-zone matched, ATR-normalized features, non-overlapping matured labels, Wilson CI | None | position/signals.mjs | Prefix invariance and minimum sample gating pass; sample limitation remains visible |
| 5 ADR5 | Mean high-low of 5 completed UTC daily candles | api/candles.js adds volume and weekly frame | position/data.mjs; source data and ingestion scripts | UTC boundary/gap tests pass; legacy KST chart data is not mixed |
| 6 Split | Delta/5, symmetric limit prices, cash/quantity accounting, target clamps | None | position/execution.mjs | 0→50, 30→50, 80→50 and 50→0 cases pass |
| 7 Core/Opportunity | First 3 within ADR; last 2 outside/boundary; no chase | None | Tests in test/position.test.mjs | Touch-only fill, limit protection and no-duplicate tests pass; no order-book queue model |
| 8 Daily | Sequential completed-day Paper replay, daily replan; same-origin state locks | None | position/dashboard.mjs | Intraday-created plans start at next complete UTC daily bar; no always-on server worker |
| 9 Cancel/reversal | Cancel opposite orders, retain actual holdings, residual plan on confirmation | None | execution tests | Cancellation/confirmation/idempotency tests pass; Paper stop requires user action to restart |
| 10 Pattern/Envelope | Confirmed pivots, 24 pattern families, oscillators/OBV/MA, train-only weights, historical analog outcomes | None | position/patterns.mjs | Pattern prefix invariance passes; heuristic patterns are candidates, not calibrated probabilities |
| 11 Backtest | A~H, horizons, thresholds, coefficient sets, FIFO trade metrics, regimes and expanding walk forward | package.json (added) | position/backtest.mjs; research-worker.mjs; scripts/verify.mjs | Real UTC data through latest completed candle; results generated without changing default threshold |
| 12 Dashboard | Summary, leading/timeline, 5 orders, settings, patterns, market context, research charts/export | index.html; duplicate index; BTC detail (one module tag and version each) | position/dashboard.css; api/market-context.js | Browser interaction and regression checks; connected providers may return unavailable |

## Causality and probability definitions

- EMA seeding follows the existing implementation: an initial SMA followed by recursive EMA.
- A historical case at i becomes eligible only when i+3 is available at decision T. Direction AND zero-zone must match the projected signal. Features are line/ATR, histogram/ATR, histogram slope/ATR and ATR/price, with configurable distance radius. Historical flat-price projection must predict the same state. Select the nearest non-overlapping cases, up to the configured maximum.
- `Historical Probability = successful cases / selected cases`. Timeline probabilities use the same denominator for cumulative success within 1, 2 and 3 days. No sample yields unavailable, not zero.
- Minimum 30 cases is an additional default reliability gate. Wilson 95% intervals are descriptive and do not eliminate dependence/regime risk. Confidence HIGH requires interval width ≤15 percentage points; otherwise MEDIUM, or LOW SAMPLE below the gate.
- Current quote, when fresh, supplies scenario price; current indicators use the latest completed daily candle. ETA is a linear interpolation between daily histogram values, not a continuous-time forecast.
- Confirmed crosses take precedence over conflicting projections. No pre-signal triggers below the configured threshold. Confirmed and baseline MACD targets can still produce orders independently.

## Pattern and risk definitions

Pivot i requires two lower highs/higher lows on both sides and is known only after i+2. Double/triple tops/bottoms and head-and-shoulders require neckline breaks. Triangle/wedge/flag/pennant candidates use confirmed swing slopes and pole/range rules. Harmonics use alternating confirmed swings with explicit Fibonacci tolerances. MACD, RSI, CCI and OBV divergence compares confirmed pivots. Similarity uses standardized log-return correlation (minimum .60), configured 30/60/90/180-candle windows and non-overlapping historical windows. Each future outcome horizon has its own matured sample count.

Risk weights are learned from directional 7-day hit rates in training. A feature needs ≥30 historical observations; weight is `max(0, Wilson lower bound − .5)`. Scores normalize active weights by the total learned directional weight, yielding 0~100 descriptive scores, not probabilities. Low Zone/Bullish and High Risk/Crash respectively use the learned bullish/bearish evidence. Risk adjustments require multiple evidence categories, preventing Envelope-only orders. Validation chooses maximum allocation adjustment from 0/10/20/30%; no OOS results enter selection. Unsupported/uncalibrated features have zero influence and missing score denominators display unavailable.

## Execution and accounting

Targets are fractions of BTC+cash equity. Plans use the actual current marked position; a filled pre-signal is not added a second time at confirmation. Orders carry creation/expiration, reference price, fixed quantity, coefficient, category and state. All old waiting orders are reconsidered daily. Lifecycle: WAITING / FILLED / CANCELLED / EXPIRED / RECALCULATED.

Limit fills only use a subsequent daily candle, never its signal candle. Favorable gap fills apply slippage capped at the limit. Buys clamp to available cash and target after fees; sells clamp to available BTC and remaining target. FIFO partial sales define realized trades and holding periods. Open position value remains in equity. Paper initial positions have an explicit start time and next-full-day activation to prevent using prices that preceded order creation.

Operational loss/volatility/trade-size stops apply to Paper; historical strategy comparisons omit operational shutdowns for all variants consistently. A Paper daily loss check uses a conservative low-first OHLC ordering, does not claim intrabar execution accuracy, and stops new orders rather than promising a guaranteed liquidation price. LIVE remains unavailable until a verified authenticated order connector is implemented and explicitly enabled. `guardLive` rejects missing capability, unhealthy API/data, position/trade/loss/volatility breaches, signal conflicts and emergency stops. No private API key UI, order submission, borrowing or external account changes are present.

## Backtest report interpretation

Default comparison: 2024 onward, Training through 2020, Validation 2021~2023. Available Upbit data begins 2017-09-25; 2015~2016 is not invented. Walk Forward refits features using only earlier years and applies a fixed experimental 20% adjustment cap per fold. A historical chart is descriptive; selecting a date within training or validation does not turn it into OOS. Applied model timestamps prevent earlier decisions from using later-trained models.

A = state allocation; B = rebalance only on an actual cross; C = oscillator evidence; D = envelope/MA evidence; E = chart-pattern evidence; F = pre-signal; G = pre-signal + split limits; H = full risk-adjusted split strategy. C/D/E/H may coincide with baseline where no reliable applicable weight was learned. The default core periods and 80% threshold do not change automatically.

Return/CAGR/MDD, 365.25-day Sharpe/Sortino (risk-free rate zero), realized FIFO Win Rate/Profit Factor, trade count, average gains/losses/holding, exposure and extremes are reported. Buy & Hold is a cost-free comparator from first evaluation open to final close. Regime attribution groups realized daily returns by ex-post observed regime; it is not a predictive regime strategy. Core/Opportunity rates, quantity-weighted buy/sell prices, same-day matching-side price improvement and missed-order next-day returns are reported. Full order, fill and trade details are in downloadable JSON.

## External data and limitations

- Upbit supplies BTC OHLCV and current price. Public API errors remain visible and halt Paper order renewal.
- Alternative.me Fear & Greed and Binance funding/open interest/account long-short ratio are optional contextual feeds. Provider errors display unavailable; Binance context uses BTCUSDT while strategy prices use KRW-BTC.
- ETF daily/weekly/30-day flow supports user-supplied timestamp/netFlow USD JSON. Automatic ETF and liquidation providers are not connected.
- Bithumb, Coinone and Korbit expose connector capability boundaries but are not connected to balances/orders. Borrowing calculation rejects activation unless actual availability is supplied; no borrowing service is represented as supported.
- Paper is a local completed-candle simulator, not a continuously running server trading daemon. Multi-device account synchronization, live exchange execution, order-book queues, funding/margin/liquidation accounting for the new BTC+cash engine, and licensed ETF/liquidation feeds require separate integrations.

Data references: https://global-docs.upbit.com/reference/list-candles-days and https://global-docs.upbit.com/reference/list-candles-weeks. Existing public API shapes were retained; additive weekly and volume changes preserve old consumers.
