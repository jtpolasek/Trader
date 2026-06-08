# Background Auto-Exit (TP/SL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background worker that fires sell trades automatically when open positions cross configurable take-profit or stop-loss thresholds, running inside the Next.js process via `instrumentation.ts` independently of whether the dashboard tab is open.

**Architecture:** Global exit rules and failure state are stored as JSON in the existing `settings` table (two new keys). A `runExitCheck()` function in `exitWorker.ts` checks open positions against thresholds using `getZeroxPrice` and executes sells via `recordTrade`. `instrumentation.ts` registers a 30-second base `setInterval` that calls `runExitCheck`; the user-configured interval controls actual work frequency via a `lastCheckedAt` guard.

**Tech Stack:** Next.js 16 App Router, `node:sqlite` (WAL mode on), `zod`, no new dependencies.

---

## File Map

| File | Change |
|---|---|
| `src/lib/types.ts` | Add `ExitRules` and `ExitFailure` types |
| `src/lib/constants.ts` | Add `DEFAULT_EXIT_RULES` constant |
| `src/lib/repositories.ts` | Add `getExitRules`, `updateExitRules`, `getExitFailures`, `addExitFailure`, `removeExitFailure` |
| `src/lib/exitWorker.ts` | **New** — `runExitCheck`, `startExitWorker`, module-level `pendingExits` Set and `lastCheckedAt` |
| `src/lib/exitWorker.test.ts` | **New** — unit + integration tests |
| `src/instrumentation.ts` | **New** — `register()` hook that calls `startExitWorker()` |
| `src/app/api/settings/exit-rules/route.ts` | **New** — GET/POST exit rules |
| `src/app/api/settings/exit-failures/[tokenAddress]/route.ts` | **New** — DELETE to dismiss a failure |
| `src/app/page.tsx` | Add exit rules settings panel, position card status line, trade history badge |

---

## Task 1: Types and constants

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Add `ExitRules` and `ExitFailure` to `src/lib/types.ts`**

Add after the `CopySettings` type (around line 136):

```ts
export type ExitRules = {
  enabled: boolean;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  exitSizePct: number;
  checkIntervalSecs: number;
};

export type ExitFailure = {
  tokenAddress: string;
  chainId: number;
  symbol: string;
  reason: string;
  failedAt: string;
};
```

- [ ] **Step 2: Add `DEFAULT_EXIT_RULES` to `src/lib/constants.ts`**

Add after `DEFAULT_COPY_SETTINGS` (after line 68):

```ts
export const DEFAULT_EXIT_RULES: ExitRules = {
  enabled: false,
  takeProfitPct: null,
  stopLossPct: null,
  exitSizePct: 100,
  checkIntervalSecs: 60
};
```

Add the import at the top of `constants.ts`:

```ts
import type { ExitRules } from "./types";
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/constants.ts
git commit -m "feat: add ExitRules and ExitFailure types and DEFAULT_EXIT_RULES constant"
```

---

## Task 2: Repository helpers for exit rules and failures

**Files:**
- Modify: `src/lib/repositories.ts`

The settings table already exists with `key TEXT PRIMARY KEY, value TEXT NOT NULL`. This task adds five helpers that read/write the `exit_rules` and `exit_failures` keys, following the exact pattern of the existing `getCopySettings` / `updateCopySettings` helpers.

- [ ] **Step 1: Add `getExitRules` and `updateExitRules` to `repositories.ts`**

Add after `updateCopySettings` (after line 136). Also update the import at the top of the file to include `ExitFailure`, `ExitRules` from `./types`, and `DEFAULT_EXIT_RULES` from `./constants`.

```ts
export function getExitRules(): ExitRules {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'exit_rules'").get() as Row | undefined;
  if (!row) return { ...DEFAULT_EXIT_RULES };
  try {
    return normalizeExitRules(JSON.parse(String(row.value)));
  } catch {
    return { ...DEFAULT_EXIT_RULES };
  }
}

export function updateExitRules(rules: ExitRules): ExitRules {
  const normalized = normalizeExitRules(rules);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES ('exit_rules', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(JSON.stringify(normalized));
  return normalized;
}
```

- [ ] **Step 2: Add `getExitFailures`, `addExitFailure`, `removeExitFailure` to `repositories.ts`**

Add directly after `updateExitRules`:

