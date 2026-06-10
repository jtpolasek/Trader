# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle and reorganize the dashboard into a dense, dark, two-column terminal layout per `docs/superpowers/specs/2026-06-09-ui-redesign-design.md`, without changing any behavior, state logic, or API.

**Architecture:** Presentation-only refactor. `src/app/page.tsx` keeps all state/hooks/fetchers; JSX blocks move verbatim into presentational components under `src/components/` that receive props. `src/app/globals.css` is rewritten around CSS design tokens (obsidian dark theme). No new dependencies.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, plain CSS with custom properties, vitest.

**Verification used by every task:** `npx tsc --noEmit` (expect no output), `npm test` (expect 178+ passing), and visual check via `npm run dev` → screenshot of http://localhost:3000 (compare against the previous task's screenshot; all panels render, no missing data).

**Hard constraints (from spec):**
- Do NOT touch: `src/lib/copyWorker.ts`, any `src/app/api/**` route, `useInterval`, the refresh functions, or the auto-copy kill-switch warning logic.
- Every conditional render branch in moved JSX is preserved verbatim.
- Position cards keep ALL current stats (quantity, avg entry, cost basis, fees, current value, unrealized P&L) and the Sell + Mark-loss actions.

---

### Task 1: Design tokens and dark base theme in globals.css

**Files:**
- Modify: `src/app/globals.css` (the `:root` block and `body`/base element styles at the top of the file)

