# Local Import/Restore Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user restore a previously exported schema-version-1 JSON bundle into the local SQLite app via a guarded, validated, transactional replace-all import.

**Architecture:** A pure zod validator (`src/lib/importBundle.ts`) parses/validates the bundle and summarizes it; `importLocalData` in `repositories.ts` performs a single-transaction replace-all that preserves original IDs/timestamps; two thin routes (`/api/import/preview`, `/api/import`) share the validator; the dashboard gets an "Import data" button that previews → confirms → imports → reloads.

**Tech Stack:** TypeScript, Next.js App Router, `node:sqlite` (`DatabaseSync`), `zod`, Vitest, React (client component).

**Spec:** `docs/superpowers/specs/2026-06-05-local-import-restore-design.md`

---

## File Structure

- `src/lib/importBundle.ts` (new) — `parseImportBundle`, `summarizeImportBundle`, exported types `ImportBundle` / `ImportSummary`. Pure; depends only on `zod` and `./types`.
- `src/lib/importBundle.test.ts` (new) — validator unit tests.
- `src/lib/repositories.ts` (modify) — add `importLocalData(bundle)` next to `exportLocalData`.
- `src/lib/repositories.test.ts` (modify) — round-trip + replace integration tests.
- `src/app/api/import/preview/route.ts` (new) — validate, return summary.
- `src/app/api/import/route.ts` (new) — validate, import, return `{ portfolio, summary }`.
- `src/app/page.tsx` (modify) — hidden file input + "Import data" button + handler.

Authoritative tables restored: `wallets`, `tokens`, `trades`, `ledger_entries`, `quotes`, `wallet_activity`, `trade_candidates`, `settings`, plus the singleton `portfolios` baseline (`name`, `starting_cash_usd`). Derived fields in the bundle (`positions`, `candidateAttention`, `copySettings`, portfolio totals, `app`/`exportedAt`) are ignored.

---

## Task 1: Bundle validator (`importBundle.ts`)

