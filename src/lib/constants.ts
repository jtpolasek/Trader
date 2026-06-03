export const ETH_CHAIN_ID = 1;

export const TOKENS = {
  ETH: {
    address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    symbol: "ETH",
    decimals: 18
  },
  WETH: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    symbol: "WETH",
    decimals: 18
  },
  USDC: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    decimals: 6
  }
} as const;

export const DEFAULT_PORTFOLIO = {
  id: "default",
  name: "Main Paper Account",
  startingCashUsd: 10_000
};

export const DEFAULT_SLIPPAGE_BPS = 100;
export const DEFAULT_GAS_BUFFER_BPS = 1500;
