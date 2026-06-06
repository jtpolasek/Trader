import { randomUUID } from "node:crypto";
import { classifyCandidateTrust } from "./candidateTrust";
import { deriveTradeCandidates } from "./candidates";
import { DEFAULT_COPY_SETTINGS, ETH_CHAIN_ID } from "./constants";
import { getDb } from "./db";
import type { CopyAttemptStatus, CopySettings, LedgerEntry, Portfolio, Position, Token, Trade, TradeCandidate, TradeInput, TradeLedgerInput, Wallet, WalletActivity } from "./types";
import { derivePortfolioTotals, derivePositions, ledgerDeltaFromTrade } from "./ledger";
import { summarizeImportBundle, type ImportBundle, type ImportSummary } from "./importBundle";

type Row = Record<string, unknown>;
export type CandidateAttentionSummary = {
  ready: number;
  review: number;
  blocked: number;
  failed: number;
  copied: number;
  total: number;
};

export type QuoteExport = {
  id: string;
  tokenAddress: string;
  side: string;
  quantity: number;
  priceUsd: number;
  notionalUsd: number;
  gasUsd: number;
  slippageUsd: number;
  dexFeeUsd: number;
  quoteSnapshot: string;
  createdAt: string;
};

export type SettingExport = {
  key: string;
  value: string;
};

export type LocalDataExport = {
  schemaVersion: 1;
  exportedAt: string;
  app: {
    name: "gmgn-paper-trader";
    version: "0.1.0";
  };
  portfolio: Portfolio;
  copySettings: CopySettings;
  candidateAttention: CandidateAttentionSummary;
  wallets: Wallet[];
  tokens: Token[];
  positions: Position[];
  trades: Trade[];
  ledgerEntries: LedgerEntry[];
  quotes: QuoteExport[];
  walletActivity: WalletActivity[];
  tradeCandidates: TradeCandidate[];
  settings: SettingExport[];
};

export type StoredActivityCandidateReprocessResult = {
  summary: {
    stored: number;
    derived: number;
    missing: number;
    inserted: number;
    newDecoded: number;
    newReview: number;
    newSkipped: number;
  };
  candidates: Omit<TradeCandidate, "id" | "createdAt" | "updatedAt">[];
};

export type PaperPortfolioArchiveSummary = {
  id: string;
  name: string;
  tradeCount: number;
  ledgerEntryCount: number;
  quoteCount: number;
  copiedCandidateCount: number;
  createdAt: string;
};

type CandidateCopySnapshot = Pick<
  TradeCandidate,
  "id" | "status" | "reason" | "lastCopyStatus" | "lastCopyBucket" | "lastCopyReason" | "lastCopyTradeId" | "lastCopyAt"
>;

