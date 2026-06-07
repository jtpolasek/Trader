---
title: "feat: Apply 22 Ethereum candidate drift corrections and add fixtures"
type: feat
status: completed
date: 2026-06-07
---

# feat: Apply 22 Ethereum candidate drift corrections and add fixtures

## Overview

22 Ethereum trade candidates are stored as `status: "skipped"` in `data/paper-trader.db` but the
current parser now correctly classifies them as `decoded` or `candidate` sells. The drift exists
because the reprocess script's `--apply` flag only inserts new candidates — it never updates
existing rows. This slice adds an `--update` flag to the reprocess script that pushes improved
classifications to existing `skipped` candidates, applies the 22 corrections, and adds parser
fixtures for the dominant new shape (ECHO Ethereum sells).

## Background

All 22 candidates are `status: "skipped"`, `confidence: 0`, `side: "unknown"` — they have never
been actioned (not copied, not manually reviewed). The parser improved since they were stored:
`hydrateActivityFromRawPayload` now recovers missing internal ETH transfer fields from `rawPayload`,
which allows many of these to resolve as valid sell pairs. Safe to update because `skipped` rows
carry no copy history.

**Reprocess preview breakdown (from last session):**
- `skipped → decoded` (13 cases): clean token-out + internal/external ETH-in sell shape, token
  address recovered
- `skipped → candidate` (5 cases): sell shape identified but ambiguous or missing address
- `skipped → decoded` with side+address improvement (4 additional ECHO sells)

**Dominant new shape:** ECHO token (`0xcaaca3c22141bcfa3dad3662c465bb48ab6736ee`) on Ethereum —
appears in 4 decoded sell cases. No ECHO Ethereum sell fixture exists yet.

## Relevant Files

| File | Purpose |
|---|---|
| `scripts/reprocess-candidates.mjs` | Add `--update` flag logic |
| `src/lib/candidateReprocess.ts` | `summarizeCandidateReprocess` — already tracks statusChanges |
| `src/lib/repositories.ts:612` | `upsertTradeCandidates()` — ON CONFLICT DO UPDATE, the safe update path |
| `src/lib/repositories.ts:682` | `reprocessStoredActivityCandidates()` — INSERT OR IGNORE only |
| `src/lib/candidates.test.ts` | Add ECHO sell fixtures |
| `src/lib/candidates.ts` | Parser (no changes expected) |
| `data/paper-trader.db` | Target DB |

## Implementation Steps

### Step 1 — Inspect the drift cases in detail

Run reprocess with `--json` flag (if it exists) or review the preview output to group the 22 hashes
by change type. Pull `wallet_activity` rows for 2-3 representative hashes to confirm the parser
improvement is correct — particularly one ECHO sell and one of the ambiguous ETH cases.

```bash
npm run reprocess:candidates
```

For representative hashes, query the DB directly:
```sql
-- ECHO sell example (0x48868171...)
SELECT category, asset, value, from_address, to_address, contract_address, raw_payload
FROM wallet_activity WHERE hash = '0x48868171957f584f572b8496c1e2f1f5d9e1336ac99ba4c334ae69d163c53b64' AND chain_id = 1;

-- ETH-as-tokenIn ambiguous case (0x399aa84e...)
SELECT category, asset, value, from_address, to_address, contract_address, raw_payload
FROM wallet_activity WHERE hash = '0x399aa84ef6273c386f9b9b571f1718c15a68affc21b3706fc3982a6bd585335e' AND chain_id = 1;
```

Confirm for each that:
- The derived `side`, `status`, and `tokenInAddress` look correct given the transfer legs
- No candidate is being promoted to `decoded` based on bad data (e.g., wrong direction inference)

### Step 2 — Add `--update` flag to reprocess script

In `scripts/reprocess-candidates.mjs`, add an `--update` flag that, after computing the diff,
updates existing candidates whose stored status is `"skipped"` and whose derived classification
has improved (status or side changed, or token address was recovered).

