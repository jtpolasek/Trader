# Local Import/Restore Flow — Design

Date: 2026-06-05

## Problem

The app can export a schema-version-1 JSON bundle of all local simulator data
(`GET /api/export`, shipped in `26651fd`), but there is no way to load one back. Resets and
experiments are therefore one-way: once you reset the paper portfolio you cannot return to a
prior captured state. This is Build Next item #6 in `NEXT_VERSION.md`.

Build the matching import/restore flow: manual, guarded, validated, transactional, and
replace-all. After import the dashboard re-verifies the ledger and refreshes.

## Scope

A single user-triggered restore of a previously exported bundle into the local SQLite app.
No merge semantics, no partial/selective restore, no multi-file, no scheduling. Replace-all
only — the imported bundle becomes the complete local state.

## Bundle reference

The export bundle (`LocalDataExport`, `schemaVersion: 1`) carries both authoritative and
derived data. Import restores only the authoritative tables and ignores derived fields, which
the dashboard recomputes from the ledger:

- **Authoritative (restored):** `wallets`, `tokens`, `trades`, `ledgerEntries`, `quotes`,
  `walletActivity`, `tradeCandidates`, `settings`, and the portfolio baseline
  (`portfolio.name`, `portfolio.startingCashUsd`).
- **Derived / duplicated (ignored on import):** `positions` (derived from the ledger),
  `candidateAttention` (derived), the convenience top-level `copySettings` field (already
  carried inside the `settings` array under key `copy_settings`), the portfolio
  cash/realized-PnL/fees totals (derived), and the `app` / `exportedAt` metadata.

## Architecture

Three new units, mirroring the export split (`exportLocalData` + the per-collection
`*ForExport` helpers).

### `src/lib/importBundle.ts` (new) — pure validator

No database access; fully unit-testable.

- `parseImportBundle(input: unknown): ImportBundle` — validates with **zod** (already a
  project dependency). Enforces `schemaVersion === 1` and the shape of every authoritative
  collection and the portfolio baseline. Returns a typed `ImportBundle` or throws an `Error`
  with a descriptive message. Unknown/extra keys (the derived fields above) are stripped
  rather than rejected, so a full export validates cleanly while only authoritative data is
  retained.
- `summarizeImportBundle(bundle: ImportBundle): ImportSummary` — returns per-collection
  counts plus `startingCashUsd`. Shape:

  ```ts
  type ImportSummary = {
    wallets: number;
    tokens: number;
    trades: number;
    ledgerEntries: number;
    quotes: number;
    walletActivity: number;
    tradeCandidates: number;
    settings: number;
    startingCashUsd: number;
  };
  ```

`ImportBundle` types the authoritative collections using the existing row types
(`Wallet`, `Token`, `Trade`, `LedgerEntry`, `QuoteExport`, `WalletActivity`,
`TradeCandidate`, `SettingExport`) plus `{ portfolio: { name: string; startingCashUsd: number } }`.

### `importLocalData(bundle: ImportBundle)` in `repositories.ts` (new)

Sibling to `exportLocalData`. Performs the replace-all in one transaction and returns
`{ portfolio: Portfolio; summary: ImportSummary }`.

Transaction body (with `PRAGMA foreign_keys = ON`, already set in `db.ts`):

1. Delete child-first: `ledger_entries`, `quotes`, `trades`, `wallet_activity`,
   `trade_candidates`, `tokens`, `wallets`, `settings`.
2. Insert parent-first, preserving original IDs and timestamps from the bundle:
   `wallets`, `tokens`, `trades`, `ledger_entries`, `quotes`, `wallet_activity`,
   `trade_candidates`, `settings`.
3. Update the singleton `portfolios` row (`id = 'default'`): set `name`,
   `starting_cash_usd`, `updated_at`.

Preserving original trade IDs and ledger rows is what keeps `GET /api/ledger/verify`
matching after import (the verifier re-derives the expected delta per trade and compares to
the stored ledger entry). Inserts use the bundle's exact column values rather than generating
new IDs; this is distinct from the normal write path (`recordTrade`), which generates IDs.