type PaperPortfolioArchivePayload = {
  schemaVersion: 1;
  trades: Trade[];
  ledgerEntries: LedgerEntry[];
  quotes: QuoteExport[];
  candidateCopies: CandidateCopySnapshot[];
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

export function upsertToken(input: Omit<Token, "createdAt" | "chainId"> & { chainId?: number }) {
  const createdAt = now();
  const chainId = input.chainId ?? ETH_CHAIN_ID;
  getDb()
    .prepare(
      `INSERT INTO tokens (address, chain_id, symbol, name, decimals, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        chain_id = excluded.chain_id,
        symbol = excluded.symbol,
        name = excluded.name,
        decimals = excluded.decimals`
    )
    .run(input.address, chainId, input.symbol, input.name, input.decimals, createdAt);
  return { ...input, chainId, createdAt };
}

export function listPositions(): Position[] {
  const aggregates = derivePositions(listLedgerEntries());
  const positions: Position[] = [];
  for (const aggregate of aggregates) {
    const token = getToken(aggregate.tokenAddress);
    if (!token) continue;
    positions.push({
      tokenAddress: aggregate.tokenAddress,
      chainId: aggregate.chainId,
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
    chainId: token.chainId,
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
  const chainId = input.chainId ?? ETH_CHAIN_ID;
  getDb()
    .prepare(
      `INSERT INTO trades
        (id, side, token_address, chain_id, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.side,
      input.tokenAddress,
      chainId,
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
  const chainId = input.chainId ?? ETH_CHAIN_ID;
  getDb()
    .prepare(
      `INSERT INTO ledger_entries
        (id, entry_type, trade_id, token_address, chain_id, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      delta.entryType,
      tradeId,
      tokenAddress,
      chainId,
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
    chainId: Number(row.chain_id),
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

export function exportLocalData(): LocalDataExport {
  return {
    schemaVersion: 1,
    exportedAt: now(),
    app: {
      name: "gmgn-paper-trader",
      version: "0.1.0"
    },
    portfolio: getPortfolio(),
    copySettings: getCopySettings(),
    candidateAttention: getCandidateAttentionSummary(),
    wallets: listWallets(),
    tokens: listTokensForExport(),
    positions: listPositions(),
    trades: listTradesForExport(),
    ledgerEntries: listLedgerEntries(),
    quotes: listQuotesForExport(),
    walletActivity: listWalletActivityForExport(),
    tradeCandidates: listTradeCandidatesForExport(),
    settings: listSettingsForExport()
  };
}

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
      "INSERT INTO tokens (address, chain_id, symbol, name, decimals, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const t of bundle.tokens) {
      insertTokenRow.run(t.address, t.chainId, t.symbol, t.name, t.decimals, t.createdAt);
    }

    const insertTradeRow = db.prepare(
      `INSERT INTO trades
        (id, side, token_address, chain_id, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const tr of bundle.trades) {
      insertTradeRow.run(
        tr.id, tr.side, tr.tokenAddress, tr.chainId, tr.quantity, tr.priceUsd, tr.notionalUsd, tr.gasUsd,
        tr.slippageUsd, tr.dexFeeUsd, tr.totalCostUsd, tr.realizedPnlUsd, tr.quoteSnapshot, tr.createdAt
      );
    }

    const insertLedger = db.prepare(
      `INSERT INTO ledger_entries
        (id, entry_type, trade_id, token_address, chain_id, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of bundle.ledgerEntries) {
      insertLedger.run(
        e.id, e.entryType, e.tradeId, e.tokenAddress, e.chainId, e.cashDelta, e.quantityDelta,
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
    .all(walletAddress) as Row[]).map(rowToWalletActivity);
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

export function previewStoredActivityCandidateReprocess(): StoredActivityCandidateReprocessResult {
  const stored = listAllTradeCandidates();
  const derived = deriveCandidatesFromStoredActivity();
  const storedKeys = new Set(stored.map(candidateKey));
  const missing = derived.filter((candidate) => !storedKeys.has(candidateKey(candidate)));
  return buildStoredActivityCandidateReprocessResult({
    candidates: missing,
    inserted: 0,
    stored: stored.length,
    derived: derived.length
  });
}

export function reprocessStoredActivityCandidates(): StoredActivityCandidateReprocessResult {
  const preview = previewStoredActivityCandidateReprocess();
  if (!preview.candidates.length) return preview;

  const statement = getDb().prepare(
    `INSERT OR IGNORE INTO trade_candidates
      (id, wallet_address, chain_id, chain_name, hash, status, confidence, side, token_in_asset, token_in_amount,
       token_in_address, token_out_asset, token_out_amount, token_out_address, reason, transfer_count, source_timestamp,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const db = getDb();
  let inserted = 0;
  db.exec("BEGIN");
  try {
    for (const candidate of preview.candidates) {
      const timestamp = now();
      const result = statement.run(
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
      inserted += Number(result.changes ?? 0);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return buildStoredActivityCandidateReprocessResult({
    candidates: preview.candidates,
    inserted,
    stored: preview.summary.stored,
    derived: preview.summary.derived
  });
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

function listAllTradeCandidates(): TradeCandidate[] {
  return (getDb().prepare("SELECT * FROM trade_candidates").all() as Row[]).map(rowToTradeCandidate);
}

function deriveCandidatesFromStoredActivity(): Omit<TradeCandidate, "id" | "createdAt" | "updatedAt">[] {
  const activity = (getDb()
    .prepare(
      `SELECT *
       FROM wallet_activity
       ORDER BY wallet_address ASC, chain_id ASC, hash ASC, timestamp ASC, id ASC`
    )
    .all() as Row[]).map(rowToWalletActivity);
  const byWallet = new Map<string, WalletActivity[]>();
  for (const item of activity) {
    const key = item.walletAddress.toLowerCase();
    byWallet.set(key, [...(byWallet.get(key) ?? []), item]);
  }
  return Array.from(byWallet.values()).flatMap((items) => deriveTradeCandidates(items));
}

function buildStoredActivityCandidateReprocessResult(input: {
  candidates: Omit<TradeCandidate, "id" | "createdAt" | "updatedAt">[];
  inserted: number;
  stored: number;
  derived: number;
}): StoredActivityCandidateReprocessResult {
  const { candidates } = input;
  return {
    summary: {
      stored: input.stored,
      derived: input.derived,
      missing: candidates.length,
      inserted: input.inserted,
      newDecoded: candidates.filter((candidate) => candidate.status === "decoded").length,
      newReview: candidates.filter((candidate) => candidate.status === "candidate").length,
      newSkipped: candidates.filter((candidate) => candidate.status === "skipped").length
    },
    candidates
  };
}

function candidateKey(candidate: Pick<TradeCandidate, "walletAddress" | "chainId" | "hash">) {
  return `${candidate.walletAddress.toLowerCase()}|${candidate.chainId}|${candidate.hash.toLowerCase()}`;
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
    db
      .prepare("UPDATE portfolios SET updated_at = ? WHERE id = 'default'")
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

export function listPaperPortfolioArchives(): PaperPortfolioArchiveSummary[] {
  return (getDb()
    .prepare(
      `SELECT id, name, payload, created_at
       FROM paper_portfolio_archives
       ORDER BY created_at DESC`
    )
    .all() as Row[]).map(rowToPaperPortfolioArchiveSummary);
}

export function createPaperPortfolioArchive(name?: string): PaperPortfolioArchiveSummary {
  const id = randomUUID();
  const createdAt = now();
  const payload = currentPaperPortfolioArchivePayload();
  const archiveName = name?.trim() || `Paper portfolio ${createdAt.slice(0, 16).replace("T", " ")}`;

  getDb()
    .prepare("INSERT INTO paper_portfolio_archives (id, name, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(id, archiveName, JSON.stringify(payload), createdAt);

  return archiveSummaryFromPayload({ id, name: archiveName, payload, createdAt });
}

export function restorePaperPortfolioArchive(id: string): { portfolio: Portfolio; archive: PaperPortfolioArchiveSummary } {
  const row = getDb().prepare("SELECT * FROM paper_portfolio_archives WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new Error("Paper portfolio archive was not found.");

  const payload = parsePaperPortfolioArchivePayload(String(row.payload));
  const db = getDb();
  const timestamp = now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM quotes").run();

    const insertTradeRow = db.prepare(
      `INSERT INTO trades
        (id, side, token_address, chain_id, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const tr of payload.trades) {
      insertTradeRow.run(
        tr.id, tr.side, tr.tokenAddress, tr.chainId, tr.quantity, tr.priceUsd, tr.notionalUsd, tr.gasUsd,
        tr.slippageUsd, tr.dexFeeUsd, tr.totalCostUsd, tr.realizedPnlUsd, tr.quoteSnapshot, tr.createdAt
      );
    }

    const insertLedger = db.prepare(
      `INSERT INTO ledger_entries
        (id, entry_type, trade_id, token_address, chain_id, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of payload.ledgerEntries) {
      insertLedger.run(
        e.id, e.entryType, e.tradeId, e.tokenAddress, e.chainId, e.cashDelta, e.quantityDelta,
        e.costBasisDelta, e.realizedPnlDelta, e.feeDelta, e.createdAt
      );
    }

    const insertQuoteRow = db.prepare(
      `INSERT INTO quotes
        (id, token_address, side, quantity, price_usd, notional_usd, gas_usd, slippage_usd, dex_fee_usd, quote_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const q of payload.quotes) {
      insertQuoteRow.run(
        q.id, q.tokenAddress, q.side, q.quantity, q.priceUsd, q.notionalUsd, q.gasUsd,
        q.slippageUsd, q.dexFeeUsd, q.quoteSnapshot, q.createdAt
      );
    }

    db
      .prepare(
        `UPDATE trade_candidates
         SET status = CASE
             WHEN status IN ('copied', 'failed') THEN 'candidate'
             ELSE status
           END,
           reason = CASE
             WHEN status IN ('copied', 'failed') THEN 'Paper portfolio archive was restored; review this candidate before copying again.'
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

    const updateCandidate = db.prepare(
      `UPDATE trade_candidates
       SET status = ?,
           reason = ?,
           last_copy_status = ?,
           last_copy_bucket = ?,
           last_copy_reason = ?,
           last_copy_trade_id = ?,
           last_copy_at = ?,
           updated_at = ?
       WHERE id = ?`
    );
    for (const candidate of payload.candidateCopies) {
      updateCandidate.run(
        candidate.status,
        candidate.reason,
        candidate.lastCopyStatus ?? "",
        candidate.lastCopyBucket ?? "",
        candidate.lastCopyReason ?? "",
        candidate.lastCopyTradeId ?? "",
        candidate.lastCopyAt ?? "",
        timestamp,
        candidate.id
      );
    }

    db.prepare("UPDATE portfolios SET updated_at = ? WHERE id = 'default'").run(timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { portfolio: getPortfolio(), archive: archiveSummaryFromPayload({ id: String(row.id), name: String(row.name), payload, createdAt: String(row.created_at) }) };
}

export function renamePaperPortfolioArchive(id: string, name: string): PaperPortfolioArchiveSummary {
  const archiveName = name.trim();
  if (!archiveName) throw new Error("Archive name is required.");

  const db = getDb();
  const result = db.prepare("UPDATE paper_portfolio_archives SET name = ? WHERE id = ?").run(archiveName, id);
  if (!Number(result.changes ?? 0)) throw new Error("Paper portfolio archive was not found.");

  const row = db.prepare("SELECT * FROM paper_portfolio_archives WHERE id = ?").get(id) as Row;
  return rowToPaperPortfolioArchiveSummary(row);
}

export function deletePaperPortfolioArchive(id: string): number {
  const result = getDb().prepare("DELETE FROM paper_portfolio_archives WHERE id = ?").run(id);
  return Number(result.changes ?? 0);
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
    chainId: Number(row.chain_id),
    symbol: String(row.symbol),
    name: String(row.name),
    decimals: Number(row.decimals),
    createdAt: String(row.created_at)
  };
}

function listTokensForExport(): Token[] {
  return (getDb().prepare("SELECT * FROM tokens ORDER BY created_at ASC, address ASC").all() as Row[]).map(rowToToken);
}

function rowToTrade(row: Row): Trade {
  return {
    id: String(row.id),
    side: String(row.side) as Trade["side"],
    tokenAddress: String(row.token_address),
    chainId: Number(row.chain_id),
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

function listTradesForExport(): Trade[] {
  return (getDb()
    .prepare(
      `SELECT tr.*, COALESCE(t.symbol, '') AS symbol
       FROM trades tr
       LEFT JOIN tokens t ON t.address = tr.token_address
       ORDER BY tr.created_at ASC, tr.id ASC`
    )
    .all() as Row[]).map(rowToTrade);
}

function listQuotesForExport(): QuoteExport[] {
  return (getDb()
    .prepare(
      `SELECT *
       FROM quotes
       ORDER BY created_at ASC, id ASC`
    )
    .all() as Row[]).map((row) => ({
    id: String(row.id),
    tokenAddress: String(row.token_address),
    side: String(row.side),
    quantity: Number(row.quantity),
    priceUsd: Number(row.price_usd),
    notionalUsd: Number(row.notional_usd),
    gasUsd: Number(row.gas_usd),
    slippageUsd: Number(row.slippage_usd),
    dexFeeUsd: Number(row.dex_fee_usd),
    quoteSnapshot: String(row.quote_snapshot),
    createdAt: String(row.created_at)
  }));
}

function listWalletActivityForExport(): WalletActivity[] {
  return (getDb()
    .prepare(
      `SELECT *
       FROM wallet_activity
       ORDER BY timestamp ASC, id ASC`
    )
    .all() as Row[]).map(rowToWalletActivity);
}

function listTradeCandidatesForExport(): TradeCandidate[] {
  return (getDb()
    .prepare(
      `SELECT *
       FROM trade_candidates
       ORDER BY COALESCE(NULLIF(source_timestamp, ''), updated_at) ASC, id ASC`
    )
    .all() as Row[]).map(rowToTradeCandidate);
}

function listSettingsForExport(): SettingExport[] {
  return (getDb()
    .prepare(
      `SELECT key, value
       FROM settings
       ORDER BY key ASC`
    )
    .all() as Row[]).map((row) => ({
    key: String(row.key),
    value: String(row.value)
  }));
}

function currentPaperPortfolioArchivePayload(): PaperPortfolioArchivePayload {
  return {
    schemaVersion: 1,
    trades: listTradesForExport(),
    ledgerEntries: listLedgerEntries(),
    quotes: listQuotesForExport(),
    candidateCopies: listCandidateCopySnapshots()
  };
}

function listCandidateCopySnapshots(): CandidateCopySnapshot[] {
  return listTradeCandidatesForExport()
    .filter((candidate) => candidate.status === "copied" || candidate.lastCopyStatus)
    .map((candidate) => ({
      id: candidate.id,
      status: candidate.status,
      reason: candidate.reason,
      lastCopyStatus: candidate.lastCopyStatus ?? "",
      lastCopyBucket: candidate.lastCopyBucket ?? "",
      lastCopyReason: candidate.lastCopyReason ?? "",
      lastCopyTradeId: candidate.lastCopyTradeId ?? "",
      lastCopyAt: candidate.lastCopyAt ?? ""
    }));
}

function rowToPaperPortfolioArchiveSummary(row: Row): PaperPortfolioArchiveSummary {
  return archiveSummaryFromPayload({
    id: String(row.id),
    name: String(row.name),
    payload: parsePaperPortfolioArchivePayload(String(row.payload)),
    createdAt: String(row.created_at)
  });
}

function archiveSummaryFromPayload(input: {
  id: string;
  name: string;
  payload: PaperPortfolioArchivePayload;
  createdAt: string;
}): PaperPortfolioArchiveSummary {
  return {
    id: input.id,
    name: input.name,
    tradeCount: input.payload.trades.length,
    ledgerEntryCount: input.payload.ledgerEntries.length,
    quoteCount: input.payload.quotes.length,
    copiedCandidateCount: input.payload.candidateCopies.length,
    createdAt: input.createdAt
  };
}

function parsePaperPortfolioArchivePayload(raw: string): PaperPortfolioArchivePayload {
  const parsed = JSON.parse(raw) as Partial<PaperPortfolioArchivePayload>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.trades) || !Array.isArray(parsed.ledgerEntries) || !Array.isArray(parsed.quotes)) {
    throw new Error("Paper portfolio archive has an unsupported format.");
  }
  return {
    schemaVersion: 1,
    trades: parsed.trades,
    ledgerEntries: parsed.ledgerEntries,
    quotes: parsed.quotes,
    candidateCopies: Array.isArray(parsed.candidateCopies) ? parsed.candidateCopies : []
  };
}

function rowToWalletActivity(row: Row): WalletActivity {
  return {
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
