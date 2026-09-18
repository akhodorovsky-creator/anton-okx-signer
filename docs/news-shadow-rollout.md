# News intelligence rollout — shadow only

## Preserved baseline (2026-09-18)
- Backup branch: `backup/2026-09-18-working-baseline`
- Original commit: `ef702c4149f633c1c49b63eb5482a62121973f6a`
- This is a source-code checkpoint, **not** a snapshot of Railway environment variables, n8n workflows, OKX balances or open orders.
- Restore code by redeploying the exact baseline commit after checking current account state, active orders, configuration and compatibility. Never assume rollback reverses trades.

## Current implementation
- `news-intelligence.js` is a pure, read-only event evaluator with no network access, exchange credentials, trade signal or order-placement method.
- Requires upstream proof of authorship (`originalVerified: true`); the domain allowlist by itself is insufficient.
- Rejects duplicates, stale timestamps, untrusted domains, and missing market observations.
- Reports only observed association between an event and market changes, not causation or a forecast.
- `news-intelligence.test.js` contains rejection and classification test cases.
- CI is isolated to the feature branch. No production wiring, Railway deployment or n8n changes are part of this branch.

## Before any optional production use
1. Build and audit first-party collectors for primary-source posts/official statements and timestamp their initial receipt; do not mistake reposts or screenshots for originals.
2. Keep deduplication IDs in persistent storage and collect timestamp-aligned BTC/ETH prices, volume, OI and funding; record feed outages explicitly.
3. Log every event and the *unchanged* baseline strategy decision side by side. Include fees, spread, slippage, latency and survivorship bias in historical tests.
4. Evaluate out of sample over multiple regimes; compare the baseline against the news-augmented candidate with drawdown and exposure limits. No profit guarantee.
5. Leave the old live strategy and risk gateway untouched until an independently reviewed release is explicitly authorized. News feed failures must never disable protective exits.
