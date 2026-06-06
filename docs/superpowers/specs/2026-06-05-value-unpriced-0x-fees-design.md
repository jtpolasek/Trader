# Value Unpriced 0x Fees in USD — Design

## Problem

The previous slice ([`2026-06-05-unpriced-0x-fee-detection-design.md`](2026-06-05-unpriced-0x-fee-detection-design.md))
made the simulator *detect* 0x fees it could not value in USD (e.g. a buy's
`zeroExFee`, typically taken in the buy token) and warn about them — but it still
reported those fees as `$0` of cost. The cost remains understated; the warning
only tells the user "there is a hidden cost" without quantifying it.

This slice values those fees in USD and folds them into the simulated cost, so
the reported `dexFeeUsd` / total cost reflects reality.

## Goal

For each fee 0x reports in a non-USDC token, value it in USD using price anchors
already available during quote building, add the valued amount to the simulated
cost, and only warn about fees that genuinely cannot be valued.

Non-goals: adding a network call to price arbitrary third-party fee tokens;
changing `issues` parsing; stale-quote infra.

## Key decisions

- **Fold valued fees into simulated cost.** A valued fee is added to `dexFeeUsd`
  (and therefore `totalCostUsd` and fee accounting), exactly like the existing
  USDC-denominated dex fee. Once valued, a fee no longer warns.
- **Three price anchors, no extra network calls.** `buildQuotePreview` already
  holds everything needed to value a fee denominated in: WETH/native (via the
  `ethUsd` it already fetched), USDC (= 1.0), or the traded token (via the
  buy/sell price it already derives). A fee in any other token cannot be valued
  and keeps its warning.
- **Conservative on possible double-count.** 0x may already net a buy-token fee
  out of `buyAmount`. Without real payloads to confirm, we value-and-fold
  anyway: this can only ever overstate cost slightly, never understate it, which
  matches the project's "trustworthiness over precision" stance. Documented as an
  assumption.
- **`buildQuotePreview` owns the user-facing warning.** `normalizeZeroxPriceQuote`
  keeps emitting the `unpricedFees` *data* field but no longer pushes the
  "could not value" warning. `buildQuotePreview` re-derives that warning from the
  fees that remain unpriced after valuation. This is safe because the normalized
  quote reaches the user only through `buildQuotePreview`; the other caller
  (`getNativeUsdPrice`) reads only `buyAmount`, and the Uniswap fallback carries
  no `unpricedFees` (valuation is a no-op there).

## Architecture

### New pure helper: `src/lib/fees.ts`

```ts
import type { UnpricedFee } from "./zerox";

export type FeePriceAnchor = {
  address: string;   // fee token address
  usdPrice: number;  // USD price per whole token
  decimals: number;  // token decimals for base-unit conversion
};

export type ValuedFees = {
  valuedUsd: number;          // sum of fees valued against an anchor
  pricedTokens: string[];     // fee token addresses that matched an anchor
  stillUnpriced: UnpricedFee[]; // fees with no matching anchor
};

export function valueUnpricedFees(
  unpriced: UnpricedFee[],
  anchors: FeePriceAnchor[]
): ValuedFees;
```

Behavior, per fee:
- Find an anchor whose `address` matches the fee `token` (case-insensitive).
- If found and the anchor `usdPrice` is a finite number `> 0`: value the fee as
  `fromBaseUnits(fee.amount, anchor.decimals) * anchor.usdPrice`, add to
  `valuedUsd`, push the token to `pricedTokens`.
- If no anchor matches, or the matched anchor price is not a usable positive
  number, or `fromBaseUnits` throws: leave the fee in `stillUnpriced` and do not
  contribute to `valuedUsd`.

Empty `unpriced` → `{ valuedUsd: 0, pricedTokens: [], stillUnpriced: [] }`.

`valueUnpricedFees` is pure: no I/O, no env, no dependence on chain config. It
takes already-resolved anchors so it can be unit-tested in isolation.

### `normalizeZeroxPriceQuote` (`src/lib/zerox.ts`)

Drop the block that pushes the unpriced-fee warning. Keep computing
`summarizeDexFees` and keep setting `dexFeeUsd` and the `unpricedFees` field on
the normalized quote. The `NormalizedZeroxQuote` type is unchanged. The gas
warning and `summarizeZeroxIssues` warnings are untouched.

### `buildQuotePreview` (`src/lib/external.ts`)

After computing the quote, `ethUsd`, and the derived token price for the side
being quoted (`notionalUsd / quantity` for a buy; `proceedsUsd / quantity` for a
sell), assemble anchors:

```ts
const anchors: FeePriceAnchor[] = [
  { address: chainTokens.weth.address, usdPrice: ethUsd, decimals: chainTokens.weth.decimals },
  { address: chainTokens.usdc.address, usdPrice: 1, decimals: chainTokens.usdc.decimals },
  { address: input.token.address, usdPrice: derivedTokenPriceUsd, decimals: input.token.decimals }
];
```

