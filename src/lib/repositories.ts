import { randomUUID } from "node:crypto";
import { classifyCandidateTrust } from "./candidateTrust";
import { DEFAULT_COPY_SETTINGS } from "./constants";
import { getDb } from "./db";
import type { CopyAttemptStatus, CopySettings, LedgerEntry, Portfolio, Position, Token, Trade, TradeCandidate, TradeInput, TradeLedgerInput, Wallet, WalletActivity } from "./types";
import { derivePortfolioTotals, derivePositions, ledgerDeltaFromTrade } from "./ledger";

type Row = Record<string, unknown>;
export type CandidateAttentionSummary = {
  ready: number;
  review: number;
  blocked: number;
  failed: number;
  copied: number;
  total: number;
};

const now = () => new Date().toISOString();


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

export function getCopySettings(): CopySettings {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'copy_settings'").get() as Row | undefined;
  if (!row) return { ...DEFAULT_COPY_SETTINGS };

  try {
    return normalizeCopySettings(JSON.parse(String(row.value)));
  } catch {
    return { ...DEFAULT_COPY_SETTINGS };
  }
}

export function updateCopySettings(settings: CopySettings): CopySettings {
  const normalized = normalizeCopySettings(settings);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES ('copy_settings', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(JSON.stringify(normalized));
  return normalized;
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
    db.prepare("DELETE FROM trade_candidates WHERE wallet_address = ?").run(address);
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


function insertTrade(input: TradeInput) {
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
      (id, wallet_address, chain_id, chain_name, hash, category, asset, contract_address, value, from_address, to_address,
       block_num, timestamp, is_swap_like, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        item.contractAddress,
        item.value,
        item.fromAddress,
        item.toAddress,
        item.blockNum,
        item.timestamp,
        item.isSwapLike ? 1 : 0,
        item.rawPayload
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
    contractAddress: String(row.contract_address),
    value: Number(row.value),
    fromAddress: String(row.from_address),
    toAddress: String(row.to_address),
    blockNum: String(row.block_num),
    timestamp: String(row.timestamp),
    isSwapLike: Boolean(row.is_swap_like),
    rawPayload: String(row.raw_payload)
  }));
}

export function getWalletActivityTokenHint(input: {
  walletAddress: string;
  chainId: number;
  hash: string;
  tokenAddress: string;
}): { symbol: string; name: string; decimals: number } | null {
  const row = getDb()
    .prepare(
      `SELECT asset, raw_payload
       FROM wallet_activity
       WHERE wallet_address = ?
         AND chain_id = ?
         AND hash = ?
         AND lower(contract_address) = lower(?)
       LIMIT 1`
    )
    .get(input.walletAddress, input.chainId, input.hash, input.tokenAddress) as Row | undefined;
  if (!row) return null;

  const symbol = String(row.asset || "").trim();
  const decimals = parseRawPayloadDecimals(String(row.raw_payload || ""));
  if (!symbol || symbol.toLowerCase() === "unknown" || !Number.isFinite(decimals)) return null;
  return { symbol, name: symbol, decimals };
}