```ts
export function getExitFailures(): ExitFailure[] {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'exit_failures'").get() as Row | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(String(row.value));
    return Array.isArray(parsed) ? (parsed as ExitFailure[]) : [];
  } catch {
    return [];
  }
}

export function addExitFailure(failure: ExitFailure): void {
  const failures = getExitFailures().filter((f) => f.tokenAddress !== failure.tokenAddress);
  failures.push(failure);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES ('exit_failures', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(JSON.stringify(failures));
}

export function removeExitFailure(tokenAddress: string): void {
  const failures = getExitFailures().filter((f) => f.tokenAddress !== tokenAddress);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES ('exit_failures', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(JSON.stringify(failures));
}
```

- [ ] **Step 3: Add `normalizeExitRules` private helper to `repositories.ts`**

Add near the other `normalize*` helpers at the bottom of the file (after `normalizeTokenList`):

```ts
function normalizeExitRules(value: unknown): ExitRules {
  const input = value && typeof value === "object" ? (value as Partial<ExitRules>) : {};
  return {
    enabled: input.enabled === true,
    takeProfitPct: typeof input.takeProfitPct === "number" && input.takeProfitPct > 0 ? input.takeProfitPct : null,
    stopLossPct: typeof input.stopLossPct === "number" && input.stopLossPct > 0 ? input.stopLossPct : null,
    exitSizePct: boundedNumber(input.exitSizePct, DEFAULT_EXIT_RULES.exitSizePct, 1, 100),
    checkIntervalSecs: [30, 60, 120, 300, 600].includes(Number(input.checkIntervalSecs))
      ? Number(input.checkIntervalSecs)
      : DEFAULT_EXIT_RULES.checkIntervalSecs
  };
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run existing tests to confirm nothing regressed**

```bash
npm test
```

Expected: all tests pass (16 files).

- [ ] **Step 6: Commit**

```bash
git add src/lib/repositories.ts
git commit -m "feat: add exit rules and exit failures repository helpers"
```

---

## Task 3: API routes for exit rules and failure dismissal

**Files:**
- Create: `src/app/api/settings/exit-rules/route.ts`
- Create: `src/app/api/settings/exit-failures/[tokenAddress]/route.ts`

These follow the exact pattern of `src/app/api/settings/route.ts`.

- [ ] **Step 1: Create `src/app/api/settings/exit-rules/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getExitRules, updateExitRules } from "@/lib/repositories";

const schema = z.object({
  enabled: z.boolean(),
  takeProfitPct: z.number().positive().nullable(),
  stopLossPct: z.number().positive().nullable(),
  exitSizePct: z.number().min(1).max(100),
  checkIntervalSecs: z.union([
    z.literal(30),
    z.literal(60),
    z.literal(120),
    z.literal(300),
    z.literal(600)
  ])
});

