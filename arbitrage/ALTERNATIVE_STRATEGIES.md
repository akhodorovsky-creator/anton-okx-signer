# ANTON Arbitrage — replacement research (PAPER ONLY)

Scope: only isolated Railway project ANTON Arbitrage Paper and experiment branch. Never modify ANTON Signal, its n8n workflow, API keys or capital. All real orders disabled and total hypothetical budget <= EUR 100.

## Why previous triangle is archived
Kraken Pro starting crypto spot tier: maker 0.40% and taker 0.80% each fill (published fee schedule, September 2026; user's account rate not verified). Three taker fills cost roughly 2.38% compounded, plus spread, book latency, partial-fill and minimum order constraints. The old /kraken endpoint remains read-only for historical compatibility but must not be represented as evidence of profitable trading. Disable its PAPER_AUTOSCAN; n8n may still call /kraken independently until edited there.

## Option 1: passive same-pair spread monitor (research only)
For BTC/EUR and ETH/EUR, observe live best bid and ask. Hypothetical passive buy at bid followed by passive sell at ask requires *two independently filled orders at different times*. At tier 1, two maker fees cost about 0.80% of notional before price changes. Require quoted spread > compounded maker fees + explicit risk buffer before flagging a *spread candidate*, not a guaranteed profit. Never claim both legs are executable from one snapshot; no self-matching/wash trades. Post-only limit orders can enforce maker classification if future trading is authorized; do not send orders at this stage. Must simulate realistic queue positions, timeout, adverse selection, inventory mark-to-market, and maker -> taker emergency-exit costs before considering real trades. A quote alone is not a backtest.

## Option 2: buy-and-sell swing PAPER model (not arbitrage)
Two-leg directional strategy on EUR pairs, independent of ANTON Signal. Unlike arbitrage it takes market direction risk and is not risk-free. Test signals out of sample, model two taker fees (about 1.59% compounded round-trip at tier 1), spread/slippage, minimum orders and max EUR 100 allocated. Maker fills may reduce fee assumptions but do not guarantee execution. Do not enable live without evidence and explicit separate go-ahead after validation.

## Option 3: cross-venue price discrepancy monitor (research only)
Observe public executable order-book quotes from two compliant venues. Include asset availability, verified account access, fees at both venues, independent prefunded balances, withdrawal/network costs, fiat transfer time, slippage and inventory replenishment. EUR 100 total across both venues may be insufficient to meet minimum orders or pre-fund both sides. No transfers or real trades. Differences between displayed last prices are not arbitrage.

## Admission gates for any replacement
1. Verify actual account-level fee schedule and Kraken Pro access, pair permissions, minimum size, precision and relevant EU restrictions.
2. Require timestamped executable depth and conservative slippage, realistic fill sequence and missed-fill simulation.
3. Distinguish observed spread, hypothetical estimated P/L, and realized P/L; do not show chart estimates as lost account money.
4. Paper test at multiple market conditions, store persistent history (existing RAM history is reset on deploy), monitor errors.
5. Keep all order placement code absent/disabled until these gates and independent approval.

Official sources: https://www.kraken.com/features/fee-schedule ; https://support.kraken.com/articles/360000920786-examples-of-placing-orders-with-different-parameters ; https://support.kraken.com/articles/360042529892-self-trading-prevention ; https://support.kraken.com/articles/synthetic-pairs .
