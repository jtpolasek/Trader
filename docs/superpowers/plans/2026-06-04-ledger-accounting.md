# Ledger-as-Source-of-Truth Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace incremental, unwrapped portfolio/position writes with an append-only ledger that is the single writable source of truth, with portfolio and positions computed on read and a read-only verify cross-check.

**Architecture:** Each trade (including total-loss closes, stored as zero-price sells) appends one immutable `ledger_entries` row of signed deltas, written atomically with the trade row in a single SQLite transaction. Cash, realized PnL, fees, and per-token positions are derived by summing ledger deltas on read — no cached running totals, so drift is structurally impossible. A pure `ledgerDeltaFromTrade` function feeds the write path, the backfill migration, and the verify endpoint identically.

**Tech Stack:** Next.js App Router (route handlers), `node:sqlite` (`DatabaseSync`), TypeScript, Vitest. Test command: `npm test` (alias for `vitest run`).

**Spec:** `docs/superpowers/specs/2026-06-04-ledger-accounting-design.md`

---

## File Structure

**Create:**
- `src/lib/ledger.ts` — pure ledger logic: `ledgerDeltaFromTrade`, `derivePortfolioTotals`, `derivePositions`, `verifyLedger`. No DB access.
- `src/lib/ledger.test.ts` — unit tests for all of the above.
- `src/app/api/ledger/verify/route.ts` — `GET` endpoint returning verify results.

**Modify:**
- `src/lib/types.ts` — add ledger types (`LedgerEntryType`, `LedgerDelta`, `LedgerEntry`, `TradeLedgerInput`, `TradeInput`, `PortfolioTotals`).
- `src/lib/db.ts` — create `ledger_entries` table + one-time backfill from existing trades.
- `src/lib/repositories.ts` — add `insertLedgerEntry`, `recordTrade`, `listLedgerEntries`, `listTradesForLedger`; rewire `getPortfolio` / `listPositions` / `getPosition` to derive from the ledger; remove now-dead `updatePortfolio` / `upsertPosition`.
- `src/app/api/trades/execute/route.ts` — use `recordTrade`.
- `src/app/api/candidates/[id]/copy/route.ts` — use `recordTrade`.
- `src/app/api/positions/[tokenAddress]/zero/route.ts` — use `recordTrade`.
- `src/app/page.tsx` — small "Ledger verified" trust signal.

**Testing strategy:** The codebase tests pure logic only (`accounting.test.ts`, `external.test.ts`, `money.test.ts`); `db.ts` and `repositories.ts` have no DB-integration tests. This plan follows that pattern: all new logic lives in pure `ledger.ts` and is unit-tested with TDD. DB wiring, routes, and UI are verified manually via steps in each task plus the full `npm test` run.

---

## Task 1: Ledger types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add ledger types at the end of `src/lib/types.ts`**

Append:

```typescript
export type TradeInput = Omit<Trade, "id" | "createdAt" | "symbol">;

export type TradeLedgerInput = Pick<
  Trade,
  | "side"
  | "quantity"
  | "priceUsd"
  | "notionalUsd"
  | "gasUsd"
  | "slippageUsd"
  | "dexFeeUsd"
  | "totalCostUsd"
  | "realizedPnlUsd"
>;

export type LedgerEntryType = "buy" | "sell" | "total_loss";

export type LedgerDelta = {
  entryType: LedgerEntryType;
  cashDelta: number;
  quantityDelta: number;
  costBasisDelta: number;
  realizedPnlDelta: number;
  feeDelta: number;
};

export type LedgerEntry = LedgerDelta & {
  id: string;
  tradeId: string;
  tokenAddress: string;
  createdAt: string;
};

export type PortfolioTotals = {
  cashUsd: number;
  realizedPnlUsd: number;
  feesPaidUsd: number;
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The new types are not yet used, which is fine.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add ledger accounting types"
```

---

## Task 2: `ledgerDeltaFromTrade` (pure)

