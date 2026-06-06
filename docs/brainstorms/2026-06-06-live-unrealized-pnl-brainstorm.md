# Live Unrealized P&L on Open Positions

**Date:** 2026-06-06  
**Status:** Ready for planning

---

## What We're Building

A "Refresh prices" button in the Positions panel that fetches the current spot price for each open position and displays unrealized P&L inline. The portfolio already tracks cost basis and fees per position — this adds the missing current value column so users can see whether they're up or down without manually executing a sell quote.

---

## Why This Approach

**New `/api/prices` endpoint + on-demand button.**

- The existing quote flow (`buildQuotePreview`) is heavy — it fetches gas, slippage, ETH/USD, and fee data. That's overkill for a spot price check.
- `getZeroxPrice` (already in `src/lib/zerox.ts`) is the lightweight primitive underneath — it takes `sellToken`, `buyToken`, `sellAmount` and returns `buyAmount`. Perfect for a quick USDC→token price lookup.
- A dedicated `/api/prices` route fetches all open positions in parallel and returns `{ [tokenAddress]: priceUsd }`. Clean separation from the trade flow.
- An on-demand button avoids background polling, rate limit burns, and stale-interval complexity.

---

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Price oracle | `getZeroxPrice` (existing) | Already integrated, no new dependency |
| Fetch strategy | Parallel per position in one request | Fast; positions list is small (typically <10) |
| Trigger | Manual "Refresh prices" button | No polling complexity; user controls when they care |
| Data storage | React state only (`Map<address, priceUsd>`) | Prices are ephemeral; no need to persist |
| Unrealized PnL formula | `(currentPrice - avgEntry) × quantity` | Matches how cost basis is already tracked |
| Chain awareness | Use `position.chainId` (if available) else default to Base | Positions are already tagged by chain |
| Stale warning | Reuse `isQuoteStale` after 2 min | Consistent with the existing quote staleness pattern |

---

## What Changes

### Backend
- **New route:** `GET /api/prices?tokens=addr1,addr2&chainId=8453`
  - Reads token addresses and chainId from query params
  - Calls `getZeroxPrice` for each token in parallel (sell 1 USDC → token to get implied price)
  - Returns `{ prices: { [address]: number } }`
  - Returns partial results on failure (one bad token doesn't break the rest)

### Frontend (`src/app/page.tsx`)
- New state: `positionPrices: Record<string, number>`, `pricesFetchedAt: number | null`, `pricesStale: boolean`
- "Refresh prices" button added to the Positions panel header
- Each position card gains: **Current value**, **Unrealized P&L** (color-coded good/bad)
- Stale warning after 2 min reuses `isQuoteStale`

---

## Out of Scope

- Auto-refresh / polling
- Persisting prices to the DB
- Showing unrealized P&L in the top-level metrics dashboard (could be a follow-on)
- Multi-chain mixed positions in a single fetch (handle per-chain grouping in a follow-on if needed)

---

## Open Questions

_None — all resolved during brainstorm._

---

## Resolved Questions

- **Price source:** `getZeroxPrice` (lightweight, already integrated) over full `buildQuotePreview`
- **Refresh trigger:** On-demand button over polling or piggybacking portfolio refresh
- **Staleness:** Reuse existing `isQuoteStale` / 2-minute threshold
