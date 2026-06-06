# Stale Quote Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an amber warning in the manual trade preview panel when the quote is more than 2 minutes old.

**Architecture:** A pure `isQuoteStale` helper (new `src/lib/quoteAge.ts`) is unit-tested independently. `page.tsx` gains two state variables (`fetchedAt`, `isStale`) and a `useEffect` timer that calls `setIsStale(true)` after 120 seconds. The warning renders inside the existing `{preview ? (...)}` block using the existing `alert` CSS class.

**Tech Stack:** React (useState, useEffect), TypeScript, Vitest

---

## Files

- Create: `src/lib/quoteAge.ts` — pure `isQuoteStale` helper
- Create: `src/lib/quoteAge.test.ts` — unit tests for `isQuoteStale`
- Modify: `src/app/page.tsx` — add state, timer effect, and warning UI

---

### Task 1: Pure `isQuoteStale` helper with tests

**Files:**
- Create: `src/lib/quoteAge.ts`
- Create: `src/lib/quoteAge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/quoteAge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isQuoteStale } from "./quoteAge";

describe("isQuoteStale", () => {
  it("returns false when age is under threshold", () => {
    expect(isQuoteStale(1000, 120999, 120000)).toBe(false);
  });

  it("returns false when age equals threshold exactly", () => {
    expect(isQuoteStale(1000, 121000, 120000)).toBe(false);
  });

  it("returns true when age exceeds threshold", () => {
    expect(isQuoteStale(1000, 121001, 120000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- quoteAge.test.ts
```

Expected: FAIL with "Cannot find module './quoteAge'"

- [ ] **Step 3: Create `src/lib/quoteAge.ts`**

```ts
export function isQuoteStale(fetchedAt: number, now: number, thresholdMs: number): boolean {
  return now - fetchedAt > thresholdMs;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- quoteAge.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass (was 132, now 135).

- [ ] **Step 6: Commit**

```bash
git add src/lib/quoteAge.ts src/lib/quoteAge.test.ts
git commit -m "feat: add isQuoteStale helper for 2-minute quote age check"
```

---

### Task 2: State and timer in `page.tsx`

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add state variables**

In `src/app/page.tsx`, find the block of `useState` declarations around line 144. Add after `const [preview, setPreview] = useState<QuotePreview | null>(null);`:

```ts
const [fetchedAt, setFetchedAt] = useState<number | null>(null);
const [isStale, setIsStale] = useState(false);
```

- [ ] **Step 2: Add the timer effect**

Find the existing `useEffect` hooks in the component (near the top of the component body, after state declarations). Add a new one after them:

```ts
useEffect(() => {
  if (!fetchedAt) return;
  const interval = setInterval(() => {
    if (isQuoteStale(fetchedAt, Date.now(), 120_000)) setIsStale(true);
  }, 30_000);
  return () => clearInterval(interval);
}, [fetchedAt]);
```

Also add the import at the top of the file alongside other `src/lib` imports:

```ts
import { isQuoteStale } from "@/lib/quoteAge";
```

- [ ] **Step 3: Update `setPreview(payload.preview)` call sites to also set `fetchedAt` and reset `isStale`**

There are two `setPreview(payload.preview)` calls — one in `previewTrade` (line ~288) and one in `executeTrade` (line ~314). Update both to add the two state resets immediately after:

In `previewTrade` (~line 288):
```ts
setPreview(payload.preview);
setFetchedAt(Date.now());
setIsStale(false);
```

In `executeTrade` (~line 314):
```ts
setPreview(payload.preview);
setFetchedAt(Date.now());
setIsStale(false);
```

- [ ] **Step 4: Update `setPreview(null)` call sites to also reset `fetchedAt` and `isStale`**

There are four `setPreview(null)` calls — lines ~279, ~528, ~770, ~786. Update each to add resets immediately after:

```ts
setPreview(null);
setFetchedAt(null);
setIsStale(false);
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all 135 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: track quote fetch time and set isStale after 2 minutes"
```

---

### Task 3: Stale warning UI in preview panel

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the warning to the preview panel**

In `src/app/page.tsx`, find the `{preview ? (` block (around line 857). Inside the `<div className="quote-box stack">`, add the stale warning as the **first child**, before the `<div className="row">` that shows the token name and side:

```tsx
{isStale && (
  <div className="alert">
    ⚠ Quote is over 2 minutes old — prices may have moved. Consider refreshing.
  </div>
)}
```

The result should look like:

```tsx
{preview ? (
  <div className="quote-box stack">
    {isStale && (
      <div className="alert">
        ⚠ Quote is over 2 minutes old — prices may have moved. Consider refreshing.
      </div>
    )}
    <div className="row">
      ...
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all 135 tests pass.

- [ ] **Step 4: Build check**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: show stale-quote warning in preview panel after 2 minutes"
```
