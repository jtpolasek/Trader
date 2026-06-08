import { ETH_CHAIN_ID, getChainTokens } from "./constants";
import { fromBaseUnits, normalizeAddress, toBaseUnits } from "./money";
import type { QuotePreview, Token, TradeSide, WalletActivity } from "./types";
import { assertUsableUniswapQuote, getUniswapQuote } from "./uniswap";
import { valueUnpricedFees, type FeePriceAnchor } from "./fees";
import { assertUsableZeroxQuote, getZeroxPrice, type UnpricedFee } from "./zerox";

type AlchemyTransfer = {
  chainId?: number;
  chainName?: string;
  hash?: string;
  category?: string;
  asset?: string;
  value?: number;
  from?: string;
  to?: string;
  blockNum?: string;
  metadata?: { blockTimestamp?: string };
  rawContract?: { address?: string | null; decimal?: string | null; value?: string | null };
};

const ALCHEMY_ACTIVITY_CHAINS = [
  { id: 1, name: "Ethereum", subdomain: "eth-mainnet", envPrefix: "ETHEREUM" },
  { id: 8453, name: "Base", subdomain: "base-mainnet", envPrefix: "BASE" }
] as const;

type SwapQuote = {
  provider: "0x" | "Uniswap";
  endpoint: string;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  gasUnits?: number;
  gasPriceWei?: number;
  gasUsd?: number;
  dexFeeUsd: number;
  unpricedFees?: UnpricedFee[];
  warnings: string[];
  rawResponse: unknown;
};

const REFERENCE_SPOT_USD = 10;

