# Stale Quote Warning — Design

## Problem

The manual trade ticket fetches a quote on Preview and holds it in React state
indefinitely. A user can preview a quote, walk away, return minutes later, and
execute against a price that has moved significantly with no indication that the
quote is old. Every other trust signal in the app surfaces a visible warning;
silent stale quotes undercut that goal.

## Goal

Show an amber warning in the preview panel when the quote is more than 2 minutes
old. The execute button stays enabled — this is informational, not a blocker.
The warning disappears when the user re-previews.

## Approach

Purely frontend. No API changes, no type changes. The quote was fetched in the
browser; the browser tracks when.

## State

Add to the trade ticket component in `src/app/page.tsx`:

```ts
const [fetchedAt, setFetchedAt] = useState<number | null>(null);
const [isStale, setIsStale] = useState(false);
```

Set both when a preview arrives:
- `setFetchedAt(Date.now())` and `setIsStale(false)` alongside every `setPreview(...)` call
  (both `previewTrade` success path and `executeTrade` success path).

Reset both when preview is cleared:
- `setFetchedAt(null)` and `setIsStale(false)` alongside every `setPreview(null)` call
  (form reset, chain change, token change).

## Timer

A `useEffect` watches `fetchedAt`. When non-null, it sets up a 30-second interval
that checks `Date.now() - fetchedAt > 120_000`. When that condition first becomes
true, calls `setIsStale(true)`. The interval is cleared in the cleanup function
so it stops when `fetchedAt` changes or the component unmounts.

```ts
useEffect(() => {
  if (!fetchedAt) return;
  const interval = setInterval(() => {
    if (Date.now() - fetchedAt > 120_000) setIsStale(true);
  }, 30_000);
  return () => clearInterval(interval);
}, [fetchedAt]);
```

## UI

Inside the `{preview ? (...)  }` block, render at the top of the preview details
when `isStale` is true:

```tsx
{isStale && (
  <p className="warning-text">
    ⚠ Quote is over 2 minutes old — prices may have moved. Consider refreshing.
  </p>
)}
```

Styled with the existing amber warning style. No button, no blocker. Execute
button stays enabled.

## Helper & Tests

Extract the staleness check into a pure helper in a new `src/lib/quoteAge.ts`:

```ts
export function isQuoteStale(fetchedAt: number, now: number, thresholdMs: number): boolean {
  return now - fetchedAt > thresholdMs;
}
```

Unit tests in the corresponding test file verify:
- Returns `false` when age is under threshold
- Returns `true` when age equals threshold exactly
- Returns `true` when age exceeds threshold

No React component tests — none exist in this codebase.

## Out of Scope

- Blocking or disabling execute on stale quotes
- Auto-clearing the preview after timeout
- Stale warnings on candidate copy quotes (separate flow)
