# Background Auto-Copy Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background worker that automatically copies `decoded` buy trades from watched wallets when new candidates appear, running inside the Next.js process regardless of whether the dashboard tab is open.

**Architecture:** A single `autoCopy: boolean` flag is added to the existing `CopySettings` (stored in the `settings` DB table — no new table). `runCopyCheck()` in `copyWorker.ts` polls all watched wallets via `fetchWalletTransfers`, upserts new candidates, finds eligible `decoded`/`buy` candidates with no prior copy attempt, and executes trades using the same sizing + quoting path as the manual copy route. `instrumentation.ts` registers a 30-second `setInterval`; the worker uses a 60-second guard to control actual work frequency.

**Tech Stack:** Next.js 16 App Router, `node:sqlite` (WAL mode), `zod`, vitest — no new dependencies.

---

## File Map

| File | Change |
|---|---|
| `src/lib/types.ts` | Add `autoCopy: boolean` to `CopySettings` |
| `src/lib/constants.ts` | Add `autoCopy: false` to `DEFAULT_COPY_SETTINGS` |
| `src/lib/repositories.ts` | Update `normalizeCopySettings` to handle `autoCopy` |
| `src/app/api/settings/route.ts` | Add `autoCopy: z.boolean()` to Zod schema |
| `src/lib/copyWorker.ts` | **New** — `shouldAutoCopy`, `runCopyCheck`, `startCopyWorker`, `resetCopyWorkerState` |
| `src/lib/copyWorker.test.ts` | **New** — pure unit tests + integration tests |
| `src/instrumentation.ts` | Add `startCopyWorker()` call alongside existing `startExitWorker()` |
| `src/app/page.tsx` | Add `autoCopy` to `CopySettingsForm`, `settingsToForm`, `buildCopySettingsPayload`, and the copy settings panel UI |

---

## Task 1: Add `autoCopy` to CopySettings

**Files:**
- Modify: `src/lib/types.ts:126-136`
- Modify: `src/lib/constants.ts:60-70`
- Modify: `src/lib/repositories.ts:1313-1326`
- Modify: `src/app/api/settings/route.ts:7-17`

### Steps

- [x] **Step 1: Add `autoCopy: boolean` to `CopySettings` in `src/lib/types.ts`**

The `CopySettings` type is around line 126. Add `autoCopy: boolean` as the last field before the closing `}`:

```ts
export type CopySettings = {
  mode: "fixedUsd" | "percentOfSource";
  fixedUsd: number;
  percentOfSource: number;
  maxTradeUsd: number;
  slippageCapBps: number;
  gasBufferBps: number;
  insufficientCashBehavior: "skip" | "cap";
  allowlist: string[];
  blocklist: string[];
  autoCopy: boolean;
};
```

- [x] **Step 2: Add `autoCopy: false` to `DEFAULT_COPY_SETTINGS` in `src/lib/constants.ts`**

The constant is around line 60. Add `autoCopy: false` before the `} as const`:

```ts
export const DEFAULT_COPY_SETTINGS = {
  mode: "fixedUsd",
  fixedUsd: 250,
  percentOfSource: 25,
  maxTradeUsd: 500,
  slippageCapBps: DEFAULT_SLIPPAGE_BPS,
  gasBufferBps: DEFAULT_GAS_BUFFER_BPS,
  insufficientCashBehavior: "skip",
  allowlist: [] as string[],
  blocklist: [] as string[],
  autoCopy: false
} as const;
```

- [x] **Step 3: Update `normalizeCopySettings` in `src/lib/repositories.ts`**

The function is around line 1313. Add `autoCopy: input.autoCopy === true` as the last field of the return object:

