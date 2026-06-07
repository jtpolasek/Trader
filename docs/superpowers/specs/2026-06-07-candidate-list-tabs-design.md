# Design: Candidate List Tabs + Pagination

**Date:** 2026-06-07
**Scope:** Build Next #5 follow-on — replace the hard cap of 5 on the candidate list with trust-bucket tabs and progressive "show more" disclosure.

---

## Overview

The wallet activity panel currently renders `candidates.slice(0, 5)` — a hard cap with no way to see the rest. A wallet with 47 candidates (common in the real DB) only shows 5. This change replaces the cap with three trust-bucket tabs (Actionable / Review / All) and a "show more" button that appends 10 per click.

No backend changes. No schema changes. No new API routes. All filtering and pagination are pure client-side derived state from the existing `candidates` React state array.

---

## Tab Definitions

Tab membership is derived from `classifyCandidateTrust(candidate).label`, which is already computed per card:

| Tab | Trust labels included |
|---|---|
| **Actionable** | `"Ready"`, `"Copied"` |
| **Review** | `"No address"`, `"Mixed shape"`, `"Multiple tokens"`, `"No route"`, `"Failed"` |
| **All** | Every candidate regardless of trust label |

**Default tab on load:** Actionable.

Each tab button shows a count badge (number of candidates in that bucket). Count badges update whenever `candidates` state changes (e.g. after a copy or reset).

---

## Progressive Disclosure

- Initial render per tab: **5 cards**
- "Show more" appends **10 per click**
- `visibleCount` resets to 5 when the active tab changes
- Button label: `Show 10 more (N remaining in [Tab])` where N = total in tab minus currently visible
- Button is hidden when all candidates in the active tab are visible

---

## Sort Order

Newest first by `sourceTimestamp` throughout — matching the current DB query sort. No sort control is added in this iteration.

---

## Component Structure

Extract a `CandidateList` component at the bottom of `src/app/page.tsx`, following the existing pattern of co-located helper components (`Metric`, `Mini`, `CandidateStatusSummary`, etc.).

**Props:**
```ts
type CandidateListProps = {
  candidates: TradeCandidate[];
  copyResults: Record<string, CopyResult>;
  busy: string;
  copyCandidate: (candidate: TradeCandidate) => void;
};
```

**Internal state:**
```ts
const [activeTab, setActiveTab] = useState<"actionable" | "review" | "all">("actionable");
const [visibleCount, setVisibleCount] = useState(5);
```

`visibleCount` resets to 5 in a `useEffect` keyed on `activeTab`.

**Derived values (useMemo):**
- `tabCandidates`: filtered subset for the active tab
- `visibleCandidates`: `tabCandidates.slice(0, visibleCount)`
- `remaining`: `tabCandidates.length - visibleCount` (clamped to 0)

The existing card markup (`<article className="candidate">`) moves into `CandidateList` unchanged. The `classifyCandidateTrust` call, copy button logic, `CopyResultPanel`, and all badge rendering stay the same.

---

## UI Changes

### What stays the same
- `CandidateStatusSummary` strip (copied / decoded / review / failed / skipped counts) renders above the tabs, unchanged
- The `{candidates.length} candidates` pill in the section header stays
- Individual candidate card markup is unchanged
- Copy flow is unchanged

### What changes
- Remove `candidates.slice(0, 5)` — replace with `<CandidateList>` component
- Three tab buttons sit between `CandidateStatusSummary` and the card list
- Active tab has a bottom border highlight and bold label; inactive tabs are muted
- Copied cards appear in Actionable but are visually dimmed (existing card style is sufficient) with their disabled button unchanged
- "Show more" button sits below the card list when `remaining > 0`

---

## Existing Behaviour Preserved

- When `candidates` is empty: existing "Fetch a watched wallet…" empty state is unchanged (rendered by the parent, not inside `CandidateList`)
- After paper portfolio reset: `candidates` state is already reset in the parent; `CandidateList` will re-render with empty tabs naturally
- After a copy: parent updates `candidates` and `copyResults` state; `CandidateList` re-renders with updated trust labels

---

## Testing

No new unit tests are required — the tab/pagination logic is pure derived state with no side effects. The existing `candidateTrust.test.ts` and integration tests cover trust classification. Manual verification:

1. Fetch a wallet with more than 5 candidates — confirm Actionable/Review/All tabs appear with correct counts
2. Click "Show more" — confirm 10 more cards appear and remaining count decrements
3. Switch tabs — confirm `visibleCount` resets to 5 and cards update
4. Copy a candidate — confirm it moves to "Copied" trust label and stays in Actionable tab (dimmed)
5. Reset paper portfolio — confirm tab counts update correctly
