import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { Portfolio, Position, Token, Trade, Wallet, WalletActivity } from "./types";

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

function rowToPortfolio(row: Row): Portfolio {
  return {
    id: String(row.id),
    name: String(row.name),
    cashUsd: Number(row.cash_usd),
    startingCashUsd: Number(row.starting_cash_usd),
    realizedPnlUsd: Number(row.realized_pnl_usd),
    feesPaidUsd: Number(row.fees_paid_usd),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function getPortfolio() {
  const row = getDb().prepare("SELECT * FROM portfolios WHERE id = 'default'").get() as Row;
  return rowToPortfolio(row);
}

export function updatePortfolio(cashUsd: number, realizedPnlUsd: number, feesPaidUsd: number) {
  getDb()
    .prepare(
      `UPDATE portfolios
       SET cash_usd = ?, realized_pnl_usd = ?, fees_paid_usd = ?, updated_at = ?
       WHERE id = 'default'`
    )
    .run(cashUsd, realizedPnlUsd, feesPaidUsd, now());
}

export function listWallets(): Wallet[] {
  return (getDb().prepare("SELECT * FROM wallets ORDER BY created_at DESC").all() as Row[]).map((row) => ({
    address: String(row.address),
    label: String(row.label),
    notes: String(row.notes),
    gmgnUrl: String(row.gmgn_url),
    createdAt: String(row.created_at)
  }));
}

export function upsertWallet(input: Omit<Wallet, "createdAt">) {
  const createdAt = now();
  getDb()
    .prepare(
      `INSERT INTO wallets (address, label, notes, gmgn_url, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        label = excluded.label,
        notes = excluded.notes,
        gmgn_url = excluded.gmgn_url`
    )
    .run(input.address, input.label, input.notes, input.gmgnUrl, createdAt);
  return { ...input, createdAt };
}

export function deleteWallet(address: string) {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM wallet_activity WHERE wallet_address = ?").run(address);
    const result = db.prepare("DELETE FROM wallets WHERE address = ?").run(address);
    db.exec("COMMIT");
    return Number(result.changes ?? 0);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getToken(address: string) {
  const row = getDb().prepare("SELECT * FROM tokens WHERE address = ?").get(address) as Row | undefined;
  return row ? rowToToken(row) : null;
}

export function upsertToken(input: Omit<Token, "createdAt">) {
  const createdAt = now();
  getDb()
    .prepare(
      `INSERT INTO tokens (address, symbol, name, decimals, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        symbol = excluded.symbol,
        name = excluded.name,
        decimals = excluded.decimals`
    )
    .run(input.address, input.symbol, input.name, input.decimals, createdAt);
  return { ...input, createdAt };
}

export function listPositions(): Position[] {
  return (getDb()
    .prepare(
      `SELECT p.*, t.symbol, t.name, t.decimals
       FROM positions p
       JOIN tokens t ON t.address = p.token_address
       WHERE p.quantity > 0.0000000001
       ORDER BY p.updated_at DESC`
    )
    .all() as Row[]).map(rowToPosition);
}

export function getPosition(tokenAddress: string) {
  const row = getDb()
    .prepare(
      `SELECT p.*, t.symbol, t.name, t.decimals
       FROM positions p
       JOIN tokens t ON t.address = p.token_address
       WHERE p.token_address = ?`
    )
    .get(tokenAddress) as Row | undefined;
  return row ? rowToPosition(row) : null;
}

export function upsertPosition(position: {
  tokenAddress: string;
  quantity: number;
  averageEntryUsd: number;
  costBasisUsd: number;
  realizedPnlUsd: number;
  feesPaidUsd: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO positions
        (token_address, quantity, average_entry_usd, cost_basis_usd, realized_pnl_usd, fees_paid_usd, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token_address) DO UPDATE SET
        quantity = excluded.quantity,
        average_entry_usd = excluded.average_entry_usd,
        cost_basis_usd = excluded.cost_basis_usd,
        realized_pnl_usd = excluded.realized_pnl_usd,
        fees_paid_usd = excluded.fees_paid_usd,
        updated_at = excluded.updated_at`
    )
    .run(
      position.tokenAddress,
      position.quantity,
      position.averageEntryUsd,
      position.costBasisUsd,
      position.realizedPnlUsd,
      position.feesPaidUsd,
      now()
    );
}

export function insertTrade(input: Omit<Trade, "id" | "createdAt" | "symbol">) {
  const id = randomUUID();
  const createdAt = now();
  getDb()
    .prepare(
      `INSERT INTO trades
        (id, side, token_address, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.side,
      input.tokenAddress,
      input.quantity,
      input.priceUsd,
      input.notionalUsd,
      input.gasUsd,
      input.slippageUsd,
      input.dexFeeUsd,
      input.totalCostUsd,
      input.realizedPnlUsd,
      input.quoteSnapshot,
      createdAt
    );
  return id;
}

export function listTrades(): Trade[] {
  return (getDb()
    .prepare(
      `SELECT tr.*, t.symbol
       FROM trades tr
       JOIN tokens t ON t.address = tr.token_address
       ORDER BY tr.created_at DESC
       LIMIT 100`
    )
    .all() as Row[]).map(rowToTrade);
}

export function insertQuote(input: {
  tokenAddress: string;
  side: string;
  quantity: number;
  priceUsd: number;
  notionalUsd: number;
  gasUsd: number;
  slippageUsd: number;
  dexFeeUsd: number;
  quoteSnapshot: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO quotes
        (id, token_address, side, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.tokenAddress,
      input.side,
      input.quantity,
      input.priceUsd,
      input.notionalUsd,
      input.gasUsd,
      input.slippageUsd,
      input.dexFeeUsd,
      input.quoteSnapshot,
      now()
    );
}

export function insertWalletActivity(items: Omit<WalletActivity, "id">[]) {
  const statement = getDb().prepare(
    `INSERT OR IGNORE INTO wallet_activity
      (id, wallet_address, chain_id, chain_name, hash, category, asset, value, from_address, to_address, block_num, timestamp, is_swap_like)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const item of items) {
      statement.run(
        randomUUID(),
        item.walletAddress,
        item.chainId,
        item.chainName,
        item.hash,
        item.category,
        item.asset,
        item.value,
        item.fromAddress,
        item.toAddress,
        item.blockNum,
        item.timestamp,
        item.isSwapLike ? 1 : 0
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listWalletActivity(walletAddress: string): WalletActivity[] {
  return (getDb()
    .prepare(
      `SELECT * FROM wallet_activity
       WHERE wallet_address = ?
       ORDER BY timestamp DESC
       LIMIT 100`
    )
    .all(walletAddress) as Row[]).map((row) => ({
    id: String(row.id),
    walletAddress: String(row.wallet_address),
    chainId: Number(row.chain_id),
    chainName: String(row.chain_name),
    hash: String(row.hash),
    category: String(row.category),
    asset: String(row.asset),
    value: Number(row.value),
    fromAddress: String(row.from_address),
    toAddress: String(row.to_address),
    blockNum: String(row.block_num),
    timestamp: String(row.timestamp),
    isSwapLike: Boolean(row.is_swap_like)
  }));
}

function rowToToken(row: Row): Token {
  return {
    address: String(row.address),
    symbol: String(row.symbol),
    name: String(row.name),
    decimals: Number(row.decimals),
    createdAt: String(row.created_at)
  };
}

function rowToPosition(row: Row): Position {
  return {
    tokenAddress: String(row.token_address),
    symbol: String(row.symbol),
    name: String(row.name),
    decimals: Number(row.decimals),
    quantity: Number(row.quantity),
    averageEntryUsd: Number(row.average_entry_usd),
    costBasisUsd: Number(row.cost_basis_usd),
    realizedPnlUsd: Number(row.realized_pnl_usd),
    feesPaidUsd: Number(row.fees_paid_usd),
    updatedAt: String(row.updated_at)
  };
}

function rowToTrade(row: Row): Trade {
  return {
    id: String(row.id),
    side: String(row.side) as Trade["side"],
    tokenAddress: String(row.token_address),
    symbol: String(row.symbol),
    quantity: Number(row.quantity),
    priceUsd: Number(row.price_usd),
    notionalUsd: Number(row.notional_usd),
    gasUsd: Number(row.gas_usd),
    slippageUsd: Number(row.slippage_usd),
    dexFeeUsd: Number(row.dex_fee_usd),
    totalCostUsd: Number(row.total_cost_usd),
    realizedPnlUsd: Number(row.realized_pnl_usd),
    quoteSnapshot: String(row.quote_snapshot),
    createdAt: String(row.created_at)
  };
}