export async function GET() {
  return NextResponse.json({ exitRules: getExitRules() });
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const exitRules = updateExitRules(body);
    return NextResponse.json({ exitRules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save exit rules." },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 2: Create `src/app/api/settings/exit-failures/[tokenAddress]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getExitFailures, removeExitFailure } from "@/lib/repositories";

export async function DELETE(
  _request: Request,
  { params }: { params: { tokenAddress: string } }
) {
  const { tokenAddress } = params;
  const before = getExitFailures();
  const match = before.find((f) => f.tokenAddress === tokenAddress);
  if (!match) {
    return NextResponse.json({ error: "No exit failure found for this token." }, { status: 404 });
  }
  removeExitFailure(tokenAddress);
  return NextResponse.json({ dismissed: tokenAddress });
}
```

- [ ] **Step 3: Verify build includes new routes**

```bash
npm run build 2>&1 | grep "exit"
```

Expected output includes:
```
/api/settings/exit-rules
/api/settings/exit-failures/[tokenAddress]
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/exit-rules/route.ts src/app/api/settings/exit-failures/[tokenAddress]/route.ts
git commit -m "feat: add exit-rules GET/POST and exit-failures DELETE routes"
```

---

## Task 4: Exit worker — pure unit tests first

**Files:**
- Create: `src/lib/exitWorker.test.ts`
- Create: `src/lib/exitWorker.ts` (stub only in this task)

Write the failing pure unit tests before implementing the worker. These tests cover threshold logic and quantity math with no DB or network.

- [ ] **Step 1: Create stub `src/lib/exitWorker.ts`**

```ts
export type ExitTrigger = "tp" | "sl" | null;

export function checkExitTrigger(input: {
  currentPriceUsd: number;
  averageEntryUsd: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
}): ExitTrigger {
  throw new Error("not implemented");
}

export function calcExitQuantity(positionQuantity: number, exitSizePct: number): number {
  throw new Error("not implemented");
}

export async function runExitCheck(): Promise<void> {
  throw new Error("not implemented");
}

export function startExitWorker(): void {
  throw new Error("not implemented");
}

/** Reset module-level state between tests. Not for production use. */
export function resetWorkerState(): void {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Create `src/lib/exitWorker.test.ts` with pure unit tests**

```ts
import { describe, it, expect } from "vitest";
import { checkExitTrigger, calcExitQuantity } from "./exitWorker";

describe("checkExitTrigger", () => {
  it("returns tp when pnlPct meets takeProfitPct exactly", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 1.5,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: null
    })).toBe("tp");
  });

  it("returns tp when pnlPct exceeds takeProfitPct", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 2.0,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: null
    })).toBe("tp");
  });

  it("returns null when pnlPct is just below takeProfitPct", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 1.499,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: null
    })).toBeNull();
  });

  it("returns sl when pnlPct meets stopLossPct exactly", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 0.8,
      averageEntryUsd: 1.0,
      takeProfitPct: null,
      stopLossPct: 20
    })).toBe("sl");
  });

  it("returns sl when pnlPct exceeds stopLossPct", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 0.5,
      averageEntryUsd: 1.0,
      takeProfitPct: null,
      stopLossPct: 20
    })).toBe("sl");
  });

  it("returns null when pnlPct is just above stopLossPct threshold", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 0.801,
      averageEntryUsd: 1.0,
      takeProfitPct: null,
      stopLossPct: 20
    })).toBeNull();
  });

  it("returns null when both thresholds are null", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 999,
      averageEntryUsd: 1.0,
      takeProfitPct: null,
      stopLossPct: null
    })).toBeNull();
  });

  it("prefers tp over sl when both fire simultaneously", () => {
    // averageEntry 1.0, current 1.5 → +50% (tp) and -50% doesn't apply,
    // but testing the branch order: tp is checked first
    expect(checkExitTrigger({
      currentPriceUsd: 1.5,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: 20
    })).toBe("tp");
  });
});

describe("calcExitQuantity", () => {
  it("returns full quantity for 100%", () => {
    expect(calcExitQuantity(1000, 100)).toBe(1000);
  });

  it("returns half quantity for 50%", () => {
    expect(calcExitQuantity(1000, 50)).toBe(500);
  });

  it("handles fractional tokens", () => {
    expect(calcExitQuantity(333.333, 50)).toBeCloseTo(166.6665, 4);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test -- exitWorker.test.ts
```

Expected: tests fail with `"not implemented"`.

- [ ] **Step 4: Implement `checkExitTrigger` and `calcExitQuantity` in `exitWorker.ts`**

Replace the stub implementations:

```ts
export function checkExitTrigger(input: {
  currentPriceUsd: number;
  averageEntryUsd: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
}): ExitTrigger {
  if (input.averageEntryUsd <= 0) return null;
  const pnlPct = ((input.currentPriceUsd - input.averageEntryUsd) / input.averageEntryUsd) * 100;
  if (input.takeProfitPct !== null && pnlPct >= input.takeProfitPct) return "tp";
  if (input.stopLossPct !== null && pnlPct <= -input.stopLossPct) return "sl";
  return null;
}

export function calcExitQuantity(positionQuantity: number, exitSizePct: number): number {
  return positionQuantity * (exitSizePct / 100);
}
```

- [ ] **Step 5: Run pure unit tests — expect pass**

```bash
npm test -- exitWorker.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/exitWorker.ts src/lib/exitWorker.test.ts
git commit -m "feat: add checkExitTrigger and calcExitQuantity with passing tests"
```

---

## Task 5: Exit worker — `runExitCheck` integration tests and implementation

**Files:**
- Modify: `src/lib/exitWorker.ts`
- Modify: `src/lib/exitWorker.test.ts`

- [ ] **Step 1: Add integration tests to `exitWorker.test.ts`**

Add at the end of the file. These use the real SQLite DB via `getDb()` and mock `getZeroxPrice` + `buildQuotePreview`:

```ts
import { beforeEach, afterEach, vi } from "vitest";
import { getDb } from "./db";
import { getExitFailures, getExitRules, updateExitRules, addExitFailure } from "./repositories";
import { runExitCheck, resetWorkerState } from "./exitWorker";

// Mocks
vi.mock("./zerox", () => ({
  getZeroxPrice: vi.fn()
}));
vi.mock("./external", () => ({
  buildQuotePreview: vi.fn()
}));

import { getZeroxPrice } from "./zerox";
import { buildQuotePreview } from "./external";

function seedPosition(tokenAddress: string, chainId: number, quantity: number, avgEntryUsd: number) {
  const db = getDb();
  const now = new Date().toISOString();
  // ensure token exists
  db.prepare(
    `INSERT OR IGNORE INTO tokens (address, chain_id, symbol, name, decimals, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(tokenAddress, chainId, "TEST", "Test Token", 18, now);
  // insert a buy trade so position appears in ledger
  const tradeId = crypto.randomUUID();
  const notional = quantity * avgEntryUsd;
  db.prepare(
    `INSERT INTO trades (id, side, token_address, chain_id, quantity, price_usd, notional_usd,
      gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd, quote_snapshot, created_at)
     VALUES (?, 'buy', ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, '{}', ?)`
  ).run(tradeId, tokenAddress, chainId, quantity, avgEntryUsd, notional, notional, now);
  db.prepare(
    `INSERT INTO ledger_entries (id, entry_type, trade_id, token_address, chain_id,
      cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
     VALUES (?, 'buy', ?, ?, ?, ?, ?, ?, 0, 0, ?)`
  ).run(crypto.randomUUID(), tradeId, tokenAddress, chainId, -notional, quantity, notional, now);
}

describe("runExitCheck", () => {
  beforeEach(() => {
    // clear trades, ledger, and module-level worker state between tests
    const db = getDb();
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM tokens").run();
    db.prepare("DELETE FROM settings WHERE key IN ('exit_rules', 'exit_failures')").run();
    resetWorkerState(); // resets lastCheckedAt and pendingExits so interval guard doesn't block tests
    vi.clearAllMocks();
  });

  it("returns early when exit rules are disabled", async () => {
    updateExitRules({
      enabled: false,
      takeProfitPct: 50,
      stopLossPct: 20,
      exitSizePct: 100,
      checkIntervalSecs: 60
    });
    seedPosition("0xabc1230000000000000000000000000000000001", 8453, 100, 1.0);
    await runExitCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("returns early when both thresholds are null", async () => {
    updateExitRules({
      enabled: true,
      takeProfitPct: null,
      stopLossPct: null,
      exitSizePct: 100,
      checkIntervalSecs: 60
    });
    seedPosition("0xabc1230000000000000000000000000000000002", 8453, 100, 1.0);
    await runExitCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("skips a position already in exit_failures", async () => {
    const tokenAddress = "0xabc1230000000000000000000000000000000003";
    updateExitRules({ enabled: true, takeProfitPct: 50, stopLossPct: null, exitSizePct: 100, checkIntervalSecs: 60 });
    addExitFailure({ tokenAddress, chainId: 8453, symbol: "TEST", reason: "prior failure", failedAt: new Date().toISOString() });
    seedPosition(tokenAddress, 8453, 100, 1.0);
    vi.mocked(getZeroxPrice).mockResolvedValue({ buyAmount: "15000000" } as never);
    await runExitCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("fires a sell and records the trade when TP threshold is crossed", async () => {
    const tokenAddress = "0xabc1230000000000000000000000000000000004";
    updateExitRules({ enabled: true, takeProfitPct: 50, stopLossPct: null, exitSizePct: 100, checkIntervalSecs: 60 });
    seedPosition(tokenAddress, 8453, 100, 1.0);

    // price: $10 / (10000000/1e18 tokens) — but we use the /api/prices pattern:
    // getZeroxPrice sells $10 USDC → token, buyAmount = tokens received in base units
    // price = 10 / (buyAmount / 10^decimals)
    // For price = 1.6 (up 60% > TP 50%): buyAmount = 10 / 1.6 * 1e18 ≈ 6.25e18
    vi.mocked(getZeroxPrice).mockResolvedValue({ buyAmount: "6250000000000000000" } as never);
    vi.mocked(buildQuotePreview).mockResolvedValue({
      side: "sell",
      quantity: 100,
      priceUsd: 1.6,
      notionalUsd: 160,
      gasUsd: 0.5,
      slippageUsd: 0,
      dexFeeUsd: 0,
      totalCostUsd: 0.5,
      sellProceedsUsd: 159.5,
      warnings: [],
      quoteSnapshot: {}
    } as never);

    await runExitCheck();

    expect(buildQuotePreview).toHaveBeenCalledOnce();
    // trade should be recorded: check ledger has a sell entry
    const db = getDb();
    const sellEntry = db.prepare(
      "SELECT * FROM ledger_entries WHERE entry_type = 'sell' LIMIT 1"
    ).get() as Record<string, unknown> | undefined;
    expect(sellEntry).toBeDefined();
    // quoteSnapshot should contain autoExit fields
    const trade = db.prepare(
      "SELECT quote_snapshot FROM trades WHERE side = 'sell' LIMIT 1"
    ).get() as { quote_snapshot: string } | undefined;
    const snap = JSON.parse(trade!.quote_snapshot) as Record<string, unknown>;
    expect(snap.autoExit).toBe(true);
    expect(snap.trigger).toBe("tp");
  });

  it("records an exit failure and does not trade when buildQuotePreview throws", async () => {
    const tokenAddress = "0xabc1230000000000000000000000000000000005";
    updateExitRules({ enabled: true, takeProfitPct: 50, stopLossPct: null, exitSizePct: 100, checkIntervalSecs: 60 });
    seedPosition(tokenAddress, 8453, 100, 1.0);
    vi.mocked(getZeroxPrice).mockResolvedValue({ buyAmount: "6250000000000000000" } as never);
    vi.mocked(buildQuotePreview).mockRejectedValue(new Error("No liquidity route found"));

    await runExitCheck();

    const failures = getExitFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].tokenAddress).toBe(tokenAddress);
    expect(failures[0].reason).toContain("No liquidity route found");
    const db = getDb();
    const sellCount = (db.prepare("SELECT COUNT(*) AS c FROM trades WHERE side = 'sell'").get() as { c: number }).c;
    expect(sellCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run integration tests to confirm they fail**

```bash
npm test -- exitWorker.test.ts
```

Expected: integration tests fail with `"not implemented"`.

- [ ] **Step 3: Implement `runExitCheck` in `exitWorker.ts`**

Replace the full file content:

```ts
import { applyTradeToState } from "./accounting";
import { DEFAULT_SLIPPAGE_BPS, DEFAULT_GAS_BUFFER_BPS, getChainTokens } from "./constants";
import { buildQuotePreview } from "./external";
import { fromBaseUnits, toBaseUnits } from "./money";
import { addExitFailure, getExitFailures, getExitRules, getPortfolio, getPosition, listPositions, recordTrade } from "./repositories";
import type { Position } from "./types";
import { getZeroxPrice } from "./zerox";

export type ExitTrigger = "tp" | "sl" | null;

export function checkExitTrigger(input: {
  currentPriceUsd: number;
  averageEntryUsd: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
}): ExitTrigger {
  if (input.averageEntryUsd <= 0) return null;
  const pnlPct = ((input.currentPriceUsd - input.averageEntryUsd) / input.averageEntryUsd) * 100;
  if (input.takeProfitPct !== null && pnlPct >= input.takeProfitPct) return "tp";
  if (input.stopLossPct !== null && pnlPct <= -input.stopLossPct) return "sl";
  return null;
}

export function calcExitQuantity(positionQuantity: number, exitSizePct: number): number {
  return positionQuantity * (exitSizePct / 100);
}

const pendingExits = new Set<string>();
let lastCheckedAt = 0;

export async function runExitCheck(): Promise<void> {
  const rules = getExitRules();
  if (!rules.enabled) return;
  if (rules.takeProfitPct === null && rules.stopLossPct === null) return;
  if (Date.now() - lastCheckedAt < rules.checkIntervalSecs * 1000) return;
  lastCheckedAt = Date.now();

  const failures = getExitFailures();
  const failedAddresses = new Set(failures.map((f) => f.tokenAddress));

  const positions = listPositions().filter(
    (p) => p.quantity > 0 && !pendingExits.has(p.tokenAddress) && !failedAddresses.has(p.tokenAddress)
  );
  if (!positions.length) return;

  const byChain = new Map<number, Position[]>();
  for (const pos of positions) {
    const arr = byChain.get(pos.chainId) ?? [];
    arr.push(pos);
    byChain.set(pos.chainId, arr);
  }

  const priceMap = new Map<string, number | null>();
  for (const [chainId, chainPositions] of byChain) {
    const chainTokens = getChainTokens(chainId);
    const sellAmount = toBaseUnits(10, chainTokens.usdc.decimals);
    const results = await Promise.allSettled(
      chainPositions.map(async (pos) => {
        const quote = await getZeroxPrice({
          chainId,
          sellToken: chainTokens.usdc.address,
          buyToken: pos.tokenAddress,
          sellAmount
        });
        const tokensReceived = fromBaseUnits(quote.buyAmount, pos.decimals);
        if (!tokensReceived) throw new Error(`Zero buy amount for ${pos.tokenAddress}`);
        return { address: pos.tokenAddress, priceUsd: 10 / tokensReceived };
      })
    );
    for (let i = 0; i < chainPositions.length; i++) {
      const result = results[i];
      priceMap.set(chainPositions[i].tokenAddress, result.status === "fulfilled" ? result.value.priceUsd : null);
    }
  }

  await Promise.allSettled(
    positions.map(async (pos) => {
      const currentPriceUsd = priceMap.get(pos.tokenAddress) ?? null;
      if (currentPriceUsd === null) return;

      const trigger = checkExitTrigger({
        currentPriceUsd,
        averageEntryUsd: pos.averageEntryUsd,
        takeProfitPct: rules.takeProfitPct,
        stopLossPct: rules.stopLossPct
      });
      if (!trigger) return;

      pendingExits.add(pos.tokenAddress);
      try {
        const tokenQuantity = calcExitQuantity(pos.quantity, rules.exitSizePct);
        const preview = await buildQuotePreview({
          side: "sell",
          token: { address: pos.tokenAddress, chainId: pos.chainId, symbol: pos.symbol, name: pos.name, decimals: pos.decimals, createdAt: "" },
          chainId: pos.chainId,
          tokenQuantity,
          slippageBps: DEFAULT_SLIPPAGE_BPS,
          gasBufferBps: DEFAULT_GAS_BUFFER_BPS
        });

        // Re-fetch position just before executing to guard against a concurrent sell
        const freshPosition = getPosition(pos.tokenAddress);
        if (!freshPosition || freshPosition.quantity <= 0) return;

        const portfolio = getPortfolio();
        const next = applyTradeToState({ portfolio, position: freshPosition, preview });

        const pnlPct = ((currentPriceUsd - pos.averageEntryUsd) / pos.averageEntryUsd) * 100;
        const snapshotWithAutoExit = {
          ...preview.quoteSnapshot,
          autoExit: true,
          trigger,
          triggerPct: Math.round(pnlPct * 100) / 100
        };

        recordTrade({
          side: "sell",
          tokenAddress: pos.tokenAddress,
          chainId: pos.chainId,
          quantity: preview.quantity,
          priceUsd: preview.priceUsd,
          notionalUsd: preview.notionalUsd,
          gasUsd: preview.gasUsd,
          slippageUsd: preview.slippageUsd,
          dexFeeUsd: preview.dexFeeUsd,
          totalCostUsd: preview.totalCostUsd,
          realizedPnlUsd: next.realizedPnlUsd,
          quoteSnapshot: JSON.stringify(snapshotWithAutoExit)
        });
      } catch (error) {
        addExitFailure({
          tokenAddress: pos.tokenAddress,
          chainId: pos.chainId,
          symbol: pos.symbol,
          reason: error instanceof Error ? error.message : "Unknown error during auto-exit.",
          failedAt: new Date().toISOString()
        });
      } finally {
        pendingExits.delete(pos.tokenAddress);
      }
    })
  );
}

export function startExitWorker(): void {
  setInterval(() => {
    runExitCheck().catch((err: unknown) => {
      console.error("[exit-worker] Unhandled error in runExitCheck:", err);
    });
  }, 30_000);
}

/** Reset module-level state between tests. Not for production use. */
export function resetWorkerState(): void {
  lastCheckedAt = 0;
  pendingExits.clear();
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test -- exitWorker.test.ts
```

Expected: all tests pass (9 pure unit + 5 integration).

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/exitWorker.ts src/lib/exitWorker.test.ts
git commit -m "feat: implement runExitCheck with full test coverage"
```

---

## Task 6: `instrumentation.ts`

**Files:**
- Create: `src/instrumentation.ts`

- [ ] **Step 1: Create `src/instrumentation.ts`**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startExitWorker } = await import("./lib/exitWorker");
    startExitWorker();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start the dev server and confirm the worker registers without crashing**

```bash
npm run dev
```

Expected: server starts cleanly. No crash or unhandled error mentioning `exitWorker` or `instrumentation`.

- [ ] **Step 4: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat: register exit worker via instrumentation.ts on server startup"
```

---

## Task 7: Trade history badge

**Files:**
- Modify: `src/app/page.tsx`

Add auto-exit badges to `getTradeSignals`. The `TradeSignal` type already supports `tone: "warn" | "bad"` — auto-exit badges use `"warn"` with a green-equivalent label for TP. Because the type only allows `"warn" | "bad"`, use `"warn"` for both and rely on the label text to distinguish.

- [ ] **Step 1: Add auto-exit signals to `getTradeSignals` in `page.tsx`**

In `getTradeSignals` (around line 2168), add before the `return signals` line:

```ts
  if (snapshot.autoExit === true) {
    const trigger = snapshot.trigger;
    if (trigger === "tp") {
      signals.push({
        label: "Auto-exit TP",
        tone: "warn",
        title: `Position was automatically sold at take-profit (+${snapshot.triggerPct ?? "?"}%).`
      });
    } else if (trigger === "sl") {
      signals.push({
        label: "Auto-exit SL",
        tone: "bad",
        title: `Position was automatically sold at stop-loss (${snapshot.triggerPct ?? "?"}%).`
      });
    }
  }
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add Auto-exit TP/SL badges to trade history signals"
```

---

## Task 8: UI — Exit rules settings panel and position card status

**Files:**
- Modify: `src/app/page.tsx`

This task adds the settings form and per-position status line. Study the existing copy settings panel in `page.tsx` for the exact markup pattern before writing new code.

- [ ] **Step 1: Add `exitRules` and `exitFailures` to the dashboard state and initial fetch**

In `page.tsx`, find where `copySettings` state is declared and loaded. Add alongside it:

```ts
const [exitRules, setExitRules] = useState<ExitRules>(DEFAULT_EXIT_RULES);
const [exitFailures, setExitFailures] = useState<ExitFailure[]>([]);
```

In the initial data fetch (where `copySettings` is fetched), add:

```ts
const [exitRulesRes, exitFailuresRes] = await Promise.all([
  fetch("/api/settings/exit-rules"),
  fetch("/api/settings/exit-failures") // see note below
]);
if (exitRulesRes.ok) {
  const data = await exitRulesRes.json() as { exitRules: ExitRules };
  setExitRules(data.exitRules);
}
```

Note: There is no `GET /api/settings/exit-failures` route. Instead, include `exitFailures` in the portfolio route response — add `exitFailures: getExitFailures()` to the `/api/portfolio` response payload, or fetch it from the exit-rules route. The simplest approach: add `exitFailures` to the `GET /api/settings/exit-rules` response.

Update `src/app/api/settings/exit-rules/route.ts` GET handler:

```ts
import { getExitRules, getExitFailures } from "@/lib/repositories";

export async function GET() {
  return NextResponse.json({
    exitRules: getExitRules(),
    exitFailures: getExitFailures()
  });
}
```

Update the fetch in `page.tsx`:

```ts
if (exitRulesRes.ok) {
  const data = await exitRulesRes.json() as { exitRules: ExitRules; exitFailures: ExitFailure[] };
  setExitRules(data.exitRules);
  setExitFailures(data.exitFailures ?? []);
}
```

Import `ExitRules`, `ExitFailure` from `@/lib/types` and `DEFAULT_EXIT_RULES` from `@/lib/constants` at the top of `page.tsx`.

- [ ] **Step 2: Add the Exit Rules settings panel component**

Add a new `ExitRulesPanel` component at the bottom of `page.tsx` (near the other panel helper components), then render it in the settings section of the dashboard:

```tsx
function ExitRulesPanel({
  exitRules,
  onSave
}: {
  exitRules: ExitRules;
  onSave: (rules: ExitRules) => void;
}) {
  const [form, setForm] = useState<ExitRules>(exitRules);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/exit-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Could not save exit rules.");
      }
      const data = await res.json() as { exitRules: ExitRules };
      onSave(data.exitRules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save exit rules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h3>Auto-exit rules</h3>
      <label>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        {" "}Enabled
      </label>
      <label>
        Take profit %
        <input
          type="number"
          min={0}
          placeholder="disabled"
          value={form.takeProfitPct ?? ""}
          onChange={(e) => setForm({ ...form, takeProfitPct: e.target.value === "" ? null : Number(e.target.value) })}
        />
      </label>
      <label>
        Stop loss %
        <input
          type="number"
          min={0}
          placeholder="disabled"
          value={form.stopLossPct ?? ""}
          onChange={(e) => setForm({ ...form, stopLossPct: e.target.value === "" ? null : Number(e.target.value) })}
        />
      </label>
      <label>
        Exit size %
        <input
          type="number"
          min={1}
          max={100}
          value={form.exitSizePct}
          onChange={(e) => setForm({ ...form, exitSizePct: Number(e.target.value) })}
        />
      </label>
      <label>
        Check interval
        <select
          value={form.checkIntervalSecs}
          onChange={(e) => setForm({ ...form, checkIntervalSecs: Number(e.target.value) })}
        >
          <option value={30}>30 seconds</option>
          <option value={60}>1 minute</option>
          <option value={120}>2 minutes</option>
          <option value={300}>5 minutes</option>
          <option value={600}>10 minutes</option>
        </select>
      </label>
      {error && <p className="bad">{error}</p>}
      <button onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save auto-exit rules"}
      </button>
    </section>
  );
}
```

Render it in the settings area of the dashboard (wherever the copy settings panel is rendered), passing state:

```tsx
<ExitRulesPanel
  exitRules={exitRules}
  onSave={(rules) => setExitRules(rules)}
/>
```

- [ ] **Step 3: Add per-position status line to position cards**

In the position card render loop in `page.tsx`, find where each position is rendered. After the existing PnL cells, add:

```tsx
{(() => {
  const failure = exitFailures.find((f) => f.tokenAddress === position.tokenAddress);
  if (failure) {
    return (
      <div className="exit-failure-alert">
        <span className="bad">Auto-exit failed: {failure.reason}</span>
        {" "}
        <button
          onClick={async () => {
            const res = await fetch(`/api/settings/exit-failures/${position.tokenAddress}`, { method: "DELETE" });
            if (res.ok) {
              setExitFailures((prev) => prev.filter((f) => f.tokenAddress !== position.tokenAddress));
            }
          }}
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (exitRules.enabled && (exitRules.takeProfitPct !== null || exitRules.stopLossPct !== null)) {
    const parts: string[] = [];
    if (exitRules.takeProfitPct !== null) parts.push(`TP +${exitRules.takeProfitPct}%`);
    if (exitRules.stopLossPct !== null) parts.push(`SL −${exitRules.stopLossPct}%`);
    return <div className="subtle">Watching: {parts.join(" / ")}</div>;
  }
  return null;
})()}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Build check**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/api/settings/exit-rules/route.ts
git commit -m "feat: add exit rules settings panel, position watching status, and failure dismissal UI"
```

---

## Task 9: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Confirm the settings panel renders**

Open the dashboard. Scroll to the settings area. Confirm the "Auto-exit rules" panel is present with all controls: enabled checkbox, TP% input, SL% input, exit size %, interval selector, save button.

- [ ] **Step 3: Configure a test rule and confirm it saves**

Enable auto-exit. Set TP to `1` (1%), SL to `50`, exit size to `100`, interval to `30s`. Click Save. Reload the page — confirm the values persist.

- [ ] **Step 4: Confirm position cards show "Watching" status**

With exit rules enabled and at least one open position, confirm each position card shows `Watching: TP +1% / SL −50%` in muted text.

- [ ] **Step 5: Confirm the worker is logging correctly**

Watch the server terminal for 30 seconds. With exit rules enabled and open positions, the worker will fire. No crash expected; a price fetch attempt will appear in network logs.

- [ ] **Step 6: Confirm trade history badge renders**

If a position exits automatically, confirm the trade history row shows either `Auto-exit TP` or `Auto-exit SL` in the signals column. (Can also be verified by manually inserting a trade with `autoExit: true` in the `quote_snapshot` via SQLite browser.)

- [ ] **Step 7: Final test run**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Final commit if any loose changes**

```bash
git status
```

If clean, no commit needed. If any stray changes:

```bash
git add -p
git commit -m "fix: manual verification cleanup"
```
