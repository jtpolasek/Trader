import type { TradeCandidate, TradeSide, WalletActivity } from "./types";

const STABLE_OR_NATIVE_ASSETS = new Set(["ETH", "WETH", "USDC", "USDT", "DAI"]);

type CandidateDraft = Omit<TradeCandidate, "id" | "createdAt" | "updatedAt">;

export function deriveTradeCandidates(activity: WalletActivity[]): CandidateDraft[] {
  const groups = new Map<string, WalletActivity[]>();
  for (const item of activity) {
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
  const tokenIn = largestTransfer(outbound);
  const tokenOut = largestTransfer(inbound);
  const hasBothDirections = Boolean(tokenIn && tokenOut);
  const isAmbiguous = inbound.length > 1 || outbound.length > 1;
  const side = inferSide(tokenIn?.asset, tokenOut?.asset);
  const tokenToCopy = side === "buy" ? tokenOut : side === "sell" ? tokenIn : null;
  const missingCopyTokenAddress = Boolean(tokenToCopy && !tokenToCopy.contractAddress);
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
      hasMissingTokenDetails(tokenIn) || hasMissingTokenDetails(tokenOut)
        ? "Alchemy returned a paired transfer with missing token symbol, amount, or contract address. Review on the block explorer before copying."
        : "Transfers are paired, but the buy/sell side could not be inferred from common cash/native assets.";

    return {
      walletAddress: first.walletAddress,
      chainId: first.chainId,
      chainName: first.chainName,
      hash: first.hash,
      status: "candidate",
      confidence: isAmbiguous ? 0.45 : 0.6,
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
    confidence: missingCopyTokenAddress ? 0.58 : isAmbiguous ? 0.72 : 0.9,
    side,
    tokenInAsset: tokenIn.asset,
    tokenInAddress: tokenIn.contractAddress,
    tokenInAmount: tokenIn.value,
    tokenOutAsset: tokenOut.asset,
    tokenOutAddress: tokenOut.contractAddress,
    tokenOutAmount: tokenOut.value,
    reason: missingCopyTokenAddress
      ? "The likely traded token has no contract address in the transfer payload; review before copying."
      : isAmbiguous
      ? "Multiple inbound or outbound transfers were found; review before copying."
      : "Paired wallet transfers indicate a likely swap.",
    transferCount: items.length,
    sourceTimestamp
  };
}

function largestTransfer(items: WalletActivity[]) {
  return [...items].sort((a, b) => b.value - a.value)[0] ?? null;
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

function hasMissingTokenDetails(item: WalletActivity | null) {
  if (!item) return true;
  if (item.category === "external") return false;
  return !item.asset || !item.value || !item.contractAddress;
}

function newestTimestamp(items: WalletActivity[]) {
  const timestamps = items
    .map((item) => item.timestamp)
    .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return timestamps[0] ?? new Date().toISOString();
}
