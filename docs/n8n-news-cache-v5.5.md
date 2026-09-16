# ANTON Signal n8n news-source repair (v5.5 candidate)

Status as of 2026-09-16: OFFLINE ONLY. Not imported or published in n8n; live workflow remains v5.3. No real orders were sent.

## Verified production evidence

- The current n8n v5.3 sends POST /auto to Railway on 15-minute scheduled runs; Railway responded 200 at 18:00:40, 18:15:57 and 18:30:38 UTC on Sep 16 and logged `WAIT_FOR_BUY`/`HOLD`.
- Google Sheets row 2026-09-16T18:30:35.295Z shows v5.3, HOLD, score +0.45, actionable false, GDELT missing (429/backoff); the last OKX `/pnl` snapshot 18:35:29Z showed 0 tracked BTC and 0 filled orders in limited history.
- The historical 13:00:42Z BUY row was produced by `ANTON Signal v5` (not v5.3) and has a PAPER simulation order, so the absence of `/auto` then does not establish a defect in the current v5.3 connection. Historical n8n executions were deleted and cannot be reconstructed.

## Confirmed v5.3 blocker

`canOpenPosition = qualityPct>=57 && gdOk && pmOk && marketInputsFresh` in the signal engine. GDELT 429 means `gdOk=false` and blocks BUY regardless of lowered score threshold. DO NOT force BUY or treat missing news as neutral.

## v5.4 defect and offline v5.5 correction

The previously prepared v5.4 throttled GDELT to one eligible 15-minute window each UTC hour but did not cache the last verified-fresh news response. Therefore three of four scheduled executions fail the news-quality gate even following a successful HTTP 200. The offline v5.5 JSON in the working session adds: an hourly attempt marker in n8n global static data; an article cache written only after valid HTTP success and valid article timestamps; cache reuse only on deliberate skipped fetches and while both checked-at and individual article ages remain under 120 minutes; immediate invalidation after HTTP 429 or any attempted failed fetch; and diagnostic `RECENT_VERIFIED_CACHE` plus cache age. Signals still require all original BUY risk guards. The GDELT request may still be rate-limited at a shared IP, and n8n workflow static data persistence is not guaranteed in manual runs.

Local syntax checks of the modified engine, gate, and execution node passed. Seven offline tests passed: hourly attempt gate, real-success cache write, 15-min verified-cache reuse without forced BUY, 429 fail-closed, 121-min cache expiry, invalid timestamp rejection, unchanged downstream order and safeguards. No deployment was attempted without an authenticated n8n editor.

## Deployment checklist

1. Restore authorized n8n editor/API access via secure browser profile; do not disclose credentials in chat.
2. Export current published workflow as backup. Import or update candidate in existing workflow; verify credential references and exactly one active schedule (15min). Do not publish an unverified duplicate.
3. Dry-run code nodes using non-trading sample data; inspect positive/negative/failure paths, branch convergence and HTTP Request2 Bearer Auth. Do not manually execute live POST /auto to test delivery.
4. Publish only after tests and monitor real scheduled runs; verify n8n -> Railway POST /auto, actual OKX order IDs/fills, fees, risk caps, order minimum, and EUR balance. HTTP 200, PAPER log and BUY alone are not proof of an exchange fill.

Unresolved: n8n editor is redirecting automated browser to /signin without credentials, and no connector exists. Do not claim live workflow repaired until editor readback and deployment succeed.
