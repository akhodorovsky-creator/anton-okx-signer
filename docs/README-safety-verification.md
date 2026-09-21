# ANTON Signal: live-safe release check

Do not use a real buy or sell as a smoke test. Confirm `npm run check`, `npm test`, and `node eur-order-cap-launcher.js --verify` are green, then verify Railway health, logs and authenticated dashboard. For the multi-pair mode, legacy `/auto` must return 409; `ANTON_POSITION_MONITOR` must show `MULTI_COORDINATOR_ONLY`. Inspect actual balances, minSz and lotSz if `ETH-EUR` is unsellable, and do not increase the position to force exchange minimum. Do not treat estimated dashboard P&L as complete accounting.
