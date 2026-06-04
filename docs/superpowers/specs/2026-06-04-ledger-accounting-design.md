# Ledger-as-Source-of-Truth Accounting — Design

**Date:** 2026-06-04
**Status:** Approved for planning
**Scope decision:** Full ledger + recompute. The ledger is the only writable source of
truth; portfolio and positions are computed on read. No cached running totals.

## Problem

The current accounting layer has two weaknesses:

1. **Silent drift from partial writes.** `src/app/api/trades/execute/route.ts` performs three
   separate, unwrapped writes — `updatePortfolio`, `upsertPosition`, `insertTrade`. If any write
   throws after an earlier one committed (most dangerously `insertTrade` after `updatePortfolio`),
   cash moves with no trade recorded and the books drift with no way to detect or recover. The
   candidate-copy path has the same shape.
2. **No reconstructability.** `portfolios` (cash / realizedPnl / fees) and `positions` are mutable
   current-state rows updated incrementally in place. The `trades` table records every economic
   effect (including total-loss closes, stored as zero-price sells) but nothing rebuilds state from
   it or proves the running totals are correct.

`NEXT_VERSION.md` item #4 calls for immutable ledger entries for cash, position, realized PnL, and
fee changes, with position rows as derived state and a recompute path. This design satisfies that,
choosing the stronger variant: positions and portfolio are derived entirely from the ledger, so
there is no cache that can drift.

## Goal

- Make partial-failure drift structurally impossible (single transaction per economic event).
- Make portfolio and positions fully reconstructable from an append-only ledger.
- Provide a read-only verify command that cross-checks the ledger against the trade log.
- Migrate existing `paper-trader.db` data non-destructively.

## Non-goals

- Dropping the legacy `positions` table or the running-total columns on `portfolios` (left vestigial
  this iteration; removable in a later cleanup).
- Multi-portfolio support.
- Any change to quote/preview logic, fee modeling, or wallet decoding.
- A repair/rewrite mode for the ledger (verify is read-only this iteration).

## Data model

One new append-only table.

```sql
CREATE TABLE ledger_entries (
  id                 TEXT PRIMARY KEY,
  entry_type         TEXT NOT NULL,        -- 'buy' | 'sell' | 'total_loss'
  trade_id           TEXT NOT NULL,        -- FK -> trades.id (the source event)
  token_address      TEXT NOT NULL,        -- FK -> tokens.address
  cash_delta         REAL NOT NULL,        -- signed change to cash
  quantity_delta     REAL NOT NULL,        -- signed change to token quantity
  cost_basis_delta   REAL NOT NULL,        -- signed change to position cost basis
  realized_pnl_delta REAL NOT NULL,        -- signed realized PnL for this event
  fee_delta          REAL NOT NULL,        -- gas + slippage + dex fee for this event
  created_at         TEXT NOT NULL,
  FOREIGN KEY(trade_id) REFERENCES trades(id),
  FOREIGN KEY(token_address) REFERENCES tokens(address)
);
```

**Key property:** every column is a signed delta computed at write time. Recompute is therefore a
pure `SUM()` and order-independent — there is no need to replay average-cost math on read. Rows are
never updated or deleted.

Aggregation and verify are both order-independent (each delta is self-contained), so no explicit
sequence column is needed; `created_at` plus SQLite `rowid` gives stable display ordering.

### Delta conventions

Every delta is a pure function of the **persisted `Trade` fields** — confirmed against
`external.ts`, where for a sell `notionalUsd` is gross proceeds, `totalCostUsd` is fees only, and
`sellProceedsUsd = max(0, notionalUsd - fees)`. Let `fees = gasUsd + slippageUsd + dexFeeUsd`.

| entry_type      | cash_delta        | quantity_delta | cost_basis_delta      | realized_pnl_delta | fee_delta |
|-----------------|-------------------|----------------|-----------------------|--------------------|-----------|
| `buy`           | `-totalCostUsd`   | `+quantity`    | `+(notionalUsd+fees)` | `0`                | `fees`    |
| `sell`          | `+proceeds`       | `-quantity`    | `-(proceeds - realizedPnlUsd)` | `realizedPnlUsd` | `fees` |
| `total_loss`*   | `0` (proceeds 0)  | `-quantity`    | `+realizedPnlUsd`     | `realizedPnlUsd`   | `0`       |

where `proceeds = max(0, notionalUsd - fees)`.

*Total-loss is stored as a zero-price sell (`notionalUsd = 0`, `fees = 0`,
`realizedPnlUsd = -costBasis`), so it falls out of the `sell` row with no special case:
`proceeds = 0`, `cost_basis_delta = -(0 - realizedPnlUsd) = realizedPnlUsd = -costBasis`.

This makes the entry a deterministic restructuring of a `Trade` row, owned by a single pure function
`ledgerDeltaFromTrade(trade)`. The write path, backfill, and verify all call it, guaranteeing
identical math.

## Read path

All reads derive from the ledger:

- `cash = startingCash + Σ cash_delta`
- `realizedPnl = Σ realized_pnl_delta`
- `fees = Σ fee_delta`
- Per-token position: `GROUP BY token_address` summing `quantity_delta`, `cost_basis_delta`,
  `realized_pnl_delta`, `fee_delta`, joined to `tokens` for symbol/name/decimals.
  `averageEntry = costBasis / quantity` (0 when quantity is 0). Open positions filtered by
  `quantity > 1e-10`, matching current `listPositions` behavior.

