import type { TradeCandidate, TradeSide, WalletActivity } from "./types";

const STABLE_OR_NATIVE_ASSETS = new Set(["ETH", "WETH", "USDC", "USDT", "DAI"]);

type CandidateDraft = Omit<TradeCandidate, "id" | "createdAt" | "updatedAt">;
type TransferPair = {
  tokenIn: WalletActivity;
  tokenOut: WalletActivity;
  side: TradeSide | "unknown";
  score: number;
};
type PairAnalysis = {
  viablePairs: TransferPair[];
  sideCount: number;
  buyCopyTokenCount: number;
  sellCopyTokenCount: number;
};

export function deriveTradeCandidates(activity: WalletActivity[]): CandidateDraft[] {
  const groups = new Map<string, WalletActivity[]>();
  for (const item of activity.map(hydrateActivityFromRawPayload)) {
    const key = `${item.chainId}|${item.hash}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return Array.from(groups.values())
    .map(toCandidate)
    .filter((candidate) => candidate.transferCount > 1 || candidate.status === "skipped")
    .sort((a, b) => Date.parse(b.sourceTimestamp) - Date.parse(a.sourceTimestamp));
}

function toCandidate(items: WalletActivity[]): CandidateDraft {
  const first = items[0];
  const wallet = first.walletAddress.toLowerCase();
  const inbound = items.filter((item) => item.toAddress.toLowerCase() === wallet && item.fromAddress.toLowerCase() !== wallet);
  const outbound = items.filter(
    (item) => item.fromAddress.toLowerCase() === wallet && item.toAddress.toLowerCase() !== wallet
  );
  const pairAnalysis = analyzePairs(outbound, inbound);
  const hasMixedSideShapes = pairAnalysis.sideCount > 1;
  const selectedPair = hasMixedSideShapes
    ? selectBestPairForSide(pairAnalysis.viablePairs, "buy") ?? pairAnalysis.viablePairs[0] ?? null
    : pairAnalysis.viablePairs[0] ?? null;
  const tokenIn = selectedPair?.tokenIn ?? largestTransfer(outbound);
  const tokenOut = selectedPair?.tokenOut ?? largestTransfer(inbound);
  const hasBothDirections = Boolean(tokenIn && tokenOut);
  const viablePairCount = pairAnalysis.viablePairs.length;
  const selectedSide = selectedPair?.side ?? inferSide(tokenIn?.asset, tokenOut?.asset);
  const side = hasMixedSideShapes ? "unknown" : selectedSide;
  const tokenToCopy = side === "buy" ? tokenOut : side === "sell" ? tokenIn : null;
  const missingCopyTokenAddress = Boolean(tokenToCopy && !tokenToCopy.contractAddress);
  const hasMultipleCopyTokens =
    selectedSide === "buy"
      ? pairAnalysis.buyCopyTokenCount > 1
      : selectedSide === "sell"
      ? pairAnalysis.sellCopyTokenCount > 1
      : false;
  const isAmbiguous = inbound.length > 1 || outbound.length > 1 || viablePairCount > 1;
  const sourceTimestamp = newestTimestamp(items);

  if (!hasBothDirections) {
    return {
      walletAddress: first.walletAddress,
      chainId: first.chainId,
      chainName: first.chainName,
      hash: first.hash,
      status: "skipped",
      confidence: 0,
      side: "unknown",
      tokenInAsset: tokenIn?.asset ?? "",
      tokenInAddress: tokenIn?.contractAddress ?? "",
      tokenInAmount: tokenIn?.value ?? 0,
      tokenOutAsset: tokenOut?.asset ?? "",
      tokenOutAddress: tokenOut?.contractAddress ?? "",
      tokenOutAmount: tokenOut?.value ?? 0,
      reason: "No paired inbound and outbound wallet transfers were found for this transaction.",
      transferCount: items.length,
      sourceTimestamp
    };
  }

  if (side === "unknown") {
    const reason =
      hasMixedSideShapes
        ? "Transfers include plausible buy and sell shapes in the same transaction. Review on the block explorer before copying."
        : hasMissingTokenDetails(tokenIn) || hasMissingTokenDetails(tokenOut)
        ? "Alchemy returned a paired transfer with missing token symbol, amount, or contract address. Review on the block explorer before copying."
        : "Transfers are paired, but the buy/sell side could not be inferred from common cash/native assets.";

    return {
      walletAddress: first.walletAddress,
      chainId: first.chainId,
      chainName: first.chainName,
      hash: first.hash,
      status: "candidate",
      confidence: hasMixedSideShapes ? 0.4 : isAmbiguous ? 0.45 : 0.6,
      side,
      tokenInAsset: tokenIn.asset,
      tokenInAddress: tokenIn.contractAddress,
      tokenInAmount: tokenIn.value,
      tokenOutAsset: tokenOut.asset,
      tokenOutAddress: tokenOut.contractAddress,
      tokenOutAmount: tokenOut.value,
      reason,
      transferCount: items.length,
      sourceTimestamp
    };
  }

  return {
    walletAddress: first.walletAddress,
    chainId: first.chainId,
    chainName: first.chainName,
    hash: first.hash,
    status: isAmbiguous || missingCopyTokenAddress ? "candidate" : "decoded",
    confidence: missingCopyTokenAddress ? 0.58 : hasMultipleCopyTokens ? 0.52 : isAmbiguous ? 0.72 : 0.9,
    side,
    tokenInAsset: tokenIn.asset,
    tokenInAddress: tokenIn.contractAddress,
    tokenInAmount: tokenIn.value,
    tokenOutAsset: tokenOut.asset,
    tokenOutAddress: tokenOut.contractAddress,
    tokenOutAmount: tokenOut.value,
    reason: missingCopyTokenAddress
      ? "The likely traded token has no contract address in the transfer payload; review before copying."
      : hasMultipleCopyTokens
      ? describeMultipleCopyTokens(selectedSide, tokenIn.asset, tokenOut.asset)
      : isAmbiguous
      ? describeAmbiguousPair(side, tokenIn.asset, tokenOut.asset)
      : describeDecodedPair(side, tokenIn.asset, tokenOut.asset),
    transferCount: items.length,
    sourceTimestamp
  };
}

function largestTransfer(items: WalletActivity[]) {
  return [...items].sort((a, b) => b.value - a.value)[0] ?? null;
}

function analyzePairs(outbound: WalletActivity[], inbound: WalletActivity[]): PairAnalysis {
  const pairs = outbound.flatMap((tokenIn) =>
    inbound.map((tokenOut) => {
      const side = inferSide(tokenIn.asset, tokenOut.asset);
      return {
        tokenIn,
        tokenOut,
        side,
        score: scorePair(tokenIn, tokenOut, side)
      };
    })
  );
  const viable = pairs.filter((pair) => pair.score > 0).sort((a, b) => b.score - a.score);
  return {
    viablePairs: viable,
    sideCount: new Set(viable.map((pair) => pair.side)).size,
    buyCopyTokenCount: countDistinctCopyTokens(viable, "buy"),
    sellCopyTokenCount: countDistinctCopyTokens(viable, "sell")
  };
}

function selectBestPairForSide(pairs: TransferPair[], side: TradeSide) {
  return pairs.find((pair) => pair.side === side) ?? null;
}

function countDistinctCopyTokens(pairs: TransferPair[], side: TradeSide) {
  return new Set(
    pairs
      .filter((pair) => pair.side === side)
      .map((pair) => (side === "buy" ? pair.tokenOut : pair.tokenIn))
      .map((item) => item.contractAddress || normalizeAsset(item.asset))
      .filter(Boolean)
  ).size;
}

function scorePair(tokenIn: WalletActivity, tokenOut: WalletActivity, side: TradeSide | "unknown") {
  if (side === "unknown") return 0;

  const copyToken = side === "buy" ? tokenOut : tokenIn;
  const cashToken = side === "buy" ? tokenIn : tokenOut;
  let score = 100;

  if (copyToken.contractAddress) score += 20;
  if (!hasMissingTokenDetails(copyToken)) score += 10;
  if (isStableAsset(cashToken.asset)) score += 8;
  if (isNativeAsset(cashToken.asset)) score += 6;
  if (tokenIn.isSwapLike || tokenOut.isSwapLike) score += 4;

  return score;
}

function inferSide(tokenIn?: string, tokenOut?: string): TradeSide | "unknown" {
  const input = normalizeAsset(tokenIn);
  const output = normalizeAsset(tokenOut);

  if (isCashLike(input) && output && !isCashLike(output)) return "buy";
  if (input && !isCashLike(input) && isCashLike(output)) return "sell";
  return "unknown";
}

function isCashLike(asset: string) {
  return STABLE_OR_NATIVE_ASSETS.has(asset);
}

function normalizeAsset(asset?: string) {
  return (asset ?? "").trim().toUpperCase();
}

function isStableAsset(asset?: string) {
  return ["USDC", "USDT", "DAI"].includes(normalizeAsset(asset));
}

function isNativeAsset(asset?: string) {
  return ["ETH", "WETH"].includes(normalizeAsset(asset));
}

function hasMissingTokenDetails(item: WalletActivity | null) {
  if (!item) return true;
  if (item.category === "external" || item.category === "internal") return false;
  return !item.asset || !item.value || !item.contractAddress;
}

function newestTimestamp(items: WalletActivity[]) {
  const timestamps = items
    .map((item) => item.timestamp)
    .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return timestamps[0] ?? new Date().toISOString();
}

function describeDecodedPair(side: TradeSide, tokenInAsset: string, tokenOutAsset: string) {
  if (side === "buy") {
    return `Paired wallet transfers indicate a likely buy using ${tokenInAsset || "cash/native asset"} for ${
      tokenOutAsset || "the received token"
    }.`;
  }
  return `Paired wallet transfers indicate a likely sell of ${tokenInAsset || "the sent token"} into ${
    tokenOutAsset || "cash/native asset"
  }.`;
}

function describeAmbiguousPair(side: TradeSide, tokenInAsset: string, tokenOutAsset: string) {
  if (side === "buy") {
    return `Multiple inbound or outbound transfers were found; selected the likely buy using ${
      tokenInAsset || "cash/native asset"
    } for ${tokenOutAsset || "the received token"}. Review before copying.`;
  }
  return `Multiple inbound or outbound transfers were found; selected the likely sell of ${
    tokenInAsset || "the sent token"
  } into ${tokenOutAsset || "cash/native asset"}. Review before copying.`;
}

function describeMultipleCopyTokens(side: TradeSide | "unknown", tokenInAsset: string, tokenOutAsset: string) {
  if (side === "buy") {
    return `Multiple possible received tokens were found; selected the likely buy using ${
      tokenInAsset || "cash/native asset"
    } for ${tokenOutAsset || "the received token"}. Review before copying.`;
  }
  return `Multiple possible sent tokens were found; selected the likely sell of ${
    tokenInAsset || "the sent token"
  } into ${tokenOutAsset || "cash/native asset"}. Review before copying.`;
}

function hydrateActivityFromRawPayload(item: WalletActivity): WalletActivity {
  const raw = parseRawAlchemyTransfer(item.rawPayload);
  if (!raw) return item;

  const rawAsset = typeof raw.asset === "string" ? raw.asset.trim() : "";
  const rawValue = typeof raw.value === "number" ? raw.value : Number(raw.value);
  const rawContract =
    raw.rawContract && typeof raw.rawContract === "object" && !Array.isArray(raw.rawContract)
      ? (raw.rawContract as Record<string, unknown>)
      : null;
  const rawAddress = normalizeOptionalAddress(
    typeof rawContract?.address === "string" ? rawContract.address : undefined
  );
  const rawTimestamp =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>).blockTimestamp
      : "";
  const rawCategory = typeof raw.category === "string" ? raw.category.trim() : "";
  const rawFrom = normalizeOptionalAddress(typeof raw.from === "string" ? raw.from : undefined);
  const rawTo = normalizeOptionalAddress(typeof raw.to === "string" ? raw.to : undefined);
  const rawBlockNum = typeof raw.blockNum === "string" ? raw.blockNum.trim() : "";

  return {
    ...item,
    category: item.category || rawCategory,
    asset: isMissingAsset(item.asset) && rawAsset ? rawAsset : item.asset,
    contractAddress: item.contractAddress || rawAddress,
    value: item.value || (Number.isFinite(rawValue) ? rawValue : item.value),
    fromAddress: item.fromAddress || rawFrom,
    toAddress: item.toAddress || rawTo,
    blockNum: item.blockNum || rawBlockNum,
    timestamp:
      Number.isFinite(Date.parse(item.timestamp)) || typeof rawTimestamp !== "string" || !rawTimestamp
        ? item.timestamp
        : rawTimestamp
  };
}

function parseRawAlchemyTransfer(rawPayload: string): Record<string, unknown> | null {
  if (!rawPayload) return null;
  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isMissingAsset(asset: string) {
  const normalized = normalizeAsset(asset);
  return !normalized || normalized === "UNKNOWN";
}

function normalizeOptionalAddress(address?: string) {
  const value = (address ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}
