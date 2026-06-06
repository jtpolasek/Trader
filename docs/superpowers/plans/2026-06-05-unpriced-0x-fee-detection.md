# Unpriced 0x Fee Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a quote warning and structured metadata when 0x reports a fee the simulator cannot value in USD, instead of silently dropping it to $0.

**Architecture:** Replace the private `estimateDexFeeUsd` in `src/lib/zerox.ts` with an exported `summarizeDexFees` that returns both the USDC-priced total and a list of unpriced fees. `normalizeZeroxPriceQuote` consumes it, adds an `unpricedFees` field to the normalized quote, and pushes one warning when unpriced fees exist. The warning rides the existing `warnings` → "Quote warn" badge path, so no UI changes are needed.

**Tech Stack:** TypeScript, Vitest. Pure functions only — no API/DB/schema changes.

**Important:** `estimateDexFeeUsd` also exists as a *separate* private function in `src/lib/uniswap.ts`. Do NOT touch the uniswap one. This plan only changes `src/lib/zerox.ts`.

---

### Task 1: `summarizeDexFees` returns priced total plus unpriced fees

**Files:**
- Modify: `src/lib/zerox.ts` (replace `estimateDexFeeUsd` at lines 180-195; add `UnpricedFee` type)
- Test: `src/lib/zerox.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/zerox.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TOKENS } from "./constants";
import { summarizeDexFees } from "./zerox";

describe("summarizeDexFees", () => {
  it("prices USDC-denominated fees and reports nothing unpriced", () => {
    const result = summarizeDexFees({
      fees: { zeroExFee: { amount: "1500000", token: TOKENS.USDC.address, type: "volume" } }
    });
    expect(result.dexFeeUsd).toBe(1.5);
    expect(result.unpriced).toEqual([]);
  });

  it("flags a buy-token-denominated 0x fee as unpriced without crediting it", () => {
    const result = summarizeDexFees({
      fees: { zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" } }
    });
    expect(result.dexFeeUsd).toBe(0);
    expect(result.unpriced).toEqual([
      { type: "zeroExFee", token: "0xtoken", amount: "5000000000000000000" }
    ]);
  });

  it("does not flag a non-USDC gasFee as unpriced", () => {
    const result = summarizeDexFees({
      fees: { gasFee: { amount: "5000000000000000000", token: "0xweth", type: "gas" } }
    });
    expect(result.unpriced).toEqual([]);
  });

  it("returns no fees when none are present", () => {
    expect(summarizeDexFees({})).toEqual({ dexFeeUsd: 0, unpriced: [] });
  });

  it("ignores zero or unparseable fee amounts", () => {
    const result = summarizeDexFees({
      fees: {
        zeroExFee: { amount: "0", token: "0xtoken", type: "volume" },
        integratorFee: { amount: "not-a-number", token: "0xtoken", type: "volume" }
      }
    });
    expect(result.unpriced).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/zerox.test.ts`
Expected: FAIL — `summarizeDexFees` is not exported from `./zerox`.

- [ ] **Step 3: Replace `estimateDexFeeUsd` with `summarizeDexFees`**

In `src/lib/zerox.ts`, delete the private `estimateDexFeeUsd` function (lines 180-195) and add in its place:

```ts
export type UnpricedFee = {
  type: string;
  token: string;
  amount: string;
};

export function summarizeDexFees(
  quote: ZeroxRawQuote,
  chainId = ETH_CHAIN_ID
): { dexFeeUsd: number; unpriced: UnpricedFee[] } {
  const fees = quote.fees;
  if (!fees) return { dexFeeUsd: 0, unpriced: [] };

  const usdc = getChainTokens(chainId).usdc;
  const isUsdc = (token?: string) => token?.toLowerCase() === usdc.address.toLowerCase();

  let dexFeeUsd = 0;
  for (const fee of [fees.integratorFee, fees.zeroExFee, fees.gasFee]) {
    if (!fee?.amount || !isUsdc(fee.token)) continue;
    try {
      dexFeeUsd += fromBaseUnits(fee.amount, usdc.decimals);
    } catch {
      // an unparseable USDC fee amount contributes nothing
    }
  }

  const unpriced: UnpricedFee[] = [];
  for (const [type, fee] of [
    ["zeroExFee", fees.zeroExFee],
    ["integratorFee", fees.integratorFee]
  ] as const) {
    if (!fee?.amount || isUsdc(fee.token)) continue;
    const amount = Number(fee.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    unpriced.push({ type, token: fee.token ?? "", amount: fee.amount });
  }

  return { dexFeeUsd, unpriced };
}
```

