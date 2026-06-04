export type TradeSide = "buy" | "sell";

export type Wallet = {
  address: string;
  label: string;
  notes: string;
  gmgnUrl: string;
  createdAt: string;
};

export type Token = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  createdAt: string;
};

export type Position = {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  quantity: number;
  averageEntryUsd: number;
  costBasisUsd: number;
  realizedPnlUsd: number;
  feesPaidUsd: number;
  updatedAt: string;
};

export type Trade = {
  id: string;
  side: TradeSide;
  tokenAddress: string;
  symbol: string;
  quantity: number;
  priceUsd: number;
  notionalUsd: number;
  gasUsd: number;
  slippageUsd: number;
  dexFeeUsd: number;
  totalCostUsd: number;
  realizedPnlUsd: number;
  quoteSnapshot: string;
  createdAt: string;
};

export type Portfolio = {
  id: string;
  name: string;
  cashUsd: number;
  startingCashUsd: number;
  realizedPnlUsd: number;
  feesPaidUsd: number;
  createdAt: string;
  updatedAt: string;
};

export type QuotePreview = {
  side: TradeSide;
  token: Token;
  quantity: number;
  priceUsd: number;
  notionalUsd: number;
  gasUsd: number;
  slippageUsd: number;
  dexFeeUsd: number;
  totalCostUsd: number;
  sellProceedsUsd: number;
  warnings: string[];
  quoteSnapshot: Record<string, unknown>;
};

export type WalletActivity = {
  id: string;
  walletAddress: string;
  chainId: number;
  chainName: string;
  hash: string;
  category: string;
  asset: string;
  contractAddress: string;
  value: number;
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  timestamp: string;
  isSwapLike: boolean;
  rawPayload: string;
};

export type TradeCandidateStatus = "candidate" | "decoded" | "skipped" | "copied" | "partial" | "failed";

export type TradeCandidate = {
  id: string;
  walletAddress: string;
  chainId: number;
  chainName: string;
  hash: string;
  status: TradeCandidateStatus;
  confidence: number;
  side: TradeSide | "unknown";
  tokenInAsset: string;
  tokenInAddress: string;
  tokenInAmount: number;
  tokenOutAsset: string;
  tokenOutAddress: string;
  tokenOutAmount: number;
  reason: string;
  transferCount: number;
  sourceTimestamp: string;
  createdAt: string;
  updatedAt: string;
};

export type CopySettings = {
  mode: "fixedUsd" | "percentOfSource";
  fixedUsd: number;
  percentOfSource: number;
  maxTradeUsd: number;
  slippageCapBps: number;
  gasBufferBps: number;
  insufficientCashBehavior: "skip" | "cap";
  allowlist: string[];
  blocklist: string[];
};

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