```ts
function normalizeCopySettings(value: unknown): CopySettings {
  const input = value && typeof value === "object" ? (value as Partial<CopySettings>) : {};
  return {
    mode: input.mode === "percentOfSource" ? "percentOfSource" : "fixedUsd",
    fixedUsd: boundedNumber(input.fixedUsd, DEFAULT_COPY_SETTINGS.fixedUsd, 1, 1_000_000),
    percentOfSource: boundedNumber(input.percentOfSource, DEFAULT_COPY_SETTINGS.percentOfSource, 1, 100),
    maxTradeUsd: boundedNumber(input.maxTradeUsd, DEFAULT_COPY_SETTINGS.maxTradeUsd, 1, 1_000_000),
    slippageCapBps: boundedNumber(input.slippageCapBps, DEFAULT_COPY_SETTINGS.slippageCapBps, 0, 5000),
    gasBufferBps: boundedNumber(input.gasBufferBps, DEFAULT_COPY_SETTINGS.gasBufferBps, 0, 10000),
    insufficientCashBehavior: input.insufficientCashBehavior === "cap" ? "cap" : "skip",
    allowlist: normalizeTokenList(input.allowlist),
    blocklist: normalizeTokenList(input.blocklist),
    autoCopy: input.autoCopy === true
  };
}
```

- [x] **Step 4: Add `autoCopy: z.boolean()` to Zod schema in `src/app/api/settings/route.ts`**

Replace the existing schema object:

```ts
const schema = z.object({
  mode: z.enum(["fixedUsd", "percentOfSource"]),
  fixedUsd: z.number().min(1).max(1_000_000),
  percentOfSource: z.number().min(1).max(100),
  maxTradeUsd: z.number().min(1).max(1_000_000),
  slippageCapBps: z.number().min(0).max(5000),
  gasBufferBps: z.number().min(0).max(10000),
  insufficientCashBehavior: z.enum(["skip", "cap"]),
  allowlist: addressList,
  blocklist: addressList,
  autoCopy: z.boolean()
});
```

- [x] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 6: Run existing tests**

```bash
npm test
```

Expected: all existing tests pass.

- [x] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/constants.ts src/lib/repositories.ts src/app/api/settings/route.ts
git commit -m "feat: add autoCopy boolean to CopySettings type, constant, normalize, and API schema"
```

---

## Task 2: Copy worker — pure unit tests first, then `shouldAutoCopy`

**Files:**
- Create: `src/lib/copyWorker.ts` (stub)
- Create: `src/lib/copyWorker.test.ts`

### Steps

- [x] **Step 1: Create stub `src/lib/copyWorker.ts`**

```ts
import type { TradeCandidate } from "./types";

export function shouldAutoCopy(candidate: TradeCandidate): boolean {
  throw new Error("not implemented");
}

export async function runCopyCheck(): Promise<void> {
  throw new Error("not implemented");
}

export function startCopyWorker(): void {
  throw new Error("not implemented");
}

export function resetCopyWorkerState(): void {
  throw new Error("not implemented");
}
```

- [x] **Step 2: Create `src/lib/copyWorker.test.ts` with pure unit tests**

```ts
import { describe, it, expect } from "vitest";
import { shouldAutoCopy } from "./copyWorker";
import type { TradeCandidate } from "./types";

function makeCandidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    id: "test-id",
    walletAddress: "0xwallet000000000000000000000000000000001",
    chainId: 8453,
    chainName: "Base",
    hash: "0xhash",
    status: "decoded",
    confidence: 0.95,
    side: "buy",
    tokenInAsset: "USDC",
    tokenInAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenInAmount: 100,
    tokenOutAsset: "TOKEN",
    tokenOutAddress: "0xtoken000000000000000000000000000000001",
    tokenOutAmount: 1000,
    reason: "decoded: clear buy shape",
    transferCount: 2,
    sourceTimestamp: new Date().toISOString(),
    lastCopyStatus: "",
    lastCopyBucket: "",
    lastCopyReason: "",
    lastCopyTradeId: "",
    lastCopyAt: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("shouldAutoCopy", () => {
  it("returns true for a decoded buy with no prior copy attempt", () => {
    expect(shouldAutoCopy(makeCandidate())).toBe(true);
  });

  it("returns false when status is not decoded", () => {
    expect(shouldAutoCopy(makeCandidate({ status: "candidate" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ status: "partial" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ status: "failed" }))).toBe(false);
  });

  it("returns false when side is not buy", () => {
    expect(shouldAutoCopy(makeCandidate({ side: "sell" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ side: "unknown" }))).toBe(false);
  });

  it("returns false when lastCopyStatus is set (already attempted)", () => {
    expect(shouldAutoCopy(makeCandidate({ lastCopyStatus: "copied" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ lastCopyStatus: "failed" }))).toBe(false);
  });
});
```

- [x] **Step 3: Run tests to confirm they fail**

```bash
npm test -- copyWorker.test.ts
```

Expected: 4 tests fail with "Error: not implemented".

- [x] **Step 4: Implement `shouldAutoCopy`**

Replace only the `shouldAutoCopy` stub in `src/lib/copyWorker.ts`:

```ts
export function shouldAutoCopy(candidate: TradeCandidate): boolean {
  return (
    candidate.status === "decoded" &&
    candidate.side === "buy" &&
    !candidate.lastCopyStatus
  );
}
```

- [x] **Step 5: Run tests — expect pass**

```bash
npm test -- copyWorker.test.ts
```

Expected: 4 unit tests pass (3 other stubs still throw but are not yet tested).

- [x] **Step 6: Commit**

```bash
git add src/lib/copyWorker.ts src/lib/copyWorker.test.ts
git commit -m "feat: add shouldAutoCopy predicate with passing unit tests"
```

---

## Task 3: Copy worker — integration tests and full `runCopyCheck`

**Files:**
- Modify: `src/lib/copyWorker.ts` (full implementation)
- Modify: `src/lib/copyWorker.test.ts` (add integration describe block)

### Step 1: Add integration tests to `src/lib/copyWorker.test.ts`

`vi.mock()` calls are hoisted by vitest — they must appear at the top level of the file, outside any `describe`. Add all of the following to the **end** of `src/lib/copyWorker.test.ts`, after the existing `shouldAutoCopy` describe block:

```ts
import { beforeEach, vi } from "vitest";
import { getDb } from "./db";
import {
  getCopySettings,
  listTradeCandidates,
  updateCopySettings,
  upsertTradeCandidates,
  upsertWallet
} from "./repositories";
import { runCopyCheck, resetCopyWorkerState } from "./copyWorker";

vi.mock("./external", () => ({
  fetchWalletTransfers: vi.fn(),
  buildQuotePreview: vi.fn(),
  getNativeUsdPrice: vi.fn(),
  resolveTokenFromAlchemy: vi.fn()
}));

import {
  fetchWalletTransfers,
  buildQuotePreview,
  getNativeUsdPrice,
  resolveTokenFromAlchemy
} from "./external";

const TEST_WALLET = "0x1234560000000000000000000000000000000001";
const TEST_TOKEN  = "0x1234560000000000000000000000000000000002";

function seedWallet() {
  upsertWallet({ address: TEST_WALLET, label: "Test", notes: "", gmgnUrl: "" });
}

function seedDecodedBuyCandidate(hashSuffix: string, tokenAddress = TEST_TOKEN): string {
  const hash = `0xdeadbeef${hashSuffix}`;
  upsertTradeCandidates([{
    walletAddress: TEST_WALLET,
    chainId: 8453,
    chainName: "Base",
    hash,
    status: "decoded",
    confidence: 0.95,
    side: "buy",
    tokenInAsset: "USDC",
    tokenInAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenInAmount: 100,
    tokenOutAsset: "TOKEN",
    tokenOutAddress: tokenAddress,
    tokenOutAmount: 1000,
    reason: "decoded: clear buy shape",
    transferCount: 2,
    sourceTimestamp: new Date().toISOString()
  }]);
  return listTradeCandidates(TEST_WALLET).find(c => c.hash === hash)!.id;
}

