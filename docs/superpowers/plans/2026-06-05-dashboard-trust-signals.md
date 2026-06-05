# Dashboard Trust Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact, read-only dashboard trust metrics and a small analytics panel derived from existing portfolio state.

**Architecture:** Add a pure `portfolioAnalytics` helper that computes trust metrics from portfolio, position, and trade arrays. Include the analytics in the existing `/api/portfolio` response, then render a compact metric strip plus a small trust panel in the dashboard.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, SQLite-backed repository data already exposed through existing types.

---

### Task 1: Pure Analytics Helper

**Files:**
- Create: `src/lib/portfolioAnalytics.ts`
- Create: `src/lib/portfolioAnalytics.test.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Write the failing analytics tests**

Create `src/lib/portfolioAnalytics.test.ts` with tests for empty state, mixed closed trades, fee drag, and FIFO hold time.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/portfolioAnalytics.test.ts`

Expected: FAIL because `./portfolioAnalytics` does not exist.

- [ ] **Step 3: Add analytics types**

Add `PortfolioAnalytics` and `PortfolioAnalyticsTokenResult` to `src/lib/types.ts`.

- [ ] **Step 4: Implement `derivePortfolioAnalytics`**

Create `src/lib/portfolioAnalytics.ts` exporting `derivePortfolioAnalytics(input)`. It computes closed trade counts, win rate, fee drag, open exposure, realized PnL, best/worst realized token, and FIFO average hold hours.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/portfolioAnalytics.test.ts`

Expected: PASS.

### Task 2: API Payload

**Files:**
- Modify: `src/app/api/portfolio/route.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Wire analytics into `/api/portfolio`**

Import `derivePortfolioAnalytics` and include `analytics` in the JSON response.

- [ ] **Step 2: Update the dashboard payload type**

Import `PortfolioAnalytics` in `src/app/page.tsx` and add `analytics: PortfolioAnalytics` to `PortfolioPayload`.

- [ ] **Step 3: Run targeted tests**

Run: `npm test`

Expected: PASS.

### Task 3: Dashboard UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add small formatting helpers**

Add UI-only helpers for nullable percent, hold-time hours, and token result labels.

- [ ] **Step 2: Render compact trust metrics**

Add four compact metrics near the existing dashboard metrics: win rate, fee drag, open exposure, and avg hold.

- [ ] **Step 3: Render the Trust Signals panel**

Add one small panel showing realized vs open exposure, best token, worst token, and closed trade count.

- [ ] **Step 4: Keep styles compact**

Add CSS classes only as needed for the trust strip and panel, reusing existing metric/card patterns.

- [ ] **Step 5: Run full verification**

Run: `npm test`, `npx tsc --noEmit`, and `npm run build`.

Expected: all commands exit 0.