**Guarded update rule:** Only update rows where `stored.status === "skipped"`. Never touch
`copied`, `decoded`, `candidate`, or `failed` rows — those may have been manually actioned.

The update should call `upsertTradeCandidates()` from `repositories.ts` (which uses
`ON CONFLICT(wallet_address, chain_id, hash) DO UPDATE SET`) for each changed skipped candidate.

**New flag behavior:**
- `npm run reprocess:candidates` — preview only (no changes), same as today
- `npm run reprocess:candidates -- --apply` — insert newly-derived missing rows only (unchanged)
- `npm run reprocess:candidates -- --update` — update existing skipped rows with improved classifications
- `npm run reprocess:candidates -- --apply --update` — do both

**Script output additions for `--update`:**
```
Updated existing candidates: 22
  skipped → decoded: 13
  skipped → candidate: 9
```

### Step 3 — Apply the updates

```bash
npm run reprocess:candidates -- --update
```

Verify the output shows `Updated existing candidates: 22`. Then run a quick DB sanity check:
```bash
npm run reprocess:candidates
```
Expected after update: `changed: 0` (stored now matches derived for these 22 rows).

### Step 4 — Add ECHO sell fixtures

Add 2 new `it()` blocks to `src/lib/candidates.test.ts` covering the ECHO Ethereum sell shape —
the most common new decoded shape (4 real cases in the DB). Use real raw_payload values from the
DB (wallet `0xbf26925f...`, ECHO contract `0xcaaca3c22141bcfa3dad3662c465bb48ab6736ee`).

**Fixture D — decoded Ethereum ECHO sell (internal ETH proceeds)**
- ECHO erc20 out (from wallet, to router)
- internal ETH in (from router, to wallet)
- Expected: `status: "decoded"`, `confidence: 0.9`, `side: "sell"`

**Fixture E — (if the ETH-as-tokenIn cases are genuinely ambiguous)**
- ETH external out + some token in — or whatever shape the `0x399aa84e...` ETH candidate has
- Expected: `status: "candidate"`, correct reason

Pull full raw_payloads from the DB for these hashes before writing fixtures, following the same
`rawPayload` consistency rules as the existing TALOS/BREAD fixtures.

### Step 5 — Run full quality checks

```bash
npm test
npx tsc --noEmit
npm run reprocess:candidates
```

Expected:
- `npm test`: 16 files / 148+ tests pass (146 + 2 new)
- `npx tsc --noEmit`: clean
- `reprocess:candidates`: `stored: 868`, `derived: 868`, `changed: 0`

## Acceptance Criteria

- [ ] `--update` flag added to `scripts/reprocess-candidates.mjs`; updates only `skipped` rows
- [ ] Running `-- --update` reports correct count of updated candidates
- [ ] DB updated: 22 candidates promoted from `skipped` to their correct derived status
- [ ] `npm run reprocess:candidates` preview shows `changed: 0` after the update
- [ ] At least 1 new ECHO Ethereum sell fixture added to `candidates.test.ts`
- [ ] `npm test` passes: 16 files, 148+ tests
- [ ] `npx tsc --noEmit` clean
- [ ] No parser logic changes

## Out of Scope

- Updating `copied`, `decoded`, `candidate`, or `failed` candidates (only `skipped`)
- Dashboard UI changes
- Any schema migrations
- Base chain candidates (Ethereum only in this slice)

## References

- Reprocess script: `scripts/reprocess-candidates.mjs`
- Upsert path: `src/lib/repositories.ts:612` (`upsertTradeCandidates`)
- Existing ECHO Ethereum fixture: `src/lib/candidates.test.ts` (search "ECHO" — the decoded
  Ethereum native-ETH buy exists; the sell does not yet)
- Base multi-router sell fixtures (prior slice): `src/lib/candidates.test.ts:1086–1388`
