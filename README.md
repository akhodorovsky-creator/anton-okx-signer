# ANTON paper strategy lab

This branch is a standalone PAPER-only observer. It has no account credentials, private API calls, signer, live order path or live trading mode.

The three candidates failed the historical profitability screen. Their new observations are hypothetical research, never real trading performance. Source: Binance public EUR market data; not OKX execution history.

Research, data, tests and full limitations: https://github.com/akhodorovsky-creator/anton-okx-signer/tree/research/cost-aware-paper-20260923/research

State is local to this container. Replacing its filesystem starts a new explicit epoch. Cloud runtime usage is billed under the existing hosting plan.

Run `npm test`, then `npm start`. Read-only routes: `/`, `/health`, `/status`.
