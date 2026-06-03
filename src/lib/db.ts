import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_PORTFOLIO } from "./constants";

let db: DatabaseSync | null = null;

export function getDb() {
  if (!db) {
    const dataDir = path.join(process.cwd(), "data");
    fs.mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(path.join(dataDir, "paper-trader.db"));
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
      cash_usd REAL NOT NULL,
      starting_cash_usd REAL NOT NULL,
      realized_pnl_usd REAL NOT NULL DEFAULT 0,
      fees_paid_usd REAL NOT NULL DEFAULT 0,
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
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      decimals INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL,
      token_address TEXT NOT NULL,
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
      value REAL NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      block_num TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      chain_id INTEGER NOT NULL DEFAULT 1,
      chain_name TEXT NOT NULL DEFAULT 'Ethereum',
      is_swap_like INTEGER NOT NULL DEFAULT 0,
      UNIQUE(wallet_address, hash, category, asset, value, from_address, to_address),
      FOREIGN KEY(wallet_address) REFERENCES wallets(address)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  addColumnIfMissing(database, "wallet_activity", "chain_id", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(database, "wallet_activity", "chain_name", "TEXT NOT NULL DEFAULT 'Ethereum'");

  const now = new Date().toISOString();
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
}

function addColumnIfMissing(database: DatabaseSync, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
