# Value Unpriced 0x Fees in USD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Value 0x fees denominated in a non-USDC token (WETH, the traded token, or USDC) in USD and fold them into the simulated trade cost, warning only on fees that still cannot be valued.

**Architecture:** A new pure helper `valueUnpricedFees(unpriced, anchors)` in `src/lib/fees.ts` does the math. `normalizeZeroxPriceQuote` keeps emitting the `unpricedFees` data field but stops pushing the warning. `buildQuotePreview` (the orchestration layer that already holds `ethUsd`, token decimals, and the derived token price) assembles price anchors, calls the helper, folds the valued USD into `dexFeeUsd`/`totalCostUsd`, owns the single "could not value" warning, and records `valuedFeeUsd` in the snapshot.

**Tech Stack:** TypeScript, Vitest. Pure functions plus one orchestration wiring change. No DB/schema/route changes.

**Spec:** `docs/superpowers/specs/2026-06-05-value-unpriced-0x-fees-design.md`

**Important constraints:**
- Do NOT modify `src/lib/uniswap.ts`.
- `src/lib/zerox.ts` keeps the `unpricedFees` field and `UnpricedFee` type; only the warning push is removed.
- The Bash tool on this machine runs bash (not PowerShell); commands below work as written.

---

### Task 1: Pure `valueUnpricedFees` helper

**Files:**
- Create: `src/lib/fees.ts`
- Create: `src/lib/fees.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/fees.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { valueUnpricedFees, type FeePriceAnchor } from "./fees";

const TOKEN = "0xbuytoken0000000000000000000000000000beef";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const anchors: FeePriceAnchor[] = [
  { address: WETH, usdPrice: 3000, decimals: 18 },
  { address: USDC, usdPrice: 1, decimals: 6 },
  { address: TOKEN, usdPrice: 0.4, decimals: 18 }
];

describe("valueUnpricedFees", () => {
  it("values a fee in the traded token against its anchor", () => {
    const result = valueUnpricedFees(
      [{ type: "zeroExFee", token: TOKEN, amount: "5000000000000000000" }],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(2, 10);
    expect(result.pricedTokens).toEqual([TOKEN]);
    expect(result.stillUnpriced).toEqual([]);
  });

  it("values a fee in WETH using the native price anchor", () => {
    const result = valueUnpricedFees(
      [{ type: "zeroExFee", token: WETH.toUpperCase(), amount: "1000000000000000000" }],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(3000, 10);
    expect(result.stillUnpriced).toEqual([]);
  });

  it("values a fee in USDC at price 1", () => {
    const result = valueUnpricedFees(
      [{ type: "integratorFee", token: USDC, amount: "2500000" }],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(2.5, 10);
  });

  it("leaves a fee with no matching anchor unpriced", () => {
    const fee = { type: "zeroExFee", token: "0xunknown", amount: "1000000000000000000" };
    const result = valueUnpricedFees([fee], anchors);
    expect(result.valuedUsd).toBe(0);
    expect(result.pricedTokens).toEqual([]);
    expect(result.stillUnpriced).toEqual([fee]);
  });

  it("splits a mix of priced and unpriced fees", () => {
    const unknown = { type: "integratorFee", token: "0xunknown", amount: "1000000000000000000" };
    const result = valueUnpricedFees(
      [{ type: "zeroExFee", token: TOKEN, amount: "5000000000000000000" }, unknown],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(2, 10);
    expect(result.pricedTokens).toEqual([TOKEN]);
    expect(result.stillUnpriced).toEqual([unknown]);
  });

  it("does not credit a fee whose anchor price is not a positive number", () => {
    const fee = { type: "zeroExFee", token: TOKEN, amount: "5000000000000000000" };
    const result = valueUnpricedFees([fee], [
      { address: TOKEN, usdPrice: 0, decimals: 18 }
    ]);
    expect(result.valuedUsd).toBe(0);
    expect(result.stillUnpriced).toEqual([fee]);
  });

  it("returns a zeroed result for empty input", () => {
    expect(valueUnpricedFees([], anchors)).toEqual({
      valuedUsd: 0,
      pricedTokens: [],
      stillUnpriced: []
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fees.test.ts`
Expected: FAIL — cannot resolve `./fees`.