Failure handling: any error (including an FK violation from an inconsistent bundle, e.g. a
trade referencing a token absent from `tokens`) rolls back the whole transaction via
`BEGIN` / `COMMIT` / `ROLLBACK`, leaving the database unchanged.

The positions table no longer exists (retired in the prior cleanup), so nothing positions-
related is written. No ledger backfill runs — `backfillLedger` only fires on a cold
`getDb()` when `ledger_entries` is empty, and import writes ledger rows directly.

### Routes

- `POST /api/import/preview` — read the JSON body, `parseImportBundle`, return
  `{ summary }`. No write.
- `POST /api/import` — read the JSON body, `parseImportBundle`, `importLocalData`, return
  `{ portfolio, summary }`.

Both call `parseImportBundle`, so validation lives in exactly one place. Routes stay thin;
the testable logic is in the lib functions. Each route wraps work in try/catch and returns
`{ error }` with status 400 on failure, matching the existing export/reset routes.

## Data flow (UI)

Mirrors the existing Export/Reset toolbar controls in `src/app/page.tsx`.

1. A hidden `<input type="file" accept="application/json">` plus an **"Import data"** button
   in the toolbar (next to "Export data").
2. On file pick: read the file text; `JSON.parse` it (catch → "File is not valid JSON.").
3. `POST /api/import/preview` with the parsed object. On non-OK, surface the server error.
4. `window.confirm` showing the summary, e.g.:

   ```
   Import will REPLACE all local data with the selected file:

   - 2 wallets
   - 5 tokens
   - 12 trades
   - 12 ledger entries
   - 8 quotes
   - 30 activity rows
   - 9 candidates
   - 1 settings
   Starting cash: $10,000

   This cannot be undone. Continue?
   ```

5. On confirm: `POST /api/import`. On success, set a message
   ("Imported N trades and restored local data. Ledger re-verified."), then run the existing
   `refresh()`, `refreshLedgerStatus()`, and the wallet/candidate reload so the dashboard
   reflects the imported state. Reset transient UI state (preview, copy results, loss offer)
   the same way the reset handler does.

Same `window.confirm` pattern as the existing reset control, so no new modal component.

## Error handling

`parseImportBundle` and the routes produce precise 400s, surfaced in the dashboard alert:

- Not JSON → "File is not valid JSON." (client-side, before any request)
- `schemaVersion !== 1` → "Unsupported export schemaVersion N. This app imports version 1."
- Missing or malformed collection/row → "Import file is not a valid version 1 export:
  <zod detail>."
- Transaction failure → "Import failed: <message>. No data was changed."

## Testing

- `src/lib/importBundle.test.ts` (new):
  - A valid full export bundle parses and yields the expected typed collections.
  - Wrong `schemaVersion` rejects with the unsupported-version message.
  - A missing collection rejects.
  - A malformed row (e.g. a trade with a non-numeric `quantity`) rejects.
  - `summarizeImportBundle` returns correct counts and `startingCashUsd`.
- `src/lib/repositories.test.ts` (extend):
  - **Round-trip:** populate a DB (token, wallet, trade via `recordTrade`, quote, activity,
    candidate, copy settings), `exportLocalData()`, then `importLocalData(parseImportBundle(bundle))`
    and re-export; assert deep-equality of all authoritative collections (ignoring
    `exportedAt`), and that `portfolio.startingCashUsd` matches.
  - **Replace:** seed a *different* pre-existing dataset, import the bundle, and assert the
    prior rows are gone and only the bundle's rows remain; assert the derived portfolio totals
    recompute from the imported ledger (cash/realized/fees consistent with the imported trades).

## Out of scope (future)

Merge/conflict semantics, selective restore, archive/named snapshots, and multi-portfolio
support remain in the Longer-Term list. This spec is the manual replace-all restore only.
