# Next Version Handoff

## Active Work In Progress — Ledger Accounting (start here)

A brainstorm + spec + implementation plan are already written for workstream #4
(ledger-style accounting). Branch `feat/ledger-accounting` is checked out. The
`data/paper-trader.db` is throwaway test data and may be deleted freely.

**Paste this to a fresh session to resume:**

> Execute the plan in `docs/superpowers/plans/2026-06-04-ledger-accounting.md` using the
> superpowers:subagent-driven-development skill — one fresh subagent per task, review between
> tasks. We are on branch `feat/ledger-accounting`. The SQLite DB at `data/paper-trader.db` is
> disposable test data; deleting it to start clean is fine. The design rationale is in
> `docs/superpowers/specs/2026-06-04-ledger-accounting-design.md`. Run `npm test` and
> `npx tsc --noEmit` as the verification gates.

What this builds: an append-only `ledger_entries` table as the single writable source of truth;
portfolio cash/PnL/fees and per-token positions are computed on read by summing ledger deltas
(no cached running totals, so drift is structurally impossible); trade + ledger writes happen in
one transaction via `recordTrade`; a read-only `GET /api/ledger/verify` cross-checks the ledger
against the trade log and surfaces a dashboard trust badge.

After it merges, the next priorities remain #2 (wallet decoding) then #3 (copy ergonomics) below.

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

## Completed Foundation

- 0x price calls live in a dedicated typed `src/lib/zerox.ts` client.
- 0x v2 `/price` responses are normalized before preview/accounting code consumes them.
- Preview and executed trade snapshots store both normalized quote metadata and the raw 0x response.
- Quote previews now expose endpoint, chain ID, token pair, input amount, gas assumptions, slippage assumptions, fee assumptions, warnings, and raw 0x response details in the UI.
- Existing accounting tests cover buy averaging, partial sells, insufficient cash, and insufficient token balance.
- Wallet activity normalization tests cover incoming/outgoing transfers, duplicate transfer handling, swap-like grouped hashes, and same-hash activity across Ethereum/Base.
- Wallet activity can now derive and store first-pass trade candidates grouped by `chainId + transaction hash`.
- Trade candidates currently track status, confidence, side, token in/out assets and amounts, transfer count, and review/skip reason.
- Wallet activity now preserves token contract addresses and raw Alchemy transfer payloads for later reprocessing/debugging.
- Trade candidates now carry token in/out contract addresses and downgrade confidence when the likely copied token has no address.
- Wallet activity and trade candidates now show local-time timestamps, and candidates sort by source transaction time newest first.
- Copy settings now persist in SQLite and can be edited from the dashboard.
- Copy settings currently include fixed-dollar mode, percent-of-source mode, max trade cap, slippage cap, gas buffer, insufficient-cash behavior, token allowlist, and token blocklist.
- Decoded/reviewable trade candidates with token addresses can now be copied into the paper portfolio through the saved copy settings.
- Candidate copy execution uses fresh 0x pricing, chain-specific USDC/WETH routing for Ethereum/Base, existing paper accounting, and stores source candidate details in the executed trade snapshot.
- Candidate copy responses now include structured success/failure details for UI display.
- Candidate cards can show copied trade details including trade ID, paper side, token quantity, notional, and fees, or a specific failure reason.
- Watched wallet creation now accepts either a raw `0x...` address or a GMGN wallet URL and extracts the address automatically.
- Tiny token prices now use a price-specific formatter so average entry and trade-history prices do not round down to `$0.00`.
- Open positions can now be manually marked as a total loss when liquidity is gone or 0x cannot find a usable sell route.
- Marking a position as a total loss inserts a zero-price sell trade, realizes the remaining cost basis as a loss, closes the position, and leaves cash unchanged.
- Sell no-route/liquidity errors now surface the same total-loss action when the failed sell maps to an open position.
- Wallet activity now summarizes copied, decoded, review, failed, and skipped candidate counts.
- Trade history now breaks fees into gas, slippage, and 0x fee lines instead of only showing a combined total.
- Trade history now shows warning badges for manual total-loss closes, high gas impact, high slippage impact, and stored quote warnings.

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
   - Tighten token direction inference relative to the watched wallet with real wallet examples.
   - Improve likely buy/sell detection from paired inbound/outbound transfers.
   - Consider ETH/USDC value changes when classifying swaps.
   - Use stored raw transfer payloads to refine parser behavior without always refetching.
   - Add more live-wallet examples to harden copy sizing around native ETH source trades, Base trades, and sell candidates.
   - Keep copy actions manual until candidate confidence is much stronger.

3. Improve copy execution ergonomics.
   - Add clearer per-candidate failure buckets: no paper position, no token address, no liquidity, insufficient cash, blocked token, unsupported pattern.
   - Consider a retry/copy-again path for failed candidates after settings change.
   - Consider allowing copy failures to keep original candidate status plus a separate last-copy result, instead of overwriting status to `failed`.
   - Add a better "cap insufficient cash" flow with fee-aware re-quoting.

4. Add ledger-style accounting now that replay mutates portfolio state.
   - Add immutable ledger entries for cash changes, position changes, realized PnL, and fees.
   - Keep current position rows as derived/current state.
   - Add a recompute path later if accounting drift appears.
   - Include manual total-loss closes in the ledger model from the start.

5. Improve dashboard trust signals.
   - Continue refining fee breakdown details as more execution costs are modeled.
   - Add persisted copied/skipped/failed candidate counts across wallet fetches if the activity view becomes multi-wallet.
   - Continue adding warnings for low liquidity, unreliable 0x simulation, stale quote assumptions, and unsupported trade patterns.
   - Add better analytics later: win rate, fee drag, average hold time, best/worst tokens, realized vs open exposure.

6. Improve persistence and data operations.
   - Add local export/import for wallets, copy settings, trades, positions, and raw activity.
   - Add a reset or archive workflow for paper portfolios so testing bad trades does not require manual DB cleanup.
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