`getPortfolio()`, `listPositions()`, and `getPosition(tokenAddress)` are rewired to these
aggregations. The `portfolios` row is still read for `id`, `name`, `startingCashUsd`, and
timestamps; its `cash_usd` / `realized_pnl_usd` / `fees_paid_usd` columns are no longer read or
written. The `positions` table is no longer read or written.

`getPosition` feeding the sell path is safe: it derives `averageEntryUsd` and `quantity` from ledger
sums, which is exactly what `accounting.ts` consumes.

## Write path

A single transactional repository function replaces the three unwrapped writes. It takes the trade
fields, derives the entry via `ledgerDeltaFromTrade`, and inserts both rows atomically.

- `recordTrade(tradeFields)` — derives the delta, then wraps `insertTrade` + `insertLedgerEntry` in
  one `BEGIN/COMMIT`; rolls back on any error. Returns the new trade id.

Both the manual-execute route (`api/trades/execute`) and the candidate-copy route
(`api/candidates/[id]/copy`) call `recordTrade`. The total-loss route (`api/positions/[address]/zero`)
also calls `recordTrade` with the zero-price sell fields it already builds (no separate function
needed, since total-loss derives from the same `ledgerDeltaFromTrade`). The `updatePortfolio` and
`upsertPosition` calls are deleted from all routes.

Insufficient-cash and insufficient-balance checks remain in `accounting.ts` and run *before* any
write, so a rejected trade persists nothing.

## Module boundaries

- **`accounting.ts`** (pure): unchanged. Still owns pre-write validation and average-cost math for
  the live trade path.
- **`ledger.ts`** (new, pure): `ledgerDeltaFromTrade(trade)` (the five signed deltas from a `Trade`),
  aggregation over arrays of entries — `derivePortfolioTotals(entries)` and
  `derivePositions(entries, tokens)` — plus the verify comparator. Unit-testable without a DB.
- **`repositories.ts`** (SQL): `insertLedgerEntry`, `listLedgerEntries`, the transactional
  the transactional `recordTrade`, and the rewired `getPortfolio` / `listPositions` /
  `getPosition` reading from ledger aggregations.
- **`db.ts`**: `ledger_entries` table creation + backfill migration.

## Verify command

`GET /api/ledger/verify` (read-only):

1. Loads all trades and, for each, derives the expected delta via `ledgerDeltaFromTrade`.
2. Loads stored ledger entries and compares delta-by-delta with an epsilon tolerance (`1e-6`) for
   floating-point. Also flags trades with no entry and entries with no matching trade.
3. Returns `{ ok: boolean, mismatches: Array<{ tradeId, field, expected, actual }> }`.

Surfaced as a compact dashboard trust signal: `Ledger ✓ verified` or `⚠ N mismatches`. This is the
drift alarm: it confirms the ledger is consistent with the independent `trades` record, catching
missing/orphaned entries and tampering. Bugs in `ledgerDeltaFromTrade` itself are out of scope for
this cross-check (both sides share it) and are covered by direct unit tests instead.

## Migration / backfill

In `db.ts` migration:

1. Create `ledger_entries`.
2. If the table is empty and `trades` rows exist, backfill: for each existing trade, derive its entry
   via `ledgerDeltaFromTrade` and insert it. Order does not matter (deltas are self-contained).
   Total-loss closes need no special handling — they are zero-price sells and derive correctly.
3. After backfill, compare derived totals to the legacy `portfolios` running totals and log any
   divergence (this surfaces pre-existing drift, which is useful to know rather than hide).

Non-destructive: no existing table or column is dropped or rewritten.

## Error handling

- Pre-write validation (insufficient cash/balance) unchanged; rejects before persistence.
- Any failure inside `recordTrade` rolls back the whole transaction.
- Verify is read-only and cannot mutate state.
- Float comparisons use a `1e-6` epsilon; existing `money.ts` helpers are reused where applicable.

## Testing

- **`ledger.test.ts`** (new):
  - `ledgerDeltaFromTrade` for buy, partial sell, full sell, and total-loss (zero-price sell).
  - Aggregation correctness (entries → portfolio totals and → positions, including multi-trade
    averaging and a fully-closed position).
  - The verify comparator flags an injected mismatch / missing entry while passing a consistent set.
- **`accounting.test.ts`**: unchanged (`accounting.ts` is not modified) and must stay green.
- Existing `accounting.test.ts`, `external.test.ts`, and other suites must stay green.
- Verification gate: `npm test` (per project convention) must pass before the work is considered
  done.

## Definition of done

- Manual execute, candidate copy, and total-loss each write a trade and a matching ledger entry in
  one transaction; a forced mid-write failure leaves no partial state.
- Portfolio and positions render identically to before for existing data, now derived from the
  ledger.
- `GET /api/ledger/verify` returns `ok: true` for a consistent database and reports specific
  mismatches when entries are tampered.
- Existing `paper-trader.db` is backfilled on first run with no data loss.
- All tests pass.