**Files:**
- Create: `src/lib/importBundle.ts`
- Test: `src/lib/importBundle.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/importBundle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseImportBundle, summarizeImportBundle } from "./importBundle";

function validBundle() {
  return {
    schemaVersion: 1,
    exportedAt: "2026-06-05T00:00:00.000Z",
    app: { name: "gmgn-paper-trader", version: "0.1.0" },
    portfolio: {
      id: "default",
      name: "Main Paper Account",
      cashUsd: 9000,
      startingCashUsd: 10000,
      realizedPnlUsd: 0,
      feesPaidUsd: 5,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    copySettings: { mode: "fixedUsd" },
    candidateAttention: { ready: 0, review: 0, blocked: 0, failed: 0, copied: 0, total: 0 },
    wallets: [
      { address: "0xwallet", label: "W", notes: "", gmgnUrl: "", createdAt: "2026-06-01T00:00:00.000Z" }
    ],
    tokens: [
      { address: "0xtoken", symbol: "TKN", name: "Token", decimals: 18, createdAt: "2026-06-01T00:00:00.000Z" }
    ],
    positions: [],
    trades: [
      {
        id: "trade-1", side: "buy", tokenAddress: "0xtoken", symbol: "TKN", quantity: 10, priceUsd: 10,
        notionalUsd: 100, gasUsd: 5, slippageUsd: 1, dexFeeUsd: 0, totalCostUsd: 106, realizedPnlUsd: 0,
        quoteSnapshot: "{}", createdAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    ledgerEntries: [
      {
        id: "ledger-1", tradeId: "trade-1", tokenAddress: "0xtoken", entryType: "buy", cashDelta: -106,
        quantityDelta: 10, costBasisDelta: 100, realizedPnlDelta: 0, feeDelta: 6, createdAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    quotes: [
      {
        id: "quote-1", tokenAddress: "0xtoken", side: "buy", quantity: 10, priceUsd: 10, notionalUsd: 100,
        gasUsd: 5, slippageUsd: 1, dexFeeUsd: 0, quoteSnapshot: "{}", createdAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    walletActivity: [
      {
        id: "act-1", walletAddress: "0xwallet", chainId: 1, chainName: "Ethereum", hash: "0xhash",
        category: "erc20", asset: "TKN", contractAddress: "0xtoken", value: 10, fromAddress: "0xrouter",
        toAddress: "0xwallet", blockNum: "0x1", timestamp: "2026-06-02T00:00:00.000Z", isSwapLike: true, rawPayload: "{}"
      }
    ],
    tradeCandidates: [
      {
        id: "cand-1", walletAddress: "0xwallet", chainId: 1, chainName: "Ethereum", hash: "0xhash",
        status: "candidate", confidence: 0.5, side: "buy", tokenInAsset: "USDC", tokenInAddress: "0xusdc",
        tokenInAmount: 100, tokenOutAsset: "TKN", tokenOutAddress: "0xtoken", tokenOutAmount: 10,
        reason: "Likely swap", transferCount: 2, sourceTimestamp: "2026-06-02T00:00:00.000Z",
        lastCopyStatus: "", lastCopyBucket: "", lastCopyReason: "", lastCopyTradeId: "", lastCopyAt: "",
        createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    settings: [{ key: "copy_settings", value: "{\"mode\":\"fixedUsd\"}" }]
  };
}

describe("parseImportBundle", () => {
  it("accepts a valid version 1 export and keeps authoritative collections", () => {
    const bundle = parseImportBundle(validBundle());
    expect(bundle.wallets).toHaveLength(1);
    expect(bundle.trades[0].id).toBe("trade-1");
    expect(bundle.ledgerEntries[0].entryType).toBe("buy");
    expect(bundle.portfolio).toEqual({ name: "Main Paper Account", startingCashUsd: 10000 });
  });

  it("rejects an unsupported schema version", () => {
    const input = { ...validBundle(), schemaVersion: 2 };
    expect(() => parseImportBundle(input)).toThrow("Unsupported export schemaVersion 2");
  });

  it("rejects a non-object input", () => {
    expect(() => parseImportBundle("nope")).toThrow("expected a JSON object");
  });

  it("rejects a bundle missing a required collection", () => {
    const input = validBundle() as Record<string, unknown>;
    delete input.trades;
    expect(() => parseImportBundle(input)).toThrow("not a valid version 1 export");
  });

  it("rejects a malformed row", () => {
    const input = validBundle();
    (input.trades[0] as Record<string, unknown>).quantity = "ten";
    expect(() => parseImportBundle(input)).toThrow("not a valid version 1 export");
  });
});

describe("summarizeImportBundle", () => {
  it("counts collections and reads starting cash", () => {
    const summary = summarizeImportBundle(parseImportBundle(validBundle()));
    expect(summary).toEqual({
      wallets: 1, tokens: 1, trades: 1, ledgerEntries: 1, quotes: 1,
      walletActivity: 1, tradeCandidates: 1, settings: 1, startingCashUsd: 10000
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/importBundle.test.ts`
Expected: FAIL — `Cannot find module './importBundle'`.

- [ ] **Step 3: Implement `src/lib/importBundle.ts`**

