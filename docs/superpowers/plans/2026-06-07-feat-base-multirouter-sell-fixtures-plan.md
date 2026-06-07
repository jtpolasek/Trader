---
title: "feat: Add Base multi-router sell fixtures to wallet parser"
type: feat
status: completed
date: 2026-06-07
---

# feat: Add Base multi-router sell fixtures to wallet parser

## Overview

Add real Base (chainId=8453) multi-router sell fixtures to `src/lib/candidates.test.ts` drawn from stored Alchemy raw payloads in `data/paper-trader.db`. This hardens the parser's sell-direction inference for the most common unfixed gap — sells routed through multiple contracts on Base where extra transfer legs create ambiguity. The primary deliverable is fixtures + verification that existing logic handles them correctly (or clearly documents where it does not).

No parser logic changes in this slice unless a trivial one-liner fix emerges. If real gaps are found, they are documented as the next slice.

## Background

The parser's noise-tolerance gate (`isTinyTransferNoise`) was added in recent slices to allow decoded sells when a tiny duplicate cash/native refund leg is present. The logic uses a **1% threshold**: a secondary inbound leg's cash value must be ≤ 1% of the primary leg's cash value to be treated as noise. This was validated with synthetic fixtures. We now want real Base multi-router payloads from the DB to confirm the gate works in practice and to lock in regression coverage.

**Key thresholds to test around:**
- Secondary leg < 1% of primary → stays `decoded` (confidence 0.9)
- Secondary leg > 1% of primary → falls to `candidate` (confidence 0.72, review-only)
- Missing copy-token `contractAddress` → falls to `candidate` (confidence 0.58)
- Multiple distinct sell-side tokens → falls to `candidate` (confidence 0.52)
- Mixed buy+sell shape → `side: "unknown"`, `candidate` (confidence 0.4)

**Existing Base sell fixtures (already covered, do not duplicate):**
- Lines 949–1017: decoded Base sell (erc20 TALOS out + internal ETH in, full rawPayload)
- Lines 1019–1084: review-only Base sell (same shape, missing contractAddress → 0.58)

## Relevant Files

| File | Purpose |
|---|---|
| `src/lib/candidates.test.ts:7` | `activity()` helper and all fixtures |
| `src/lib/candidates.ts` | `deriveTradeCandidates`, `isTinyTransferNoise`, `hydrateActivityFromRawPayload` |
| `src/lib/candidates.ts:184` | `isTinyTransferNoise` — 1% threshold logic |
| `src/lib/candidates.ts:318` | `hydrateActivityFromRawPayload` — raw payload field recovery |
| `data/paper-trader.db` | Source of real Base raw payloads |
| `scripts/reprocess-candidates.mjs` | Preview/apply reprocessing against stored candidates |

## Implementation Steps

### Step 1 — Mine the DB for multi-router Base sell candidates

Run the following SQLite queries against `data/paper-trader.db` to identify real multi-transfer Base transactions and inspect their raw payloads.

**Find multi-transfer Base hashes (3+ rows):**
```sql
SELECT hash, COUNT(*) as ct,
       GROUP_CONCAT(category) as cats,
       GROUP_CONCAT(asset) as assets,
       GROUP_CONCAT(CAST(value AS TEXT)) as vals,
       GROUP_CONCAT(COALESCE(contract_address,'none')) as contracts
FROM wallet_activity
WHERE chain_id = 8453
GROUP BY hash HAVING ct >= 3
ORDER BY ct DESC LIMIT 20;
```

**Known candidate from prior query:** `0xc2821caa67f5afe4150131b7eb25a5d4f2ffa0eb0f2d84209a5ba7660245a93e` — 3 BREAD transfers to different addresses. Pull its full rows:

```sql
SELECT id, hash, category, asset, value, contract_address,
       from_address, to_address, block_num, timestamp,
       chain_id, chain_name, wallet_address, raw_payload
FROM wallet_activity
WHERE chain_id = 8453 AND hash = '0xc2821caa67f5afe4150131b7eb25a5d4f2ffa0eb0f2d84209a5ba7660245a93e'
ORDER BY id;
```

