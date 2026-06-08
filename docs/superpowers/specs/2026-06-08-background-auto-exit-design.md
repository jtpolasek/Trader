# Design: Background Auto-Exit (TP/SL)

**Date:** 2026-06-08
**Scope:** True background take-profit / stop-loss auto-exit that fires while the Next.js server is running, independent of whether the dashboard tab is open.

---

## Overview

Open positions are currently exited only by manual user action. This feature adds a background worker — running inside the Next.js process via `instrumentation.ts` — that periodically checks open position prices against configurable thresholds and automatically executes sell trades when they are crossed.

Global default rules (TP%, SL%, exit size%, check interval) are stored in the existing `settings` table. Exit failures are also stored there, surfaced on affected position cards, and dismissible by the user.

No new process, no new dependencies, no schema migration. The worker reuses `getZeroxPrice`, `buildQuotePreview`, and `recordTrade` — the same path as manual sells.

---

## Data Model

Two new entries in the existing `settings` table (key/value JSON, same pattern as copy settings). No migration required.

### `exit_rules` key

```ts
type ExitRules = {
  enabled: boolean;
  takeProfitPct: number | null;  // null = disabled; 50 → exit when up 50%
  stopLossPct: number | null;    // null = disabled; 20 → exit when down 20%
  exitSizePct: number;           // 1–100, percentage of position quantity to sell
  checkIntervalSecs: number;     // 30 | 60 | 120 | 300 | 600
}
```

Default (when key is absent): `{ enabled: false, takeProfitPct: null, stopLossPct: null, exitSizePct: 100, checkIntervalSecs: 60 }`.

### `exit_failures` key

```ts
type ExitFailure = {
  tokenAddress: string;
  chainId: number;
  symbol: string;
  reason: string;
  failedAt: string;  // ISO timestamp
}
// stored as ExitFailure[]
```

The worker skips any position whose `tokenAddress` appears in this array. The position stays skipped until the user dismisses the failure, which removes the entry and allows the next tick to retry.

---

## New Files

| File | Purpose |
|---|---|
| `src/instrumentation.ts` | Next.js startup hook; registers the base 30s interval |
| `src/lib/exitWorker.ts` | Core check-and-execute logic; independently testable |
| `src/lib/exitWorker.test.ts` | Unit + integration tests |
| `src/app/api/settings/exit-rules/route.ts` | GET/POST exit rules |
| `src/app/api/settings/exit-failures/[tokenAddress]/route.ts` | DELETE to dismiss a failure |

---

## Worker Logic (`exitWorker.ts`)

### Module-level state

```ts
const pendingExits = new Set<string>();  // token addresses currently being processed
let lastCheckedAt = 0;                   // ms timestamp
```

`pendingExits` prevents two concurrent price fetches from both deciding to exit the same position. Safe as a plain `Set` because we're single-process and the guard only needs to survive the duration of one async check cycle.

### `runExitCheck()` flow

```
1. Read exit_rules from settings.
   Return early if:
   - enabled is false
   - both takeProfitPct and stopLossPct are null
   - Date.now() − lastCheckedAt < checkIntervalSecs × 1000

2. Set lastCheckedAt = Date.now().

3. Read exit_failures from settings (default []).

4. Derive open positions via getPositions() (existing ledger-derived helper).
   Filter to: quantity > 0, tokenAddress not in pendingExits, tokenAddress not in exit_failures.

5. If no positions remain after filtering, return.

6. Fetch prices for all filtered positions in parallel via getZeroxPrice,
   grouped by chainId (same Promise.allSettled pattern as /api/prices route).

7. For each fulfilled price result:
   pnlPct = (currentPrice − position.averageEntryUsd) / position.averageEntryUsd × 100

   trigger = 'tp' if takeProfitPct !== null && pnlPct >= takeProfitPct
           | 'sl' if stopLossPct !== null && pnlPct <= −stopLossPct
           | null

   If trigger is null: skip.

8. For each triggered position (run in parallel):
   a. Add tokenAddress to pendingExits.
   b. tokenQuantity = position.quantity × (exitSizePct / 100)
   c. Call buildQuotePreview({ side: 'sell', token, tokenQuantity, chainId })
   d. Call recordTrade with quoteSnapshot extended:
      { ...snapshot, autoExit: true, trigger: 'tp'|'sl', triggerPct: pnlPct }
   e. On success: remove tokenAddress from pendingExits.
   f. On failure: remove tokenAddress from pendingExits,
                  append ExitFailure to exit_failures in settings.
```

