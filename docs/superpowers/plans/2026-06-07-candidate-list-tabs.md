# Candidate List Tabs + Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-capped `candidates.slice(0, 5)` in the wallet activity panel with a tabbed interface (Actionable / Review / All) and a "show more" button that appends 10 per click.

**Architecture:** All changes are client-side in `src/app/page.tsx`. A new `CandidateList` component is extracted at the bottom of the file (following the existing local-component pattern). Tab membership is derived from `classifyCandidateTrust` which already runs per card. No backend changes, no new API routes, no new test files.

**Tech Stack:** Next.js App Router, React 18 hooks (`useState`, `useEffect`, `useMemo`), TypeScript, Vitest (`npm test`), `npx tsc --noEmit` for type-checking.

---

## Files

- **Modify:** `src/app/globals.css` — add `.tab-row` and `.tab-button` CSS rules
- **Modify:** `src/app/page.tsx` — add `CandidateList` component near bottom of file; replace inline `candidates.slice(0, 5)` render block with `<CandidateList>`

---

## Task 1: Verify baseline

- [ ] **Step 1: Confirm type-check passes**

  ```
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 2: Confirm test suite passes**

  ```
  npm test
  ```

  Expected: 16 files, 149 tests pass.

---

## Task 2: Add tab CSS to globals.css

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add tab styles**

  In `src/app/globals.css`, find the `.candidate-list` rule (around line 318) and add the following immediately after it:

  ```css
  .tab-row {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }

  .tab-button {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
    padding: 6px 14px;
  }

  .tab-button.active {
    border-bottom-color: var(--accent, #58a6ff);
    color: var(--text);
    font-weight: 600;
  }

  .tab-button:hover:not(.active) {
    color: var(--text);
  }
  ```

- [ ] **Step 2: Commit**

  ```
  git add src/app/globals.css
  git commit -m "feat: add tab-row and tab-button CSS for candidate list"
  ```

---

## Task 3: Add CandidateList component

**Files:**
- Modify: `src/app/page.tsx`

The `CandidateList` component goes at the bottom of `page.tsx`, just before the final closing of the file (after the existing `CandidateStatusSummary` component and before `getCandidateStats`). All React hooks (`useState`, `useEffect`, `useMemo`) and all helper functions (`classifyCandidateTrust`, `candidateLastCopyResult`, `candidateCopyButtonTitle`, `candidateCopyButtonLabel`, `candidateStatusClass`, `candidateTitle`, `candidateCopyTokenAddress`) are already imported/defined in the same file.

- [ ] **Step 1: Add the `candidateTab` helper and `CandidateList` component**

  Find the line in `page.tsx` that reads:

  ```ts
  function getCandidateStats(candidates: TradeCandidate[]) {
  ```

  Insert the following block immediately before it:

  ```tsx
  type CandidateTab = "actionable" | "review" | "all";

  const ACTIONABLE_TRUST = new Set(["Ready", "Copied"]);

  function candidateTab(candidate: TradeCandidate): "actionable" | "review" {
    return ACTIONABLE_TRUST.has(classifyCandidateTrust(candidate).label) ? "actionable" : "review";
  }

  function CandidateList({
    candidates,
    copyResults,
    busy,
    copyCandidate,
  }: {
    candidates: TradeCandidate[];
    copyResults: Record<string, CopyResult>;
    busy: string;
    copyCandidate: (candidate: TradeCandidate) => void;
  }) {
    const [activeTab, setActiveTab] = useState<CandidateTab>("actionable");
    const [visibleCount, setVisibleCount] = useState(5);

    useEffect(() => {
      setVisibleCount(5);
    }, [activeTab]);

    const tabCandidates = useMemo(
      () => (activeTab === "all" ? candidates : candidates.filter((c) => candidateTab(c) === activeTab)),
      [candidates, activeTab]
    );

    const visibleCandidates = tabCandidates.slice(0, visibleCount);
    const remaining = Math.max(0, tabCandidates.length - visibleCount);

    function tabCount(tab: CandidateTab) {
      if (tab === "all") return candidates.length;
      return candidates.filter((c) => candidateTab(c) === tab).length;
    }

    return (
      <div>
        <div className="tab-row">
          {(["actionable", "review", "all"] as CandidateTab[]).map((tab) => (
            <button
              key={tab}
              className={`tab-button${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}{" "}
              <span className="pill">{tabCount(tab)}</span>
            </button>
          ))}
        </div>
        <div className="candidate-list">
          {visibleCandidates.map((candidate) => {
            const isCopying = busy === `copy-${candidate.id}`;
            const visibleCopyResult = isCopying
              ? null
              : copyResults[candidate.id] ?? candidateLastCopyResult(candidate);
            const trust = classifyCandidateTrust(candidate);
            return (
              <article className="candidate" key={candidate.id}>
                <div className="row">
                  <div>
                    <div className="activity-meta">
                      <span className={candidateStatusClass(candidate.status)}>{candidate.status}</span>
                      <span className={`pill ${trust.tone}`} title={trust.title}>{trust.label}</span>
                      <span className="pill">{candidate.chainName}</span>
                      <span className="pill">{Math.round(candidate.confidence * 100)}% confidence</span>
                    </div>
                    <h3>{candidateTitle(candidate)}</h3>
                    <TimestampLine timestamp={candidate.sourceTimestamp} />
                    <p className="subtle">{candidate.reason}</p>
                    {candidateCopyTokenAddress(candidate) ? (
                      <p className="mono subtle">{candidateCopyTokenAddress(candidate)}</p>
                    ) : null}
                    <ExplorerLink chainId={candidate.chainId} hash={candidate.hash} />
                  </div>
                  {trust.copyable ? (
                    <button
                      className="button secondary"
                      onClick={() => copyCandidate(candidate)}
                      disabled={isCopying}
                      title={candidateCopyButtonTitle(candidate, copyResults[candidate.id])}
                    >
                      {isCopying ? <Loader2 size={18} /> : <Send size={18} />}
                      {candidateCopyButtonLabel(candidate, copyResults[candidate.id])}
                    </button>
                  ) : trust.label === "Copied" ? null : (
                    <button className="button secondary" disabled title={trust.title}>
                      <Eye size={18} />
                      Review
                    </button>
                  )}
                </div>
                <div className="grid dashboard-grid">
                  <Mini label="Input" value={`${formatNumber(candidate.tokenInAmount, 6)} ${candidate.tokenInAsset || "-"}`} />
                  <Mini
                    label="Output"
                    value={`${formatNumber(candidate.tokenOutAmount, 6)} ${candidate.tokenOutAsset || "-"}`}
                  />
                  <Mini label="Transfers" value={String(candidate.transferCount)} />
                  <Mini label="Side" value={candidate.side} />
                </div>
                {visibleCopyResult ? <CopyResultPanel result={visibleCopyResult} /> : null}
              </article>
            );
          })}
        </div>
        {remaining > 0 ? (
          <button
            className="button secondary"
            style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
            onClick={() => setVisibleCount((n) => n + 10)}
          >
            Show {Math.min(10, remaining)} more ({remaining} remaining in {activeTab})
          </button>
        ) : null}
      </div>
    );
  }
  ```

- [ ] **Step 2: Run type-check**

  ```
  npx tsc --noEmit
  ```

  Expected: no errors. If `CopyResult` is flagged as not found, confirm it is defined near the top of `page.tsx` (around line 97) — it is a file-local type, so the component can see it.

- [ ] **Step 3: Commit**

  ```
  git add src/app/page.tsx
  git commit -m "feat: add CandidateList component with Actionable/Review/All tabs and show more"
  ```

---

## Task 4: Wire CandidateList into the page JSX

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace the inline candidate render block**

  Find this block in `page.tsx` (around line 1557):

  ```tsx
  {candidates.length ? (
    <div className="candidate-list">
      {candidates.slice(0, 5).map((candidate) => {
        const isCopying = busy === `copy-${candidate.id}`;
        const visibleCopyResult = isCopying
          ? null
          : copyResults[candidate.id] ?? candidateLastCopyResult(candidate);
        const trust = classifyCandidateTrust(candidate);
        return (
        <article className="candidate" key={candidate.id}>
          <div className="row">
            <div>
              <div className="activity-meta">
                <span className={candidateStatusClass(candidate.status)}>{candidate.status}</span>
                <span className={`pill ${trust.tone}`} title={trust.title}>{trust.label}</span>
                <span className="pill">{candidate.chainName}</span>
                <span className="pill">{Math.round(candidate.confidence * 100)}% confidence</span>
              </div>
              <h3>{candidateTitle(candidate)}</h3>
              <TimestampLine timestamp={candidate.sourceTimestamp} />
              <p className="subtle">{candidate.reason}</p>
              {candidateCopyTokenAddress(candidate) ? (
                <p className="mono subtle">{candidateCopyTokenAddress(candidate)}</p>
              ) : null}
              <ExplorerLink chainId={candidate.chainId} hash={candidate.hash} />
            </div>
            {trust.copyable ? (
              <button
                className="button secondary"
                onClick={() => copyCandidate(candidate)}
                disabled={isCopying}
                title={candidateCopyButtonTitle(candidate, copyResults[candidate.id])}
              >
                {isCopying ? <Loader2 size={18} /> : <Send size={18} />}
                {candidateCopyButtonLabel(candidate, copyResults[candidate.id])}
              </button>
            ) : trust.label === "Copied" ? null : (
              <button className="button secondary" disabled title={trust.title}>
                <Eye size={18} />
                Review
              </button>
            )}
          </div>
          <div className="grid dashboard-grid">
            <Mini label="Input" value={`${formatNumber(candidate.tokenInAmount, 6)} ${candidate.tokenInAsset || "-"}`} />
            <Mini
              label="Output"
              value={`${formatNumber(candidate.tokenOutAmount, 6)} ${candidate.tokenOutAsset || "-"}`}
            />
            <Mini label="Transfers" value={String(candidate.transferCount)} />
            <Mini label="Side" value={candidate.side} />
          </div>
          {visibleCopyResult ? <CopyResultPanel result={visibleCopyResult} /> : null}
        </article>
      );
      })}
    </div>
  ) : null}
  ```

  Replace it with:

  ```tsx
  {candidates.length ? (
    <CandidateList
      candidates={candidates}
      copyResults={copyResults}
      busy={busy}
      copyCandidate={copyCandidate}
    />
  ) : null}
  ```

- [ ] **Step 2: Run type-check**

  ```
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Run tests**

  ```
  npm test
  ```

  Expected: 16 files, 149 tests pass (no regressions — no test files reference the inline render block).

- [ ] **Step 4: Commit**

  ```
  git add src/app/page.tsx
  git commit -m "feat: replace inline candidate render with CandidateList tabs component"
  ```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the dev server**

  ```
  npm run dev
  ```

- [ ] **Step 2: Verify tab counts**

  Fetch a watched wallet that has candidates. Confirm:
  - Three tab buttons appear: Actionable, Review, All
  - Each tab badge shows the correct count
  - Actionable = candidates with trust label "Ready" or "Copied"
  - Review = candidates with trust label "No address", "Mixed shape", "Multiple tokens", "No route", or "Failed"
  - All = total candidates

- [ ] **Step 3: Verify show more**

  If a tab has more than 5 candidates: confirm the "Show N more" button appears and clicking it appends 10 more cards. Confirm the button disappears once all candidates in the tab are visible.

- [ ] **Step 4: Verify tab switch resets count**

  Switch from Actionable to Review — confirm the list resets to showing 5 (not carrying over the expanded count from the previous tab).

- [ ] **Step 5: Verify copy still works**

  Click Copy on a Ready candidate — confirm the copy flow is unchanged (button becomes spinner, result panel appears, status updates to Copied, card moves to the Actionable tab with dimmed styling).

- [ ] **Step 6: Verify empty state**

  When no wallet is fetched, confirm the existing "Fetch a watched wallet…" empty state still renders (it is controlled by the parent and is unaffected by this change).