**Inspect `from_address` vs `wallet_address`** to determine direction (outbound = from_address matches wallet, inbound = to_address matches wallet). Identify:
- Which legs are outbound (token being sold)
- Which legs are inbound (proceeds coming in)
- Whether there are noise/extra legs

Also pull a few 2-transfer hashes that have mixed `erc20` + `internal` or `erc20` + `external` categories for baseline comparison:
```sql
SELECT hash, COUNT(*) as ct,
       GROUP_CONCAT(category) as cats,
       GROUP_CONCAT(asset) as assets
FROM wallet_activity
WHERE chain_id = 8453
GROUP BY hash HAVING ct = 2
  AND cats LIKE '%erc20%' AND (cats LIKE '%internal%' OR cats LIKE '%external%')
LIMIT 10;
```

### Step 2 — Select 3 fixture hashes

From Step 1, select 3 hashes that cover distinct shapes. Target:

**Fixture A — decoded multi-router sell (goal: status "decoded", confidence 0.9)**
- A hash with: one clear erc20 token-out leg, one clear internal/external ETH-in leg, plus at least one additional leg that is a tiny noise amount (< 1% of the ETH proceeds).
- If no real DB hash has all three legs, augment with a synthetic noise leg constructed from the real token/ETH data. Keep the real legs' rawPayload intact; fabricate only the noise leg's rawPayload to be internally consistent.

**Fixture B — review-only multi-router sell (goal: status "candidate", confidence 0.72)**
- A hash with: one clear erc20 token-out leg, two or more inbound ETH/cash legs where the secondary leg is > 1% of the primary (competing proceeds, not noise).
- If the DB has the 3-transfer BREAD hash where all legs are outbound with no proceeds, model it as a "multiple outbound tokens, no clear cash inbound" case → should yield `candidate` with reason about ambiguity or missing cash leg.

**Fixture C — review-only due to missing contract address (goal: status "candidate", confidence 0.58)**
- Similar to the existing line 1019–1084 fixture but using a different real hash where `contractAddress` is empty or null in the raw payload. Confirms the guard still fires for Base multi-router sells, not just simple ones.

> **Decision point:** If the 3-transfer BREAD hash turns out to be all-outbound with no cash proceeds in the DB, use it as Fixture B (ambiguous multi-router, no proceeds → review-only), and construct a synthetic 3-transfer fixture for Fixture A with realistic Base addresses from the real data.

### Step 3 — Write the fixture `it()` blocks

Add three new `it()` blocks at the end of the single `describe("deriveTradeCandidates")` block in `src/lib/candidates.test.ts`, after the existing Base sell tests (~line 1085).

**Pattern to follow** (from existing lines 949–1017):

```typescript
it("<descriptive name>", () => {
  const wallet = "0x<real-wallet-address-from-db>";
  const hash = "0x<real-hash>";
  const tokenAddress = "0x<real-contract-address>";
  const routerAddress = "0x<real-router-address>";
  const ethRouterAddress = "0x<real-eth-router-address>";

  const transfers = [
    activity({
      walletAddress: wallet,
      chainId: 8453,
      chainName: "Base",
      hash,
      category: "erc20",
      asset: "<TOKEN>",
      contractAddress: tokenAddress,
      value: <amount>,
      fromAddress: wallet,
      toAddress: routerAddress,
      rawPayload: JSON.stringify({ /* real rawPayload from DB */ }),
    }),
    activity({
      walletAddress: wallet,
      chainId: 8453,
      chainName: "Base",
      hash,
      category: "internal",
      asset: "ETH",
      contractAddress: "",
      value: <eth_amount>,
      fromAddress: ethRouterAddress,
      toAddress: wallet,
      rawPayload: JSON.stringify({ /* real rawPayload from DB */ }),
    }),
    // Fixture A only: add tiny noise leg here
    // activity({ ... value: eth_amount * 0.005, fromAddress: anotherRouter, toAddress: wallet ... })
  ];

  const [candidate] = deriveTradeCandidates(transfers);

  // Fixture A assertions:
  expect(candidate.status).toBe("decoded");
  expect(candidate.confidence).toBe(0.9);
  expect(candidate.side).toBe("sell");
  expect(candidate.tokenInAsset).toBe("<TOKEN>");
  expect(candidate.tokenInAddress).toBe(tokenAddress);
  expect(candidate.tokenOutAsset).toBe("ETH");

  // Fixture B assertions (review-only):
  expect(candidate.status).toBe("candidate");
  expect(candidate.confidence).toBe(0.72);

  // Fixture C assertions (missing address):
  expect(candidate.status).toBe("candidate");
  expect(candidate.confidence).toBe(0.58);
});
```