### `startExitWorker()` (called from `instrumentation.ts`)

Sets up `setInterval(runExitCheck, 30_000)`. The 30-second base is fixed in code; `checkIntervalSecs` in settings controls actual work frequency via the `lastCheckedAt` guard. Interval setting changes from the UI take effect within 30 seconds without a server restart.

---

## `instrumentation.ts`

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startExitWorker } = await import('./lib/exitWorker');
    startExitWorker();
  }
}
```

The dynamic import is required — static top-level imports of SQLite-touching modules crash at this initialization stage. The `NEXT_RUNTIME` guard prevents the worker from starting in the edge runtime.

---

## API Routes

### `GET /api/settings/exit-rules`
Returns current `ExitRules` from settings, or safe defaults if the key is absent.

### `POST /api/settings/exit-rules`
Validates and writes `ExitRules` to settings. Zod schema enforces:
- `exitSizePct` between 1 and 100
- `checkIntervalSecs` in `[30, 60, 120, 300, 600]`
- `takeProfitPct` / `stopLossPct` null or positive number

### `DELETE /api/settings/exit-failures/[tokenAddress]`
Reads `exit_failures` array, removes the entry matching `tokenAddress`, writes back. Returns 404 if no matching entry exists.

---

## UI

### Exit Rules settings panel

New collapsible section in the existing dashboard settings area, below copy settings:

- **Enabled** toggle
- **Take profit %** number input (blank = disabled)
- **Stop loss %** number input (blank = disabled)
- **Exit size %** number input (1–100)
- **Check interval** selector: 30s / 1m / 2m / 5m / 10m
- **Save** button → POST to `/api/settings/exit-rules`

On load: `GET /api/settings/exit-rules` populates the form.

### Position cards

Small status line added below existing price/PnL cells:

- Rules enabled, no failure: `Watching: TP +50% / SL −20%` in muted text (omits whichever threshold is null)
- Entry in `exit_failures` for this token: amber inline alert — `Auto-exit failed: [reason]` + **Dismiss** button → `DELETE /api/settings/exit-failures/[tokenAddress]` → reload

### Trade history badges

`getTradeSignals` (or equivalent snapshot-reading helper) checks for `autoExit: true` in the stored `quoteSnapshot`:
- `trigger === 'tp'` → green `Auto-exit TP` badge
- `trigger === 'sl'` → red `Auto-exit SL` badge

No new badge infrastructure needed — follows the existing warning badge pattern.

---

## SQLite Concurrency

WAL mode is already enabled (`db.ts:15`). The worker shares the same `DatabaseSync` singleton as API routes. `node:sqlite` writes are synchronous and serialize naturally; WAL allows concurrent reads. No additional locking is needed.

---

## Testing (`exitWorker.test.ts`)

### Pure unit tests (no DB, no network)

- TP fires when `pnlPct >= takeProfitPct`; does not fire when just below
- SL fires when `pnlPct <= −stopLossPct`; does not fire when just above
- Both thresholds null → no trigger
- `exitSizePct: 50` with `quantity: 1000` → `tokenQuantity: 500`
- Interval guard: `runExitCheck` returns early when `now − lastCheckedAt < checkIntervalSecs × 1000`

### Integration tests (real SQLite, mocked `getZeroxPrice` + `buildQuotePreview`)

- `enabled: false` → no trades executed
- Position in `exit_failures` → skipped, no trade
- `pendingExits` entry → position skipped for that tick
- TP threshold crossed → `recordTrade` called; `quoteSnapshot` includes `autoExit: true, trigger: 'tp'`
- SL threshold crossed → same with `trigger: 'sl'`
- `buildQuotePreview` throws → failure written to `exit_failures`; `recordTrade` not called
- Dismiss route removes correct entry from `exit_failures`; other entries unaffected

### Existing tests unaffected

No changes to `accounting.ts`, `ledger.ts`, `copy.ts`, `zerox.ts`, or their test files.

---

## Out of Scope

- Per-position exit rule overrides (global defaults only in this iteration)
- Multiple TP tiers (e.g., sell 50% at TP1, remainder at TP2)
- Auto-buy / entry triggers
- Worker running when the Next.js server is not running (requires a separate OS-level scheduler)
- Push notifications when an auto-exit fires
