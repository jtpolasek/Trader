# Brainstorm: Base Multi-Router Sell Parser Fixtures

**Date:** 2026-06-07
**Status:** Ready for planning

## What We're Building

Add real Base multi-router sell fixtures to `src/lib/candidates.test.ts` drawn from stored Alchemy raw payloads in `data/paper-trader.db`. The goal is to harden the parser's sell-direction inference for the most common unfixed gap: sells routed through multiple contracts on Base, where several inbound/outbound ERC-20 legs make it hard to identify the clear "token-out / proceeds-in" shape. After adding fixtures we run `npm run reprocess:candidates` in preview mode to see if the new parse logic moves any stored candidates before applying.

## Why This Approach

Real raw payloads from the local DB are the most authentic source — they contain the exact field shapes (including missing/null fields) that the live app encounters. Synthetic fixtures are faster to write but routinely miss the real quirks that make parsing fail. The existing test harness (`activity()` helper + inline fixture arrays in `candidates.test.ts`) makes it easy to paste raw payloads in directly.

## Key Decisions

- **Source:** Pull raw payloads from `data/paper-trader.db` using a quick SQLite query filtered to `chainId = 8453` (Base) and `category` IN (`erc20`, `external`, `internal`), grouped by `hash`, looking for hashes with 3+ transfers (likely multi-router).
- **Fixture structure:** Follow the existing `activity()` helper pattern — one `describe` block per transaction hash, containing an array of `activity()` calls with `rawPayload` set to the stored JSON string.
- **Coverage target:** At least 2-3 multi-router sell hashes: one that should decode (clear token-out + clear proceeds-in + ignorable noise), one that should stay review-only (competing proceeds or ambiguous direction), and one that is currently skipped/failed.
- **No parser changes in this slice** unless a fixture trivially fails due to a one-line guard. The primary deliverable is fixtures + confirmation that existing logic handles them correctly (or documents where it doesn't).
- **Reprocess check:** After fixtures pass, run `npm run reprocess:candidates` (no `--apply`) and record the before/after decoded/review/skipped counts in the PR description.

## Scope (YAGNI)

- Out of scope: fixing the parser in this slice (that's the next slice after fixtures reveal the gaps).
- Out of scope: native ETH sells, buy fixtures, or Ethereum chain fixtures.
- Out of scope: any DB schema or route changes.

## Open Questions

None — requirements are clear enough to plan.

## Success Criteria

- `npm test` still passes with new fixtures added (16+ files, 143+ tests).
- At least one multi-router sell fixture decodes correctly, at least one stays review-only with a correct reason.
- `npm run reprocess:candidates` preview runs cleanly and counts are recorded.
- `npx tsc --noEmit` clean.
