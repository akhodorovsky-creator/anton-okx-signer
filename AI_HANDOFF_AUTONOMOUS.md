# ANTON OKX Signer — autonomous live trading handoff

## Exact baseline
- Repository: akhodorovsky-creator/anton-okx-signer
- Branch: backup/autonomous-live-trading-20260923
- Exact baseline commit: 0096a0fcb3e0755e0eccb95bc41b22fc2d19482a
- Last verified Railway production deployment of this baseline: 2026-09-23 21:37 UTC
- Deployment message: Restore last verified risk-monitor.js
- Railway project: ANTON OKX Signer
- Railway service: anton-okx-signer
- Start command: npm start
- Healthcheck: /health
- Node.js: >=20

## Why this branch
This is the last verified production snapshot before Telegram-confirmed trade approval was introduced. It is the autonomous trading version.

The next behavior-changing generation introduced Telegram approval and disabled fully autonomous live execution. Do not mix those later approval files into this baseline unless explicitly requested.

## Autonomous engine
Primary multi-pair coordinator: multi-live.js

In this snapshot:
- MULTI_SPOT_LIVE=true enables autonomous multi-pair live execution.
- Traded pairs: BTC-EUR, ETH-EUR, DOGE-EUR.
- Take-profit: +5%.
- Stop-loss: -2%.
- Signal cadence defaults to 15 minutes, with optional MULTI_SIGNAL_INTERVAL_MINUTES policy.
- Position reconciliation, pending-order guards, lot-size validation, signer authentication and uncertainty blocking are part of the safety design.

## Runtime files to inspect first
1. package.json
2. eur-order-cap-launcher.js
3. multi-live.js
4. market-strategy.js
5. frequency-policy.js
6. lot-size.js
7. safety-gateway.js
8. server.js
9. risk-monitor.js
10. dashboard-launcher.js
11. telegram-bot.js

## Railway variables
The production service has these application variables configured:
- ALLOWED_INSTRUMENTS
- CAPITAL_CAP_EUR
- CAPITAL_CAP_USDT
- DASHBOARD_TOKEN
- LIVE
- LIVE_ENABLED
- MARKET_ONLY_LIVE
- MAX_ORDER_EUR
- MAX_ORDER_USDT
- MAX_SIGNAL_AGE_SECONDS
- MULTI_ALLOW_DUST_REENTRY
- MULTI_SIGNAL_INTERVAL_MINUTES
- MULTI_SPOT_LIVE
- NODE_OPTIONS
- OKX_API_KEY
- OKX_DEMO
- OKX_PASSPHRASE
- OKX_SECRET_KEY
- PNL_BASELINES_JSON
- PNL_RESET_AT
- POLITICAL_SHADOW_ENABLED
- PORT
- SIGNER_TOKEN
- TELEGRAM_ALLOWED_CHAT_ID
- TELEGRAM_BOT_TOKEN
- TELEGRAM_TRADE_APPROVAL

Important: secret values remain in Railway. The connected Railway interface exposes their names but redacts their values. Do not fabricate or replace credentials.

TELEGRAM_TRADE_APPROVAL exists in the current Railway environment because production was later changed. The baseline commit above predates the Telegram-confirmed-trade workflow; treat the source code at the baseline commit as authoritative.

## Rules for another AI
- Use baseline commit 0096a0fcb3e0755e0eccb95bc41b22fc2d19482a as the autonomous reference.
- Do not silently upgrade to main.
- Preserve safety checks unless a change is explicitly justified and tested.
- Before any deployment, run npm run check and npm test.
- Compare every change that affects order creation, order sizing, exits, P&L reconciliation or runtime flags.
- Keep a rollback branch before deployment.
- Never place API keys, passphrases, Telegram tokens or dashboard/signing tokens into the public GitHub repository.

## Current repository note
The default main branch is newer and contains Telegram trade-approval behavior. This backup branch is intentionally isolated so the autonomous version cannot be lost.
