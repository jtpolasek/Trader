# Dashboard Trust Signals Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Surface total unrealized P&L in the top metrics row and add an opt-in auto-refresh price interval to the Positions panel.

**Architecture:** Both features are pure frontend changes to `src/app/page.tsx`. Feature 1 adds a `useMemo` that aggregates `positionPrices` React state and renders a 5th `<Metric>` cell. Feature 2 adds a `useState` for interval selection, a ref pattern to keep `fetchPositionPrices` current inside `setInterval`, and a `<select>` in the Positions panel header.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, lucide-react

---

## File Map

| File | Change |
|------|--------|
| `src/app/page.tsx` | All changes — Metric prop, useMemo, two useEffects, useRef, state, two UI additions |

---

## Task 1: Extend `Metric` with optional `valueClassName` prop

**Files:**
- Modify: `src/app/page.tsx:1607-1627`

The `Metric` component currently renders `<strong>{value}</strong>` with no CSS class. We need to color the unrealized P&L green or red. Add an optional `valueClassName` prop applied to `<strong>`.

- [x] **Step 1: Update the `Metric` function at the bottom of `src/app/page.tsx`**

Find this block (around line 1607):

```typescript
function Metric({
  icon,
  label,
  value,
  className = ""
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`metric ${className}`.trim()}>
      <span className="row">
        {label}
        {icon}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
```

Replace with:

```typescript
function Metric({
  icon,
  label,
  value,
  className = "",
  valueClassName = ""
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`metric ${className}`.trim()}>
      <span className="row">
        {label}
        {icon}
      </span>
      <strong className={valueClassName || undefined}>{value}</strong>
    </div>
  );
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add valueClassName prop to Metric component"
```

---

## Task 2: Add `TrendingUp` icon import and `totalUnrealizedPnlUsd` computed value

**Files:**
- Modify: `src/app/page.tsx:3-21` (lucide import)
- Modify: `src/app/page.tsx:242` (after last useMemo)

- [x] **Step 1: Add `TrendingUp` to the lucide-react import block**

Find the import block at lines 3–21:

```typescript
import {
  Activity,
  Archive,
  ArchiveRestore,
  BadgeDollarSign,
  Download,
  Eye,
  History,
  ListRestart,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Save,
  Target,
  Trash2,
  Upload,
  WalletCards
} from "lucide-react";
```

Replace with (add `TrendingUp` in alphabetical order):

```typescript
import {
  Activity,
  Archive,
  ArchiveRestore,
  BadgeDollarSign,
  Download,
  Eye,
  History,
  ListRestart,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Save,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  WalletCards
} from "lucide-react";
```

- [x] **Step 2: Add `totalUnrealizedPnlUsd` useMemo after the existing useMemos**

Find this line (around line 242):

```typescript
  const candidateStats = useMemo(() => getCandidateStats(candidates), [candidates]);
```

Add immediately after it:

```typescript
  const totalUnrealizedPnlUsd = useMemo(() => {
    if (!data?.positions.length || !Object.keys(positionPrices).length) return null;
    let total = 0;
    let priced = 0;
    for (const pos of data.positions) {
      const price = positionPrices[pos.tokenAddress];
      if (price !== undefined) {
        total += (price - pos.averageEntryUsd) * pos.quantity;
        priced++;
      }
    }
    return priced > 0 ? total : null;
  }, [data?.positions, positionPrices]);
```

**What this does:** Returns `null` when `positionPrices` is empty (no prices fetched yet). Otherwise sums `(currentPrice - averageEntryUsd) * quantity` for every position that has a known price. Returns `null` rather than `0` if no positions were matched (handles the edge case where positions exist but none have prices yet).

- [x] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass (no logic under test changed).

