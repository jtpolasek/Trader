import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_PORTFOLIO } from "./constants";
import { ledgerDeltaFromTrade } from "./ledger";

let db: DatabaseSync | null = null;

export function getDb() {
  if (!db) {
    const dbPath = process.env.PAPER_TRADER_DB_PATH || path.join(process.cwd(), "data", "paper-trader.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
  }
  return db;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      starting_cash_usd REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      gmgn_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      address TEXT PRIMARY KEY,
      chain_id INTEGER NOT NULL DEFAULT 1,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      decimals INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL,
      token_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL DEFAULT 1,
      quantity REAL NOT NULL,
      price_usd REAL NOT NULL,
      notional_usd REAL NOT NULL,
      gas_usd REAL NOT NULL,
      slippage_usd REAL NOT NULL,
      dex_fee_usd REAL NOT NULL,
      total_cost_usd REAL NOT NULL,
      realized_pnl_usd REAL NOT NULL DEFAULT 0,
      quote_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(token_address) REFERENCES tokens(address)
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      entry_type TEXT NOT NULL,
      trade_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL DEFAULT 1,
      cash_delta REAL NOT NULL,
      quantity_delta REAL NOT NULL,
      cost_basis_delta REAL NOT NULL,
      realized_pnl_delta REAL NOT NULL,
      fee_delta REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(trade_id),
      FOREIGN KEY(trade_id) REFERENCES trades(id),
      FOREIGN KEY(token_address) REFERENCES tokens(address)
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_entries_token ON ledger_entries(token_address);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_trade ON ledger_entries(trade_id);

    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      token_address TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      price_usd REAL NOT NULL,
      notional_usd REAL NOT NULL,
      gas_usd REAL NOT NULL,
      slippage_usd REAL NOT NULL,
      dex_fee_usd REAL NOT NULL,
      quote_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(token_address) REFERENCES tokens(address)
    );

    CREATE TABLE IF NOT EXISTS wallet_activity (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      hash TEXT NOT NULL,
      category TEXT NOT NULL,
      asset TEXT NOT NULL,
      contract_address TEXT NOT NULL DEFAULT '',
      value REAL NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      block_num TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      chain_id INTEGER NOT NULL DEFAULT 1,
      chain_name TEXT NOT NULL DEFAULT 'Ethereum',
      is_swap_like INTEGER NOT NULL DEFAULT 0,
      raw_payload TEXT NOT NULL DEFAULT '',
      UNIQUE(wallet_address, hash, category, asset, value, from_address, to_address),
      FOREIGN KEY(wallet_address) REFERENCES wallets(address)
    );

    CREATE TABLE IF NOT EXISTS trade_candidates (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      chain_name TEXT NOT NULL,
      hash TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      side TEXT NOT NULL,
      token_in_asset TEXT NOT NULL,
      token_in_address TEXT NOT NULL DEFAULT '',
      token_in_amount REAL NOT NULL,
      token_out_asset TEXT NOT NULL,
      token_out_address TEXT NOT NULL DEFAULT '',
      token_out_amount REAL NOT NULL,
      reason TEXT NOT NULL,
      transfer_count INTEGER NOT NULL,
      source_timestamp TEXT NOT NULL DEFAULT '',
      last_copy_status TEXT NOT NULL DEFAULT '',
      last_copy_bucket TEXT NOT NULL DEFAULT '',
      last_copy_reason TEXT NOT NULL DEFAULT '',
      last_copy_trade_id TEXT NOT NULL DEFAULT '',
      last_copy_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(wallet_address, chain_id, hash),
      FOREIGN KEY(wallet_address) REFERENCES wallets(address)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_portfolio_archives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing(database, "tokens", "chain_id", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(database, "trades", "chain_id", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(database, "ledger_entries", "chain_id", "INTEGER NOT NULL DEFAULT 1");
  backfillTradeChainIds(database);
  addColumnIfMissing(database, "wallet_activity", "chain_id", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(database, "wallet_activity", "chain_name", "TEXT NOT NULL DEFAULT 'Ethereum'");
  addColumnIfMissing(database, "wallet_activity", "contract_address", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "wallet_activity", "raw_payload", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "token_in_address", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "token_out_address", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "source_timestamp", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "last_copy_status", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "last_copy_bucket", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "last_copy_reason", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "last_copy_trade_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, "trade_candidates", "last_copy_at", "TEXT NOT NULL DEFAULT ''");
  ensureUniqueLedgerTradeIndex(database);

  const now = new Date().toISOString();
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

  dropVestigialState(database);

  backfillLedger(database);
}

function addColumnIfMissing(database: DatabaseSync, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

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

function ensureUniqueLedgerTradeIndex(database: DatabaseSync) {
  const indexes = database.prepare("PRAGMA index_list(ledger_entries)").all() as Array<{ name: string; unique: number }>;
  if (indexes.some((index) => index.name === "idx_ledger_entries_trade_unique" && index.unique === 1)) {
    return;
  }

  const duplicates = database
    .prepare(
      `SELECT trade_id
       FROM ledger_entries
       GROUP BY trade_id
       HAVING COUNT(*) > 1
       LIMIT 1`
    )
    .get();

  if (duplicates) return;

  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_trade_unique ON ledger_entries(trade_id)");
}

function backfillLedger(database: DatabaseSync) {
  const existing = database.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get() as { count: number };
  if (existing.count > 0) return;

  const trades = database
    .prepare(
      `SELECT id, side, token_address, chain_id, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd,
              total_cost_usd, realized_pnl_usd, created_at
       FROM trades
       ORDER BY created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;
  if (trades.length === 0) return;

  const insert = database.prepare(
    `INSERT INTO ledger_entries
      (id, entry_type, trade_id, token_address, chain_id, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        Number(row.chain_id),
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

function backfillTradeChainIds(database: DatabaseSync) {
  const trades = database
    .prepare("SELECT id, token_address, quote_snapshot FROM trades")
    .all() as Array<{ id: string; token_address: string; quote_snapshot: string }>;
  const updateTrade = database.prepare("UPDATE trades SET chain_id = ? WHERE id = ?");
  const updateToken = database.prepare("UPDATE tokens SET chain_id = ? WHERE address = ?");
  const updateLedger = database.prepare("UPDATE ledger_entries SET chain_id = ? WHERE trade_id = ?");

  for (const trade of trades) {
    const chainId = readChainIdFromSnapshot(trade.quote_snapshot);
    if (!chainId) continue;
    updateTrade.run(chainId, trade.id);
    updateToken.run(chainId, trade.token_address);
    updateLedger.run(chainId, trade.id);
  }
}

function readChainIdFromSnapshot(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { chainId?: unknown; copiedFrom?: { chainId?: unknown } };
    const value = parsed.chainId ?? parsed.copiedFrom?.chainId;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