describe("runCopyCheck", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM tokens").run();
    db.prepare("DELETE FROM trade_candidates").run();
    db.prepare("DELETE FROM wallet_activity").run();
    db.prepare("DELETE FROM wallets").run();
    db.prepare("DELETE FROM settings WHERE key = 'copy_settings'").run();
    resetCopyWorkerState();
    vi.clearAllMocks();
    vi.mocked(fetchWalletTransfers).mockResolvedValue({ transfers: [], warnings: [] });
    vi.mocked(getNativeUsdPrice).mockResolvedValue(2500);
  });

  it("returns early when autoCopy is disabled", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: false });
    seedWallet();
    seedDecodedBuyCandidate("01");
    await runCopyCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("skips a candidate whose lastCopyStatus is already set", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: true });
    seedWallet();
    const id = seedDecodedBuyCandidate("02");
    getDb()
      .prepare("UPDATE trade_candidates SET last_copy_status = 'copied' WHERE id = ?")
      .run(id);
    await runCopyCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("executes a buy trade and stamps autoCopied in quoteSnapshot", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: true, fixedUsd: 100 });
    seedWallet();
    seedDecodedBuyCandidate("03");
    vi.mocked(resolveTokenFromAlchemy).mockResolvedValue({
      address: TEST_TOKEN,
      chainId: 8453,
      symbol: "TKN",
      name: "Token",
      decimals: 18,
      createdAt: new Date().toISOString()
    });
    vi.mocked(buildQuotePreview).mockResolvedValue({
      side: "buy",
      token: { address: TEST_TOKEN, chainId: 8453, symbol: "TKN", name: "Token", decimals: 18, createdAt: "" },
      quantity: 500,
      priceUsd: 0.2,
      notionalUsd: 100,
      gasUsd: 0.5,
      slippageUsd: 0,
      dexFeeUsd: 0,
      totalCostUsd: 100.5,
      sellProceedsUsd: 0,
      warnings: [],
      quoteSnapshot: {}
    } as never);

    await runCopyCheck();

    expect(buildQuotePreview).toHaveBeenCalledOnce();
    const db = getDb();
    const trade = db
      .prepare("SELECT * FROM trades WHERE side = 'buy' LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    expect(trade).toBeDefined();
    const snap = JSON.parse(String(trade!.quote_snapshot)) as Record<string, unknown>;
    expect(snap.autoCopied).toBe(true);
    expect((snap.copiedFrom as Record<string, unknown>).walletAddress).toBe(TEST_WALLET);
  });

  it("records lastCopyStatus = failed when buildQuotePreview throws", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: true });
    seedWallet();
    const id = seedDecodedBuyCandidate("04");
    vi.mocked(resolveTokenFromAlchemy).mockResolvedValue({
      address: TEST_TOKEN, chainId: 8453, symbol: "TKN", name: "Token", decimals: 18,
      createdAt: new Date().toISOString()
    });
    vi.mocked(buildQuotePreview).mockRejectedValue(new Error("No liquidity route found"));

    await runCopyCheck();

    const candidate = listTradeCandidates(TEST_WALLET).find(c => c.id === id)!;
    expect(candidate.lastCopyStatus).toBe("failed");
    const count = (
      getDb().prepare("SELECT COUNT(*) AS c FROM trades WHERE side = 'buy'").get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });
});
```

- [x] **Step 2: Run tests to confirm integration tests fail**

```bash
npm test -- copyWorker.test.ts
```

Expected: 4 unit tests pass; 4 integration tests fail with "Error: not implemented".

- [x] **Step 3: Implement full `src/lib/copyWorker.ts`**

Replace the entire file:

```ts
import { applyTradeToState } from "./accounting";
import { deriveTradeCandidates } from "./candidates";
import { classifyCopyError, sizeCopyTrade } from "./copy";
import {
  buildQuotePreview,
  fetchWalletTransfers,
  getNativeUsdPrice,
  resolveTokenFromAlchemy
} from "./external";
import {
  getCopySettings,
  getPortfolio,
  getPosition,
  getToken,
  insertWalletActivity,
  listTradeCandidates,
  listWalletActivity,
  listWallets,
  recordTrade,
  updateTradeCandidateCopyResult,
  updateTradeCandidateStatus,
  upsertTradeCandidates,
  upsertToken
} from "./repositories";
import type { TradeCandidate } from "./types";

export function shouldAutoCopy(candidate: TradeCandidate): boolean {
  return (
    candidate.status === "decoded" &&
    candidate.side === "buy" &&
    !candidate.lastCopyStatus
  );
}