(Note: `gasFee` participates in the priced sum exactly as before, but is intentionally excluded from `unpriced` because network gas is estimated separately in `buildQuotePreview`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/zerox.test.ts`
Expected: PASS (5 tests). Note: `normalizeZeroxPriceQuote` still references the now-removed `estimateDexFeeUsd` and will fail typecheck — that is fixed in Task 2. Do not run `tsc` yet.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zerox.ts src/lib/zerox.test.ts
git commit -m "feat: summarize priced and unpriced 0x fees"
```

---

### Task 2: Wire `unpricedFees` + warning into the normalized quote

**Files:**
- Modify: `src/lib/zerox.ts` (`NormalizedZeroxQuote` type at lines 44-57; `normalizeZeroxPriceQuote` at lines 88-114)
- Test: `src/lib/zerox.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/zerox.test.ts`:

```ts
import { normalizeZeroxPriceQuote } from "./zerox";

const params = {
  sellToken: TOKENS.USDC.address,
  buyToken: "0xtoken",
  sellAmount: "100000000"
};

describe("normalizeZeroxPriceQuote unpriced fees", () => {
  it("warns and carries unpricedFees when a fee cannot be valued", () => {
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
    expect(quote.warnings).toContain(
      "0x reported a fee in 0xtoken the simulator could not value in USD; the real cost is higher than shown."
    );
  });

  it("stays clean for USDC-denominated fees", () => {
    const quote = normalizeZeroxPriceQuote(params, {
      buyAmount: "250000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: { zeroExFee: { amount: "1500000", token: TOKENS.USDC.address, type: "volume" } }
    });
    expect(quote.dexFeeUsd).toBe(1.5);
    expect(quote.unpricedFees).toEqual([]);
    expect(quote.warnings).toEqual([]);
  });

  it("lists multiple unpriced fee tokens in one warning", () => {
    const quote = normalizeZeroxPriceQuote(params, {
      buyAmount: "250000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: {
        zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" },
        integratorFee: { amount: "1000000000000000000", token: "0xweth", type: "volume" }
      }
    });
    expect(quote.warnings).toContain(
      "0x reported a fee in 0xtoken, 0xweth the simulator could not value in USD; the real cost is higher than shown."
    );
  });
});
```

(Merge the `import` line into the existing import from `./zerox` at the top of the file rather than duplicating it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/zerox.test.ts`
Expected: FAIL — `quote.unpricedFees` is `undefined` and the warning is absent.

- [ ] **Step 3: Add `unpricedFees` to the type and populate it**

In `src/lib/zerox.ts`, add `unpricedFees` to the `NormalizedZeroxQuote` type (after the `dexFeeUsd` field):

```ts
  dexFeeUsd: number;
  unpricedFees: UnpricedFee[];
  warnings: string[];
```

Then update `normalizeZeroxPriceQuote` so its body reads:

```ts
export function normalizeZeroxPriceQuote(
  params: ZeroxPriceParams,
  rawResponse: ZeroxRawQuote
): NormalizedZeroxQuote {
  const warnings = summarizeZeroxIssues(rawResponse);
  const gasUnits = finiteNumber(rawResponse.gas);
  const gasPriceWei = finiteNumber(rawResponse.gasPrice);

  if (!gasUnits || !gasPriceWei) {
    warnings.push("0x did not return a complete gas estimate; gas may be understated.");
  }

  const { dexFeeUsd, unpriced } = summarizeDexFees(rawResponse, params.chainId);
  if (unpriced.length) {
    const tokens = unpriced.map((fee) => fee.token).join(", ");
    warnings.push(
      `0x reported a fee in ${tokens} the simulator could not value in USD; the real cost is higher than shown.`
    );
  }

  return {
    provider: "0x",
    endpoint: ZEROX_PRICE_ENDPOINT,
    chainId: params.chainId ?? ETH_CHAIN_ID,
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: rawResponse.sellAmount ?? params.sellAmount,
    buyAmount: rawResponse.buyAmount ?? "0",
    gasUnits,
    gasPriceWei,
    dexFeeUsd,
    unpricedFees: unpriced,
    warnings,
    rawResponse
  };
}
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run src/lib/zerox.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Run typecheck and full suite**

Run: `npx tsc --noEmit`
Expected: passes (no remaining reference to the removed `estimateDexFeeUsd` in zerox.ts).

Run: `npm test`
Expected: all files pass, including unchanged `external.test.ts` (its `normalizeZeroxPriceQuote` tests use `toMatchObject`/USDC fees, so the additive `unpricedFees: []` field does not break them).

- [ ] **Step 6: Commit**

```bash
git add src/lib/zerox.ts src/lib/zerox.test.ts
git commit -m "feat: warn on unpriced 0x fees in normalized quote"
```

---

### Task 3: Update handoff doc

**Files:**
- Modify: `NEXT_VERSION.md`

- [ ] **Step 1: Record the change**

Under "Completed Foundation" in `NEXT_VERSION.md`, add a bullet:

```markdown
- 0x fees denominated in a non-USDC token (e.g. a buy-token `zeroExFee`) are no longer silently dropped to $0: `summarizeDexFees` returns both the USDC-priced total and an `unpricedFees` list, and `normalizeZeroxPriceQuote` adds a "could not value in USD; the real cost is higher than shown" quote warning that surfaces through the existing "Quote warn" badge.
```

In the "Latest Session Notes" section, replace the stale candidate text with a short note that this slice shipped and record the verification (`npm test` count, `npx tsc --noEmit` pass).

- [ ] **Step 2: Commit**

```bash
git add NEXT_VERSION.md
git commit -m "docs: note unpriced 0x fee detection in handoff"
```

---

## Self-Review Notes

- **Spec coverage:** `summarizeDexFees` shape (Task 1), gasFee excluded from unpriced (Task 1 step 3 + test), USDC still priced (Task 1), `unpricedFees` field + single multi-token warning riding existing badge path (Task 2), new `zerox.test.ts` with all five spec test cases (Tasks 1-2), no DB/route change, handoff updated (Task 3). All spec requirements mapped.
- **Type consistency:** `UnpricedFee { type, token, amount }` defined in Task 1 and reused unchanged in Task 2's `NormalizedZeroxQuote`. `summarizeDexFees` returns `{ dexFeeUsd, unpriced }` consistently.
- **Fee iteration order:** `unpriced` is built `zeroExFee` then `integratorFee`, matching the `"0xtoken, 0xweth"` expectation in the multi-fee test.