```ts
import { z } from "zod";

const walletSchema = z.object({
  address: z.string(),
  label: z.string(),
  notes: z.string(),
  gmgnUrl: z.string(),
  createdAt: z.string()
});

const tokenSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  createdAt: z.string()
});

const tradeSchema = z.object({
  id: z.string(),
  side: z.enum(["buy", "sell"]),
  tokenAddress: z.string(),
  quantity: z.number(),
  priceUsd: z.number(),
  notionalUsd: z.number(),
  gasUsd: z.number(),
  slippageUsd: z.number(),
  dexFeeUsd: z.number(),
  totalCostUsd: z.number(),
  realizedPnlUsd: z.number(),
  quoteSnapshot: z.string(),
  createdAt: z.string()
});

const ledgerEntrySchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  tokenAddress: z.string(),
  entryType: z.enum(["buy", "sell", "total_loss"]),
  cashDelta: z.number(),
  quantityDelta: z.number(),
  costBasisDelta: z.number(),
  realizedPnlDelta: z.number(),
  feeDelta: z.number(),
  createdAt: z.string()
});

const quoteSchema = z.object({
  id: z.string(),
  tokenAddress: z.string(),
  side: z.string(),
  quantity: z.number(),
  priceUsd: z.number(),
  notionalUsd: z.number(),
  gasUsd: z.number(),
  slippageUsd: z.number(),
  dexFeeUsd: z.number(),
  quoteSnapshot: z.string(),
  createdAt: z.string()
});

const walletActivitySchema = z.object({
  id: z.string(),
  walletAddress: z.string(),
  chainId: z.number(),
  chainName: z.string(),
  hash: z.string(),
  category: z.string(),
  asset: z.string(),
  contractAddress: z.string(),
  value: z.number(),
  fromAddress: z.string(),
  toAddress: z.string(),
  blockNum: z.string(),
  timestamp: z.string(),
  isSwapLike: z.boolean(),
  rawPayload: z.string()
});

const tradeCandidateSchema = z.object({
  id: z.string(),
  walletAddress: z.string(),
  chainId: z.number(),
  chainName: z.string(),
  hash: z.string(),
  status: z.enum(["candidate", "decoded", "skipped", "copied", "partial", "failed"]),
  confidence: z.number(),
  side: z.enum(["buy", "sell", "unknown"]),
  tokenInAsset: z.string(),
  tokenInAddress: z.string(),
  tokenInAmount: z.number(),
  tokenOutAsset: z.string(),
  tokenOutAddress: z.string(),
  tokenOutAmount: z.number(),
  reason: z.string(),
  transferCount: z.number(),
  sourceTimestamp: z.string(),
  lastCopyStatus: z.string().optional().default(""),
  lastCopyBucket: z.string().optional().default(""),
  lastCopyReason: z.string().optional().default(""),
  lastCopyTradeId: z.string().optional().default(""),
  lastCopyAt: z.string().optional().default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});

const settingSchema = z.object({
  key: z.string(),
  value: z.string()
});

const portfolioSchema = z.object({
  name: z.string(),
  startingCashUsd: z.number()
});

const importBundleSchema = z.object({
  portfolio: portfolioSchema,
  wallets: z.array(walletSchema),
  tokens: z.array(tokenSchema),
  trades: z.array(tradeSchema),
  ledgerEntries: z.array(ledgerEntrySchema),
  quotes: z.array(quoteSchema),
  walletActivity: z.array(walletActivitySchema),
  tradeCandidates: z.array(tradeCandidateSchema),
  settings: z.array(settingSchema)
});

export type ImportBundle = z.infer<typeof importBundleSchema>;

export type ImportSummary = {
  wallets: number;
  tokens: number;
  trades: number;
  ledgerEntries: number;
  quotes: number;
  walletActivity: number;
  tradeCandidates: number;
  settings: number;
  startingCashUsd: number;
};

export function parseImportBundle(input: unknown): ImportBundle {
  if (!input || typeof input !== "object") {
    throw new Error("Import file is not a valid version 1 export: expected a JSON object.");
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version !== 1) {
    throw new Error(`Unsupported export schemaVersion ${String(version)}. This app imports version 1.`);
  }
  const result = importBundleSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    const detail = issue?.message ?? "invalid shape";
    throw new Error(`Import file is not a valid version 1 export: ${path ? `${path}: ` : ""}${detail}.`);
  }
  return result.data;
}

export function summarizeImportBundle(bundle: ImportBundle): ImportSummary {
  return {
    wallets: bundle.wallets.length,
    tokens: bundle.tokens.length,
    trades: bundle.trades.length,
    ledgerEntries: bundle.ledgerEntries.length,
    quotes: bundle.quotes.length,
    walletActivity: bundle.walletActivity.length,
    tradeCandidates: bundle.tradeCandidates.length,
    settings: bundle.settings.length,
    startingCashUsd: bundle.portfolio.startingCashUsd
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/importBundle.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/importBundle.ts src/lib/importBundle.test.ts
git commit -m "feat: add import bundle validator and summary"
```

