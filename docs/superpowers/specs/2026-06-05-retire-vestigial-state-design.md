# Retire Vestigial Portfolio/Positions State — Design

Date: 2026-06-05

## Problem

Accounting is ledger-backed: cash, realized PnL, fees, and per-token positions are
derived on read by summing `ledger_entries` deltas. Several pieces of pre-ledger state
are still written but never read for truth, leaving a latent footgun where a future query
could read stale values:

- The `positions` table — created in the schema and cleared on reset, but never read.
  Both `listPositions()` and `getPosition()` derive from the ledger.
- `portfolios.cash_usd`, `portfolios.realized_pnl_usd`, `portfolios.fees_paid_usd` —
  written by the seed insert and the reset path, but `getPortfolio()` reads only
  `starting_cash_usd` and derives the rest.

This is Build Next item #4 in `NEXT_VERSION.md`. Doing it before the import/restore work
means fewer dead tables to reason about in the import bundle.

## What stays

- `portfolios.starting_cash_usd` — the ledger's baseline. Live.
- `trades.realized_pnl_usd` — legitimate per-trade data feeding `ledgerDeltaFromTrade`. Live.
- The export bundle shape and `schemaVersion: 1` — unchanged. Export's `positions` field
  is ledger-derived (`listPositions()`), so it keeps working with no schema bump.

## Approach: hard drop

Remove the vestigial state from the schema for new databases and physically drop it from
existing databases via migration, so no future query can read stale values. `node:sqlite`
supports `ALTER TABLE ... DROP COLUMN` and `DROP TABLE`. The dropped data is fully
derivable from the ledger, so the operation is safe and intentionally irreversible.

## Changes

Scope: `src/lib/db.ts`, `src/lib/repositories.ts`, and tests. No API or UI changes.

### 1. `db.ts` — schema (new databases)

- `portfolios` CREATE TABLE: remove `cash_usd`, `realized_pnl_usd`, `fees_paid_usd`.
  Keep `id`, `name`, `starting_cash_usd`, `created_at`, `updated_at`.
- Remove the `positions` CREATE TABLE block entirely.
- Seed insert: `(id, name, starting_cash_usd, created_at, updated_at)` only.

### 2. `db.ts` — migration (existing databases)

Add `dropVestigialState(database)`, called inside `migrate()` after the existing
`addColumnIfMissing` block and before `backfillLedger` (order is safe either way —
backfill only reads `trades`/`ledger_entries`):

- `DROP TABLE IF EXISTS positions`.
- Drop each of `cash_usd`, `realized_pnl_usd`, `fees_paid_usd` from `portfolios` via a
  new `dropColumnIfPresent(database, table, column)` helper that mirrors
  `addColumnIfMissing`: guard on `PRAGMA table_info`, then `ALTER TABLE ... DROP COLUMN`.

Both helpers are idempotent, so re-running `migrate()` is a no-op.

### 3. `repositories.ts` — `resetPaperPortfolio()`

- Remove `DELETE FROM positions`.
- The `portfolios` UPDATE no longer sets `cash_usd` / `realized_pnl_usd` / `fees_paid_usd`
  (those columns are gone); it only bumps `updated_at`. Behavior is identical: once
  `ledger_entries` is cleared, derived totals already collapse to `starting_cash_usd`.

### 4. Tests

- Add a migration test: open a DB, create an old-shape `positions` table and add the three
  `portfolios` columns, then run `migrate()` and assert via `PRAGMA` that the `positions`
  table is gone and the three columns are absent, and that `getPortfolio()` still returns
  correct derived totals.
- Existing export test (`backup.positions` derived) and `resetPaperPortfolio` test stay green.

## Risk and verification

`ALTER TABLE DROP COLUMN` rewrites the table — trivial cost for a local single-user SQLite
DB, and the dropped data is derivable, so it is safe and irreversible by design.

Verify with: `npm test`, `npx tsc --noEmit`, `npm run build`, plus a smoke check that the
dashboard portfolio summary and the "Ledger ✓ verified" badge still render against the
existing `data/paper-trader.db`.