export function upsertTradeCandidates(candidates: Omit<TradeCandidate, "id" | "createdAt" | "updatedAt">[]) {
  const statement = getDb().prepare(
    `INSERT INTO trade_candidates
      (id, wallet_address, chain_id, chain_name, hash, status, confidence, side, token_in_asset, token_in_amount,
       token_in_address, token_out_asset, token_out_amount, token_out_address, reason, transfer_count, source_timestamp,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(wallet_address, chain_id, hash) DO UPDATE SET
       chain_name = excluded.chain_name,
       status = excluded.status,
       confidence = excluded.confidence,
       side = excluded.side,
       token_in_asset = excluded.token_in_asset,
       token_in_amount = excluded.token_in_amount,
       token_in_address = excluded.token_in_address,
       token_out_asset = excluded.token_out_asset,
       token_out_amount = excluded.token_out_amount,
       token_out_address = excluded.token_out_address,
       reason = excluded.reason,
       transfer_count = excluded.transfer_count,
       source_timestamp = excluded.source_timestamp,
       updated_at = excluded.updated_at`
  );
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const candidate of candidates) {
      const timestamp = now();
      statement.run(
        randomUUID(),
        candidate.walletAddress,
        candidate.chainId,
        candidate.chainName,
        candidate.hash,
        candidate.status,
        candidate.confidence,
        candidate.side,
        candidate.tokenInAsset,
        candidate.tokenInAmount,
        candidate.tokenInAddress,
        candidate.tokenOutAsset,
        candidate.tokenOutAmount,
        candidate.tokenOutAddress,
        candidate.reason,
        candidate.transferCount,
        candidate.sourceTimestamp,
        timestamp,
        timestamp
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listTradeCandidates(walletAddress: string): TradeCandidate[] {
  return (getDb()
    .prepare(
      `SELECT * FROM trade_candidates
       WHERE wallet_address = ?
       ORDER BY COALESCE(NULLIF(source_timestamp, ''), updated_at) DESC
       LIMIT 100`
    )
    .all(walletAddress) as Row[]).map(rowToTradeCandidate);
}

export function getCandidateAttentionSummary(): CandidateAttentionSummary {
  const summary: CandidateAttentionSummary = {
    ready: 0,
    review: 0,
    blocked: 0,
    failed: 0,
    copied: 0,
    total: 0
  };

  const candidates = (getDb().prepare("SELECT * FROM trade_candidates").all() as Row[]).map(rowToTradeCandidate);
  for (const candidate of candidates) {
    summary.total += 1;
    const trust = classifyCandidateTrust(candidate);
    if (trust.label === "Ready") summary.ready += 1;
    else if (trust.label === "Copied") summary.copied += 1;
    else if (trust.label === "Failed" || trust.label === "No route") summary.failed += 1;
    else if (!trust.copyable) summary.blocked += 1;
    else summary.review += 1;
  }

  return summary;
}

export function resetPaperPortfolio() {
  const db = getDb();
  const timestamp = now();
  db.exec("BEGIN");
  try {
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
    db
      .prepare(
        `UPDATE trade_candidates
         SET status = CASE
             WHEN status IN ('copied', 'failed') THEN 'candidate'
             ELSE status
           END,
           reason = CASE
             WHEN status IN ('copied', 'failed') THEN 'Paper portfolio was reset; review this candidate before copying again.'
             ELSE reason
           END,
           last_copy_status = '',
           last_copy_bucket = '',
           last_copy_reason = '',
           last_copy_trade_id = '',
           last_copy_at = '',
           updated_at = ?`
      )
      .run(timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getPortfolio();
}

export function getTradeCandidate(id: string): TradeCandidate | null {
  const row = getDb().prepare("SELECT * FROM trade_candidates WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToTradeCandidate(row) : null;
}

export function updateTradeCandidateStatus(
  id: string,
  status: TradeCandidate["status"],
  reason?: string
) {
  const result = getDb()
    .prepare(
      `UPDATE trade_candidates
       SET status = ?, reason = COALESCE(?, reason), updated_at = ?
       WHERE id = ?`
    )
    .run(status, reason ?? null, now(), id);
  return Number(result.changes ?? 0);
}

export function updateTradeCandidateCopyResult(input: {
  id: string;
  status: CopyAttemptStatus;
  bucket?: string;
  reason: string;
  tradeId?: string;
}) {
  const timestamp = now();
  const result = getDb()
    .prepare(
      `UPDATE trade_candidates
       SET last_copy_status = ?,
           last_copy_bucket = ?,
           last_copy_reason = ?,
           last_copy_trade_id = ?,
           last_copy_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(input.status, input.bucket ?? "", input.reason, input.tradeId ?? "", timestamp, timestamp, input.id);
  return Number(result.changes ?? 0);
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

function rowToTradeCandidate(row: Row): TradeCandidate {
  return {
    id: String(row.id),
    walletAddress: String(row.wallet_address),
    chainId: Number(row.chain_id),
    chainName: String(row.chain_name),
    hash: String(row.hash),
    status: String(row.status) as TradeCandidate["status"],
    confidence: Number(row.confidence),
    side: String(row.side) as TradeCandidate["side"],
    tokenInAsset: String(row.token_in_asset),
    tokenInAddress: String(row.token_in_address),
    tokenInAmount: Number(row.token_in_amount),
    tokenOutAsset: String(row.token_out_asset),
    tokenOutAddress: String(row.token_out_address),
    tokenOutAmount: Number(row.token_out_amount),
    reason: String(row.reason),
    transferCount: Number(row.transfer_count),
    sourceTimestamp: String(row.source_timestamp || row.updated_at),
    lastCopyStatus: String(row.last_copy_status || "") as TradeCandidate["lastCopyStatus"],
    lastCopyBucket: String(row.last_copy_bucket || ""),
    lastCopyReason: String(row.last_copy_reason || ""),
    lastCopyTradeId: String(row.last_copy_trade_id || ""),
    lastCopyAt: String(row.last_copy_at || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

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
    blocklist: normalizeTokenList(input.blocklist)
  };
}

function parseRawPayloadDecimals(rawPayload: string) {
  try {
    const payload = JSON.parse(rawPayload) as { rawContract?: { decimal?: unknown } };
    const value = payload.rawContract?.decimal;
    if (typeof value === "number") return value;
    if (typeof value !== "string" || !value.trim()) return NaN;
    return value.startsWith("0x") ? Number.parseInt(value, 16) : Number.parseInt(value, 10);
  } catch {
    return NaN;
  }
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeTokenList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item).trim().toLowerCase())
        .filter((item) => /^0x[a-f0-9]{40}$/.test(item))
    )
  );
}
