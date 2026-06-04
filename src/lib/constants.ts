export const ETH_CHAIN_ID = 1;
export const BASE_CHAIN_ID = 8453;

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

export const CHAIN_TOKENS = {
  [ETH_CHAIN_ID]: {
    name: "Ethereum",
    alchemySubdomain: "eth-mainnet",
    weth: TOKENS.WETH,
    usdc: TOKENS.USDC
  },
  [BASE_CHAIN_ID]: {
    name: "Base",
    alchemySubdomain: "base-mainnet",
    weth: {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18
    },
    usdc: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      decimals: 6
    }
  }
} as const;

export function getChainTokens(chainId = ETH_CHAIN_ID) {
  return CHAIN_TOKENS[chainId as keyof typeof CHAIN_TOKENS] ?? CHAIN_TOKENS[ETH_CHAIN_ID];
}

export const DEFAULT_PORTFOLIO = {
  id: "default",
  name: "Main Paper Account",
  startingCashUsd: 10_000
};

export const DEFAULT_SLIPPAGE_BPS = 100;
export const DEFAULT_GAS_BUFFER_BPS = 1500;

export const DEFAULT_COPY_SETTINGS = {
  mode: "fixedUsd",
  fixedUsd: 250,
  percentOfSource: 25,
  maxTradeUsd: 500,
  slippageCapBps: DEFAULT_SLIPPAGE_BPS,
  gasBufferBps: DEFAULT_GAS_BUFFER_BPS,
  insufficientCashBehavior: "skip",
  allowlist: [] as string[],
  blocklist: [] as string[]
} as const;