- [ ] **Step 3: Implement `src/lib/fees.ts`**

```ts
import { fromBaseUnits } from "./money";
import type { UnpricedFee } from "./zerox";

export type FeePriceAnchor = {
  address: string;
  usdPrice: number;
  decimals: number;
};

export type ValuedFees = {
  valuedUsd: number;
  pricedTokens: string[];
  stillUnpriced: UnpricedFee[];
};

export function valueUnpricedFees(unpriced: UnpricedFee[], anchors: FeePriceAnchor[]): ValuedFees {
  let valuedUsd = 0;
  const pricedTokens: string[] = [];
  const stillUnpriced: UnpricedFee[] = [];

  for (const fee of unpriced) {
    const anchor = anchors.find((a) => a.address.toLowerCase() === fee.token.toLowerCase());
    if (!anchor || !Number.isFinite(anchor.usdPrice) || anchor.usdPrice <= 0) {
      stillUnpriced.push(fee);
      continue;
    }
    try {
      valuedUsd += fromBaseUnits(fee.amount, anchor.decimals) * anchor.usdPrice;
      pricedTokens.push(fee.token);
    } catch {
      stillUnpriced.push(fee);
    }
  }

  return { valuedUsd, pricedTokens, stillUnpriced };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fees.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/lib/fees.ts src/lib/fees.test.ts
git commit -m "feat: add valueUnpricedFees helper"
```

---

### Task 2: Stop emitting the unpriced warning in `normalizeZeroxPriceQuote`

**Files:**
- Modify: `src/lib/zerox.ts` (`normalizeZeroxPriceQuote`)
- Modify: `src/lib/zerox.test.ts` (the two tests asserting the normalize warning)

- [ ] **Step 1: Update the failing tests first**

In `src/lib/zerox.test.ts`, find the `describe("normalizeZeroxPriceQuote unpriced fees", ...)` block. The warning will no longer be emitted by `normalizeZeroxPriceQuote`, but the `unpricedFees` data field must still be populated. Replace the two tests that assert `quote.warnings` contains the "could not value" string so they assert the field and the ABSENCE of the warning instead.

Replace the `"warns and carries unpricedFees when a fee cannot be valued"` test body with:

```ts
  it("carries unpricedFees data without emitting a warning", () => {
    const quote = normalizeZeroxPriceQuote(params, {
      buyAmount: "250000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: { zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" } }
    });
    expect(quote.dexFeeUsd).toBe(0);
    expect(quote.unpricedFees).toEqual([
      { type: "zeroExFee", token: "0xtoken", amount: "5000000000000000000" }
    ]);
    expect(quote.warnings).not.toContain(
      "0x reported a fee in 0xtoken that the simulator could not value in USD; the real cost is higher than shown."
    );
  });
```

Replace the `"lists multiple unpriced fee tokens in one warning"` test body with:

```ts
  it("carries multiple unpriced fees as data without a warning", () => {
    const quote = normalizeZeroxPriceQuote(params, {
      buyAmount: "250000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: {
        zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" },
        integratorFee: { amount: "1000000000000000000", token: "0xweth", type: "volume" }
      }
    });
    expect(quote.unpricedFees).toEqual([
      { type: "zeroExFee", token: "0xtoken", amount: "5000000000000000000" },
      { type: "integratorFee", token: "0xweth", amount: "1000000000000000000" }
    ]);
    expect(quote.warnings.some((w) => w.includes("could not value in USD"))).toBe(false);
  });
```