Then:

```ts
const { valuedUsd, stillUnpriced } = valueUnpricedFees(quote.unpricedFees ?? [], anchors);
const dexFeeUsd = quote.dexFeeUsd + valuedUsd;
const warnings = [...quote.warnings];
if (stillUnpriced.length) {
  const tokens = stillUnpriced.map((fee) => fee.token).join(", ");
  warnings.push(
    `0x reported a fee in ${tokens} that the simulator could not value in USD; the real cost is higher than shown.`
  );
}
```

`derivedTokenPriceUsd` is the price already computed for the preview:
- buy: `quantity > 0 ? notionalUsd / quantity : 0`
- sell: `quantity > 0 ? proceedsUsd / quantity : 0`

The valued `dexFeeUsd` flows into `totalCostUsd` (buy: `notionalUsd + gasUsd +
slippageUsd + dexFeeUsd`; sell: into `totalFees` and `sellProceedsUsd`) exactly
as the existing `dexFeeUsd` does today — no new accounting path.

Because `buildQuotePreview` currently spreads `quote.warnings` into the preview
`warnings` and reads `quote.dexFeeUsd` directly, those two reads change to the
locally-computed `warnings` and `dexFeeUsd` above.

### Snapshot

`snapshotBase` gains `valuedFeeUsd: valuedUsd`, and its representation of unpriced
fees reflects `stillUnpriced` (not the full detected list) so the snapshot's
warning and its unpriced data agree. The embedded `normalizedQuote` (via
`withoutRawResponse`) still carries the raw detected `unpricedFees`; the
preview-level `valuedFeeUsd` and the `stillUnpriced`-derived warning are the
authoritative post-valuation view. `assumptions.dexFeeUsd` already exists and now
carries the valued total.

No DB/schema/route change. Snapshot fields are additive; older snapshots without
`valuedFeeUsd` remain valid (consumers treat a missing field as `0`).

## Data flow (buy example)

1. 0x returns `zeroExFee` = `5000000000000000000` (5.0 of an 18-decimal buy
   token), `buyAmount` → quantity `250`, `notionalUsd` = `$100`.
2. `summarizeDexFees` (unchanged) flags the fee as unpriced (non-USDC token).
3. `buildQuotePreview` derives token price `100 / 250 = $0.40`, builds anchors,
   and calls `valueUnpricedFees`.
4. The fee matches the token anchor → `5.0 * 0.40 = $2.00` valued,
   `stillUnpriced = []`.
5. `dexFeeUsd = quote.dexFeeUsd + 2.00`; no unpriced warning;
   `snapshot.valuedFeeUsd = 2.00`.

A fee in an unrelated token finds no anchor → stays in `stillUnpriced` → warning
fires, `valuedUsd` unaffected.

## Testing

### `src/lib/fees.test.ts` (new) — pure `valueUnpricedFees`
- Fee in the traded token, anchor present → valued correctly, `stillUnpriced` empty.
- Fee in WETH, WETH anchor → valued via `ethUsd`.
- Fee in USDC-address anchor (price 1) → valued.
- Fee in an unrelated token (no anchor) → `valuedUsd` 0, fee in `stillUnpriced`.
- Multiple fees, mixed priced/unpriced → correct split and sum.
- Anchor with non-positive/NaN price → fee stays unpriced (not credited).
- Empty input → zeroed result.

### `src/lib/external.test.ts` — extend `buildQuotePreview`
- Buy whose `zeroExFee` is in the buy token: `dexFeeUsd` and `totalCostUsd`
  increase by the valued amount, and **no** unpriced warning is present.
- Buy whose fee is in an unrelated token: warning present, `dexFeeUsd` unchanged
  by it.

(These follow the existing `buildQuotePreview` test setup, which mocks the swap
quote and native price.)

### `src/lib/zerox.test.ts` — update
- The two tests asserting the normalize-level unpriced warning are changed to
  assert the `unpricedFees` data field only (warning no longer emitted by
  `normalizeZeroxPriceQuote`).

## Definition of done

- `valueUnpricedFees` exists in `src/lib/fees.ts`, pure and unit-tested.
- `normalizeZeroxPriceQuote` no longer pushes the unpriced warning but still sets
  `unpricedFees`.
- `buildQuotePreview` values fees against WETH/USDC/traded-token anchors, folds
  the valued USD into `dexFeeUsd`/`totalCostUsd`, warns only on `stillUnpriced`,
  and records `valuedFeeUsd` in the snapshot.
- A buy with a buy-token-denominated 0x fee shows a non-zero dex fee and no
  unpriced warning; a fee in an unknown token still warns.
- `npm test` and `npx tsc --noEmit` pass; existing accounting and quote tests
  remain green.
