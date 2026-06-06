---
title: "feat: Live unrealized P&L on open positions"
type: feat
status: completed
date: 2026-06-06
brainstorm: docs/brainstorms/2026-06-06-live-unrealized-pnl-brainstorm.md
---

# feat: Live unrealized P&L on open positions

## Overview

Open positions currently show cost basis and fees but no current value or unrealized gain/loss. This feature adds a **"Refresh prices"** button to the Positions panel that fetches current spot prices for all open positions via a new lightweight `/api/prices` endpoint, then displays unrealized P&L inline — color-coded good/bad — with a stale warning after 2 minutes.

## Problem Statement

The Positions panel shows:
- Quantity, average entry, cost basis, fees paid

It does **not** show:
- Current token price
- Current market value of the position
- Unrealized P&L = `(currentPrice - avgEntry) × quantity`

Without this, a user can't tell whether they're winning or losing on open positions without manually executing a sell quote for each one.

## Key Constraints Found in Research

- **`Position` type has no `chainId`** (`src/lib/types.ts:19`). Neither do the `trades` or `tokens` tables (`src/lib/db.ts`). The endpoint will accept a `chainId` query param and default to Base (8453) — the app's primary chain. This is a known limitation; most users trade on Base.
- **Token decimals** are available via `getToken(address)` from the DB (`src/lib/repositories.ts:156`). Any token with an open position was already traded and is guaranteed to exist in the tokens table.
- **`getZeroxPrice`** is the right primitive (`src/lib/zerox.ts:66`). It takes `{chainId, sellToken, buyToken, sellAmount}` and returns `buyAmount` in token base units — no gas/slippage overhead.
- **`isQuoteStale`** already exists (`src/lib/quoteAge.ts`) with 2-minute threshold — reuse for the stale warning.
- **Existing API route pattern**: `NextResponse.json` + zod validation, seen in `src/app/api/quotes/route.ts`.

## Proposed Solution

### 1. New backend endpoint: `GET /api/prices`

**File:** `src/app/api/prices/route.ts`

Query params:
- `tokens` — comma-separated token addresses (max 20)
- `chainId` — integer, default `8453` (Base)

For each token, in parallel:
1. Look up `token.decimals` from DB via `getToken(address)`
2. Call `getZeroxPrice({ chainId, sellToken: usdc.address, buyToken: tokenAddress, sellAmount: toBaseUnits(10, usdc.decimals) })`
3. Derive price: `priceUsd = 10 / fromBaseUnits(quote.buyAmount, token.decimals)`
4. Return `null` for tokens that fail (no liquidity, unknown token, etc.) — partial results are fine

Response shape:
```ts
{ prices: Record<string, number | null>, fetchedAt: string }
```

Using $10 USDC as the sell amount avoids precision issues for both very cheap memecoins and expensive tokens.

### 2. Frontend additions: `src/app/page.tsx`

**New state:**
```ts
const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});
const [pricesFetchedAt, setPricesFetchedAt] = useState<number | null>(null);
const [isPricesStale, setIsPricesStale] = useState(false);
```

**New `fetchPositionPrices()` function:**
- Builds `?tokens=addr1,addr2&chainId=8453` from `data.positions`
- Calls `GET /api/prices`
- Sets `positionPrices`, `pricesFetchedAt`, resets stale flag
- Guarded by `busy` state key `"prices"`

**Stale interval:**
- Reuse the existing `useEffect` / `setInterval` pattern from the quote stale check
- Watch `pricesFetchedAt`, set `isPricesStale` after 2 min via `isQuoteStale`

**Positions panel additions:**
- Header row: "Refresh prices" button (with `<RefreshCw>` icon) next to the "N open" pill
- Stale warning banner above the position list when `isPricesStale`
- Per-position card: two new `<Mini>` cells — **Current value** and **Unrealized P&L**
  - Current value: `formatUsd(positionPrices[position.tokenAddress] * position.quantity)` — show `-` if no price loaded
  - Unrealized P&L: `formatUsd((positionPrices[position.tokenAddress] - position.averageEntryUsd) * position.quantity)` — color class `good` if positive, `bad` if negative, neutral if no price

## Acceptance Criteria

- [x] `GET /api/prices?tokens=0x...&chainId=8453` returns `{ prices: { "0x...": 1.23 }, fetchedAt: "..." }`
- [x] Tokens with no liquidity or unknown to DB return `null` in the prices map (not a 500)
- [x] "Refresh prices" button appears in the Positions panel header; disabled while loading
- [x] After clicking, each position card shows Current value and Unrealized P&L
- [x] Positions with no price loaded show `-` for both fields
- [x] Unrealized P&L is green when positive, red when negative
- [x] A stale warning banner appears in the Positions panel after prices are >2 minutes old
- [x] Prices are NOT persisted to DB — React state only
- [x] Existing trade execution and quote preview flows are unaffected

## Technical Considerations

- **Partial failure:** A single token's 0x failure must not fail the whole batch. Catch per-token errors and return `null`. Log the error server-side.
- **Rate limits:** Positions list is typically <10 items; parallel calls are fine. If it ever grows large, add a concurrency limit (e.g., `Promise.allSettled` in chunks of 10).
- **Chain defaulting:** The endpoint defaults to Base (8453). This is correct for ~95% of users. Ethereum positions (chainId 1) would get incorrect prices. Known limitation, acceptable for now.
- **$10 USDC sell amount:** Balances precision for cheap memecoins vs. normal tokens. 0x's `/price` endpoint is read-only (no settlement), so this has no real-world cost.
- **No new DB tables or migrations needed.**

## File Checklist

- [x] `src/app/api/prices/route.ts` — new GET handler
- [x] `src/app/page.tsx` — state, fetch function, stale interval, button, position card additions
- [x] `src/lib/types.ts` — no changes needed (prices are ephemeral, not typed as a named type)

## References

- `src/lib/zerox.ts:66` — `getZeroxPrice` signature
- `src/lib/external.ts:111` — `getNativeUsdPrice` as a usage example of `getZeroxPrice`
- `src/lib/quoteAge.ts` — `isQuoteStale` for reuse
- `src/lib/repositories.ts:156` — `getToken` for decimals lookup
- `src/lib/constants.ts:45` — `getChainTokens` for USDC address per chain
- `src/lib/money.ts` — `toBaseUnits`, `fromBaseUnits`, `formatUsd`
- `src/app/api/quotes/route.ts` — existing route pattern to follow
- `docs/brainstorms/2026-06-06-live-unrealized-pnl-brainstorm.md`
