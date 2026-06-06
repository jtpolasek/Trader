# Unpriced 0x Fee Detection — Design

## Problem

`estimateDexFeeUsd` in `src/lib/zerox.ts` only values 0x fees denominated in
USDC. Any fee taken in another token returns `0` and is silently dropped from
the cost estimate.

This matters most for buys. On a buy (sell USDC → buy token), 0x typically takes
its `zeroExFee` in the **buy token**, not USDC. So the simulator reports the 0x
fee as `$0` and understates the true cost of the trade — with no warning to the
user. Every other cost/quality signal in the app surfaces a badge or warning, so
this silent hole undercuts the trustworthiness goal (Build Next #1).

## Goal

Detect when 0x reports a fee the simulator cannot value in USD, surface it as a
quote warning plus structured metadata, and prove the behavior with tests.

This slice does **not** convert the unpriced fee to USD, broaden `issues`
parsing, or add stale-quote infrastructure. Those remain future work.

## Approach

Replace the single-purpose `estimateDexFeeUsd(rawQuote, chainId) → number` with
one pure function that returns both the priced total and the leftovers it could
not value:

```ts
summarizeDexFees(rawQuote: ZeroxRawQuote, chainId?: number): {
  dexFeeUsd: number;
  unpriced: UnpricedFee[];
}

type UnpricedFee = {
  type: string;   // "zeroExFee" | "integratorFee"
  token: string;  // fee token address as reported by 0x
  amount: string; // base-unit amount as reported by 0x
};
```

Keeping the priced sum and the unpriced list in one function keeps all fee
iteration in a single place; the consumer does not re-walk the fee structure.

### What counts as a fee here

Only `integratorFee` and `zeroExFee` are considered for unpriced detection.
`gasFee` is excluded because network gas is already estimated separately via
`gasUnits × gasPriceWei` in `buildQuotePreview`; flagging it as "unpriced" would
be misleading noise.

Existing behavior is preserved for the priced sum: fees denominated in USDC
(including `gasFee` when USDC-denominated) are still summed into `dexFeeUsd`
exactly as before. The only addition is the `unpriced` list.

### What counts as unpriced

A fee entry is unpriced when all of the following hold:

- the fee object is present,
- its `amount` parses to a finite value greater than `0`, and
- its `token` is not the chain USDC address (case-insensitive).

A fee with no amount, a zero/unparseable amount, or a USDC token is not
unpriced.

### Wiring into the normalized quote

`normalizeZeroxPriceQuote` calls `summarizeDexFees`, sets `dexFeeUsd` from the
result, and:

- adds `unpricedFees: UnpricedFee[]` to `NormalizedZeroxQuote` (empty array when
  none), and
- when `unpriced.length > 0`, pushes a single warning into `warnings`:

  > `0x reported a fee in <TOKEN> that the simulator could not value in USD; the real cost is higher than shown.`

  `<TOKEN>` is the fee token address (symbol resolution is out of scope). When
  multiple unpriced fees exist, list their tokens comma-separated in one
  warning rather than emitting several near-duplicate lines.

Because the warning rides the existing `warnings` array, it flows automatically
through the quote snapshot and the existing "Quote warn" trade-row badge
(`getSnapshotWarnings` / `getTradeSignals` in `src/app/page.tsx`). No new badge
or UI wiring is required. `unpricedFees` is carried on the normalized quote (and
therefore in the stored snapshot) for later structured display if wanted.

## Components touched

- `src/lib/zerox.ts`
  - New exported `summarizeDexFees` (replaces internal `estimateDexFeeUsd`).
  - New exported `UnpricedFee` type; `unpricedFees` added to
    `NormalizedZeroxQuote`.
  - `normalizeZeroxPriceQuote` updated to set `dexFeeUsd` + `unpricedFees` and
    push the warning.
- `src/lib/zerox.test.ts` (new) — direct unit tests for the fee logic.

No API route, schema, or DB change. The snapshot gains an additive field; older
stored snapshots without `unpricedFees` remain valid (consumers treat a missing
field as empty).

## Testing

New `src/lib/zerox.test.ts` covering `summarizeDexFees` and
`normalizeZeroxPriceQuote`:

- Buy-token-denominated `zeroExFee` → `dexFeeUsd` excludes it, `unpriced` has one
  entry, and the normalized quote carries the warning + populated `unpricedFees`.
- USDC-denominated fee → counted in `dexFeeUsd`, `unpriced` empty, no warning.
- `gasFee` in a non-USDC token → **not** flagged as unpriced (no warning).
- Multiple unpriced fees → single warning listing both tokens.
- No fees → `dexFeeUsd: 0`, `unpriced: []`, no fee warning.

Existing `external.test.ts` quote-preview tests must still pass unchanged.

## Definition of done

- `summarizeDexFees` and the new `unpricedFees`/warning path are implemented.
- A buy whose 0x fee is in the buy token produces a quote warning instead of a
  silent `$0` fee.
- New `zerox.test.ts` passes and the full suite (`npm test`) stays green.
- `npx tsc --noEmit` passes.
- No behavior change for trades whose fees are USDC-denominated or absent.