export async function resolveTokenFromAlchemy(address: string, chainId = ETH_CHAIN_ID): Promise<Token> {
  const tokenAddress = normalizeAddress(address);
  const chainTokens = getChainTokens(chainId);
  const cachedUsdc = tokenAddress === chainTokens.usdc.address.toLowerCase();
  const cachedWeth = tokenAddress === chainTokens.weth.address.toLowerCase();
  if (cachedUsdc || cachedWeth) {
    const token = cachedUsdc ? chainTokens.usdc : chainTokens.weth;
    return {
      address: token.address.toLowerCase(),
      chainId,
      symbol: token.symbol,
      name: token.symbol,
      decimals: token.decimals,
      createdAt: new Date().toISOString()
    };
  }

  const apiKey = getAlchemyApiKey(chainId);
  if (!apiKey) {
    throw new Error("ALCHEMY_API_KEY is required to resolve token metadata.");
  }

  const response = await fetch(`https://${chainTokens.alchemySubdomain}.g.alchemy.com/v2/${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getTokenMetadata",
      params: [tokenAddress]
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Alchemy token metadata failed with ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: { name?: string; symbol?: string; decimals?: number };
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "Alchemy returned a token metadata error.");
  }
  const metadata = payload.result;
  if (!hasCompleteTokenMetadata(metadata)) {
    const fallback = await resolveTokenFromErc20Calls(tokenAddress, chainId, apiKey);
    if (!fallback) {
      throw new Error("Token metadata is incomplete or unavailable.");
    }
    return fallback;
  }

  return {
    address: tokenAddress,
    chainId,
    symbol: metadata.symbol,
    name: metadata.name || metadata.symbol,
    decimals: metadata.decimals,
    createdAt: new Date().toISOString()
  };
}

export async function getEthUsdPrice() {
  return getNativeUsdPrice(ETH_CHAIN_ID);
}

export async function getNativeUsdPrice(chainId = ETH_CHAIN_ID) {
  const chainTokens = getChainTokens(chainId);
  const quote = await getZeroxPrice({
    chainId,
    sellToken: chainTokens.weth.address,
    buyToken: chainTokens.usdc.address,
    sellAmount: toBaseUnits(1, chainTokens.weth.decimals)
  });
  const buyAmount = Number(quote.buyAmount);
  if (!buyAmount) {
    throw new Error("Could not calculate ETH/USD from 0x.");
  }
  return fromBaseUnits(quote.buyAmount, chainTokens.usdc.decimals);
}

export async function buildQuotePreview(input: {
  side: TradeSide;
  token: Token;
  chainId?: number;
  usdAmount?: number;
  tokenQuantity?: number;
  slippageBps: number;
  gasBufferBps: number;
}): Promise<QuotePreview> {
  if (input.side === "buy" && (!input.usdAmount || input.usdAmount <= 0)) {
    throw new Error("Buy preview requires a USD amount.");
  }
  if (input.side === "sell" && (!input.tokenQuantity || input.tokenQuantity <= 0)) {
    throw new Error("Sell preview requires a token quantity.");
  }

  const chainId = input.chainId ?? ETH_CHAIN_ID;
  const chainTokens = getChainTokens(chainId);
  const sellToken = input.side === "buy" ? chainTokens.usdc.address : input.token.address;
  const buyToken = input.side === "buy" ? input.token.address : chainTokens.usdc.address;
  const sellAmount =
    input.side === "buy"
      ? toBaseUnits(input.usdAmount ?? 0, chainTokens.usdc.decimals)
      : toBaseUnits(input.tokenQuantity ?? 0, input.token.decimals);
  const quote = await getBestSwapQuote({
    chainId,
    side: input.side,
    sellToken,
    buyToken,
    sellAmount,
    slippageBps: input.slippageBps
  });

  const ethUsd = await getNativeUsdPrice(chainId);
  const spotTokenPriceUsd = await getReferenceTokenPriceUsd(input.token, chainId);
  const gasEth = ((quote.gasUnits ?? 0) * (quote.gasPriceWei ?? 0)) / 1e18;
  const gasUsd = (quote.gasUsd ?? gasEth * ethUsd) * (1 + input.gasBufferBps / 10_000);

  const isBuy = input.side === "buy";
  const buyQuantity = fromBaseUnits(quote.buyAmount, input.token.decimals);
  const sellProceeds = fromBaseUnits(quote.buyAmount, chainTokens.usdc.decimals);
  const sellQuantity = input.tokenQuantity ?? 0;
  const tokenQuantity = isBuy ? buyQuantity : sellQuantity;
  const tokenNotionalUsd = isBuy ? input.usdAmount ?? 0 : sellProceeds;
  const derivedTokenPriceUsd = tokenQuantity > 0 ? tokenNotionalUsd / tokenQuantity : 0;
  const implicitSwapCostUsd = estimateImplicitSwapCostUsd({
    side: input.side,
    spotTokenPriceUsd,
    quantity: tokenQuantity,
    notionalUsd: tokenNotionalUsd
  });

  const anchors: FeePriceAnchor[] = [
    { address: chainTokens.weth.address, usdPrice: ethUsd, decimals: chainTokens.weth.decimals },
    { address: chainTokens.usdc.address, usdPrice: 1, decimals: chainTokens.usdc.decimals },
    { address: input.token.address, usdPrice: derivedTokenPriceUsd, decimals: input.token.decimals }
  ];
  const { valuedUsd, pricedTokens, stillUnpriced } = valueUnpricedFees(quote.unpricedFees ?? [], anchors);

  const dexFeeUsd = quote.dexFeeUsd + valuedUsd;
  const warnings = [...quote.warnings];
  if (stillUnpriced.length) {
    const tokens = stillUnpriced.map((fee) => fee.token).join(", ");
    warnings.push(
      `0x reported a fee in ${tokens} that the simulator could not value in USD; the real cost is higher than shown.`
    );
  }

  const snapshotBase = {
    provider: "0x",
    quoteKind: "price-preview",
    endpoint: quote.endpoint,
    chainId: quote.chainId,
    side: input.side,
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    inputAmount: quote.sellAmount,
    assumptions: {
      ethUsd,
      slippageBps: input.slippageBps,
      gasBufferBps: input.gasBufferBps,
      gasUnits: quote.gasUnits ?? 0,
      gasPriceWei: quote.gasPriceWei ?? 0,
      gasUsd: quote.gasUsd,
      dexFeeUsd,
      spotTokenPriceUsd,
      implicitSwapCostUsd
    },
    valuedFeeUsd: valuedUsd,
    valuedFeeTokens: pricedTokens,
    stillUnpricedFees: stillUnpriced,
    normalizedQuote: withoutRawResponse(quote),
    rawQuote: quote.rawResponse
  };

  if (isBuy) {
    const quantity = buyQuantity;
    const notionalUsd = input.usdAmount ?? 0;
    const slippageUsd = 0;
    const totalCostUsd = notionalUsd + gasUsd + dexFeeUsd;
    return {
      side: "buy",
      token: input.token,
      quantity,
      priceUsd: quantity > 0 ? notionalUsd / quantity : 0,
      notionalUsd,
      gasUsd,
      slippageUsd,
      dexFeeUsd,
      totalCostUsd,
      sellProceedsUsd: 0,
      warnings,
      quoteSnapshot: snapshotBase
    };
  }

  const quantity = sellQuantity;
  const proceedsUsd = sellProceeds;
  const slippageUsd = 0;
  const totalFees = gasUsd + dexFeeUsd;
  return {
    side: "sell",
    token: input.token,
    quantity,
    priceUsd: quantity > 0 ? proceedsUsd / quantity : 0,
    notionalUsd: proceedsUsd,
    gasUsd,
    slippageUsd,
    dexFeeUsd,
    totalCostUsd: totalFees,
    sellProceedsUsd: Math.max(0, proceedsUsd - totalFees),
    warnings,
    quoteSnapshot: snapshotBase
  };
}

async function getReferenceTokenPriceUsd(token: Token, chainId: number) {
  const chainTokens = getChainTokens(chainId);
  const quote = await getBestSwapQuote({
    chainId,
    side: "buy",
    sellToken: chainTokens.usdc.address,
    buyToken: token.address,
    sellAmount: toBaseUnits(REFERENCE_SPOT_USD, chainTokens.usdc.decimals),
    slippageBps: 0
  });
  const tokensReceived = fromBaseUnits(quote.buyAmount, token.decimals);
  if (!(tokensReceived > 0)) {
    throw new Error("Could not derive a reference token price.");
  }
  return REFERENCE_SPOT_USD / tokensReceived;
}

function estimateImplicitSwapCostUsd(input: {
  side: TradeSide;
  spotTokenPriceUsd: number;
  quantity: number;
  notionalUsd: number;
}) {
  if (!(input.spotTokenPriceUsd > 0) || !(input.quantity > 0) || !(input.notionalUsd > 0)) return 0;

  if (input.side === "buy") {
    return Math.max(0, input.notionalUsd - input.quantity * input.spotTokenPriceUsd);
  }

  return Math.max(0, input.quantity * input.spotTokenPriceUsd - input.notionalUsd);
}

export async function fetchWalletTransfers(walletAddress: string): Promise<{
  transfers: Omit<WalletActivity, "id">[];
  warnings: string[];
}> {
  const address = normalizeAddress(walletAddress);
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    throw new Error("ALCHEMY_API_KEY is required to fetch wallet activity.");
  }

  const results = await Promise.allSettled(
    ALCHEMY_ACTIVITY_CHAINS.flatMap((chain) =>
      (["from", "to"] as const).map((direction) =>
        fetchAlchemyTransfers({
          apiKey: process.env[`${chain.envPrefix}_ALCHEMY_API_KEY`] || apiKey,
          address,
          direction,
          chain
        })
      )
    )
  );
  const batches: AlchemyTransfer[][] = [];
  const warnings = new Set<string>();

  for (const result of results) {
    if (result.status === "fulfilled") {
      batches.push(result.value);
    } else {
      warnings.add(result.reason instanceof Error ? result.reason.message : "A wallet activity fetch failed.");
    }
  }

  return {
    transfers: normalizeAlchemyTransfers(address, batches.flat()),
    warnings: Array.from(warnings)
  };
}

async function fetchAlchemyTransfers(input: {
  apiKey: string;
  address: string;
  direction: "from" | "to";
  chain: (typeof ALCHEMY_ACTIVITY_CHAINS)[number];
}): Promise<AlchemyTransfer[]> {
  const response = await fetch(`https://${input.chain.subdomain}.g.alchemy.com/v2/${input.apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [
        {
          fromBlock: "0x0",
          toBlock: "latest",
          ...(input.direction === "from" ? { fromAddress: input.address } : { toAddress: input.address }),
          category: ["erc20", "external", "internal"],
          withMetadata: true,
          excludeZeroValue: true,
          maxCount: "0x32",
          order: "desc"
        }
      ]
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`${input.chain.name} Alchemy transfer fetch failed with ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: {
      transfers?: AlchemyTransfer[];
    };
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? `${input.chain.name} Alchemy returned a transfer error.`);
  }

  return (payload.result?.transfers ?? []).map((transfer) => ({
    ...transfer,
    chainId: input.chain.id,
    chainName: input.chain.name
  }));
}

export function normalizeAlchemyTransfers(
  address: string,
  transfers: AlchemyTransfer[]
): Omit<WalletActivity, "id">[] {
  const normalizedAddress = normalizeAddress(address);
  const uniqueTransfers = new Map<string, AlchemyTransfer>();
  for (const transfer of transfers) {
    if (!transfer.hash) continue;
    uniqueTransfers.set(transferKey(transfer), transfer);
  }

  const byHash = new Map<string, number>();
  for (const transfer of uniqueTransfers.values()) {
    if (transfer.hash) byHash.set(transfer.hash, (byHash.get(transfer.hash) ?? 0) + 1);
  }

  return Array.from(uniqueTransfers.values())
    .filter((transfer) => transfer.hash)
    .map((transfer) => ({
      walletAddress: normalizedAddress,
      chainId: transfer.chainId ?? 1,
      chainName: transfer.chainName ?? "Ethereum",
      hash: transfer.hash ?? "",
      category: transfer.category ?? "unknown",
      asset: transfer.asset ?? "unknown",
      contractAddress: normalizeOptionalAddress(transfer.rawContract?.address),
      value: Number(transfer.value ?? 0),
      fromAddress: (transfer.from ?? "").toLowerCase(),
      toAddress: (transfer.to ?? "").toLowerCase(),
      blockNum: transfer.blockNum ?? "",
      timestamp: transfer.metadata?.blockTimestamp ?? new Date().toISOString(),
      isSwapLike: (byHash.get(transfer.hash ?? "") ?? 0) > 1,
      rawPayload: JSON.stringify(transfer)
    }));
}

function transferKey(transfer: AlchemyTransfer) {
  return [
    transfer.chainId ?? 1,
    transfer.hash ?? "",
    transfer.category ?? "",
    transfer.asset ?? "",
    transfer.rawContract?.address ?? "",
    transfer.value ?? "",
    (transfer.from ?? "").toLowerCase(),
    (transfer.to ?? "").toLowerCase()
  ].join("|");
}

function normalizeOptionalAddress(address?: string | null) {
  const value = (address ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}

async function getBestSwapQuote(input: {
  chainId: number;
  side: TradeSide;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  slippageBps: number;
}): Promise<SwapQuote> {
  let zeroxError: unknown = null;
  try {
    const quote = await getZeroxPrice(input);
    assertUsableZeroxQuote(quote, input.side);
    return quote;
  } catch (error) {
    zeroxError = error;
  }

  if (!process.env.UNISWAP_API_KEY) {
    throw zeroxError;
  }

  const quote = await getUniswapQuote(input);
  assertUsableUniswapQuote(quote);
  return {
    ...quote,
    warnings: [
      `0x quote unavailable; using Uniswap fallback. ${zeroxError instanceof Error ? zeroxError.message : ""}`.trim(),
      ...quote.warnings
    ]
  };
}

function getAlchemyApiKey(chainId: number) {
  if (chainId === 8453) return process.env.BASE_ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY;
  return process.env.ALCHEMY_API_KEY;
}

function hasCompleteTokenMetadata(
  metadata: { name?: string; symbol?: string; decimals?: number } | undefined
): metadata is { name?: string; symbol: string; decimals: number } {
  return Boolean(metadata?.symbol && Number.isFinite(metadata.decimals));
}

async function resolveTokenFromErc20Calls(tokenAddress: string, chainId: number, apiKey: string): Promise<Token | null> {
  const [symbol, decimals, name] = await Promise.all([
    callErc20String(tokenAddress, "0x95d89b41", chainId, apiKey),
    callErc20Decimals(tokenAddress, chainId, apiKey),
    callErc20String(tokenAddress, "0x06fdde03", chainId, apiKey)
  ]);

  if (!symbol || !Number.isFinite(decimals)) return null;

  return {
    address: tokenAddress,
    chainId,
    symbol,
    name: name || symbol,
    decimals,
    createdAt: new Date().toISOString()
  };
}

async function callErc20Decimals(tokenAddress: string, chainId: number, apiKey: string) {
  const result = await callErc20(tokenAddress, "0x313ce567", chainId, apiKey);
  if (!result) return NaN;
  const decimals = Number(BigInt(result));
  return Number.isFinite(decimals) ? decimals : NaN;
}

async function callErc20String(tokenAddress: string, data: string, chainId: number, apiKey: string) {
  const result = await callErc20(tokenAddress, data, chainId, apiKey);
  return result ? decodeAbiStringOrBytes32(result) : "";
}

async function callErc20(tokenAddress: string, data: string, chainId: number, apiKey: string) {
  const chainTokens = getChainTokens(chainId);
  const response = await fetch(`https://${chainTokens.alchemySubdomain}.g.alchemy.com/v2/${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: tokenAddress, data }, "latest"]
    }),
    cache: "no-store"
  });

  if (!response.ok) return "";
  const payload = (await response.json()) as { result?: string; error?: unknown };
  if (payload.error || !payload.result || payload.result === "0x") return "";
  return payload.result;
}

function decodeAbiStringOrBytes32(result: string) {
  const hex = result.startsWith("0x") ? result.slice(2) : result;
  if (!hex) return "";

  const dynamic = decodeDynamicAbiString(hex);
  if (dynamic) return dynamic;

  return hexToAscii(hex).replace(/\0+$/g, "").trim();
}

function decodeDynamicAbiString(hex: string) {
  if (hex.length < 128) return "";
  const offset = Number.parseInt(hex.slice(0, 64), 16);
  if (!Number.isFinite(offset) || offset < 32) return "";
  const lengthStart = offset * 2;
  const length = Number.parseInt(hex.slice(lengthStart, lengthStart + 64), 16);
  if (!Number.isFinite(length) || length <= 0) return "";
  return hexToAscii(hex.slice(lengthStart + 64, lengthStart + 64 + length * 2)).trim();
}

function hexToAscii(hex: string) {
  const bytes = hex.match(/.{1,2}/g) ?? [];
  return bytes.map((byte) => String.fromCharCode(Number.parseInt(byte, 16))).join("");
}

function withoutRawResponse<T extends { rawResponse: unknown }>(quote: T) {
  const { rawResponse: _rawResponse, ...normalizedQuote } = quote;
  return normalizedQuote;
}