**Files:**
- Create: `src/lib/ledger.ts`
- Test: `src/lib/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ledger.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ledgerDeltaFromTrade } from "./ledger";
import type { TradeLedgerInput } from "./types";

function trade(overrides: Partial<TradeLedgerInput>): TradeLedgerInput {
  return {
    side: "buy",
    quantity: 10,
    priceUsd: 10,
    notionalUsd: 100,
    gasUsd: 5,
    slippageUsd: 1,
    dexFeeUsd: 0,
    totalCostUsd: 106,
    realizedPnlUsd: 0,
    ...overrides
  };
}

describe("ledgerDeltaFromTrade", () => {
  it("derives a buy delta with fees folded into cost basis", () => {
    expect(ledgerDeltaFromTrade(trade({}))).toEqual({
      entryType: "buy",
      cashDelta: -106,
      quantityDelta: 10,
      costBasisDelta: 106,
      realizedPnlDelta: 0,
      feeDelta: 6
    });
  });

  it("derives a sell delta with proceeds net of fees", () => {
    const delta = ledgerDeltaFromTrade(
      trade({ side: "sell", quantity: 4, notionalUsd: 60, gasUsd: 3, slippageUsd: 1, dexFeeUsd: 0, totalCostUsd: 4, realizedPnlUsd: 16 })
    );
    expect(delta).toEqual({
      entryType: "sell",
      cashDelta: 56,
      quantityDelta: -4,
      costBasisDelta: -40,
      realizedPnlDelta: 16,
      feeDelta: 4
    });
  });

  it("classifies a zero-price sell as a total loss", () => {
    const delta = ledgerDeltaFromTrade(
      trade({ side: "sell", quantity: 100, priceUsd: 0, notionalUsd: 0, gasUsd: 0, slippageUsd: 0, dexFeeUsd: 0, totalCostUsd: 0, realizedPnlUsd: -200 })
    );
    expect(delta).toEqual({
      entryType: "total_loss",
      cashDelta: 0,
      quantityDelta: -100,
      costBasisDelta: -200,
      realizedPnlDelta: -200,
      feeDelta: 0
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ledger.test.ts`
Expected: FAIL — cannot find module `./ledger` / `ledgerDeltaFromTrade is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/ledger.ts`:

```typescript
import type { LedgerDelta, TradeLedgerInput } from "./types";

export function ledgerDeltaFromTrade(trade: TradeLedgerInput): LedgerDelta {
  const fees = trade.gasUsd + trade.slippageUsd + trade.dexFeeUsd;

  if (trade.side === "buy") {
    return {
      entryType: "buy",
      cashDelta: -trade.totalCostUsd,
      quantityDelta: trade.quantity,
      costBasisDelta: trade.notionalUsd + fees,
      realizedPnlDelta: 0,
      feeDelta: fees
    };
  }

  const proceeds = Math.max(0, trade.notionalUsd - fees);
  const isTotalLoss = trade.priceUsd === 0 && trade.notionalUsd === 0;

  return {
    entryType: isTotalLoss ? "total_loss" : "sell",
    cashDelta: proceeds,
    quantityDelta: -trade.quantity,
    costBasisDelta: -(proceeds - trade.realizedPnlUsd),
    realizedPnlDelta: trade.realizedPnlUsd,
    feeDelta: fees
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ledger.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger.ts src/lib/ledger.test.ts
git commit -m "feat: derive ledger deltas from trade records"
```

---

## Task 3: Portfolio + position aggregation (pure)

**Files:**
- Modify: `src/lib/ledger.ts`
- Modify: `src/lib/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ledger.test.ts`:

```typescript
import { derivePortfolioTotals, derivePositions } from "./ledger";
import type { LedgerEntry } from "./types";

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: "e",
    tradeId: "t",
    tokenAddress: "0xtoken",
    entryType: "buy",
    cashDelta: 0,
    quantityDelta: 0,
    costBasisDelta: 0,
    realizedPnlDelta: 0,
    feeDelta: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("derivePortfolioTotals", () => {
  it("sums cash, realized pnl, and fees onto starting cash", () => {
    const totals = derivePortfolioTotals(
      [
        entry({ cashDelta: -106, feeDelta: 6 }),
        entry({ cashDelta: 56, realizedPnlDelta: 16, feeDelta: 4 })
      ],
      10_000
    );
    expect(totals).toEqual({ cashUsd: 9_950, realizedPnlUsd: 16, feesPaidUsd: 10 });
  });
});

describe("derivePositions", () => {
  it("aggregates per token and computes average entry", () => {
    const positions = derivePositions([
      entry({ tokenAddress: "0xa", quantityDelta: 10, costBasisDelta: 106, feeDelta: 6, createdAt: "2026-01-01T00:00:00.000Z" }),
      entry({ tokenAddress: "0xa", quantityDelta: 5, costBasisDelta: 83, feeDelta: 8, createdAt: "2026-01-02T00:00:00.000Z" })
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      tokenAddress: "0xa",
      quantity: 15,
      costBasisUsd: 189,
      feesPaidUsd: 14,
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    expect(positions[0].averageEntryUsd).toBeCloseTo(12.6);
  });

  it("omits fully closed positions", () => {
    const positions = derivePositions([
      entry({ tokenAddress: "0xa", quantityDelta: 100, costBasisDelta: 200 }),
      entry({ tokenAddress: "0xa", quantityDelta: -100, costBasisDelta: -200, realizedPnlDelta: -200, entryType: "total_loss" })
    ]);
    expect(positions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ledger.test.ts`
