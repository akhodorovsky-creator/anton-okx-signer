# ANTON Signal: offline BTC/EUR historical replay (candidate 2026-09-22)

**Research only.** `offline-backtest.js` does not connect to OKX, Railway, n8n, an account, or a signer. It has no order placement, no credentials, and is not imported by the production startup script. Do not use its output to justify increasing capital or order size. The existing production strategy and `main` branch remain unchanged until an intentional review/merge.

## Usage

Obtain legitimate historical **five-minute, fully closed and chronologically aligned** BTC-EUR and ETH-EUR observations, plus historical BTC open interest and funding **as known at each respective time**. Never substitute today's OI/funding for old candles or forward-fill unavailable values. Keep the data file local and outside the public repository: `node offline-backtest.js /private/path/history.csv > /private/path/research.json`.

CSV header must be exactly:

`time,open,high,low,close,volume,ethClose,ethVolume,oi,funding`

- `time`: UTC ISO 8601 timestamp of the **opening** of each 5-minute bar, e.g. `2026-09-01T00:00:00.000Z`.
- Prices: BTC-EUR OHLC, ETH-EUR close; volumes: their respective 5-minute volumes; `oi`: contemporaneous strictly positive BTC open interest; `funding`: contemporaneous signed funding rate expressed as a decimal (not percentage).
- Each row represents a closed candle and derivative values observed by the end of that candle. Rows must be contiguous (exactly 5 minutes apart), oldest first. No invented or interpolated values. At least 64 rows are required; months of historical data are needed before drawing conclusions.
- CSV is intentionally strict: no quoting, commas inside values, extra columns, duplicate rows, or missing bars. Malformed input fails rather than silently trading on fabricated history.

## Explicit modelling assumptions

- BTC-EUR **only**; reuse of the actual pure `market-strategy.compute` indicators and signal decision. Does **not** replay multi-pair sizing, the news/n8n gates, exchange minimums, order-book depth, network failures or private live-account state.
- Evaluate after the close of a five-minute candle, only at 15-minute boundaries; enter/exit at the **next** five-minute candle open. This avoids using the entry bar's future close. The real exchange might fill at materially different prices or fail to fill.
- Only one BTC position at a time; initial cash €200, order €5, TP +5%, SL -2%, 30-minute post-fill cooldown. Default hypothetical fees 0.1% on each side and slippage 0.05% on each side are *assumptions*, not verified OKX account fees.
- Snapshot-triggered TP/SL only: not intrabar stop orders. Gap risk exists, and no stop is guaranteed. Net equity marks open positions at a conservative hypothetical liquidation quote including costs; max drawdown is based on these marks.
- Buy-and-hold benchmark invests the same initial capital at the first eligible next-bar open and assumes both entry and hypothetical exit costs. No deposits, withdrawals or interest. Unclosed trades are marked to market, not represented as realized profits.
- Final report is labelled `HYPOTHETICAL_NOT_LIVE`. It is neither an audited performance record nor a tax report.

## Quality gate before any production integration

1. Run `node --test offline-backtest.test.js`, `npm run check`, `npm test`, and `node eur-order-cap-launcher.js --verify` on this branch; inspect the PR CI status.
2. Source and verify historical data availability and precise timestamp alignment. Export only aggregate statistical reports, not private exchange trades or keys, to public GitHub.
3. Repeat the replay on a fixed out-of-sample period, using verified commission tiers and independently collected slippage. Compare BTC buy-and-hold and a no-trade baseline. Track return, max drawdown, trade count and whether sample size is adequate; no optimization on the same evaluation period.
4. Do not merge this feature into live trading or modify `MULTI_SPOT_LIVE`, `/auto`, `MAX_ORDER_EUR`, Railway or n8n as part of this proposal.

**Next separate work:** durable private fill-by-fill storage, deposit/withdrawal reconciliation and order-state recovery. Current Railway lacks a persistent volume; do not falsely call GitHub (a public source repository) a financial ledger. Production issue #8 documents this limitation. Keep API keys and account history out of commits, issues and CI artifacts.

Rollback reference: `backup/2026-09-22-before-analytics` at `60dce7f0220b84633ed9a8eabdd7110532551a67`.
