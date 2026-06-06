# Internal Transfer Sell Decode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `"internal"` to the Alchemy transfer fetch so DEX sell transactions (token out + ETH back via internal transfer) decode correctly as `side: "sell"` candidates.

**Architecture:** One-line fetch change adds the missing category; one-line parser guard extends the native-ETH exemption to `"internal"` transfers; two new fixture tests lock the behavior. Existing stored activity heals on next wallet re-fetch + reprocess with no migration.

**Tech Stack:** TypeScript, Vitest, Node.js `node:sqlite`, Next.js API routes

---

## Files

- Modify: `src/lib/external.ts` — add `"internal"` to `category` array in `fetchAlchemyTransfers`
- Modify: `src/lib/candidates.ts` — extend `hasMissingTokenDetails` guard to cover `"internal"` category
- Modify: `src/lib/candidates.test.ts` — add two fixture tests for internal-transfer sell shapes

---

### Task 1: Extend `hasMissingTokenDetails` to treat `internal` like `external`

**Files:**
- Modify: `src/lib/candidates.ts:218`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("deriveTradeCandidates", ...)` block in `src/lib/candidates.test.ts`, after the last `it(...)`:

```ts
it("decodes a Base sell from erc20 token-out and internal ETH-in", () => {
  const hash = "0xsellhash";
  const chainId = 8453;
  const router = "0xd0a40c6526acdebd4f6d87931098ff37a9f8e4bf";
  const tokenAddress = "0xdcb35db5e40d1b53e54bb7cfe8f9730ecddb9ba3";

  const candidates = deriveTradeCandidates([
    activity({
      hash,
      chainId,
      chainName: "Base",
      category: "erc20",
      asset: "TALOS",
      contractAddress: tokenAddress,
      value: 89492134,
      fromAddress: wallet,
      toAddress: router,
      rawPayload: JSON.stringify({
        blockNum: "0x2cba766",
        uniqueId: `${hash}:log:799`,
        hash,
        from: wallet,
        to: router,
        value: 89492134,
        asset: "TALOS",
        category: "erc20",
        rawContract: { value: "0x4a06b254badabe8f12a84a", address: tokenAddress, decimal: "0x12" },
        metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
        chainId: 8453,
        chainName: "Base"
      })
    }),
    activity({
      hash,
      chainId,
      chainName: "Base",
      category: "internal",
      asset: "ETH",
      contractAddress: "",
      value: 0.5,
      fromAddress: router,
      toAddress: wallet,
      rawPayload: JSON.stringify({
        blockNum: "0x2cba766",
        uniqueId: `${hash}:internal:0`,
        hash,
        from: router,
        to: wallet,
        value: 0.5,
        asset: "ETH",
        category: "internal",
        rawContract: { value: "0x6f05b59d3b20000", address: null, decimal: null },
        metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
        chainId: 8453,
        chainName: "Base"
      })
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0].status).toBe("decoded");
  expect(candidates[0].side).toBe("sell");
  expect(candidates[0].tokenInAsset).toBe("TALOS");
  expect(candidates[0].tokenInAddress).toBe(tokenAddress);
  expect(candidates[0].tokenOutAsset).toBe("ETH");
  expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.9);
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- candidates.test.ts
```

Expected: FAIL — the sell is marked `status: "candidate"` or `"unknown"` instead of `"decoded"` because `hasMissingTokenDetails` flags the internal ETH transfer as missing a contract address.

- [ ] **Step 3: Fix `hasMissingTokenDetails` in `src/lib/candidates.ts`**

Find line 218 (the function body):

```ts
function hasMissingTokenDetails(item: WalletActivity | null) {
  if (!item) return true;
  if (item.category === "external") return false;
  return !item.asset || !item.value || !item.contractAddress;
}
```

Change to:

```ts
function hasMissingTokenDetails(item: WalletActivity | null) {
  if (!item) return true;
  if (item.category === "external" || item.category === "internal") return false;
  return !item.asset || !item.value || !item.contractAddress;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- candidates.test.ts
```

Expected: the new test passes. All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidates.ts src/lib/candidates.test.ts
git commit -m "feat: treat internal ETH transfers as valid native legs in sell parsing"
```

---

### Task 2: Add review-only sell fixture for missing token address

**Files:**
- Modify: `src/lib/candidates.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test immediately after the one added in Task 1:

```ts
it("keeps a Base internal-transfer sell review-only when the token address is missing", () => {
  const hash = "0xsellnoaddrHash";
  const chainId = 8453;
  const router = "0xd0a40c6526acdebd4f6d87931098ff37a9f8e4bf";

  const candidates = deriveTradeCandidates([
    activity({
      hash,
      chainId,
      chainName: "Base",
      category: "erc20",
      asset: "TALOS",
      contractAddress: "",
      value: 89492134,
      fromAddress: wallet,
      toAddress: router,
      rawPayload: JSON.stringify({
        blockNum: "0x2cba766",
        uniqueId: `${hash}:log:799`,
        hash,
        from: wallet,
        to: router,
        value: 89492134,
        asset: "TALOS",
        category: "erc20",
        rawContract: { value: "0x4a06b254badabe8f12a84a", address: null, decimal: "0x12" },
        metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
        chainId: 8453,
        chainName: "Base"
      })
    }),
    activity({
      hash,
      chainId,
      chainName: "Base",
      category: "internal",
      asset: "ETH",
      contractAddress: "",
      value: 0.5,
      fromAddress: router,
      toAddress: wallet,
      rawPayload: JSON.stringify({
        blockNum: "0x2cba766",
        uniqueId: `${hash}:internal:0`,
        hash,
        from: router,
        to: wallet,
        value: 0.5,
        asset: "ETH",
        category: "internal",
        rawContract: { value: "0x6f05b59d3b20000", address: null, decimal: null },
        metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
        chainId: 8453,
        chainName: "Base"
      })
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0].status).toBe("candidate");
  expect(candidates[0].side).toBe("sell");
  expect(candidates[0].tokenInAsset).toBe("TALOS");
  expect(candidates[0].tokenInAddress).toBe("");
  expect(candidates[0].tokenOutAsset).toBe("ETH");
  expect(candidates[0].reason).toContain("no contract address");
});
```

- [ ] **Step 2: Run the test**

```bash
npm test -- candidates.test.ts
```

Expected: PASS — the missing-address path already sets `status: "candidate"` with `missingCopyTokenAddress` reason. Confirm the reason text contains "no contract address" — if it says something different, update the `toContain(...)` assertion to match the actual reason text produced by `candidates.ts:124`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/candidates.test.ts
git commit -m "test: add review-only internal-transfer sell fixture for missing token address"
```

---

### Task 3: Add `"internal"` to the Alchemy fetch categories

**Files:**
- Modify: `src/lib/external.ts:310`

- [ ] **Step 1: Make the change**

In `src/lib/external.ts`, find the `fetchAlchemyTransfers` function (~line 304). Change:

```ts
category: ["erc20", "external"],
```

to:

```ts
category: ["erc20", "external", "internal"],
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (the fetch change has no unit test — it is covered by the fixture tests in Task 1 which exercise the normalization path with `category: "internal"` payloads).

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/external.ts
git commit -m "feat: fetch internal transfers from Alchemy to capture DEX sell ETH returns"
```

---

### Task 4: Re-fetch wallets and reprocess candidates

These are manual runtime steps, not code changes. Run them against the real DB after the code changes are committed.

- [ ] **Step 1: Re-fetch all watched wallets**

In the running app dashboard, trigger a wallet activity fetch for each watched wallet. The fetch now includes `internal` transfers; `INSERT OR IGNORE` means existing erc20/external rows are preserved and the new internal legs are inserted alongside them.

- [ ] **Step 2: Reprocess candidates**

```bash
npm run reprocess:candidates
```

Review the preview output. If `changed` is non-zero, sell candidates that previously had no paired inbound will now decode as `side: "sell"`.

- [ ] **Step 3: Apply**

```bash
npm run reprocess:candidates -- --apply
```

- [ ] **Step 4: Verify**

```bash
npm test
```

Expected: all tests still pass. Check the dashboard — decoded sell candidates should now appear.
