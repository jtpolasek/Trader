# Design: Dashboard Trust Signals Quick Wins

**Date:** 2026-06-07
**Scope:** Build Next #5 follow-ons B — two pure-frontend enhancements to the Positions panel and top metrics row.

---

## Overview

Two independent features that share no data flow:

1. **Unrealized P&L in the top metrics row** — surface total open gain/loss in the main financial snapshot row using already-fetched `positionPrices` React state.
2. **Auto-refresh prices** — let the user opt into a recurring price fetch at 1 / 2 / 5 minute intervals instead of clicking "Refresh prices" manually every time.

No backend changes. No schema changes. No new API routes.

---

## Feature 1: Unrealized P&L in the Top Metrics Row

### Motivation

`positionPrices` is already fetched and held in React state. The per-card unrealized P&L is visible in the Positions panel, but the top-row financial snapshot (Cash, Equity basis, Realized PnL, Fees paid) has no aggregate open gain/loss figure. Adding it there gives the user an at-a-glance total without scrolling.

### Computed Value

A new `useMemo` — `totalUnrealizedPnlUsd` — aggregates across all open positions:

```
totalUnrealizedPnlUsd = sum over positions where positionPrices[pos.tokenAddress] is defined:
  (positionPrices[pos.tokenAddress] - pos.averageEntryUsd) * pos.quantity
```

Returns `null` when `positionPrices` has no entries (prices not yet fetched). Returns a number (possibly negative) otherwise, even if only a subset of positions have prices.

### Metric Component Change

`Metric` currently renders `<strong>{value}</strong>` with no color support. Add an optional `valueClassName?: string` prop that is applied to that `<strong>`. This is a 3-line change to the component. Existing callsites are unaffected (prop is optional, default `""`).

### UI

A 5th `<Metric>` appended to the existing `dashboard-grid` section:

- **Label:** `Unrealized P&L`
- **Icon:** `TrendingUp` (lucide-react, already in the package)
- **Value:** `formatUsd(totalUnrealizedPnlUsd)` when not null; `"—"` when null
- **`valueClassName`:** `"good"` when value ≥ 0, `"bad"` when value < 0, `""` when null

The `"good"` / `"bad"` CSS classes are already used by `UnrealizedPnl` and the existing trade history coloring, so no new CSS is needed.

The grid currently has 4 cells. A 5th will reflow to a second row on narrow viewports; this is acceptable and consistent with how other grid sections handle overflow.

### Display Invariant

The metric shows `"—"` until the user fetches prices (manually or via auto-refresh). It never shows a stale value across sessions — `positionPrices` is ephemeral React state that resets on page load, so `totalUnrealizedPnlUsd` is always `null` until prices are explicitly fetched in the current session.

---

## Feature 2: Auto-Refresh Prices

### Motivation

The manual "Refresh prices" button works but requires the user to remember to click it. An opt-in interval lets active sessions stay current without attention.

### State

One new `useState<number>`: `autoRefreshInterval`, initialized to `0` (off). Values: `0` (manual), `60`, `120`, `300` (seconds).

### Stable Ref Pattern

`fetchPositionPrices` is defined inside the component and closes over `data?.positions` and other state. Passing it directly to `setInterval` would capture a stale closure on the first render. The fix: a `useRef<() => void>` named `fetchPricesRef`, kept current via a dependency-free `useEffect`:

```typescript
const fetchPricesRef = useRef<() => void>(() => {});
useEffect(() => { fetchPricesRef.current = fetchPositionPrices; });
```

The interval calls `fetchPricesRef.current()`, which always invokes the latest version of the function.

### Interval Effect

```typescript
useEffect(() => {
  if (!autoRefreshInterval) return;
  const id = setInterval(() => fetchPricesRef.current(), autoRefreshInterval * 1000);
  return () => clearInterval(id);
}, [autoRefreshInterval]);
```

- Keyed on `autoRefreshInterval` only — starts when non-zero, clears and restarts when interval changes, clears on component unmount.
- Does not run when `autoRefreshInterval === 0`.
- Does not suppress the stale-price warning: if a fetch completes but another 2 minutes pass without a new fetch completing, `isPricesStale` still fires as before.

### UI

In the Positions panel header `div.row`, add a `<select>` to the right of the "Refresh prices" button:

```
[ Manual ▾ ]   [ Refresh prices ]
```

Options:
| Label    | Value |
|----------|-------|
| Manual   | 0     |
| 1 min    | 60    |
| 2 min    | 120   |
| 5 min    | 300   |

- Selecting anything other than "Manual" starts auto-refresh immediately (the effect fires on state change).
- Selecting "Manual" stops it.
- Disabled when `data?.positions.length === 0` (nothing to price).
- No label text — the options are self-explanatory in context.

### Interaction with Existing Controls

- The manual "Refresh prices" button stays. Users can still trigger an immediate fetch at any time.
- The existing `isPricesStale` stale warning remains unchanged — it fires 2 minutes after the last completed fetch regardless of whether auto-refresh is active.
- `autoRefreshInterval` is not persisted (ephemeral React state). It resets to "Manual" on page reload, which is correct: the user opts in per session.

---

## Files Changed

All changes are confined to `src/app/page.tsx`:

1. Add `TrendingUp` to the lucide-react import.
2. Add `useState` for `autoRefreshInterval`.
3. Add `useRef` for `fetchPricesRef` and its synchronizing `useEffect`.
4. Add `useEffect` for the auto-refresh interval (keyed on `autoRefreshInterval`).
5. Add `useMemo` for `totalUnrealizedPnlUsd`.
6. Extend `Metric` with optional `valueClassName` prop.
7. Add 5th `<Metric>` to the main metrics row.
8. Add `<select>` to the Positions panel header.

No new files. No test changes required (all logic is derived display state with no new pure functions).

---

## Definition of Done

- Top metrics row shows "Unrealized P&L" as `—` on load, then green/red once prices are fetched.
- `autoRefreshInterval` select renders in the Positions panel header; choosing 1/2/5 min triggers repeated price fetches at that cadence.
- Manual "Refresh prices" button continues to work independently.
- `isPricesStale` warning still fires 2 minutes after last fetch.
- `npx tsc --noEmit` passes.
- `npm test` stays green (no logic changes to tested paths).
- `npm run build` passes.