Leave the `"stays clean for USDC-denominated fees"` test as-is (it already asserts `warnings: []`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/zerox.test.ts`
Expected: FAIL — `normalizeZeroxPriceQuote` still pushes the warning, so `not.toContain` / `some(...)===false` assertions fail.

- [ ] **Step 3: Remove the warning push from `normalizeZeroxPriceQuote`**

In `src/lib/zerox.ts`, the function currently contains:

```ts
  const { dexFeeUsd, unpriced } = summarizeDexFees(rawResponse, params.chainId);
  if (unpriced.length) {
    const tokens = unpriced.map((fee) => fee.token).join(", ");
    warnings.push(
      `0x reported a fee in ${tokens} that the simulator could not value in USD; the real cost is higher than shown.`
    );
  }
```

Replace that block with just:

```ts
  const { dexFeeUsd, unpriced } = summarizeDexFees(rawResponse, params.chainId);
```

Leave the return object untouched — it still sets `dexFeeUsd` and `unpricedFees: unpriced`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/zerox.test.ts`
Expected: PASS (all zerox tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/zerox.ts src/lib/zerox.test.ts
git commit -m "refactor: move unpriced-fee warning out of normalize"
```

---

### Task 3: Value fees in `buildQuotePreview`

**Files:**
- Modify: `src/lib/external.ts` (`buildQuotePreview`, lines ~157-222)
- Modify: `src/lib/external.test.ts` (add a `buildQuotePreview` describe block + import)

- [ ] **Step 1: Write the failing integration tests**

In `src/lib/external.test.ts`:

(a) Add `buildQuotePreview` to the existing import from `./external` (the file already imports `normalizeAlchemyTransfers, resolveTokenFromAlchemy` from `./external` — add `buildQuotePreview` to that list). Also add `TOKENS` to the existing `./constants` import if not already present.

(b) Locate the `jsonResponse` helper already defined in this file (used by the `resolveTokenFromAlchemy` tests) and reuse it. Append this describe block at the end of the file:

```ts
describe("buildQuotePreview unpriced fee valuation", () => {
  const BUY_TOKEN = "0xbuytoken0000000000000000000000000000beef";
  const token = {
    address: BUY_TOKEN,
    symbol: "BUY",
    name: "Buy Token",
    decimals: 18,
    createdAt: new Date().toISOString()
  };
  const originalApiKey = process.env.ZEROX_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.ZEROX_API_KEY;
    else process.env.ZEROX_API_KEY = originalApiKey;
  });

  function mockSwapThenNative(swapQuote: Record<string, unknown>) {
    process.env.ZEROX_API_KEY = "test-key";
    return vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(swapQuote))
      .mockResolvedValueOnce(
        jsonResponse({ buyAmount: "3000000000", sellAmount: "1000000000000000000" })
      );
  }

  it("values a buy-token-denominated 0x fee and folds it into dexFeeUsd", async () => {
    mockSwapThenNative({
      buyAmount: "250000000000000000000",
      sellAmount: "100000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: { zeroExFee: { amount: "5000000000000000000", token: BUY_TOKEN, type: "volume" } }
    });

    const preview = await buildQuotePreview({
      side: "buy",
      token,
      usdAmount: 100,
      slippageBps: 100,
      gasBufferBps: 0
    });

    // 250 tokens for $100 => $0.40/token; 5-token fee => $2.00 valued
    expect(preview.dexFeeUsd).toBeCloseTo(2, 6);
    expect(preview.warnings.some((w) => w.includes("could not value in USD"))).toBe(false);
  });

  it("keeps warning and does not fold a fee in an unknown token", async () => {
    mockSwapThenNative({
      buyAmount: "250000000000000000000",
      sellAmount: "100000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: { zeroExFee: { amount: "5000000000000000000", token: "0xunknownfeetoken", type: "volume" } }
    });

    const preview = await buildQuotePreview({
      side: "buy",
      token,
      usdAmount: 100,
      slippageBps: 100,
      gasBufferBps: 0
    });

    expect(preview.dexFeeUsd).toBe(0);
    expect(preview.warnings.some((w) => w.includes("could not value in USD"))).toBe(true);
  });
});
```

Note: confirm `afterEach` and `vi` are already imported at the top of `external.test.ts` (they are — line 1 imports `afterEach, describe, expect, it, vi`). The file's top-level `afterEach` calls `vi.restoreAllMocks()`, which restores the fetch spy between tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/external.test.ts`
Expected: FAIL — `preview.dexFeeUsd` is `0` in the first test (fee not yet valued) and the warning is absent for the unknown-token test (warning currently lives in normalize, which no longer emits it after Task 2).

- [ ] **Step 3: Wire valuation into `buildQuotePreview`**

In `src/lib/external.ts`:

(a) Add to the imports at the top:

```ts
import { valueUnpricedFees, type FeePriceAnchor } from "./fees";
```

(b) The current code (around lines 157-182) reads:

