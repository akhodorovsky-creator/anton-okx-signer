# Execution reconciliation — 2026-09-21

## Changes in isolated branch

- When `MULTI_SPOT_LIVE=true`, the multi-pair coordinator owns entries and exits. External `POST /auto` now returns HTTP 409 instead of forwarding to the old BTC strategy.
- The independent legacy risk-monitor skips its `POST /auto` when multi-pair is LIVE. Otherwise it retains the original BTC behavior.
- The guarded order-size compatibility launcher retains the existing EUR 20 ceiling and EUR 200 capital limit; it aborts startup if expected source strings change.
- Exit blocks log position quantity, available balance, exchange minimum and lot step; **this is diagnosis, not a sale**.
- The existing P&L is estimated, and recent/archive pages and historical retention can make it incomplete. Do not interpret it as a tax statement or account-wide realized profit.

## Remaining operational limitations

- `ETH-EUR BELOW_MIN_OR_UNAVAILABLE` cannot be repaired by forcing a too-small market order. Inspect the accessible ETH balance, minSz and lotSz on OKX. If unsellable dust remains, manual exchange procedures may be necessary. Do not enlarge a position merely to conceal the error.
- Order-history `limit=100` has incomplete-history fail-closed handling in the multi-pair coordinator, but no complete durable fee/fill ledger. The code stops after its fixed archival horizon rather than trading on unverifiable history. Persistent accounting requires separate implementation and reconciliation.
- The trading model uses BTC derivatives features for all three pairs; passing software tests does not validate profitability.
- A successful deployment status is not proof of correct trade reconciliation. Check Railway logs and exchange order history after deployment, without initiating artificial live trades.

## Verification / rollback

1. Run `npm run check`, `npm test`, and `node eur-order-cap-launcher.js --verify` on the candidate commit.
2. After an authorized release, check `/health`, dashboard read-only data, startup order cap logs and `ANTON_POSITION_MONITOR` showing `MULTI_COORDINATOR_ONLY`.
3. Confirm external `/auto` is HTTP 409 while multi trading is enabled; use non-trading synthetic requests only.
4. Confirm no unexpected order acknowledgement; reconcile any order acknowledgements with OKX before any retry.
5. Roll back to `backup/2026-09-21-before-audit-fixes` (commit `e55339fdc4b87f5f26da91f25feefec23280985e`) if regression occurs. Be aware rollback restores previous conflicting legacy exit paths.

No API credentials or dashboard tokens are stored in this document.