**Important rawPayload consistency rules** (from existing Base sell fixtures):
- `rawPayload.hash` must match the activity `hash`
- `rawPayload.from` / `rawPayload.to` must match `fromAddress` / `toAddress`
- `rawPayload.category` must match activity `category`
- `rawPayload.chainId` must be `8453`, `rawPayload.chainName` must be `"Base"`
- `rawPayload.rawContract.address` must match `contractAddress` (or `null` for ETH/internal)
- `rawPayload.rawContract.decimal` should be `"0x12"` (18) for ETH legs
- `rawPayload.metadata.blockTimestamp` should be an ISO timestamp

### Step 4 — Run tests and confirm counts

```bash
npm test
```

Expected: 16 files / 146+ tests pass (143 existing + 3 new).

If any fixture fails, diagnose using the threshold logic in `candidates.ts:184`. Adjust the fixture's value amounts (not the parser logic) to hit the intended side of the threshold. Add a comment on the fixture explaining the threshold relationship if the value choice is non-obvious.

### Step 5 — Record reprocess:candidates preview counts

Before applying anything, run the preview to capture before/after numbers:

```bash
npm run reprocess:candidates
```

Record the output in the PR description:
- `stored` count
- `derived` count  
- `changed` count (expect 0 — no parser logic changed)
- `decoded` / `review` / `skipped` breakdown

If `changed > 0`, investigate before applying — a parser logic change may have snuck in.

### Step 6 — TypeScript check

```bash
npx tsc --noEmit
```

Expected: no errors.

## Acceptance Criteria

- [ ] Three new `it()` blocks added to `src/lib/candidates.test.ts` after line ~1085
- [ ] Fixture A: decoded multi-router Base sell with noise leg → `status: "decoded"`, `confidence: 0.9`, `side: "sell"`
- [ ] Fixture B: review-only multi-router Base sell → `status: "candidate"`, `confidence: 0.72` (competing proceeds or ambiguous shape)
- [ ] Fixture C: review-only Base sell with missing contract address → `status: "candidate"`, `confidence: 0.58`
- [ ] All three use real Base addresses/tokens sourced from DB raw payloads (not placeholder `"0xhash"` / `"0xrouter"`)
- [ ] `npm test` passes: 16+ files, 146+ tests
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run reprocess:candidates` preview run completed and counts recorded
- [ ] No parser logic changes (fixtures only, or a trivial one-liner with clear justification)

## Success Metrics

- Parser behavior on Base multi-router sells is locked in by regression tests
- Any future parser change that breaks multi-router sell decoding will be caught immediately
- `reprocess:candidates` preview shows `changed: 0` (confirming real DB candidates are unaffected)

## Out of Scope

- Parser logic improvements (next slice, after fixtures reveal specific gaps)
- Native ETH sell fixtures on Base
- Ethereum chain fixtures
- Buy fixtures
- Any DB schema or API route changes

## References

- Brainstorm: `docs/brainstorms/2026-06-07-base-multirouter-sell-fixtures-brainstorm.md`
- Existing Base sell fixtures: `src/lib/candidates.test.ts:949–1084`
- Noise tolerance logic: `src/lib/candidates.ts:184` (`isTinyTransferNoise`)
- Hydration logic: `src/lib/candidates.ts:318` (`hydrateActivityFromRawPayload`)
- Reprocess script: `scripts/reprocess-candidates.mjs`