- [x] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: compute total unrealized P&L from position prices"
```

---

## Task 3: Render the Unrealized P&L metric in the top metrics row

**Files:**
- Modify: `src/app/page.tsx:963-968` (main metrics section)

- [x] **Step 1: Add the 5th Metric cell to the main metrics `<section>`**

Find the main metrics section (around line 963):

```typescript
      <section className="section grid dashboard-grid">
        <Metric icon={<BadgeDollarSign size={20} />} label="Cash" value={formatUsd(portfolio?.cashUsd ?? 0)} />
        <Metric icon={<Target size={20} />} label="Equity basis" value={formatUsd(stats?.equityUsd ?? 0)} />
        <Metric icon={<Activity size={20} />} label="Realized PnL" value={formatUsd(portfolio?.realizedPnlUsd ?? 0)} />
        <Metric icon={<History size={20} />} label="Fees paid" value={formatUsd(stats?.totalFeesUsd ?? 0)} />
      </section>
```

Replace with:

```typescript
      <section className="section grid dashboard-grid">
        <Metric icon={<BadgeDollarSign size={20} />} label="Cash" value={formatUsd(portfolio?.cashUsd ?? 0)} />
        <Metric icon={<Target size={20} />} label="Equity basis" value={formatUsd(stats?.equityUsd ?? 0)} />
        <Metric icon={<Activity size={20} />} label="Realized PnL" value={formatUsd(portfolio?.realizedPnlUsd ?? 0)} />
        <Metric icon={<History size={20} />} label="Fees paid" value={formatUsd(stats?.totalFeesUsd ?? 0)} />
        <Metric
          icon={<TrendingUp size={20} />}
          label="Unrealized P&L"
          value={totalUnrealizedPnlUsd !== null ? formatUsd(totalUnrealizedPnlUsd) : "—"}
          valueClassName={totalUnrealizedPnlUsd !== null ? (totalUnrealizedPnlUsd >= 0 ? "good" : "bad") : ""}
        />
      </section>
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [x] **Step 4: Start the dev server and visually verify the metric**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
- "Unrealized P&L" appears as a 5th cell in the top metrics row showing `—`.
- After clicking "Refresh prices" in the Positions panel, the cell updates to a green (gain) or red (loss) USD value.
- If there are no open positions, the cell stays `—` even after a price fetch attempt.

- [x] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: surface total unrealized P&L in top metrics row"
```

---

## Task 4: Add `autoRefreshInterval` state and `fetchPricesRef` stable ref

**Files:**
- Modify: `src/app/page.tsx:165` (state block)
- Modify: `src/app/page.tsx:233` (after stale-price useEffect)

`fetchPositionPrices` is an async function defined inside the component that closes over `data?.positions` and other state. If we pass it directly to `setInterval`, the interval will call a stale version of the function captured at registration time. The fix: a `useRef` that is kept current after every render via a side-effect-free `useEffect`. The interval always calls `fetchPricesRef.current()`, which is always the latest version.

- [x] **Step 1: Add `autoRefreshInterval` state after `isPricesStale` (line 165)**

Find:

```typescript
  const [isPricesStale, setIsPricesStale] = useState(false);
```

Add immediately after:

```typescript
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
```

- [x] **Step 2: Add `fetchPricesRef` declaration after `selectedArchiveId` state (line 178)**

Find:

```typescript
  const [selectedArchiveId, setSelectedArchiveId] = useState("");
```

Add immediately after (still inside the component, before the first `const refresh = ...`):

```typescript
  const fetchPricesRef = useRef<() => void>(() => {});
