# ANTON Arbitrage — isolated experiment (PAPER ONLY)

This experiment lives only on branch `experiment/anton-arbitrage-paper-2026-09-19`. It must not be merged into `main` or deployed to the existing Railway service `anton-okx-signer`. The existing n8n workflow `VjtQFUB6yKxbrpyt` must not be edited, cloned into its production schedules, or pointed at this experiment.

Existing baseline backup: `backup/2026-09-18-working-baseline` (code snapshot only; it is NOT a backup of orders, balances, n8n credentials, or Railway environment).

Separate deployment requirements before any unattended operation: independent Railway project/service, dedicated n8n workflow (or an independent scheduler), separate storage and logs, read-only market-data credentials if needed, no shared order or write API keys, unique endpoints, no production triggers. `LIVE_ENABLED=false` by default; no order submission code until separately reviewed and explicitly authorized.

Initial strategy: check whether mutually exclusive, collectively exhaustive binary-outcome contracts can be purchased at combined executable asks below the guaranteed combined payout, *after* fees, available size, and resolution/settlement costs. Check venue terms, settlement rules, counterparty risk, and whether both legs can fill. This is not risk-free in practice and is not the same as buying unrelated cryptocurrencies on OKX.

Status: isolated development branch created; no arb market venue selected or connected; no scanner deployment or real trade performed.