- [ ] **Step 1: Replace the `:root` variable block** at the top of `globals.css` with the token system. Keep any existing variable *names* that are referenced elsewhere in the file by mapping them to the new values (grep each old `--name` before deleting it; if it's used, keep it as an alias line, e.g. `--old-name: var(--panel);`).

```css
:root {
  --bg: #020617;
  --panel: #0f172a;
  --panel-2: #0b1222;
  --border: #1e293b;
  --border-strong: #334155;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --faint: #64748b;
  --accent: #2dd4bf;
  --accent-strong: #0d9488;
  --gain: #34d399;
  --loss: #fb7185;
  --warn: #fbbf24;
  --gain-bg: rgba(52, 211, 153, 0.1);
  --loss-bg: rgba(251, 113, 133, 0.1);
  --warn-bg: rgba(251, 191, 36, 0.1);
  --radius: 8px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --font-mono: ui-monospace, "Cascadia Code", Consolas, monospace;
  --fs-body: 13px;
  --fs-small: 11px;
  --fs-label: 10px;
}
```

- [ ] **Step 2: Restyle the base elements** — set `body { background: var(--bg); color: var(--text); font-size: var(--fs-body); }`, then walk the existing rules for `.panel`, `.card`, `.pill`, `.button`, `.icon-button`, inputs/selects/textareas, and tables, replacing hardcoded light colors with tokens (`var(--panel)` backgrounds, `var(--border)` borders, `var(--muted)` secondary text, `var(--gain)`/`var(--loss)`/`var(--warn)` for `.good`/`.bad`/`.warn` pill variants with the `*-bg` backgrounds). Reduce paddings one step on `.panel` and `.card` (e.g. 20px→12px) and label font sizes to `var(--fs-label)` uppercase.

- [ ] **Step 3: Verify visually.** Run `npm run dev`, screenshot http://localhost:3000. Expected: whole app dark, all text readable, pills colored correctly. Fix any unreadable hardcoded colors found.

- [ ] **Step 4: Run checks.** `npx tsc --noEmit` (no output) and `npm test` (all pass — CSS shouldn't affect them; this guards accidental file touches).

- [ ] **Step 5: Commit.**

```bash
git add src/app/globals.css
git commit -m "feat: dark obsidian design-token theme in globals.css"
```

---

### Task 2: Topbar with inline metric strip and overflow menu

**Files:**
- Create: `src/components/Topbar.tsx`, `src/components/MetricStrip.tsx`
- Modify: `src/app/page.tsx` (header at the `<header className="topbar">` block, the two metric `<section className="section grid dashboard-grid">` blocks, and the `Trust signals` panel), `src/app/globals.css`

The current page renders: topbar (brand, ledger pill, Refresh, interval select, Import/Export/Reprocess/Archive/Reset buttons), then two full-width metric grids (`dashboard-grid` and `dashboard-grid trust-strip`), then a separate "Trust signals" panel. These collapse into one slim sticky topbar + one thin metric strip.

- [ ] **Step 1: Create `MetricStrip.tsx`.** A presentational component that renders one horizontal, wrapping strip of small label/value pairs. Reuse the value-formatting already done at the call site — it receives ready-to-render strings:

```tsx
export type MetricItem = { label: string; value: string; tone?: "gain" | "loss" | "muted" };

export function MetricStrip({ items }: { items: MetricItem[] }) {
  return (
    <div className="metric-strip">
      {items.map((item) => (
        <span key={item.label} className="metric-item">
          <span className="metric-label">{item.label}</span>
          <span className={`metric-value${item.tone ? ` ${item.tone}` : ""}`}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `Topbar.tsx`.** Move the existing topbar JSX (brand block, ledger pill, Refresh button, dashboard-interval `<select>` and hidden import `<input>`) into it verbatim, plus a `<details className="overflow-menu">` containing the existing Import / Export / Reprocess / Archive / Reset buttons (move their JSX verbatim — including the `Reset` confirm flow which lives in the handler, not the JSX). Props are exactly the values/handlers those JSX blocks already reference, e.g.:

```tsx
export function Topbar(props: {
  ledgerOk: { ok: boolean; count: number } | null;
  busy: string;
  dashboardRefreshInterval: number;
  refreshOptions: { seconds: number; label: string }[];
  onRefresh: () => void;
  onIntervalChange: (seconds: number) => void;
  metricItems: MetricItem[];
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImportFile: (file: File) => void;
  onExport: () => void;
  onReprocess: () => void;
  onArchive: () => void;
  onReset: () => void;
}) { /* moved JSX + <MetricStrip items={props.metricItems} /> */ }
```

(If a moved block references a prop not listed here, add it to the props rather than restructuring the JSX.)

- [ ] **Step 3: Wire it in `page.tsx`.** Replace the `<header>` and both metric sections and the Trust signals panel with `<Topbar …/>`, building `metricItems` from the same expressions the old `Metric`/`Mini` calls used: Cash, Equity basis, Realized PnL (tone loss/gain), Unrealized P&L, Fees paid, Win rate, Fee drag, Open exposure, Avg hold, Best token, Worst token. Delete the now-unused `Metric` component if nothing references it (`UnrealizedPnl`/`Mini` may still be used elsewhere — grep first).

- [ ] **Step 4: Style.** In `globals.css` add:

```css
.topbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); background: color-mix(in srgb, var(--bg) 80%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
.metric-strip { display: flex; flex-wrap: wrap; gap: var(--space-3); font-size: var(--fs-small); }
.metric-item { display: inline-flex; gap: var(--space-1); align-items: baseline; }
.metric-label { color: var(--faint); text-transform: uppercase; font-size: var(--fs-label); }
.metric-value { font-variant-numeric: tabular-nums; }
.metric-value.gain { color: var(--gain); } .metric-value.loss { color: var(--loss); }
.overflow-menu { position: relative; } .overflow-menu > summary { list-style: none; cursor: pointer; }
.overflow-menu[open] > .overflow-items { position: absolute; right: 0; top: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-1); z-index: 30; }
```

- [ ] **Step 5: Verify.** `npx tsc --noEmit`, `npm test`, dev-server screenshot: sticky slim topbar, all 11 metrics readable in the strip, overflow menu opens with the 5 actions, Reset still confirms.

- [ ] **Step 6: Commit.**

```bash
git add src/components/Topbar.tsx src/components/MetricStrip.tsx src/app/page.tsx src/app/globals.css
git commit -m "feat: sticky topbar with inline metric strip and overflow menu"
```

---

### Task 3: Two-column grid and panel reordering

**Files:**
- Modify: `src/app/page.tsx` (the `<section className="section grid main-grid">` block), `src/app/globals.css` (`.main-grid` rules and the `nth-child` span rules)

- [ ] **Step 1: Reorder panels in `page.tsx`** into two explicit stacks (move whole panel JSX blocks; do not edit their internals):

```tsx
<section className="main-grid">
  <div className="stack stack-primary">
    {/* Positions panel (currently after Trust signals) */}
    {/* Candidate attention strip + Wallet activity / candidates panel */}
    {/* Past trades panel — wrap in <details className="panel collapsible-panel"> with <summary><h2>Past trades</h2></summary> if not already collapsible */}
  </div>
  <div className="stack stack-secondary">
    {/* Watchlist panel */}
    {/* Wallet activity feed portion stays inside its existing panel */}
    {/* Trade ticket panel — wrap in collapsible-panel (collapsed by default) */}
    {/* Copy settings, Auto-exit rules — already collapsible panels */}
    {/* Paper archives block */}
  </div>
</section>
```

- [ ] **Step 2: Replace the `.main-grid` CSS** (delete the old `nth-child` span rules):

```css
.main-grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-3); align-items: start; padding: var(--space-3) var(--space-4); }
.stack { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
@media (max-width: 1100px) { .main-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit`, `npm test`, screenshot: positions top-left, watchlist top-right, collapsed panels show only their summary rows, nothing rendered twice or lost (count the panels: Positions, Candidates/Activity, Past trades left; Watchlist, Trade ticket, Copy settings, Auto-exit, Archives right).

- [ ] **Step 4: Commit.**

```bash
git add src/app/page.tsx src/app/globals.css
git commit -m "feat: two-column dashboard grid with prioritized panel order"
```

---

### Task 4: Compact position cards

**Files:**
- Create: `src/components/PositionsPanel.tsx` (contains `PositionsPanel` and `PositionCard`)
- Modify: `src/app/page.tsx` (the Positions panel block), `src/app/globals.css`

- [ ] **Step 1: Create `PositionsPanel.tsx`.** Move the Positions panel JSX (header row with count pill, price auto-refresh `<select>`, Refresh-prices button, stale indicator, and the per-position card mapping) into it. Keep every existing expression (per-position price lookup from `positionPrices`, unrealized P&L computation, Mark-loss conditional, busy states) verbatim, but re-lay each card to the compact structure:

```tsx
<article className="position-card" key={position.tokenAddress}>
  <div className="position-head">
    <span><b>{position.symbol}</b> <span className="mono faint">{shortAddress(position.tokenAddress)}</span></span>
    {/* existing unrealized P&L element, tone class gain/loss */}
  </div>
  <dl className="position-stats">
    {/* existing five stats as <div><dt>Qty</dt><dd>…</dd></div> pairs:
        quantity, avg entry, cost basis, fees, current value */}
  </dl>
  <div className="position-actions">
    {/* Sell button: calls the existing handler that prefills tradeForm for this token (same code the current card uses) */}
    {/* existing Mark loss button + its conditional, verbatim */}
  </div>
</article>
```

Props: `positions`, `positionPrices`, `pricesFetchedAt`, `isPricesStale`, `busy`, `autoRefreshInterval`, `onAutoRefreshChange`, `onRefreshPrices`, `onSell(position)`, `onMarkLoss(position)` — i.e., whatever the moved JSX already references; pass it down rather than restructuring.

- [ ] **Step 2: Style** in `globals.css`:

```css
.positions-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
@media (max-width: 1400px) { .positions-grid { grid-template-columns: 1fr; } }
.position-card { background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2) var(--space-3); }
.position-head { display: flex; justify-content: space-between; align-items: baseline; }
.position-stats { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: var(--space-2) 0; font-size: var(--fs-small); }
.position-stats dt { color: var(--faint); text-transform: uppercase; font-size: var(--fs-label); display: inline; }
.position-stats dd { display: inline; margin: 0 0 0 var(--space-1); font-variant-numeric: tabular-nums; }
.position-actions { display: flex; gap: var(--space-2); }
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit`, `npm test`, screenshot with the real open position: card ~half previous height, all six stats present, Sell prefills the trade ticket (click it and check the ticket), Mark loss still appears for losing positions.

- [ ] **Step 4: Commit.**

```bash
git add src/components/PositionsPanel.tsx src/app/page.tsx src/app/globals.css
git commit -m "feat: compact 2-up position cards"
```

---

### Task 5: Watchlist leaderboard with derived stats

**Files:**
- Create: `src/components/WatchlistPanel.tsx`
- Test: `src/components/walletStats.test.ts`
- Create: `src/components/walletStats.ts`
- Modify: `src/app/page.tsx` (Watchlist panel block), `src/app/globals.css`

- [ ] **Step 1: Write the failing test** for the derived-stats helper:

```ts
import { describe, expect, it } from "vitest";
import { deriveWalletStats } from "./walletStats";

const W = "0x1234560000000000000000000000000000000001";

describe("deriveWalletStats", () => {
  it("counts candidates, copied candidates, and newest activity per wallet", () => {
    const stats = deriveWalletStats(
      [
        { walletAddress: W, lastCopyStatus: "copied" },
        { walletAddress: W, lastCopyStatus: null },
        { walletAddress: "0xother", lastCopyStatus: "copied" }
      ] as never,
      [
        { wallet: W, timestamp: "2026-06-08T10:00:00Z" },
        { wallet: W, timestamp: "2026-06-09T10:00:00Z" }
      ] as never
    );
    expect(stats.get(W)).toEqual({ candidates: 2, copied: 1, lastSeen: "2026-06-09T10:00:00Z" });
    expect(stats.get("0xother")?.candidates).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify failure.** `npx vitest run src/components/walletStats.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement `walletStats.ts`:**

```ts
import type { TradeCandidate, WalletActivity } from "@/lib/types";

export type WalletStats = { candidates: number; copied: number; lastSeen: string | null };

export function deriveWalletStats(
  candidates: Pick<TradeCandidate, "walletAddress" | "lastCopyStatus">[],
  activity: Pick<WalletActivity, "wallet" | "timestamp">[]
): Map<string, WalletStats> {
  const stats = new Map<string, WalletStats>();
  const get = (address: string) => {
    const key = address.toLowerCase();
    let entry = stats.get(key);
    if (!entry) {
      entry = { candidates: 0, copied: 0, lastSeen: null };
      stats.set(key, entry);
    }
    return entry;
  };
  for (const candidate of candidates) {
    const entry = get(candidate.walletAddress);
    entry.candidates += 1;
    if (candidate.lastCopyStatus === "copied") entry.copied += 1;
  }
  for (const item of activity) {
    const entry = get(item.wallet);
    if (!entry.lastSeen || item.timestamp > entry.lastSeen) entry.lastSeen = item.timestamp;
  }
  return stats;
}
```

Check `src/lib/types.ts` for the real field names (`walletAddress`, `lastCopyStatus`, `wallet`, `timestamp`) and adjust the Pick keys if they differ — the test must use the real names too. Note the test calls `stats.get(W)` with a lowercase-hex address; keys are lowercased.

- [ ] **Step 4: Run the test — expect PASS.** Also run `npm test` (everything passes).

- [ ] **Step 5: Create `WatchlistPanel.tsx`.** Move the Watchlist panel JSX into it, replacing the per-wallet `<article className="card wallet-card">` mapping with a table; everything else (panel header, master-switch warning paragraph, add-wallet `<details>` form) moves verbatim. The master auto-copy switch in the header reuses the existing `copySettingsForm.autoCopy` checkbox + its existing submit handler from the Copy settings form (pass both down; do not duplicate the update logic).

```tsx
<table className="watchlist-table">
  <thead><tr><th>Wallet</th><th>Cands</th><th>Copied</th><th>Last seen</th><th>Copy</th><th></th></tr></thead>
  <tbody>
    {wallets.map((wallet) => {
      const stat = stats.get(wallet.address.toLowerCase());
      return (
        <tr key={wallet.address}>
          <td><b>{wallet.label}</b> <span className="mono faint">{shortAddress(wallet.address)}</span></td>
          <td>{stat?.candidates ?? 0}</td>
          <td className={stat?.copied ? "gain" : ""}>{stat?.copied ?? 0}</td>
          <td>{stat?.lastSeen ? /* existing TimestampLine or relative formatter */ : "—"}</td>
          <td>{/* existing auto-copy checkbox JSX, restyled as .switch */}</td>
          <td>{/* existing Activity + Delete buttons as icon-only buttons, verbatim handlers */}</td>
        </tr>
      );
    })}
  </tbody>
</table>
```

In `page.tsx`: `const walletStats = useMemo(() => deriveWalletStats(candidates, activity), [candidates, activity]);` and pass it down. Caveat: `activity` only holds the most recently fetched wallet's transfers, so Last seen may be `—` for others — acceptable per spec (derived from already-loaded data only).

- [ ] **Step 6: Style** (`globals.css`): `.watchlist-table { width: 100%; border-collapse: collapse; font-size: var(--fs-small); } .watchlist-table th { color: var(--faint); text-transform: uppercase; font-size: var(--fs-label); text-align: left; padding: var(--space-1); } .watchlist-table td { padding: var(--space-1); border-top: 1px solid var(--border); }` plus a `.switch` recolor of the checkbox (accent-color: var(--accent-strong) is sufficient).

- [ ] **Step 7: Verify.** `npx tsc --noEmit`, `npm test`, screenshot: leaderboard renders all wallets with counts, toggle flips auto-copy (check via network tab / refetch), master-off warning still appears when applicable, add-wallet form opens via `+`.

- [ ] **Step 8: Commit.**

```bash
git add src/components/WatchlistPanel.tsx src/components/walletStats.ts src/components/walletStats.test.ts src/app/page.tsx src/app/globals.css
git commit -m "feat: watchlist leaderboard with derived per-wallet stats"
```

---

### Task 6: Extract remaining panels into components

**Files:**
- Create: `src/components/CandidatesPanel.tsx`, `src/components/ActivityFeed.tsx`, `src/components/TradeTicket.tsx`, `src/components/SettingsPanels.tsx`, `src/components/TradeHistory.tsx`, `src/components/shared.tsx`
- Modify: `src/app/page.tsx`

Pure code movement — no markup or style changes in this task. One commit per extraction; after each: `npx tsc --noEmit`, `npm test`, quick screenshot.

- [ ] **Step 1: Create `shared.tsx`** and move the small presentational helpers used by multiple panels: `Mini`, `UnrealizedPnl`, `TimestampLine`, `ExplorerLink`, `FeeBreakdown`, `TradeSignals`, `CopyResultPanel`, `QuoteDebug`, plus the pure functions `shortAddress` and `localDateKey`. Export them; import back into `page.tsx` and the new components. Commit: `refactor: move shared presentational helpers to components/shared`.

- [ ] **Step 2: Extract `CandidatesPanel.tsx`** — move `CandidateList`, `CandidateStatusSummary`, `CandidateAttentionStrip`, `hydrateCopyResult`, `candidateTab`, and the candidate-related helper functions next to them, along with the "Wallet activity" panel's candidates section. Commit: `refactor: extract CandidatesPanel`.

- [ ] **Step 3: Extract `ActivityFeed.tsx`** — the activity list portion (filter pills, visible/older slicing UI, activity rows with `activityTypeLabel`/`activityTypeClass` — move those functions too). Commit: `refactor: extract ActivityFeed`.

- [ ] **Step 4: Extract `TradeTicket.tsx`** (BUY/SELL tabs form, preview block), `SettingsPanels.tsx` (Copy settings + Auto-exit rules + Archives, three exports or one component with props), `TradeHistory.tsx` (Past trades table + pagination). One commit each.

- [ ] **Step 5: Confirm `page.tsx` is now state + composition only** (target: under ~800 lines — state, hooks, fetchers, handlers, and the JSX tree of `<Topbar/>`, `<PositionsPanel/>`, etc.). `npx tsc --noEmit`, `npm test`.

---

### Task 7: Final polish, dead CSS sweep, and verification

**Files:**
- Modify: `src/app/globals.css`, screenshots only otherwise

- [ ] **Step 1: Dead CSS sweep.** For each class selector in `globals.css`, grep `src/` for the class name; delete rules with zero references (the old `dashboard-grid`, `trust-strip`, `wallet-card`, `trade-table` column-width rules etc. are likely candidates). Do not delete `.good`/`.bad`/`.warn` (pill variants still used).

- [ ] **Step 2: State spot-checks in the browser.** With dev server running, verify: error banner (stop the dev API or trigger a failed fetch via a bogus wallet add), empty positions state, busy spinners (click Refresh prices), collapsed panels open/close, the auto-copy master-off warning, and the activity "Show N more (N older)" pagination.

- [ ] **Step 3: Full check.** `npx tsc --noEmit`, `npm test`, `npm run build` (expect successful production build).

- [ ] **Step 4: Before/after screenshots** saved to `docs/superpowers/specs/` as `2026-06-09-ui-redesign-after.png` (full page).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "chore: dead CSS sweep and redesign verification artifacts"
```
