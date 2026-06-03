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
  hash: string;
  category: string;
  asset: string;
  value: number;
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  timestamp: string;
  isSwapLike: boolean;
};
