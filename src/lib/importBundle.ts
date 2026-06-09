import { z } from "zod";

const walletSchema = z.object({
  address: z.string(),
  label: z.string(),
  notes: z.string(),
  gmgnUrl: z.string(),
  autoCopy: z.boolean().optional().default(false),
  createdAt: z.string()
});

const tokenSchema = z.object({
  address: z.string(),
  chainId: z.number().optional().default(1),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  createdAt: z.string()
});

const tradeSchema = z.object({
  id: z.string(),
  side: z.enum(["buy", "sell"]),
  tokenAddress: z.string(),
  chainId: z.number().optional().default(1),
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
  chainId: z.number().optional().default(1),
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