Expected: FAIL — `derivePortfolioTotals` / `derivePositions` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/ledger.ts`:

```typescript
import type { LedgerEntry, PortfolioTotals } from "./types";

export function derivePortfolioTotals(entries: LedgerEntry[], startingCashUsd: number): PortfolioTotals {
  let cashUsd = startingCashUsd;
  let realizedPnlUsd = 0;
  let feesPaidUsd = 0;
  for (const item of entries) {
    cashUsd += item.cashDelta;
    realizedPnlUsd += item.realizedPnlDelta;
    feesPaidUsd += item.feeDelta;
  }
  return { cashUsd, realizedPnlUsd, feesPaidUsd };
}

export type PositionAggregate = {
  tokenAddress: string;
  quantity: number;
  averageEntryUsd: number;
  costBasisUsd: number;
  realizedPnlUsd: number;
  feesPaidUsd: number;
  updatedAt: string;
};

const OPEN_POSITION_EPSILON = 1e-10;

export function derivePositions(entries: LedgerEntry[]): PositionAggregate[] {
  const byToken = new Map<string, PositionAggregate>();

  for (const item of entries) {
    const current =
      byToken.get(item.tokenAddress) ??
      {
        tokenAddress: item.tokenAddress,
        quantity: 0,
        averageEntryUsd: 0,
        costBasisUsd: 0,
        realizedPnlUsd: 0,
        feesPaidUsd: 0,
        updatedAt: item.createdAt
      };

    current.quantity += item.quantityDelta;
    current.costBasisUsd += item.costBasisDelta;
    current.realizedPnlUsd += item.realizedPnlDelta;
    current.feesPaidUsd += item.feeDelta;
    if (item.createdAt > current.updatedAt) current.updatedAt = item.createdAt;
    byToken.set(item.tokenAddress, current);
  }

  return Array.from(byToken.values())
    .filter((position) => position.quantity > OPEN_POSITION_EPSILON)
    .map((position) => ({
      ...position,
      averageEntryUsd: position.quantity > OPEN_POSITION_EPSILON ? position.costBasisUsd / position.quantity : 0
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ledger.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger.ts src/lib/ledger.test.ts
git commit -m "feat: derive portfolio totals and positions from ledger entries"
```

---

## Task 4: `verifyLedger` (pure)

**Files:**
- Modify: `src/lib/ledger.ts`
- Modify: `src/lib/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ledger.test.ts`:

```typescript
import { verifyLedger } from "./ledger";

describe("verifyLedger", () => {
  const buyTrade = { id: "t1", ...trade({}) };

  it("passes when each trade has a matching entry", () => {
    const entries = [entry({ tradeId: "t1", cashDelta: -106, quantityDelta: 10, costBasisDelta: 106, realizedPnlDelta: 0, feeDelta: 6 })];
    const result = verifyLedger([buyTrade], entries);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("flags a missing entry", () => {
    const result = verifyLedger([buyTrade], []);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContainEqual({ tradeId: "t1", field: "entry", expected: 0, actual: null });
  });

  it("flags a tampered delta", () => {
    const entries = [entry({ tradeId: "t1", cashDelta: -999, quantityDelta: 10, costBasisDelta: 106, realizedPnlDelta: 0, feeDelta: 6 })];
    const result = verifyLedger([buyTrade], entries);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContainEqual({ tradeId: "t1", field: "cashDelta", expected: -106, actual: -999 });
  });

  it("flags an orphan entry with no trade", () => {
    const entries = [entry({ tradeId: "ghost", cashDelta: 1 })];
    const result = verifyLedger([], entries);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContainEqual({ tradeId: "ghost", field: "orphan-entry", expected: 0, actual: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ledger.test.ts`
Expected: FAIL — `verifyLedger` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/ledger.ts`:

```typescript
import type { TradeLedgerInput } from "./types";

export type LedgerMismatch = {
  tradeId: string;
  field: string;
  expected: number;
  actual: number | null;
};

const VERIFY_EPSILON = 1e-6;

export function verifyLedger(
  trades: Array<TradeLedgerInput & { id: string }>,
  entries: LedgerEntry[]
): { ok: boolean; mismatches: LedgerMismatch[] } {
  const entryByTrade = new Map(entries.map((item) => [item.tradeId, item]));
  const tradeIds = new Set(trades.map((item) => item.id));
  const mismatches: LedgerMismatch[] = [];

  for (const item of trades) {
    const expected = ledgerDeltaFromTrade(item);
    const stored = entryByTrade.get(item.id);
    if (!stored) {
      mismatches.push({ tradeId: item.id, field: "entry", expected: 0, actual: null });
      continue;
    }

    const checks: Array<[string, number, number]> = [
      ["cashDelta", expected.cashDelta, stored.cashDelta],
      ["quantityDelta", expected.quantityDelta, stored.quantityDelta],
      ["costBasisDelta", expected.costBasisDelta, stored.costBasisDelta],
      ["realizedPnlDelta", expected.realizedPnlDelta, stored.realizedPnlDelta],
      ["feeDelta", expected.feeDelta, stored.feeDelta]
    ];

    for (const [field, exp, act] of checks) {
      if (Math.abs(exp - act) > VERIFY_EPSILON) {
        mismatches.push({ tradeId: item.id, field, expected: exp, actual: act });
      }
    }
  }

  for (const item of entries) {
    if (!tradeIds.has(item.tradeId)) {
      mismatches.push({ tradeId: item.tradeId, field: "orphan-entry", expected: 0, actual: null });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ledger.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger.ts src/lib/ledger.test.ts
git commit -m "feat: cross-check ledger entries against the trade log"
```

---

## Task 5: Create `ledger_entries` table + backfill migration

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Add the table to the `CREATE TABLE` block**

In `src/lib/db.ts`, inside the `database.exec(\`...\`)` migration string, add this table definition immediately after the `trades` table block (after its closing `);`):

```sql
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      entry_type TEXT NOT NULL,
      trade_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      cash_delta REAL NOT NULL,
      quantity_delta REAL NOT NULL,
      cost_basis_delta REAL NOT NULL,
      realized_pnl_delta REAL NOT NULL,
      fee_delta REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(trade_id) REFERENCES trades(id),
      FOREIGN KEY(token_address) REFERENCES tokens(address)
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_entries_token ON ledger_entries(token_address);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_trade ON ledger_entries(trade_id);
```

- [ ] **Step 2: Add the backfill import and call**

At the top of `src/lib/db.ts`, add to the existing imports:

```typescript
import { randomUUID } from "node:crypto";
import { ledgerDeltaFromTrade } from "./ledger";
```

At the end of the `migrate` function (after the `INSERT OR IGNORE INTO portfolios ...` block), add:

```typescript
  backfillLedger(database);
```

- [ ] **Step 3: Implement `backfillLedger`**

Add this function to `src/lib/db.ts` (below `addColumnIfMissing`):

```typescript
function backfillLedger(database: DatabaseSync) {
  const existing = database.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get() as { count: number };
  if (existing.count > 0) return;

  const trades = database
    .prepare(
      `SELECT id, side, token_address, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd,
              total_cost_usd, realized_pnl_usd, created_at
       FROM trades
       ORDER BY created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;
  if (trades.length === 0) return;

  const insert = database.prepare(
    `INSERT INTO ledger_entries
      (id, entry_type, trade_id, token_address, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  database.exec("BEGIN");
  try {
    for (const row of trades) {
      const delta = ledgerDeltaFromTrade({
        side: String(row.side) as "buy" | "sell",
        quantity: Number(row.quantity),
        priceUsd: Number(row.price_usd),
        notionalUsd: Number(row.notional_usd),
        gasUsd: Number(row.gas_usd),
        slippageUsd: Number(row.slippage_usd),
        dexFeeUsd: Number(row.dex_fee_usd),
        totalCostUsd: Number(row.total_cost_usd),
        realizedPnlUsd: Number(row.realized_pnl_usd)
      });
      insert.run(
        randomUUID(),
        delta.entryType,
        String(row.id),
        String(row.token_address),
        delta.cashDelta,
        delta.quantityDelta,
        delta.costBasisDelta,
        delta.realizedPnlDelta,
        delta.feeDelta,
        String(row.created_at)
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
```

- [ ] **Step 4: Verify it compiles and the suite still passes**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. (No ledger rows exist for a fresh DB, so backfill is a no-op; existing tests are unaffected.)

- [ ] **Step 5: Manually verify the table + backfill against the live DB**

Run the dev server once so `getDb()` runs the migration against `data/paper-trader.db`:

Run: `npm run dev` (let it boot, then stop with Ctrl+C)

Then inspect (PowerShell):

Run: `node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/paper-trader.db');console.log('trades',db.prepare('SELECT COUNT(*) c FROM trades').get());console.log('entries',db.prepare('SELECT COUNT(*) c FROM ledger_entries').get());"`
Expected: `entries.c` equals `trades.c` (one ledger entry per existing trade). If there are zero trades, both are 0 — also correct.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add ledger_entries table with one-time backfill"
```

---

## Task 6: Repository write + read wiring

**Files:**
- Modify: `src/lib/repositories.ts`

- [ ] **Step 1: Update imports and `insertTrade` signature**

In `src/lib/repositories.ts`, update the type import line to add the new types:

```typescript
import type {
  CopySettings,
  LedgerEntry,
  Portfolio,
  Position,
  Token,
  Trade,
  TradeCandidate,
  TradeInput,
  TradeLedgerInput,
  Wallet,
  WalletActivity
} from "./types";
```

Add this import below the existing `./types` import:

```typescript
import { derivePortfolioTotals, derivePositions, ledgerDeltaFromTrade } from "./ledger";
```

Change the `insertTrade` signature from `input: Omit<Trade, "id" | "createdAt" | "symbol">` to `input: TradeInput` (behavior unchanged; this is a naming alias).

- [ ] **Step 2: Add `insertLedgerEntry`, `recordTrade`, `listLedgerEntries`, `listTradesForLedger`**

Add these functions to `src/lib/repositories.ts` (place them just after `insertTrade`):

```typescript
function insertLedgerEntryRow(tradeId: string, tokenAddress: string, input: TradeInput) {
  const delta = ledgerDeltaFromTrade(input);
  getDb()
    .prepare(
      `INSERT INTO ledger_entries
        (id, entry_type, trade_id, token_address, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      delta.entryType,
      tradeId,
      tokenAddress,
      delta.cashDelta,
      delta.quantityDelta,
      delta.costBasisDelta,
      delta.realizedPnlDelta,
      delta.feeDelta,
      now()
    );
}

export function recordTrade(input: TradeInput): string {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const tradeId = insertTrade(input);
    insertLedgerEntryRow(tradeId, input.tokenAddress, input);
    db.exec("COMMIT");
    return tradeId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listLedgerEntries(): LedgerEntry[] {
  return (getDb()
    .prepare(
      `SELECT * FROM ledger_entries ORDER BY created_at ASC, rowid ASC`
    )
    .all() as Row[]).map((row) => ({
    id: String(row.id),
    tradeId: String(row.trade_id),
    tokenAddress: String(row.token_address),
    entryType: String(row.entry_type) as LedgerEntry["entryType"],
    cashDelta: Number(row.cash_delta),
    quantityDelta: Number(row.quantity_delta),
    costBasisDelta: Number(row.cost_basis_delta),
    realizedPnlDelta: Number(row.realized_pnl_delta),
    feeDelta: Number(row.fee_delta),
    createdAt: String(row.created_at)
  }));
}

export function listTradesForLedger(): Array<TradeLedgerInput & { id: string }> {
  return (getDb()
    .prepare(
      `SELECT id, side, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd
       FROM trades`
    )
    .all() as Row[]).map((row) => ({
    id: String(row.id),
    side: String(row.side) as Trade["side"],
    quantity: Number(row.quantity),
    priceUsd: Number(row.price_usd),
    notionalUsd: Number(row.notional_usd),
    gasUsd: Number(row.gas_usd),
    slippageUsd: Number(row.slippage_usd),
    dexFeeUsd: Number(row.dex_fee_usd),
    totalCostUsd: Number(row.total_cost_usd),
    realizedPnlUsd: Number(row.realized_pnl_usd)
  }));
}
```

- [ ] **Step 3: Rewire `getPortfolio` to derive from the ledger**

Replace the existing `getPortfolio` function with:

```typescript
export function getPortfolio() {
  const row = getDb().prepare("SELECT * FROM portfolios WHERE id = 'default'").get() as Row;
  const startingCashUsd = Number(row.starting_cash_usd);
  const totals = derivePortfolioTotals(listLedgerEntries(), startingCashUsd);
  return {
    id: String(row.id),
    name: String(row.name),
    cashUsd: totals.cashUsd,
    startingCashUsd,
    realizedPnlUsd: totals.realizedPnlUsd,
    feesPaidUsd: totals.feesPaidUsd,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  } satisfies Portfolio;
}
```

(The `rowToPortfolio` helper is now unused — delete it.)

- [ ] **Step 4: Rewire `listPositions` and `getPosition` to derive from the ledger**

Replace the existing `listPositions` and `getPosition` functions with:

```typescript
export function listPositions(): Position[] {
  const aggregates = derivePositions(listLedgerEntries());
  const positions: Position[] = [];
  for (const aggregate of aggregates) {
    const token = getToken(aggregate.tokenAddress);
    if (!token) continue;
    positions.push({
      tokenAddress: aggregate.tokenAddress,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      quantity: aggregate.quantity,
      averageEntryUsd: aggregate.averageEntryUsd,
      costBasisUsd: aggregate.costBasisUsd,
      realizedPnlUsd: aggregate.realizedPnlUsd,
      feesPaidUsd: aggregate.feesPaidUsd,
      updatedAt: aggregate.updatedAt
    });
  }
  return positions;
}

export function getPosition(tokenAddress: string) {
  const entries = listLedgerEntries().filter((entry) => entry.tokenAddress === tokenAddress);
  if (entries.length === 0) return null;

  const token = getToken(tokenAddress);
  if (!token) return null;

  let quantity = 0;
  let costBasisUsd = 0;
  let realizedPnlUsd = 0;
  let feesPaidUsd = 0;
  let updatedAt = entries[0].createdAt;
  for (const entry of entries) {
    quantity += entry.quantityDelta;
    costBasisUsd += entry.costBasisDelta;
    realizedPnlUsd += entry.realizedPnlDelta;
    feesPaidUsd += entry.feeDelta;
    if (entry.createdAt > updatedAt) updatedAt = entry.createdAt;
  }

  return {
    tokenAddress,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    quantity,
    averageEntryUsd: quantity > 1e-10 ? costBasisUsd / quantity : 0,
    costBasisUsd,
    realizedPnlUsd,
    feesPaidUsd,
    updatedAt
  } satisfies Position;
}
```

- [ ] **Step 5: Delete the now-dead write helpers**

Delete the `updatePortfolio` function and the `upsertPosition` function from `src/lib/repositories.ts`. They are replaced by `recordTrade`. (Leave `rowToPosition` only if still referenced; after this change it is unused — delete it too.)

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: FAIL — the three route files still import `updatePortfolio` / `upsertPosition`. That is expected and fixed in Task 7. Confirm the only errors are in `src/app/api/...` route files, not in `repositories.ts` itself.

- [ ] **Step 7: Commit**

```bash
git add src/lib/repositories.ts
git commit -m "feat: serve portfolio and positions from the ledger"
```

---

## Task 7: Route wiring — execute, copy, total-loss

**Files:**
- Modify: `src/app/api/trades/execute/route.ts`
- Modify: `src/app/api/candidates/[id]/copy/route.ts`
- Modify: `src/app/api/positions/[tokenAddress]/zero/route.ts`

- [ ] **Step 1: Update `execute/route.ts`**

In `src/app/api/trades/execute/route.ts`, replace the `@/lib/repositories` import block (which currently imports `insertTrade`, `updatePortfolio`, `upsertPosition`) with exactly this — `recordTrade` replaces all three. Leave the separate `@/lib/external` import of `buildQuotePreview` / `resolveTokenFromAlchemy` untouched:

```typescript
import {
  getPortfolio,
  getPosition,
  getToken,
  recordTrade,
  upsertToken
} from "@/lib/repositories";
```

Replace the write section (the lines from `const next = applyTradeToState(...)` through the `const tradeId = insertTrade({ ... });` call) with:

```typescript
    const next = applyTradeToState({ portfolio, position, preview });

    const tradeId = recordTrade({
      side: preview.side,
      tokenAddress,
      quantity: preview.quantity,
      priceUsd: preview.priceUsd,
      notionalUsd: preview.notionalUsd,
      gasUsd: preview.gasUsd,
      slippageUsd: preview.slippageUsd,
      dexFeeUsd: preview.dexFeeUsd,
      totalCostUsd: preview.totalCostUsd,
      realizedPnlUsd: next.realizedPnlUsd,
      quoteSnapshot: JSON.stringify(preview.quoteSnapshot)
    });
```

`applyTradeToState` is still called: it performs the insufficient-cash/balance validation (which throws before any write) and computes `next.realizedPnlUsd`. Its `next.portfolio` / `next.position` outputs are simply no longer persisted directly.

- [ ] **Step 2: Update `candidates/[id]/copy/route.ts`**

In `src/app/api/candidates/[id]/copy/route.ts`, change the repositories import block to remove `updatePortfolio`, `upsertPosition`, `insertTrade` and add `recordTrade`:

```typescript
import {
  getCopySettings,
  getPortfolio,
  getPosition,
  getToken,
  getTradeCandidate,
  recordTrade,
  updateTradeCandidateStatus,
  upsertToken
} from "@/lib/repositories";
```

Replace the write section (from `const next = applyTradeToState(...)` through the `const tradeId = insertTrade({ ... });` call, but keep the `quoteSnapshot` object construction in between) with:

```typescript
    const next = applyTradeToState({ portfolio, position, preview });

    const quoteSnapshot = {
      ...preview.quoteSnapshot,
      copiedFrom: {
        candidateId: candidate.id,
        walletAddress: candidate.walletAddress,
        chainId: candidate.chainId,
        chainName: candidate.chainName,
        sourceHash: candidate.hash,
        sourceTimestamp: candidate.sourceTimestamp,
        sourceSide: candidate.side,
        sourceNotionalUsd: sized.sourceNotionalUsd,
        copySettings: settings
      }
    };

    const tradeId = recordTrade({
      side: preview.side,
      tokenAddress: sized.tokenAddress,
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
```

- [ ] **Step 3: Update `positions/[tokenAddress]/zero/route.ts`**

In `src/app/api/positions/[tokenAddress]/zero/route.ts`, change the repositories import block to:

```typescript
import {
  getPortfolio,
  getPosition,
  recordTrade
} from "@/lib/repositories";
```

Replace the write section (from `const next = applyTotalLossToState(...)` through the `const tradeId = insertTrade({ ... });` call) with:

```typescript
    const next = applyTotalLossToState({ portfolio, position });

    const tradeId = recordTrade({
      side: "sell",
      tokenAddress,
      quantity: position.quantity,
      priceUsd: 0,
      notionalUsd: 0,
      gasUsd: 0,
      slippageUsd: 0,
      dexFeeUsd: 0,
      totalCostUsd: 0,
      realizedPnlUsd: next.realizedPnlUsd,
      quoteSnapshot: JSON.stringify({
        provider: "manual",
        action: "mark-total-loss",
        reason: "Position was manually marked as a total loss because no usable liquidity/route was available.",
        tokenAddress,
        quantity: position.quantity,
        costBasisUsd: position.costBasisUsd,
        createdAt: new Date().toISOString()
      })
    });
```

`applyTotalLossToState` is still called to compute `next.realizedPnlUsd` and is left in place.

- [ ] **Step 4: Verify the whole project compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — no remaining references to `updatePortfolio` / `upsertPosition` / `insertTrade` in routes; all existing tests green.

- [ ] **Step 5: Manual smoke test of the write path**

Run: `npm run dev`

In the UI at `http://localhost:3000`:
1. Preview and execute a small paper buy for any ERC-20 contract.
2. Confirm Cash drops, the position appears, and the trade lands in Trade history.
3. Execute a partial sell of that position; confirm realized PnL and Cash update.

Then confirm the ledger matches the trades (PowerShell):

Run: `node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/paper-trader.db');console.log(db.prepare('SELECT COUNT(*) trades FROM trades').get(), db.prepare('SELECT COUNT(*) entries FROM ledger_entries').get());"`
Expected: `entries` count equals `trades` count. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/trades/execute/route.ts src/app/api/candidates/[id]/copy/route.ts src/app/api/positions/[tokenAddress]/zero/route.ts
git commit -m "feat: write trades and ledger entries atomically via recordTrade"
```

---

## Task 8: Verify endpoint

**Files:**
- Create: `src/app/api/ledger/verify/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/ledger/verify/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { verifyLedger } from "@/lib/ledger";
import { listLedgerEntries, listTradesForLedger } from "@/lib/repositories";

export async function GET() {
  const result = verifyLedger(listTradesForLedger(), listLedgerEntries());
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manually verify the endpoint**

Run: `npm run dev`

Run: `node -e "fetch('http://localhost:3000/api/ledger/verify').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"`
Expected: `{"ok":true,"mismatches":[]}` against a consistent DB. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ledger/verify/route.ts
git commit -m "feat: add read-only ledger verify endpoint"
```

---

## Task 9: Dashboard trust signal

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add verify state and fetch**

In `src/app/page.tsx`, inside the `Home` component, add state near the other `useState` declarations:

```typescript
  const [ledgerOk, setLedgerOk] = useState<{ ok: boolean; count: number } | null>(null);
```

Add a fetch helper near `refresh`:

```typescript
  const refreshLedgerStatus = async () => {
    const response = await fetch("/api/ledger/verify", { cache: "no-store" });
    const payload = (await response.json()) as { ok: boolean; mismatches: unknown[] };
    setLedgerOk({ ok: payload.ok, count: payload.mismatches.length });
  };
```

In the existing mount `useEffect`, call it alongside `refresh()`:

```typescript
  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load portfolio."));
    refreshLedgerStatus().catch(() => setLedgerOk(null));
  }, []);
```

- [ ] **Step 2: Render the badge in the topbar**

In the `<header className="topbar">` block, add this just before the Refresh `<button>`:

```tsx
        {ledgerOk ? (
          <span className={ledgerOk.ok ? "pill good" : "pill bad"} title="Ledger consistency check against the trade log">
            {ledgerOk.ok ? "Ledger ✓ verified" : `⚠ ${ledgerOk.count} ledger mismatches`}
          </span>
        ) : null}
```

- [ ] **Step 3: Verify it compiles and the suite passes**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Manually verify the badge**

Run: `npm run dev`
Open `http://localhost:3000`. Expected: a green `Ledger ✓ verified` pill in the top bar. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: show ledger verification status on the dashboard"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full type check + test run**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — all suites green, no type errors.

- [ ] **Step 2: Confirm no dead references remain**

Run: `git grep -n "updatePortfolio\|upsertPosition"`
Expected: no matches (both helpers and all their call sites are gone).

- [ ] **Step 3: End-to-end smoke**

Run: `npm run dev`. Execute a buy, a partial sell, and a manual total-loss on a throwaway position. After each, confirm the `Ledger ✓ verified` pill stays green and Cash / PnL / Fees update correctly. Stop the dev server.

---

## Self-Review Notes (for the implementer)

- **Float tolerance:** verify uses `1e-6`; open-position filter uses `1e-10`. These intentionally differ — the former compares deltas, the latter decides whether a near-zero residual quantity counts as an open position (matching the prior `quantity > 0.0000000001` behavior in `listPositions`).
- **`applyTradeToState` / `applyTotalLossToState` stay:** they remain the pre-write validators and the source of `realizedPnlUsd`. Only their direct persistence side effects are removed. `accounting.ts` and `accounting.test.ts` are unchanged.
- **Backfill is one-shot:** guarded by `COUNT(*) FROM ledger_entries`. If a future change needs re-backfill, the table must be emptied first (out of scope here).