```ts
  const ethUsd = await getNativeUsdPrice(chainId);
  const gasEth = ((quote.gasUnits ?? 0) * (quote.gasPriceWei ?? 0)) / 1e18;
  const gasUsd = (quote.gasUsd ?? gasEth * ethUsd) * (1 + input.gasBufferBps / 10_000);
  const dexFeeUsd = quote.dexFeeUsd;
  const warnings = [...quote.warnings];
  const snapshotBase = {
    provider: "0x",
    quoteKind: "price-preview",
    endpoint: quote.endpoint,
    chainId: quote.chainId,
    side: input.side,
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    inputAmount: quote.sellAmount,
    assumptions: {
      ethUsd,
      slippageBps: input.slippageBps,
      gasBufferBps: input.gasBufferBps,
      gasUnits: quote.gasUnits ?? 0,
      gasPriceWei: quote.gasPriceWei ?? 0,
      gasUsd: quote.gasUsd,
      dexFeeUsd
    },
    normalizedQuote: withoutRawResponse(quote),
    rawQuote: quote.rawResponse
  };
```

The problem: `dexFeeUsd`, `warnings`, and `snapshotBase` are built BEFORE the per-side `quantity` (needed for the traded-token price) is known. To fix this, compute the side-specific quantity and proceeds first, then value fees, then build the snapshot. Replace the block above through the end of the function with:

```ts
  const ethUsd = await getNativeUsdPrice(chainId);
  const gasEth = ((quote.gasUnits ?? 0) * (quote.gasPriceWei ?? 0)) / 1e18;
  const gasUsd = (quote.gasUsd ?? gasEth * ethUsd) * (1 + input.gasBufferBps / 10_000);

  const isBuy = input.side === "buy";
  const buyQuantity = fromBaseUnits(quote.buyAmount, input.token.decimals);
  const sellProceeds = fromBaseUnits(quote.buyAmount, chainTokens.usdc.decimals);
  const sellQuantity = input.tokenQuantity ?? 0;
  const tokenQuantity = isBuy ? buyQuantity : sellQuantity;
  const tokenNotionalUsd = isBuy ? input.usdAmount ?? 0 : sellProceeds;
  const derivedTokenPriceUsd = tokenQuantity > 0 ? tokenNotionalUsd / tokenQuantity : 0;

  const anchors: FeePriceAnchor[] = [
    { address: chainTokens.weth.address, usdPrice: ethUsd, decimals: chainTokens.weth.decimals },
    { address: chainTokens.usdc.address, usdPrice: 1, decimals: chainTokens.usdc.decimals },
    { address: input.token.address, usdPrice: derivedTokenPriceUsd, decimals: input.token.decimals }
  ];
  const { valuedUsd, stillUnpriced } = valueUnpricedFees(quote.unpricedFees ?? [], anchors);

  const dexFeeUsd = quote.dexFeeUsd + valuedUsd;
  const warnings = [...quote.warnings];
  if (stillUnpriced.length) {
    const tokens = stillUnpriced.map((fee) => fee.token).join(", ");
    warnings.push(
      `0x reported a fee in ${tokens} that the simulator could not value in USD; the real cost is higher than shown.`
    );
  }

  const snapshotBase = {
    provider: "0x",
    quoteKind: "price-preview",
    endpoint: quote.endpoint,
    chainId: quote.chainId,
    side: input.side,
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    inputAmount: quote.sellAmount,
    assumptions: {
      ethUsd,
      slippageBps: input.slippageBps,
      gasBufferBps: input.gasBufferBps,
      gasUnits: quote.gasUnits ?? 0,
      gasPriceWei: quote.gasPriceWei ?? 0,
      gasUsd: quote.gasUsd,
      dexFeeUsd
    },
    valuedFeeUsd: valuedUsd,
    stillUnpricedFees: stillUnpriced,
    normalizedQuote: withoutRawResponse(quote),
    rawQuote: quote.rawResponse
  };

  if (isBuy) {
    const quantity = buyQuantity;
    const notionalUsd = input.usdAmount ?? 0;
    const slippageUsd = notionalUsd * (input.slippageBps / 10_000);
    const totalCostUsd = notionalUsd + gasUsd + slippageUsd + dexFeeUsd;
    return {
      side: "buy",
      token: input.token,
      quantity,
      priceUsd: quantity > 0 ? notionalUsd / quantity : 0,
      notionalUsd,
      gasUsd,
      slippageUsd,
      dexFeeUsd,
      totalCostUsd,
      sellProceedsUsd: 0,
      warnings,
      quoteSnapshot: snapshotBase
    };
  }

  const quantity = sellQuantity;
  const proceedsUsd = sellProceeds;
  const slippageUsd = proceedsUsd * (input.slippageBps / 10_000);
  const totalFees = gasUsd + slippageUsd + dexFeeUsd;
  return {
    side: "sell",
    token: input.token,
    quantity,
    priceUsd: quantity > 0 ? proceedsUsd / quantity : 0,
    notionalUsd: proceedsUsd,
    gasUsd,
    slippageUsd,
    dexFeeUsd,
    totalCostUsd: totalFees,
    sellProceedsUsd: Math.max(0, proceedsUsd - totalFees),
    warnings,
    quoteSnapshot: snapshotBase
  };
```

