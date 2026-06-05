# Retire Vestigial Portfolio/Positions State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physically remove the never-read `positions` table and the `portfolios.cash_usd` / `realized_pnl_usd` / `fees_paid_usd` running-total columns so no future query can read stale values.

**Architecture:** Accounting is already ledger-derived. We add an idempotent migration step (`dropVestigialState`) that drops the dead table/columns on existing SQLite databases, strip them from the new-DB schema and seed, and remove the dead writes from `resetPaperPortfolio`. The export bundle and `schemaVersion: 1` are unchanged because export's `positions` field is ledger-derived.

**Tech Stack:** TypeScript, Next.js, `node:sqlite` (`DatabaseSync`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-retire-vestigial-state-design.md`

---

## File Structure

- `src/lib/db.ts` — schema, seed, and migration. Add `dropColumnIfPresent` + `dropVestigialState`; trim the `portfolios` CREATE TABLE, remove the `positions` CREATE TABLE, trim the seed insert.
- `src/lib/repositories.ts` — `resetPaperPortfolio()` loses its `DELETE FROM positions` and its cash/pnl/fees `UPDATE` (now only bumps `updated_at`).
- `src/lib/repositories.test.ts` — new migration test proving an old-shape DB is cleaned on `migrate()`. Existing export/reset tests must stay green.

What stays: `portfolios.starting_cash_usd`, `trades.realized_pnl_usd`, and the derived `positions` field in the export bundle.

---

## Task 1: Migration drops vestigial state on existing databases

**Files:**
- Modify: `src/lib/db.ts`
- Test: `src/lib/repositories.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block at the end of `src/lib/repositories.test.ts` (the file already imports `fs`, `os`, `path`, and `vi` at the top, and each test runs in a fresh temp cwd via the existing `beforeEach`):

```ts
describe("vestigial state migration", () => {
  it("drops the positions table and legacy portfolio total columns on existing databases", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dataDir = path.join(process.cwd(), "data");
    fs.mkdirSync(dataDir, { recursive: true });

    const legacy = new DatabaseSync(path.join(dataDir, "paper-trader.db"));
    legacy.exec(`
      CREATE TABLE portfolios (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cash_usd REAL NOT NULL,
        starting_cash_usd REAL NOT NULL,
        realized_pnl_usd REAL NOT NULL DEFAULT 0,
        fees_paid_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE positions (
        token_address TEXT PRIMARY KEY,
        quantity REAL NOT NULL,
        average_entry_usd REAL NOT NULL,
        cost_basis_usd REAL NOT NULL,
        realized_pnl_usd REAL NOT NULL DEFAULT 0,
        fees_paid_usd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO portfolios
        (id, name, cash_usd, starting_cash_usd, realized_pnl_usd, fees_paid_usd, created_at, updated_at)
      VALUES
        ('default', 'Main Paper Account', 4200, 10000, -1, 7,
         '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
    `);
    legacy.close();

    vi.resetModules();
    const { getDb } = await import("./db");
    const { getPortfolio } = await import("./repositories");
    const db = getDb();

    const portfolioColumns = (
      db.prepare("PRAGMA table_info(portfolios)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(portfolioColumns).not.toContain("cash_usd");
    expect(portfolioColumns).not.toContain("realized_pnl_usd");
    expect(portfolioColumns).not.toContain("fees_paid_usd");
    expect(portfolioColumns).toContain("starting_cash_usd");

    const positionsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'positions'")
      .get();
    expect(positionsTable).toBeUndefined();

    const portfolio = getPortfolio();
    expect(portfolio.startingCashUsd).toBe(10000);
    expect(portfolio.cashUsd).toBe(10000);
    expect(portfolio.realizedPnlUsd).toBe(0);
    expect(portfolio.feesPaidUsd).toBe(0);
  });
});
```

This proves the stale legacy values (`cash_usd: 4200`, `realized_pnl_usd: -1`, `fees_paid_usd: 7`) are gone and `getPortfolio()` derives `cashUsd: 10000` from `starting_cash_usd` + the empty ledger.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/repositories.test.ts -t "vestigial state migration"`
Expected: FAIL — `portfolioColumns` still contains `cash_usd` (and the `positions` table still exists), because `dropVestigialState` does not exist yet.

- [ ] **Step 3: Add the drop helpers in `db.ts`**

In `src/lib/db.ts`, immediately after the existing `addColumnIfMissing` function (ends around line 206), add:

```ts
function dropColumnIfPresent(database: DatabaseSync, table: string, column: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

function dropVestigialState(database: DatabaseSync) {
  database.exec("DROP TABLE IF EXISTS positions");
  dropColumnIfPresent(database, "portfolios", "cash_usd");
  dropColumnIfPresent(database, "portfolios", "realized_pnl_usd");
  dropColumnIfPresent(database, "portfolios", "fees_paid_usd");
}
```

- [ ] **Step 4: Call `dropVestigialState` after the seed insert**

In `src/lib/db.ts`, inside `migrate()`, the seed `INSERT OR IGNORE INTO portfolios ...` block ends with `.run(... now, now);` (around line 196), immediately followed by `backfillLedger(database);`. Insert the call between them so the drop runs *after* the seed (the seed still references the legacy columns at this point in the plan):

```ts
    .run(
      DEFAULT_PORTFOLIO.id,
      DEFAULT_PORTFOLIO.name,
      DEFAULT_PORTFOLIO.startingCashUsd,
      now,
      now
    );

  dropVestigialState(database);

  backfillLedger(database);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/repositories.test.ts -t "vestigial state migration"`
Expected: PASS.

- [ ] **Step 6: Run the full suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — all test files (the export and reset tests still pass because `positions` is ledger-derived and reset still clears the ledger).

- [ ] **Step 7: Commit**

```bash
git add src/lib/db.ts src/lib/repositories.test.ts
git commit -m "feat: drop vestigial positions table and portfolio total columns on migrate"
```

---

## Task 2: Remove vestigial state from the new-DB schema and seed

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Trim the `portfolios` CREATE TABLE**

In `src/lib/db.ts`, replace the `portfolios` table definition:

```ts
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cash_usd REAL NOT NULL,
      starting_cash_usd REAL NOT NULL,
      realized_pnl_usd REAL NOT NULL DEFAULT 0,
      fees_paid_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
```

with:

```ts
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      starting_cash_usd REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
```

- [ ] **Step 2: Remove the `positions` CREATE TABLE block**

In `src/lib/db.ts`, delete this entire block (including its trailing blank line):

```ts
    CREATE TABLE IF NOT EXISTS positions (
      token_address TEXT PRIMARY KEY,
      quantity REAL NOT NULL,
      average_entry_usd REAL NOT NULL,
      cost_basis_usd REAL NOT NULL,
      realized_pnl_usd REAL NOT NULL DEFAULT 0,
      fees_paid_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(token_address) REFERENCES tokens(address)
    );
```

- [ ] **Step 3: Trim the seed insert**

In `src/lib/db.ts`, replace the seed insert:

```ts
  database
    .prepare(
      `INSERT OR IGNORE INTO portfolios
        (id, name, cash_usd, starting_cash_usd, realized_pnl_usd, fees_paid_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
    )
    .run(
      DEFAULT_PORTFOLIO.id,
      DEFAULT_PORTFOLIO.name,
      DEFAULT_PORTFOLIO.startingCashUsd,
      DEFAULT_PORTFOLIO.startingCashUsd,
      now,
      now
    );
```

with:

```ts
  database
    .prepare(
      `INSERT OR IGNORE INTO portfolios
        (id, name, starting_cash_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      DEFAULT_PORTFOLIO.id,
      DEFAULT_PORTFOLIO.name,
      DEFAULT_PORTFOLIO.startingCashUsd,
      now,
      now
    );
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. The migration test still passes: on a brand-new DB the columns/table are never created, so `dropVestigialState`'s `PRAGMA`/`IF EXISTS` guards make it a no-op; on a legacy DB it still drops them.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no output).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts
git commit -m "refactor: remove vestigial columns and positions table from schema and seed"
```

---

## Task 3: Stop writing vestigial state in `resetPaperPortfolio`

**Files:**
- Modify: `src/lib/repositories.ts`

- [ ] **Step 1: Remove the dead `positions` delete and column writes**

In `src/lib/repositories.ts`, inside `resetPaperPortfolio()`, replace this block:

```ts
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM quotes").run();
    db.prepare("DELETE FROM positions").run();
    db
      .prepare(
        `UPDATE portfolios
         SET cash_usd = starting_cash_usd,
             realized_pnl_usd = 0,
             fees_paid_usd = 0,
             updated_at = ?
         WHERE id = 'default'`
      )
      .run(timestamp);
```

with:

```ts
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM quotes").run();
    db
      .prepare("UPDATE portfolios SET updated_at = ? WHERE id = 'default'")
      .run(timestamp);
```

The `trade_candidates` UPDATE and the surrounding `BEGIN`/`COMMIT`/`ROLLBACK` are unchanged. Reset behavior is identical: clearing `ledger_entries` collapses derived totals to `starting_cash_usd`.

- [ ] **Step 2: Run the reset test**

Run: `npx vitest run src/lib/repositories.test.ts -t "resetPaperPortfolio"`
Expected: PASS — the existing assertions (`cashUsd === startingCashUsd`, `realizedPnlUsd: 0`, `feesPaidUsd: 0`, `listPositions()` empty) still hold via derivation.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/repositories.ts
git commit -m "refactor: stop writing vestigial portfolio totals and positions on reset"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Test, typecheck, build**

Run each and confirm success:

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: `npm test` all pass; `tsc` no output; `npm run build` completes without errors.

- [ ] **Step 2: Smoke-check against the real local DB**

Run `npm run dev`, open the dashboard, and confirm the portfolio summary renders and the "Ledger ✓ verified" badge still shows green against the existing `data/paper-trader.db` (which migrates in place, dropping the legacy columns/table on first load).

Then confirm the schema actually changed:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/paper-trader.db');console.log('portfolios:',d.prepare('PRAGMA table_info(portfolios)').all().map(c=>c.name));console.log('positions table:',d.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='positions'\").get());"
```

Expected: `portfolios` columns are `id, name, starting_cash_usd, created_at, updated_at` (no `cash_usd` / `realized_pnl_usd` / `fees_paid_usd`); `positions table:` prints `undefined`.

- [ ] **Step 3: Final confirmation**

No commit needed — all changes are committed in Tasks 1–3. Confirm `git status` is clean and `git log --oneline -4` shows the three feature/refactor commits plus the spec commit.

---

## Self-Review Notes

- **Spec coverage:** schema trim (Task 2), existing-DB migration via `dropVestigialState`/`dropColumnIfPresent` (Task 1), seed trim (Task 2), reset cleanup (Task 3), migration test (Task 1), full verification incl. smoke check (Task 4). Export/`schemaVersion` unchanged — no task needed.
- **Ordering note:** `dropVestigialState` is placed *after* the seed insert so that during Task 1 (schema/seed still reference the legacy columns) the seed succeeds before the columns are dropped. After Task 2 removes them from schema/seed, the drop helpers are idempotent no-ops on new DBs.
- **Naming consistency:** `dropVestigialState`, `dropColumnIfPresent` used identically across plan and call site; mirror the existing `addColumnIfMissing` helper.