const pendingCopies = new Set<string>();
let lastCheckedAt = 0;
const POLL_INTERVAL_MS = 60_000;

export async function runCopyCheck(): Promise<void> {
  const settings = getCopySettings();
  if (!settings.autoCopy) return;
  if (Date.now() - lastCheckedAt < POLL_INTERVAL_MS) return;
  lastCheckedAt = Date.now();

  const wallets = listWallets();
  for (const wallet of wallets) {
    try {
      const { transfers } = await fetchWalletTransfers(wallet.address);
      insertWalletActivity(transfers);
      const activity = listWalletActivity(wallet.address);
      upsertTradeCandidates(deriveTradeCandidates(activity));
    } catch {
      // Skip this wallet on error; retry next cycle
    }
  }

  const allCandidates = wallets.flatMap((w) => listTradeCandidates(w.address));
  const eligible = allCandidates.filter(
    (c) => shouldAutoCopy(c) && !pendingCopies.has(c.id)
  );
  if (!eligible.length) return;

  await Promise.allSettled(
    eligible.map(async (candidate) => {
      pendingCopies.add(candidate.id);
      try {
        const tokenAddress = candidate.tokenOutAddress;
        const position = tokenAddress ? getPosition(tokenAddress) : null;
        const nativeUsd = await getNativeUsdPrice(candidate.chainId);
        const sized = sizeCopyTrade({ candidate, settings, nativeUsd, position });

        const storedToken = getToken(sized.tokenAddress);
        const token =
          storedToken && storedToken.chainId === candidate.chainId
            ? storedToken
            : upsertToken(
                await resolveTokenFromAlchemy(sized.tokenAddress, candidate.chainId)
              );

        const preview = await buildQuotePreview({
          side: "buy",
          token,
          chainId: candidate.chainId,
          usdAmount: sized.usdAmount,
          slippageBps: settings.slippageCapBps,
          gasBufferBps: settings.gasBufferBps
        });

        const portfolio = getPortfolio();
        const next = applyTradeToState({ portfolio, position, preview });

        const quoteSnapshot = {
          ...preview.quoteSnapshot,
          autoCopied: true,
          copiedFrom: {
            candidateId: candidate.id,
            walletAddress: candidate.walletAddress,
            chainId: candidate.chainId,
            sourceHash: candidate.hash
          }
        };

        const tradeId = recordTrade({
          side: "buy",
          tokenAddress: sized.tokenAddress,
          chainId: candidate.chainId,
          quantity: preview.quantity,
          priceUsd: preview.priceUsd,
          notionalUsd: preview.notionalUsd,
          gasUsd: preview.gasUsd,
          slippageUsd: preview.slippageUsd,
          dexFeeUsd: preview.dexFeeUsd,
          totalCostUsd: preview.totalCostUsd,
          realizedPnlUsd: next.realizedPnlUsd,
          quoteSnapshot: JSON.stringify(quoteSnapshot)
        });

        updateTradeCandidateStatus(candidate.id, "copied", `Auto-copied as trade ${tradeId}.`);
        updateTradeCandidateCopyResult({
          id: candidate.id,
          status: "copied",
          reason: `Auto-copied as trade ${tradeId}.`,
          tradeId
        });
      } catch (error) {
        const { bucket, reason } = classifyCopyError(error);
        updateTradeCandidateCopyResult({ id: candidate.id, status: "failed", bucket, reason });
      } finally {
        pendingCopies.delete(candidate.id);
      }
    })
  );
}

export function startCopyWorker(): void {
  setInterval(() => {
    runCopyCheck().catch((err: unknown) => {
      console.error("[copy-worker] Unhandled error in runCopyCheck:", err);
    });
  }, 30_000);
}