This preserves the existing buy/sell math exactly (same `quantity`, `priceUsd`, `slippageUsd`, totals) while routing `dexFeeUsd` through the valued total and computing the warning from `stillUnpriced`. The `withoutRawResponse`, `fromBaseUnits`, and `chainTokens` references are already in scope.

- [ ] **Step 4: Run the targeted tests**

Run: `npx vitest run src/lib/external.test.ts`
Expected: PASS, including the two new `buildQuotePreview` tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: all files pass (existing accounting/quote tests unaffected — the buy/sell math is unchanged).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/external.ts src/lib/external.test.ts
git commit -m "feat: value unpriced 0x fees into simulated cost"
```

---

### Task 4: Update handoff doc

**Files:**
- Modify: `NEXT_VERSION.md`

- [ ] **Step 1: Record the change**

Under "Completed Foundation" in `NEXT_VERSION.md`, add a bullet:

```markdown
- Unpriced 0x fees are now valued in USD and folded into simulated cost: `valueUnpricedFees` (`src/lib/fees.ts`) prices a fee denominated in WETH/native, USDC, or the traded token against anchors `buildQuotePreview` already has (`ethUsd`, `1`, and the derived token price), adds the valued amount to `dexFeeUsd`/`totalCostUsd`, and only warns about fees in tokens it still cannot value. `normalizeZeroxPriceQuote` no longer emits the unpriced warning; `buildQuotePreview` owns it and records `valuedFeeUsd` in the quote snapshot.
```

In "Latest Session Notes", replace the prior unpriced-fee-detection note's "Just shipped" framing with a short note that valuation now shipped on top of detection, and record verification (`npm test` file/test counts, `npx tsc --noEmit` pass).

- [ ] **Step 2: Commit**

```bash
git add NEXT_VERSION.md
git commit -m "docs: note unpriced 0x fee valuation in handoff"
```

---

## Self-Review Notes

- **Spec coverage:** pure `valueUnpricedFees` with anchor matching + `fromBaseUnits` valuation + stillUnpriced split (Task 1); normalize drops warning, keeps `unpricedFees` field (Task 2); `buildQuotePreview` builds WETH/USDC/token anchors, folds `valuedUsd` into `dexFeeUsd`→`totalCostUsd`, owns the `stillUnpriced` warning, records `valuedFeeUsd` + `stillUnpricedFees` in snapshot (Task 3); conservative fold documented in spec; handoff updated (Task 4). All spec sections mapped.
- **Type consistency:** `FeePriceAnchor { address, usdPrice, decimals }` and `ValuedFees { valuedUsd, pricedTokens, stillUnpriced }` defined in Task 1 and reused verbatim in Task 3. `valueUnpricedFees(quote.unpricedFees ?? [], anchors)` matches the `UnpricedFee[]` field on `NormalizedZeroxQuote`.
- **Behavior preservation:** Task 3 keeps the exact buy/sell `quantity`/`priceUsd`/`slippageUsd`/totals math; only `dexFeeUsd` sourcing and the warning derivation change. `buyQuantity`/`sellProceeds` are computed once and reused for both the anchor price and the return values, avoiding divergence.
- **Placeholder scan:** none.