```

- [x] **Step 3: Add the two new useEffects after the stale-price useEffect (line 233)**

Find the end of the stale-price useEffect:

```typescript
  useEffect(() => {
    if (!pricesFetchedAt) return;
    const interval = setInterval(() => {
      if (isQuoteStale(pricesFetchedAt, Date.now(), 120_000)) setIsPricesStale(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [pricesFetchedAt]);
```

Add immediately after:

```typescript
  useEffect(() => { fetchPricesRef.current = fetchPositionPrices; });

  useEffect(() => {
    if (!autoRefreshInterval) return;
    const id = setInterval(() => fetchPricesRef.current(), autoRefreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefreshInterval]);
```

**Why two separate effects:** The first has no dependency array — it runs after every render to keep `fetchPricesRef.current` pointing at the latest `fetchPositionPrices` closure. The second is keyed only on `autoRefreshInterval` — it registers/clears the timer when the interval changes.

- [x] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add auto-refresh interval state and stable fetchPrices ref"
```

---

## Task 5: Add interval `<select>` to the Positions panel header

**Files:**
- Modify: `src/app/page.tsx:1382-1394` (Positions panel header)

- [x] **Step 1: Add the `<select>` to the Positions panel header row**

Find the Positions panel header (around line 1382):

```typescript
            <div className="row">
              <h2>Positions</h2>
              <span className="pill">{data?.positions.length ?? 0} open</span>
              <button
                className="button secondary"
                onClick={() => fetchPositionPrices()}
                disabled={busy === "prices" || !data?.positions.length}
                title="Fetch current prices for open positions"
              >
                {busy === "prices" ? <Loader2 size={18} /> : <RefreshCw size={18} />}
                Refresh prices
              </button>
            </div>
```

Replace with:

```typescript
            <div className="row">
              <h2>Positions</h2>
              <span className="pill">{data?.positions.length ?? 0} open</span>
              <select
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                disabled={!data?.positions.length}
                title="Auto-refresh interval for position prices"
              >
                <option value={0}>Manual</option>
                <option value={60}>1 min</option>
                <option value={120}>2 min</option>
                <option value={300}>5 min</option>
              </select>
              <button
                className="button secondary"
                onClick={() => fetchPositionPrices()}
                disabled={busy === "prices" || !data?.positions.length}
                title="Fetch current prices for open positions"
              >
                {busy === "prices" ? <Loader2 size={18} /> : <RefreshCw size={18} />}
                Refresh prices
              </button>
            </div>
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [x] **Step 4: Verify the build passes**

```bash
npm run build
```

Expected: build succeeds with no TypeScript or Next.js errors.

- [x] **Step 5: Start the dev server and verify the full feature end-to-end**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:

1. **Interval select renders** in the Positions panel header, left of "Refresh prices". Default is "Manual".
2. **Disabled when no positions**: if the portfolio has no open positions, the select is greyed out.
3. **Auto-refresh works**: select "1 min", wait ~60 seconds. The "Unrealized P&L" top metric updates (or the stale warning clears if it had fired). Dev tools Network tab should show a `/api/prices` request every 60 seconds.
4. **Manual button still works**: click "Refresh prices" while auto-refresh is active — it fires immediately without disrupting the interval timer.
5. **Switching interval**: change from "1 min" to "5 min" — the old timer clears, the new 5-minute timer starts.
6. **Stopping**: select "Manual" — no more automatic `/api/prices` requests.
7. **Stale warning**: set to "Manual", wait 2+ minutes after a fetch — the stale warning still fires.
8. **Unrealized P&L `—` on load**: reload the page — the top metrics row shows `—` for Unrealized P&L. Select "1 min"; after the first auto-fetch fires, the cell populates with a colored value.

- [x] **Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add auto-refresh interval selector to Positions panel"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `totalUnrealizedPnlUsd` useMemo (Task 2)
- ✅ `Metric` `valueClassName` prop (Task 1)
- ✅ 5th Metric cell with `TrendingUp` icon, green/red coloring (Task 3)
- ✅ `—` display when null / prices not fetched (Task 3)
- ✅ `autoRefreshInterval` state defaulting to 0 (Task 4)
- ✅ `fetchPricesRef` stable ref + syncing effect (Task 4)
- ✅ Interval effect keyed on `autoRefreshInterval` (Task 4)
- ✅ `<select>` with Manual / 1 min / 2 min / 5 min options (Task 5)
- ✅ Select disabled when no positions (Task 5)
- ✅ Manual "Refresh prices" button preserved (Task 5)
- ✅ `isPricesStale` stale warning unaffected (no changes to that effect)

**No placeholders present.**

**Type consistency:**
- `totalUnrealizedPnlUsd: number | null` — consistent across Task 2 (computed) and Task 3 (rendered)
- `autoRefreshInterval: number` — consistent across Task 4 (state) and Task 5 (select value/onChange)
- `fetchPricesRef: MutableRefObject<() => void>` — consistent across Task 4 (declaration) and Task 4 (effects)
- `valueClassName?: string` — consistent across Task 1 (Metric prop) and Task 3 (usage)