export function resetCopyWorkerState(): void {
  lastCheckedAt = 0;
  pendingCopies.clear();
}
```

- [x] **Step 4: Run copyWorker tests**

```bash
npm test -- copyWorker.test.ts
```

Expected: 8 tests pass (4 unit + 4 integration).

- [x] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [x] **Step 6: Commit**

```bash
git add src/lib/copyWorker.ts src/lib/copyWorker.test.ts
git commit -m "feat: implement runCopyCheck with full test coverage"
```

---

## Task 4: Wire `startCopyWorker` into `instrumentation.ts`

**Files:**
- Modify: `src/instrumentation.ts`

### Steps

- [x] **Step 1: Update `src/instrumentation.ts`**

Replace the entire file:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startExitWorker } = await import("./lib/exitWorker");
    const { startCopyWorker } = await import("./lib/copyWorker");
    startExitWorker();
    startCopyWorker();
  }
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 3: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat: register copy worker via instrumentation.ts on server startup"
```

---

## Task 5: UI — auto-copy toggle in copy settings panel

**Files:**
- Modify: `src/app/page.tsx`

### Steps

Context for navigating `src/app/page.tsx`:
- `CopySettingsForm` type: around line 64
- `settingsToForm` function: around line 2115
- `buildCopySettingsPayload` function: around line 2129
- Copy settings form panel: `<form className="stack" onSubmit={saveCopySettings}>` around line 1327

- [x] **Step 1: Add `autoCopy: boolean` to `CopySettingsForm`**

Find the `CopySettingsForm` type (around line 64). Add `autoCopy: boolean` as the last field:

```ts
type CopySettingsForm = {
  mode: CopySettings["mode"];
  fixedUsd: string;
  percentOfSource: string;
  maxTradeUsd: string;
  slippageCapBps: string;
  gasBufferBps: string;
  insufficientCashBehavior: CopySettings["insufficientCashBehavior"];
  allowlist: string;
  blocklist: string;
  autoCopy: boolean;
};
```

- [x] **Step 2: Update `settingsToForm` to map `autoCopy`**

Find `settingsToForm` (around line 2115). Add `autoCopy: settings.autoCopy === true` to the returned object — add it as the last field:

```ts
function settingsToForm(settings: CopySettings): CopySettingsForm {
  return {
    mode: settings.mode,
    fixedUsd: String(settings.fixedUsd),
    percentOfSource: String(settings.percentOfSource),
    maxTradeUsd: String(settings.maxTradeUsd),
    slippageCapBps: String(settings.slippageCapBps),
    gasBufferBps: String(settings.gasBufferBps),
    insufficientCashBehavior: settings.insufficientCashBehavior,
    allowlist: Array.from(settings.allowlist).join("\n"),
    blocklist: Array.from(settings.blocklist).join("\n"),
    autoCopy: settings.autoCopy === true
  };
}
```

- [x] **Step 3: Update `buildCopySettingsPayload` to include `autoCopy`**

Find `buildCopySettingsPayload` (around line 2129). Add `autoCopy: form.autoCopy` as the last field:

```ts
function buildCopySettingsPayload(form: CopySettingsForm): CopySettings {
  return {
    mode: form.mode,
    fixedUsd: Number(form.fixedUsd),
    percentOfSource: Number(form.percentOfSource),
    maxTradeUsd: Number(form.maxTradeUsd),
    slippageCapBps: Number(form.slippageCapBps),
    gasBufferBps: Number(form.gasBufferBps),
    insufficientCashBehavior: form.insufficientCashBehavior,
    allowlist: parseTokenList(form.allowlist),
    blocklist: parseTokenList(form.blocklist),
    autoCopy: form.autoCopy
  };
}
```

- [x] **Step 4: Add auto-copy checkbox to the copy settings form panel**

Inside the copy settings `<div className="form-grid">` (around line 1340), add a new checkbox field as the first item (before the mode select). Follow the exact field/label/input pattern used by the other controls in this form:

```tsx
<div className="field">
  <label htmlFor="autoCopy">Auto-copy</label>
  <input
    id="autoCopy"
    type="checkbox"
    checked={copySettingsForm.autoCopy}
    onChange={(e) =>
      setCopySettingsForm({ ...copySettingsForm, autoCopy: e.target.checked })
    }
  />
</div>
```

- [x] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [x] **Step 6: Build check**

```bash
npm run build
```

Expected: clean build. (Pre-existing TypeScript diagnostic warnings in the build output are fine if they existed before this task.)

- [x] **Step 7: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add auto-copy toggle to copy settings panel"
```
