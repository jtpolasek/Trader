# Next Version Handoff

## Latest Session Notes

Just shipped (branch `feat/surface-valued-unpriced-fees`): surfacing the valued/unpriced 0x fee data
in the dashboard (Build Next #1). Front-end only, reads the existing quote-snapshot fields
(`valuedFeeUsd`, `valuedFeeTokens`, `stillUnpricedFees`) in `src/app/page.tsx` — no schema/route
changes. Added two helpers next to `getSnapshotWarnings` (`getValuedFeeUsd`,
`getStillUnpricedFeeTokens`); the trade-history fee breakdown shows an `incl. $X valued` sub-line on
the 0x fee; `getTradeSignals` emits a distinct red "Unpriced fee" badge (separate from the amber
"Quote warn") when `stillUnpricedFees` is non-empty; the manual preview box shows the 0x fee plus its
valued portion; and the quote details panel gained "Valued 0x fee" / "Unpriced fee tokens" rows. No
double-counting: the unpriced warning is added at the preview level, not into
`normalizedQuote.warnings`, so "Quote warn" does not also fire for it. The real
`data/paper-trader.db` has no unpriced-fee trades yet, so the badge/line only appear once such a
quote is encountered. Verification: `npx tsc --noEmit` clean, `npm test` 15 files / 130 tests pass,
`npm run build` succeeds. Next up is Build Next #2 (wallet activity parsing hardening).

Previously shipped (branch `feat/value-unpriced-0x-fees`): valuing unpriced 0x fees in USD, built on top
of the earlier detection slice. A pure `valueUnpricedFees(unpriced, anchors)` in `src/lib/fees.ts`
prices a fee denominated in WETH/native, USDC, or the traded token against anchors `buildQuotePreview`
already holds (`ethUsd`, `1`, and the derived token price), and `buildQuotePreview` folds the valued
USD into `dexFeeUsd`/`totalCostUsd`. Warning ownership moved up: `normalizeZeroxPriceQuote` keeps the
`unpricedFees` data field but no longer emits the warning; `buildQuotePreview` owns the "could not
value in USD" warning and only fires it for fees in tokens it still cannot price. The snapshot now
carries `valuedFeeUsd`, `valuedFeeTokens`, and `stillUnpricedFees`. The fold is deliberately
conservative (it can only overstate cost slightly, never understate) because 0x may already net a
buy-token fee out of `buyAmount`. Spec/plan:
`docs/superpowers/specs/2026-06-05-value-unpriced-0x-fees-design.md` and
`docs/superpowers/plans/2026-06-05-value-unpriced-0x-fees.md`.

Verification after fee valuation:

- `npm test` passes: 15 test files, 130 tests (new `src/lib/fees.test.ts` with 7 tests; new
  `buildQuotePreview` integration tests in `src/lib/external.test.ts`).
- `npx tsc --noEmit` passes.

The earlier detection slice (branch `feat/unpriced-0x-fee-detection`, merged) added
`summarizeDexFees(rawQuote, chainId)` returning the USDC-priced total plus an `unpriced` list, and
the `unpricedFees` field on the normalized quote. Spec/plan:
`docs/superpowers/specs/2026-06-05-unpriced-0x-fee-detection-design.md` and
`docs/superpowers/plans/2026-06-05-unpriced-0x-fee-detection.md`.

Recent commits on `main` (newest first, all pushed to `origin/main`):

- `Merge: value unpriced 0x fees in USD`
- `Merge: unpriced 0x fee detection`
- `feat: add dashboard reprocess control for stored activity candidates`
- `feat: reprocess stored wallet activity candidates`
- `feat: add dashboard trust signals`
- `Merge: local import/restore flow`

Also merged + pushed this session: the dashboard "Reprocess" control (previews `GET /api/candidates/reprocess`,
confirms the decoded/review/skipped breakdown, applies via `POST`, reloads), wiring up the
already-built reprocess backend. The route `GET /api/candidates/reprocess` previews missing
candidates derived from existing `wallet_activity`; `POST` inserts only missing rows and does not
overwrite copied/failed/existing candidates. CLI: `npm run reprocess:candidates` (+ `-- --apply`).
The real `data/paper-trader.db` was reprocessed earlier: stored candidates 242 → 481, matching all
481 derived with `changed: 0`.

Latest verification after stored-activity reprocessing:

- `npm test -- repositories.test.ts route.test.ts candidateReprocess.test.ts candidates.test.ts` passes: 4 test files, 35 tests.
- `npm test` passes: 13 test files, 110 tests.
- `npx tsc --noEmit` passes.
- `npm run build` passes and lists `/api/candidates/reprocess`.
- `npm run reprocess:candidates` against the real `data/paper-trader.db` reports `stored: 481`, `derived: 481`, `changed: 0`, and "No candidate differences found."

Latest verification after the import/restore work:

- `npm test` passes: 10 test files, 97 tests (added validator + import round-trip/replace tests).
- `npx tsc --noEmit` passes.
- `npm run build` passes (new routes `/api/import` and `/api/import/preview` listed).
- End-to-end smoke check against the real `data/paper-trader.db`: rejection paths return the expected 400 messages (`schemaVersion 2`, missing collections, non-object); a real export → add throwaway wallet → import-the-export round-trip dropped the throwaway (wallets 4 → 3), restored all 13 trades, and `GET /api/ledger/verify` returned `ok:true`.

## Resume Here Tomorrow

State of `main`: clean and pushed. Both quote-reliability fee slices are done (detection +
USD valuation). The most recent few sessions cleared the obvious quote-cost trust gaps, so the
highest-leverage remaining work shifts back toward **wallet parsing** and **surfacing the new fee
data in the UI**.

Ranked suggestions for the next build, best first:

1. DONE: **Surface valued/unpriced fees in the dashboard.** Shipped on branch
   `feat/surface-valued-unpriced-fees` (see Latest Session Notes). The trade/preview fee breakdown
   now shows the valued portion of the dex fee and a distinct "Unpriced fee" badge fires when
   `stillUnpricedFees` is non-empty. Pure front-end read of the existing snapshot fields.

2. **Wallet activity parsing hardening (Build Next #2, core trustworthiness).** Add more real
   Base and review-only stored-payload fixtures and keep tightening buy/sell direction inference,
   especially native-ETH and multi-transfer sell shapes. This is the biggest lever on simulation
   trustworthiness and the parser already has a solid fixture/test harness in `src/lib/candidates*`.

3. **Paper-portfolio archive workflow (Build Next #6).** Let testing bad trades not require manual
   DB cleanup — an archive/restore for the paper portfolio (trades + ledger + quotes) that preserves
   wallets/activity/candidates/settings, building on the existing reset + export/import plumbing.

4. **Quote reliability leftovers (Build Next #1).** Lower priority now that fees are handled.
   Remaining: broaden 0x `issues` parsing as new real shapes appear; consider an optional firm
   `/swap/allowance-holder/quote` simulation mode once `/price` previews are proven stable.

#1 is now done, so start with #2 (wallet activity parsing hardening) — it is the biggest remaining
lever on simulation trustworthiness.

Just completed: the local import/restore flow. A pure zod validator (`src/lib/importBundle.ts`, `parseImportBundle` + `summarizeImportBundle`) enforces `schemaVersion: 1` and strips derived fields; `importLocalData` in `repositories.ts` does a single-transaction replace-all that preserves original IDs/timestamps (so ledger verify still matches), deleting child-first and inserting parent-first under `foreign_keys = ON`. Routes `POST /api/import/preview` (summary, no write) and `POST /api/import` share the validator. The dashboard has an "Import data" button that previews → `window.confirm` summary → imports → `window.location.reload()`. Derived fields (`positions`, `candidateAttention`, `copySettings`, portfolio totals, `app`/`exportedAt`) are intentionally ignored on import; `copy_settings` rides in via the `settings` array. Spec/plan: `docs/superpowers/specs/2026-06-05-local-import-restore-design.md` and `docs/superpowers/plans/2026-06-05-local-import-restore.md`.

## Recently Completed — Ledger Accounting (merged to `main`)

Workstream #4 (ledger-style accounting) is implemented and merged. The design and plan live in
`docs/superpowers/specs/2026-06-04-ledger-accounting-design.md` and
`docs/superpowers/plans/2026-06-04-ledger-accounting.md`.

What shipped: an append-only `ledger_entries` table as the single writable source of truth;
portfolio cash/PnL/fees and per-token positions are computed on read by summing ledger deltas
(no cached running totals, so drift is structurally impossible); trade + ledger writes happen in
one transaction via `recordTrade`; a one-time backfill migrates existing trades; a read-only
`GET /api/ledger/verify` cross-checks the ledger against the trade log and surfaces a dashboard
"Ledger ✓ verified" trust badge. Current full-suite verification is tracked in Latest Session Notes.

Remaining ledger hardening/cleanup is tracked under "Ledger accounting hardening" in Build Next.
The next priorities are #2 (wallet decoding) then #3 (copy ergonomics) below.

## Direction

Keep the full-featured copy-trade simulator vision from `trader.md` and `tradercheck.md`, but continue building the current MVP in the existing Next.js + SQLite app.

The next work should focus on simulation trustworthiness before larger platform architecture. Do not switch to FastAPI, Postgres, or background workers until the core quote, decoding, and accounting flows are reliable enough to justify the added operational complexity.

## Current MVP Boundary

- Simulator only: no private keys, no custody, no live transactions.
- Local Next.js App Router app with server-side API routes.
- SQLite persistence in `data/paper-trader.db`.
- Manual wallet watchlist with labels, notes, and optional GMGN URL.
- Alchemy-backed Ethereum/Base wallet activity fetch.
- Alchemy-backed ERC-20 metadata lookup.
- 0x Swap API v2 `/swap/allowance-holder/price` previews for manual buy/sell simulations.
- Paper trade execution with gas, slippage, 0x fee snapshot storage, positions, trade history, realized PnL, and fee tracking.

This is enough to test the workflow, but it should not be treated as reliable PnL analysis until the quote and wallet parsing layers are tightened.

## Important Implementation Notes

- The live app is still local-first. Keep schema changes compatible with existing SQLite data in `data/paper-trader.db`.
- `NEXT_VERSION.md` is the active handoff doc. `NEXT_SESSION.md` was intentionally retired.
- `trader.md` and `tradercheck.md` are useful long-term feature references, not the implementation source of truth.
- The current UI is intentionally manual-gated: wallet fetches, candidate copies, paper trades, and total-loss closes are user-triggered.
- Slippage is currently a simulation buffer, not an actual exchange fee. It is calculated as notional times slippage bps.
- Manual total-loss closes are represented as zero-price sell trades with a quote snapshot action of `mark-total-loss`.
- Trade-history warning badges are front-end derived from stored trade fields and quote snapshots. They do not yet persist a separate warning model.
- Candidate status counts currently summarize the in-memory wallet activity view, not a global/multi-wallet aggregate dashboard.
- 0x quote warnings are stored inside the normalized quote snapshot; use those snapshots before changing warning logic.
- Be careful with `next-env.d.ts` churn after builds. Do not revert user work, but avoid committing unrelated generated noise.
- `tsconfig.tsbuildinfo` is a machine-local TypeScript incremental-build cache and is ignored on purpose.
- Ledger backfill is one-shot: it is skipped whenever `ledger_entries` is non-empty. If `GET /api/ledger/verify` ever reports drift after a bad partial state, the recovery path is to inspect/export the DB, empty `ledger_entries`, restart to re-run backfill, then verify again before continuing.
- The local export bundle is schema version `1` and currently includes app metadata, portfolio summary, copy settings, candidate attention summary, wallets, tokens, derived positions, trades, ledger entries, quotes, wallet activity, trade candidates, and raw settings. Import should validate this shape before writing anything.
- Dashboard trust analytics v1 is intentionally read-only and deterministic. It is computed by `derivePortfolioAnalytics` from the current portfolio payload, not persisted in SQLite.

## Completed Foundation

- 0x price calls live in a dedicated typed `src/lib/zerox.ts` client.
- Uniswap quotes live in a dedicated typed `src/lib/uniswap.ts` client and are used as a fallback when 0x cannot price a route and `UNISWAP_API_KEY` is configured.
- 0x v2 `/price` responses are normalized before preview/accounting code consumes them.
- Preview and executed trade snapshots store both normalized quote metadata and the raw 0x response.
- Quote previews now expose endpoint, chain ID, token pair, input amount, gas assumptions, slippage assumptions, fee assumptions, warnings, and raw 0x response details in the UI.
- Existing accounting tests cover buy averaging, partial sells, insufficient cash, and insufficient token balance.
- Wallet activity normalization tests cover incoming/outgoing transfers, duplicate transfer handling, swap-like grouped hashes, and same-hash activity across Ethereum/Base.
- Wallet activity can now derive and store first-pass trade candidates grouped by `chainId + transaction hash`.
- Trade candidates currently track status, confidence, side, token in/out assets and amounts, transfer count, and review/skip reason.
- Wallet activity now preserves token contract addresses and raw Alchemy transfer payloads for later reprocessing/debugging.
- Trade candidates now carry token in/out contract addresses and downgrade confidence when the likely copied token has no address.
- Candidate parsing now scores every watched-wallet outbound/inbound transfer pair and prefers cash/native-to-token buy shapes or token-to-cash/native sell shapes, instead of blindly choosing the largest raw transfer in each direction.
- Native ETH source trades, Base token buys, and noisy multi-transfer sell/buy examples are covered by parser tests; ambiguous multi-transfer candidates remain manual-review instead of high-confidence decoded.
- Noisy transactions with multiple plausible received tokens, multiple plausible sent tokens, or both buy and sell shapes now stay manual-review with lower confidence and specific review reasons.
- Stored Alchemy raw payload hydration now recovers missing transfer direction fields (`category`, `from`, `to`, `blockNum`) in addition to token details and timestamps.
- Real stored-payload parser fixtures cover a decoded Ethereum ECHO native-ETH buy and a review-only SNOWY native-ETH buy with no token contract address.
- Stored wallet activity can be reprocessed into missing trade candidates without refetching wallets: `GET /api/candidates/reprocess` previews, `POST /api/candidates/reprocess` inserts only missing rows, and `npm run reprocess:candidates` / `-- --apply` provide a CLI report/apply path.
- The real local `data/paper-trader.db` has been reprocessed so stored and derived trade candidates both total 481 with no differences.
- Wallet activity and trade candidates now show local-time timestamps, and candidates sort by source transaction time newest first.
- Copy settings now persist in SQLite and can be edited from the dashboard.
- Copy settings currently include fixed-dollar mode, percent-of-source mode, max trade cap, slippage cap, gas buffer, insufficient-cash behavior, token allowlist, and token blocklist.
- Decoded/reviewable trade candidates with token addresses can now be copied into the paper portfolio through the saved copy settings.
- Candidate copy execution uses fresh 0x pricing, chain-specific USDC/WETH routing for Ethereum/Base, existing paper accounting, and stores source candidate details in the executed trade snapshot.
- Candidate copy responses now include structured success/failure details for UI display.
- Candidate cards can show copied trade details including trade ID, paper side, token quantity, notional, and fees, or a specific failure reason.
- Candidate copy failures now include a structured bucket for clearer triage: no paper position, missing token address, no liquidity/route, insufficient cash, blocked token, unsupported pattern, metadata, already copied, or unknown.
- Token metadata resolution now prefers chain-specific Alchemy keys for Base and falls back to direct ERC-20 `symbol()`, `decimals()`, and `name()` calls when `alchemy_getTokenMetadata` is incomplete.
- Candidate copy can also recover token symbol/decimals from cached wallet activity `raw_payload` when both metadata lookup and direct ERC-20 calls are incomplete.
- Candidate copy attempts now persist separately from parser status as `last_copy_*` fields; failed copy attempts no longer overwrite a decoded/review candidate's status, while successful copies still finalize the candidate as `copied`.
- Failed candidate copy attempts can now be retried directly from the candidate card; the button switches to "Retry" and stale failure details are hidden while the new attempt is running.
- Candidate cards now show compact trust badges like Ready, Review, No address, Mixed shape, Multiple tokens, No route, and Failed, with unsafe/noisy candidates shown as review-only instead of silently hiding the action.
- The dashboard now includes persisted candidate attention counts across all watched wallets: ready, review, blocked, failed, and copied.
- Copy settings `insufficientCashBehavior: "cap"` now performs fee-aware buy re-quoting: if the first copied buy exceeds available cash after gas/slippage/0x fees, the route computes an affordable notional, re-quotes it, and only executes when the final all-in total fits cash.
- The manual trade ticket now includes an Ethereum/Base chain selector and sends `chainId` through preview/execute, so Base token contracts are no longer resolved as Ethereum by default.
- Watched wallet creation now accepts either a raw `0x...` address or a GMGN wallet URL and extracts the address automatically.
- Tiny token prices now use a price-specific formatter so average entry and trade-history prices do not round down to `$0.00`.
- Open positions can now be manually marked as a total loss when liquidity is gone or 0x cannot find a usable sell route.
- Marking a position as a total loss inserts a zero-price sell trade, realizes the remaining cost basis as a loss, closes the position, and leaves cash unchanged.
- Sell no-route/liquidity errors now surface the same total-loss action when the failed sell maps to an open position.
- The dashboard now has a reset-paper-portfolio workflow that clears simulated trades, ledger entries, quote previews, and copy attempt results while preserving watched wallets, raw wallet activity, candidates, and copy settings.
- The dashboard can now download a local JSON export containing wallets, settings, tokens, raw activity, candidates, quotes, trades, ledger entries, and derived portfolio state before resets or experiments.
- Wallet activity now summarizes copied, decoded, review, failed, and skipped candidate parse-status counts.
- Trade history now breaks fees into gas, slippage, and 0x fee lines instead of only showing a combined total.
- Trade history now shows warning badges for manual total-loss closes, high gas impact, high slippage impact, and stored quote warnings.
- Accounting is ledger-backed: an append-only `ledger_entries` table (one signed-delta row per trade) is the single writable source of truth; cash, realized PnL, fees, and positions are derived on read by summing deltas, so running totals cannot drift.
- A single pure `ledgerDeltaFromTrade` function feeds the write path, the backfill migration, and the verify cross-check identically — there is no second copy of the delta math.
- Trade + ledger writes are atomic: all three write routes (manual execute, candidate copy, manual total-loss) persist through the transactional `recordTrade`, so a mid-write failure leaves no partial state.
- Ledger entries now enforce one row per trade via `UNIQUE(trade_id)` for new DBs and a guarded unique-index migration for existing DBs that do not already contain duplicate entries.
- `insertTrade` is no longer exported from `repositories.ts`; external callers must use transactional `recordTrade`.
- `recordTrade` has a real SQLite integration test proving rollback when the ledger insert fails.
- Existing trades are backfilled into the ledger once on first migration (idempotent via a row-count guard); total-loss closes backfill correctly as zero-price sells with no special case.
- `GET /api/ledger/verify` re-derives the expected delta per trade and reports mismatches/missing/orphan entries; the dashboard shows a compact green/red "Ledger ✓ verified" badge.
- Dashboard portfolio and ledger status refreshes now check `response.ok` before trusting JSON payloads.
- Dashboard trust signals v1 is shipped: `/api/portfolio` includes `analytics`; the UI shows win rate, fee drag, open exposure, average hold time, realized vs open exposure, and best/worst realized token. The math is covered by `src/lib/portfolioAnalytics.test.ts`.
- 0x fees denominated in a non-USDC token (e.g. a buy-token `zeroExFee`) are no longer silently dropped to `$0`: `summarizeDexFees` in `src/lib/zerox.ts` returns both the USDC-priced total and an `unpriced` list, and the normalized quote carries `unpricedFees`.
- Unpriced 0x fees are now valued in USD and folded into simulated cost: `valueUnpricedFees` (`src/lib/fees.ts`) prices a fee in WETH/native, USDC, or the traded token against anchors `buildQuotePreview` already has (`ethUsd`, `1`, derived token price), adds the valued amount to `dexFeeUsd`/`totalCostUsd`, and warns only about fees in tokens it still cannot value. `normalizeZeroxPriceQuote` no longer emits the unpriced warning; `buildQuotePreview` owns it and records `valuedFeeUsd`/`valuedFeeTokens`/`stillUnpricedFees` in the quote snapshot (it surfaces through the existing "Quote warn" badge). The fold is conservative: it may slightly overstate cost (0x can net a buy-token fee out of `buyAmount`) but never understates.

Do not rely on 0x Trade Analytics for arbitrary GMGN wallets. It only returns trades associated with our own 0x API key/app, so it is useful for our app analytics later, not for discovering or replaying random wallet trades.

## Build Next

1. Harden quote and trade preview reliability.
   - Keep 0x `/swap/allowance-holder/price` as the default preview endpoint.
   - Broaden 0x `issues` parsing as more real responses are observed.
   - Continue refining quote/debug metadata and trade-row warning badges as real payloads reveal missing fields.
   - Add optional `/swap/allowance-holder/quote` firm-simulation mode only after `/price` previews are stable.
   - Keep adding tests for new 0x issue and fee shapes as they appear.
   - Add stale-quote warnings if preview and execution become separate enough that quotes can sit for a while.

2. Improve wallet activity parsing into candidate swaps.
   - Continue tightening token direction inference with more real wallet examples and stored raw payloads.
   - Keep improving likely buy/sell detection for more complex paired inbound/outbound transfers.
   - Consider ETH/USDC value changes when classifying swaps.
   - Use stored raw transfer payloads to refine parser behavior without always refetching.
   - Add more live-wallet examples to harden copy sizing around native ETH source trades, Base trades, and sell candidates.
   - Keep copy actions manual until candidate confidence is much stronger.

3. Improve copy execution ergonomics.
   - Continue polishing retry/copy-again feedback as more real failure cases appear.

4. Ledger accounting hardening and cleanup (core shipped; these are follow-ups).
   - DONE: Retired the vestigial state. The `positions` table and the `portfolios.cash_usd` / `realized_pnl_usd` / `fees_paid_usd` running-total columns are dropped from schema/seed and from existing DBs via the idempotent `dropVestigialState` migration. `portfolios.starting_cash_usd` is kept as the ledger baseline.

5. Improve dashboard trust signals.
   - DONE: Trust signals v1 shipped. `derivePortfolioAnalytics` computes closed trade count, win rate, fee drag, FIFO average hold time, open exposure, realized PnL, and best/worst realized token; the dashboard renders a compact trust strip plus a small "Trust signals" panel.
   - Continue refining fee breakdown details as more execution costs are modeled.
   - Add persisted copied/skipped/failed candidate counts across wallet fetches if the activity view becomes multi-wallet.
   - Continue adding warnings for low liquidity, unreliable 0x simulation, stale quote assumptions, and unsupported trade patterns.
   - Add deeper analytics later only if they stay compact: per-token closed trade counts, fee drag by token, quote-warning trend, and realized/open exposure over time.

6. Improve persistence and data operations.
   - DONE: Local import/restore for the export bundle. Transactional replace-all guarded by a confirmation summary; validated with zod; ledger re-verified after import. See `src/lib/importBundle.ts`, `importLocalData` in `repositories.ts`, and `/api/import` + `/api/import/preview`.
   - Add an archive workflow for paper portfolios so testing bad trades does not require manual DB cleanup.
   - Consider multi-portfolio support before any scheduled polling.

## Longer-Term Feature List

- Historical backtesting using watched-wallet transactions and nearest-available pricing.
- Multi-portfolio strategy testing.
- Local export/import for wallets, settings, trades, and portfolio history.
- Pause/resume controls for wallet tracking once polling is added.
- Scheduled polling or background ingestion after manual fetch/decode flow is reliable.
- Multi-user auth and production database after the local MVP proves the workflow.
- FastAPI/Postgres/background workers only when durability, scale, or deployment needs make them worth the complexity.

## Definition Of Done For The Next Iteration

- New 0x issue shapes discovered during testing have explicit warning text and tests.
- Wallet parsing improvements are backed by real or fixture-style activity examples.
- Copy failures are easier to classify without reading raw logs or snapshots.
- Candidate status changes remain understandable after multiple copy attempts.
- Manual buy/sell, candidate copy, and manual total-loss accounting still pass tests.
- Dashboard trust signals remain compact and do not crowd the trade history table on localhost.
- The UI keeps the simulator/no-live-trading boundary obvious.