---

## Task 2: `importLocalData` replace-all (repositories.ts)

**Files:**
- Modify: `src/lib/repositories.ts`
- Test: `src/lib/repositories.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `src/lib/repositories.test.ts`, immediately before the `function seedToken(` helper (the file already imports `fs`, `os`, `path`, `vi`, and runs each test in a fresh temp cwd):

```ts
describe("importLocalData", () => {
  it("round-trips an export bundle without duplicating rows", async () => {
    const repos = await import("./repositories");
    const { parseImportBundle } = await import("./importBundle");
    const token = seedToken(repos.upsertToken);
    repos.upsertWallet({ address: "0xwallet", label: "W", notes: "", gmgnUrl: "" });
    repos.updateCopySettings({
      mode: "fixedUsd", fixedUsd: 125, percentOfSource: 25, maxTradeUsd: 500,
      slippageCapBps: 100, gasBufferBps: 1500, insufficientCashBehavior: "cap", allowlist: [], blocklist: []
    });
    repos.recordTrade(tradeInput({ tokenAddress: token.address }));

    const bundle = repos.exportLocalData();
    const reparsed = parseImportBundle(JSON.parse(JSON.stringify(bundle)));
    repos.importLocalData(reparsed);
    const after = repos.exportLocalData();

    expect(after.wallets).toEqual(bundle.wallets);
    expect(after.tokens).toEqual(bundle.tokens);
    expect(after.trades).toEqual(bundle.trades);
    expect(after.ledgerEntries).toEqual(bundle.ledgerEntries);
    expect(after.settings).toEqual(bundle.settings);
    expect(after.portfolio.startingCashUsd).toBe(bundle.portfolio.startingCashUsd);
    expect(after.portfolio.cashUsd).toBe(bundle.portfolio.cashUsd);
    expect(after.trades).toHaveLength(1);
    expect(after.ledgerEntries).toHaveLength(1);
  });

  it("replaces pre-existing data with the imported bundle", async () => {
    const repos = await import("./repositories");
    const { parseImportBundle } = await import("./importBundle");
    const token = seedToken(repos.upsertToken);
    repos.upsertWallet({ address: "0xwallet", label: "W", notes: "", gmgnUrl: "" });
    repos.recordTrade(tradeInput({ tokenAddress: token.address }));
    const bundle = repos.exportLocalData();

    // Diverge: add a second wallet, token, and trade so state is now bundle + extra.
    const extraToken = repos.upsertToken({
      address: "0x00000000000000000000000000000000000000ff", symbol: "EXTRA", name: "Extra", decimals: 18
    });
    repos.upsertWallet({ address: "0xother", label: "Other", notes: "", gmgnUrl: "" });
    repos.recordTrade(tradeInput({ tokenAddress: extraToken.address }));
    expect(repos.exportLocalData().trades).toHaveLength(2);

    repos.importLocalData(parseImportBundle(JSON.parse(JSON.stringify(bundle))));
    const after = repos.exportLocalData();

    expect(after.wallets.map((w) => w.address)).toEqual(["0xwallet"]);
    expect(after.tokens.map((t) => t.address)).toEqual([token.address]);
    expect(after.trades).toHaveLength(1);
    expect(after.portfolio.cashUsd).toBe(bundle.portfolio.cashUsd);
    expect(after.portfolio.realizedPnlUsd).toBe(bundle.portfolio.realizedPnlUsd);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/repositories.test.ts -t "importLocalData"`
Expected: FAIL — `repos.importLocalData is not a function`.

- [ ] **Step 3: Implement `importLocalData`**

In `src/lib/repositories.ts`, add the import for the validator types/helper at the top, alongside the existing imports. Replace the existing line:

```ts
import { derivePortfolioTotals, derivePositions, ledgerDeltaFromTrade } from "./ledger";
```

with:

```ts
import { derivePortfolioTotals, derivePositions, ledgerDeltaFromTrade } from "./ledger";
import { summarizeImportBundle, type ImportBundle, type ImportSummary } from "./importBundle";
```

Then add this function immediately after `exportLocalData` (just before `export function insertQuote(`):

```ts
export function importLocalData(bundle: ImportBundle): { portfolio: Portfolio; summary: ImportSummary } {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM quotes").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM wallet_activity").run();
    db.prepare("DELETE FROM trade_candidates").run();
    db.prepare("DELETE FROM tokens").run();
    db.prepare("DELETE FROM wallets").run();
    db.prepare("DELETE FROM settings").run();

    const insertWallet = db.prepare(
      "INSERT INTO wallets (address, label, notes, gmgn_url, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const w of bundle.wallets) {
      insertWallet.run(w.address, w.label, w.notes, w.gmgnUrl, w.createdAt);
    }

    const insertTokenRow = db.prepare(
      "INSERT INTO tokens (address, symbol, name, decimals, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const t of bundle.tokens) {
      insertTokenRow.run(t.address, t.symbol, t.name, t.decimals, t.createdAt);
    }

    const insertTradeRow = db.prepare(
      `INSERT INTO trades
        (id, side, token_address, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const tr of bundle.trades) {
      insertTradeRow.run(
        tr.id, tr.side, tr.tokenAddress, tr.quantity, tr.priceUsd, tr.notionalUsd, tr.gasUsd,
        tr.slippageUsd, tr.dexFeeUsd, tr.totalCostUsd, tr.realizedPnlUsd, tr.quoteSnapshot, tr.createdAt
      );
    }

    const insertLedger = db.prepare(
      `INSERT INTO ledger_entries
        (id, entry_type, trade_id, token_address, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of bundle.ledgerEntries) {
      insertLedger.run(
        e.id, e.entryType, e.tradeId, e.tokenAddress, e.cashDelta, e.quantityDelta,
        e.costBasisDelta, e.realizedPnlDelta, e.feeDelta, e.createdAt
      );
    }

    const insertQuoteRow = db.prepare(
      `INSERT INTO quotes
        (id, token_address, side, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const q of bundle.quotes) {
      insertQuoteRow.run(
        q.id, q.tokenAddress, q.side, q.quantity, q.priceUsd, q.notionalUsd, q.gasUsd,
        q.slippageUsd, q.dexFeeUsd, q.quoteSnapshot, q.createdAt
      );
    }

    const insertActivity = db.prepare(
      `INSERT INTO wallet_activity
        (id, wallet_address, chain_id, chain_name, hash, category, asset, contract_address, value, from_address, to_address, block_num, timestamp, is_swap_like, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of bundle.walletActivity) {
      insertActivity.run(
        a.id, a.walletAddress, a.chainId, a.chainName, a.hash, a.category, a.asset, a.contractAddress,
        a.value, a.fromAddress, a.toAddress, a.blockNum, a.timestamp, a.isSwapLike ? 1 : 0, a.rawPayload
      );
    }

    const insertCandidate = db.prepare(
      `INSERT INTO trade_candidates
        (id, wallet_address, chain_id, chain_name, hash, status, confidence, side, token_in_asset, token_in_address, token_in_amount, token_out_asset, token_out_address, token_out_amount, reason, transfer_count, source_timestamp, last_copy_status, last_copy_bucket, last_copy_reason, last_copy_trade_id, last_copy_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of bundle.tradeCandidates) {
      insertCandidate.run(
        c.id, c.walletAddress, c.chainId, c.chainName, c.hash, c.status, c.confidence, c.side,
        c.tokenInAsset, c.tokenInAddress, c.tokenInAmount, c.tokenOutAsset, c.tokenOutAddress, c.tokenOutAmount,
        c.reason, c.transferCount, c.sourceTimestamp, c.lastCopyStatus, c.lastCopyBucket, c.lastCopyReason,
        c.lastCopyTradeId, c.lastCopyAt, c.createdAt, c.updatedAt
      );
    }

    const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const s of bundle.settings) {
      insertSetting.run(s.key, s.value);
    }

    db.prepare("UPDATE portfolios SET name = ?, starting_cash_usd = ?, updated_at = ? WHERE id = 'default'")
      .run(bundle.portfolio.name, bundle.portfolio.startingCashUsd, now());

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { portfolio: getPortfolio(), summary: summarizeImportBundle(bundle) };
}
```

- [ ] **Step 4: Run the import tests to verify they pass**

Run: `npx vitest run src/lib/repositories.test.ts -t "importLocalData"`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (all files).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no output).

- [ ] **Step 7: Commit**

```bash
git add src/lib/repositories.ts src/lib/repositories.test.ts
git commit -m "feat: add transactional replace-all importLocalData"
```

---

## Task 3: Import API routes

**Files:**
- Create: `src/app/api/import/preview/route.ts`
- Create: `src/app/api/import/route.ts`

- [ ] **Step 1: Create the preview route**

Create `src/app/api/import/preview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { parseImportBundle, summarizeImportBundle } from "@/lib/importBundle";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const bundle = parseImportBundle(body);
    return NextResponse.json({ summary: summarizeImportBundle(bundle) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read import file." },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 2: Create the import route**

Create `src/app/api/import/route.ts`:

```ts
import { NextResponse } from "next/server";
import { parseImportBundle } from "@/lib/importBundle";
import { importLocalData } from "@/lib/repositories";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const bundle = parseImportBundle(body);
    const result = importLocalData(bundle);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not import local data." },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 3: Typecheck and build the routes**

Run: `npx tsc --noEmit`
Expected: PASS (no output).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/import/preview/route.ts src/app/api/import/route.ts
git commit -m "feat: add import preview and import API routes"
```

---

## Task 4: Dashboard "Import data" control

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the `Upload` icon and `useRef` import**

In `src/app/page.tsx`, change the lucide-react import to include `Upload` (insert alphabetically after `Trash2`):

```ts
import {
  Activity,
  BadgeDollarSign,
  Download,
  Eye,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Save,
  Target,
  Trash2,
  Upload,
  WalletCards
} from "lucide-react";
```

And change the React import to include `useRef`:

```ts
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 2: Add the file-input ref and import handler**

In `src/app/page.tsx`, find the line `  async function exportSimulatorData() {` and insert this directly above it:

```ts
  const importInputRef = useRef<HTMLInputElement>(null);

  async function importSimulatorData(file: File) {
    setError("");
    setMessage("");

    let bundle: unknown;
    try {
      bundle = JSON.parse(await file.text());
    } catch {
      setError("File is not valid JSON.");
      return;
    }

    setBusy("import-data");
    try {
      const previewResponse = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle)
      });
      const previewPayload = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(previewPayload.error ?? "Could not read import file.");

      const s = previewPayload.summary as {
        wallets: number; tokens: number; trades: number; ledgerEntries: number; quotes: number;
        walletActivity: number; tradeCandidates: number; settings: number; startingCashUsd: number;
      };
      const confirmed = window.confirm(
        "Import will REPLACE all local data with the selected file:\n\n" +
          `- ${s.wallets} wallets\n` +
          `- ${s.tokens} tokens\n` +
          `- ${s.trades} trades\n` +
          `- ${s.ledgerEntries} ledger entries\n` +
          `- ${s.quotes} quotes\n` +
          `- ${s.walletActivity} activity rows\n` +
          `- ${s.tradeCandidates} candidates\n` +
          `- ${s.settings} settings\n` +
          `Starting cash: ${formatUsd(s.startingCashUsd)}\n\n` +
          "This cannot be undone. Continue?"
      );
      if (!confirmed) {
        setBusy("");
        return;
      }

      const importResponse = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle)
      });
      const importPayload = await importResponse.json();
      if (!importResponse.ok) throw new Error(importPayload.error ?? "Could not import local data.");

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import local data.");
      setBusy("");
    }
  }
```

(`window.location.reload()` after a successful replace-all is intentional: import swaps out wallets, tokens, and candidates that are loaded across several parts of the page, so a full reload is the simplest way to guarantee the UI reflects the imported state. The reset handler can do targeted state updates only because it preserves those collections.)

- [ ] **Step 3: Add the hidden input and "Import data" button**

In `src/app/page.tsx`, find the Export button block:

```tsx
        <button
          className="button secondary"
          onClick={() => exportSimulatorData()}
          disabled={busy === "export-data"}
          title="Export local simulator data"
        >
          {busy === "export-data" ? <Loader2 size={18} /> : <Download size={18} />}
          Export data
        </button>
```

and insert this immediately before it:

```tsx
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importSimulatorData(file);
          }}
        />
        <button
          className="button secondary"
          onClick={() => importInputRef.current?.click()}
          disabled={busy === "import-data"}
          title="Import a local simulator export"
        >
          {busy === "import-data" ? <Loader2 size={18} /> : <Upload size={18} />}
          Import data
        </button>
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS. (`formatUsd` is already imported in `page.tsx`; `Upload`, `useRef`, and `importInputRef` are now defined.)

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add Import data control to dashboard"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Test, typecheck, build**

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all tests pass; `tsc` no output; build completes.

- [ ] **Step 2: End-to-end smoke check**

Start the server (`npm run dev`), then in the dashboard:

1. Click **Export data** and save the JSON file.
2. Make a change (e.g. add a watched wallet or run a paper trade).
3. Click **Import data**, choose the exported file, and confirm the summary dialog.
4. After the page reloads, verify the dashboard matches the exported state (the change from step 2 is gone) and the "Ledger ✓ verified" badge is green.

Also confirm rejection paths via API:

```bash
curl -s -X POST http://localhost:3000/api/import/preview -H "content-type: application/json" -d '{"schemaVersion":2}' | cat
curl -s -X POST http://localhost:3000/api/import/preview -H "content-type: application/json" -d '{"schemaVersion":1}' | cat
```

Expected: first returns `{"error":"Unsupported export schemaVersion 2. This app imports version 1."}`; second returns `{"error":"Import file is not a valid version 1 export: ...}"` (missing collections).

- [ ] **Step 3: Confirm clean tree**

Run: `git status --short`
Expected: clean (revert any `next-env.d.ts` churn with `git checkout -- next-env.d.ts`; do not commit it).

---

## Self-Review Notes

- **Spec coverage:** validator + summary (Task 1), transactional replace-all with FK-safe ordering and ID/timestamp preservation (Task 2), preview + import routes sharing the validator (Task 3), guarded UI with summary confirm and post-import refresh-via-reload (Task 4), round-trip + replace tests (Task 2), error paths (Tasks 1/3 + Task 5 smoke). Derived fields are ignored by construction (zod strips them; `importLocalData` writes only authoritative tables).
- **Type consistency:** `ImportBundle` / `ImportSummary` defined in Task 1 are the exact types consumed in Tasks 2–4; `parseImportBundle` / `summarizeImportBundle` / `importLocalData` names are used identically throughout. Insert column lists match the schema in `src/lib/db.ts`.
- **Ordering:** deletes run child-first (`ledger_entries`, `quotes`, `trades`, `wallet_activity`, `trade_candidates`, `tokens`, `wallets`, `settings`); inserts run parent-first — satisfying `PRAGMA foreign_keys = ON`.
