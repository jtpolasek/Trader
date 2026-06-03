import { TOKENS } from "./constants";
import { fromBaseUnits, normalizeAddress, toBaseUnits } from "./money";
import type { QuotePreview, Token, TradeSide, WalletActivity } from "./types";
import { assertUsableZeroxQuote, getZeroxPrice } from "./zerox";

export async function resolveTokenFromAlchemy(address: string): Promise<Token> {
  const tokenAddress = normalizeAddress(address);
  const cachedUsdc = tokenAddress === TOKENS.USDC.address.toLowerCase();
  const cachedWeth = tokenAddress === TOKENS.WETH.address.toLowerCase();
  if (cachedUsdc || cachedWeth) {
    const token = cachedUsdc ? TOKENS.USDC : TOKENS.WETH;
    return {
      address: token.address.toLowerCase(),
      symbol: token.symbol,
      name: token.symbol,
      decimals: token.decimals,
      createdAt: new Date().toISOString()
    };
  }

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    throw new Error("ALCHEMY_API_KEY is required to resolve token metadata.");
  }

  const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`, {
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
  if (!payload.result?.decimals || !payload.result.symbol) {
    throw new Error("Token metadata is incomplete or unavailable.");
  }

  return {
    address: tokenAddress,
    symbol: payload.result.symbol,
    name: payload.result.name || payload.result.symbol,
    decimals: payload.result.decimals,
    createdAt: new Date().toISOString()
  };
}

export async function getEthUsdPrice() {
  const quote = await getZeroxPrice({
    sellToken: TOKENS.WETH.address,
    buyToken: TOKENS.USDC.address,
    sellAmount: toBaseUnits(1, TOKENS.WETH.decimals)
  });
  const buyAmount = Number(quote.buyAmount);
  if (!buyAmount) {
    throw new Error("Could not calculate ETH/USD from 0x.");
  }
  return fromBaseUnits(quote.buyAmount, TOKENS.USDC.decimals);
}

export async function buildQuotePreview(input: {
  side: TradeSide;
  token: Token;
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

  const quote =
    input.side === "buy"
      ? await getZeroxPrice({
          sellToken: TOKENS.USDC.address,
          buyToken: input.token.address,
          sellAmount: toBaseUnits(input.usdAmount ?? 0, TOKENS.USDC.decimals)
        })
      : await getZeroxPrice({
          sellToken: input.token.address,
          buyToken: TOKENS.USDC.address,
          sellAmount: toBaseUnits(input.tokenQuantity ?? 0, input.token.decimals)
        });

  assertUsableZeroxQuote(quote, input.side);

  const ethUsd = await getEthUsdPrice();
  const gasEth = (quote.gasUnits * quote.gasPriceWei) / 1e18;
  const gasUsd = gasEth * ethUsd * (1 + input.gasBufferBps / 10_000);
  const dexFeeUsd = quote.dexFeeUsd;
  const warnings = [...quote.warnings];

  if (input.side === "buy") {
    const quantity = fromBaseUnits(quote.buyAmount, input.token.decimals);
    const notionalUsd = input.usdAmount ?? 0;
    const slippageUsd = notionalUsd * (input.slippageBps / 10_000);
    const totalCostUsd = notionalUsd + gasUsd + slippageUsd + dexFeeUsd;
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
      quoteSnapshot: {
        provider: "0x",
        ethUsd,
        normalizedQuote: withoutRawResponse(quote),
        rawQuote: quote.rawResponse
      }
    };
  }

  const quantity = input.tokenQuantity ?? 0;
  const proceedsUsd = fromBaseUnits(quote.buyAmount, TOKENS.USDC.decimals);
  const slippageUsd = proceedsUsd * (input.slippageBps / 10_000);
  const totalFees = gasUsd + slippageUsd + dexFeeUsd;
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
    quoteSnapshot: {
      provider: "0x",
      ethUsd,
      normalizedQuote: withoutRawResponse(quote),
      rawQuote: quote.rawResponse
    }
  };
}

export async function fetchWalletTransfers(walletAddress: string): Promise<Omit<WalletActivity, "id">[]> {
  const address = normalizeAddress(walletAddress);
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    throw new Error("ALCHEMY_API_KEY is required to fetch wallet activity.");
  }

  const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`, {
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
          fromAddress: address,
          category: ["erc20", "external"],
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
    throw new Error(`Alchemy transfer fetch failed with ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: {
      transfers?: Array<{
        hash?: string;
        category?: string;
        asset?: string;
        value?: number;
        from?: string;
        to?: string;
        blockNum?: string;
        metadata?: { blockTimestamp?: string };
      }>;
    };
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "Alchemy returned a transfer error.");
  }

  const transfers = payload.result?.transfers ?? [];
  const byHash = new Map<string, number>();
  for (const transfer of transfers) {
    if (transfer.hash) byHash.set(transfer.hash, (byHash.get(transfer.hash) ?? 0) + 1);
  }

  return transfers
    .filter((transfer) => transfer.hash)
    .map((transfer) => ({
      walletAddress: address,
      hash: transfer.hash ?? "",
      category: transfer.category ?? "unknown",
      asset: transfer.asset ?? "unknown",
      value: Number(transfer.value ?? 0),
      fromAddress: (transfer.from ?? "").toLowerCase(),
      toAddress: (transfer.to ?? "").toLowerCase(),
      blockNum: transfer.blockNum ?? "",
      timestamp: transfer.metadata?.blockTimestamp ?? new Date().toISOString(),
      isSwapLike: (byHash.get(transfer.hash ?? "") ?? 0) > 1
    }));
}

function withoutRawResponse<T extends { rawResponse: unknown }>(quote: T) {
  const { rawResponse: _rawResponse, ...normalizedQuote } = quote;
  return normalizedQuote;
}
