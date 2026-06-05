import type { CopySettings, Position, TradeCandidate } from "./types";

const CASH_ASSETS = new Set(["USDC", "USDT", "DAI"]);
const NATIVE_ASSETS = new Set(["ETH", "WETH"]);

export type CopyFailureBucket =
  | "already-copied"
  | "blocked-token"
  | "insufficient-cash"
  | "missing-position"
  | "missing-token-address"
  | "no-liquidity"
  | "token-metadata"
  | "unsupported-pattern"
  | "unknown";

export function copyTokenAddress(candidate: TradeCandidate) {
  if (candidate.side === "buy") return candidate.tokenOutAddress;
  if (candidate.side === "sell") return candidate.tokenInAddress;
  return "";
}

export function assertTokenAllowed(candidate: TradeCandidate, settings: CopySettings) {
  const tokenAddress = copyTokenAddress(candidate).toLowerCase();
  if (!tokenAddress) {
    throw new Error("This candidate has no token contract address to copy.");
  }
  if (settings.allowlist.length && !settings.allowlist.includes(tokenAddress)) {
    throw new Error("This token is not on the copy allowlist.");
  }
  if (settings.blocklist.includes(tokenAddress)) {
    throw new Error("This token is on the copy blocklist.");
  }
}

export function estimateSourceNotionalUsd(candidate: TradeCandidate, nativeUsd: number) {
  const inputAsset = normalizeAsset(candidate.tokenInAsset);
  const outputAsset = normalizeAsset(candidate.tokenOutAsset);

  if (candidate.side === "buy") {
    if (CASH_ASSETS.has(inputAsset)) return candidate.tokenInAmount;
    if (NATIVE_ASSETS.has(inputAsset)) return candidate.tokenInAmount * nativeUsd;
  }

  if (candidate.side === "sell") {
    if (CASH_ASSETS.has(outputAsset)) return candidate.tokenOutAmount;
    if (NATIVE_ASSETS.has(outputAsset)) return candidate.tokenOutAmount * nativeUsd;
  }

  return 0;
}

export function sizeCopyTrade(input: {
  candidate: TradeCandidate;
  settings: CopySettings;
  nativeUsd: number;
  position: Position | null;
}) {
  const { candidate, settings, nativeUsd, position } = input;
  if (candidate.side !== "buy" && candidate.side !== "sell") {
    throw new Error("Only buy or sell candidates can be copied.");
  }

  assertTokenAllowed(candidate, settings);
  const sourceNotionalUsd = estimateSourceNotionalUsd(candidate, nativeUsd);
  const desiredUsd =
    settings.mode === "fixedUsd" ? settings.fixedUsd : sourceNotionalUsd * (settings.percentOfSource / 100);
  const cappedUsd = Math.min(desiredUsd, settings.maxTradeUsd);

  if (!Number.isFinite(cappedUsd) || cappedUsd <= 0) {
    throw new Error("Could not determine a positive copy size for this candidate.");
  }

  if (candidate.side === "buy") {
    return {
      side: "buy" as const,
      tokenAddress: candidate.tokenOutAddress,
      usdAmount: cappedUsd,
      sourceNotionalUsd
    };
  }

  if (!position || position.quantity <= 0) {
    throw new Error("This sell candidate cannot be copied because the paper portfolio has no matching position.");
  }

  const sourceQuantity = candidate.tokenInAmount;
  const desiredQuantity =
    settings.mode === "fixedUsd"
      ? cappedUsd / Math.max(position.averageEntryUsd, 0.0000000001)
      : sourceQuantity * (settings.percentOfSource / 100);
  const maxQuantityByCap = settings.maxTradeUsd / Math.max(position.averageEntryUsd, 0.0000000001);
  const tokenQuantity = Math.min(desiredQuantity, maxQuantityByCap, position.quantity);

  if (!Number.isFinite(tokenQuantity) || tokenQuantity <= 0) {
    throw new Error("Could not determine a positive sell quantity for this candidate.");
  }

  return {
    side: "sell" as const,
    tokenAddress: candidate.tokenInAddress,
    tokenQuantity,
    sourceNotionalUsd
  };
}

export function calculateCashCappedBuyUsd(input: {
  cashUsd: number;
  requestedUsd: number;
  gasUsd: number;
  dexFeeUsd: number;
  slippageBps: number;
  safetyBufferBps?: number;
}) {
  const safetyBufferBps = input.safetyBufferBps ?? 25;
  const fixedFeesUsd = Math.max(0, input.gasUsd) + Math.max(0, input.dexFeeUsd);
  const spendableBeforeSlippage = input.cashUsd - fixedFeesUsd;
  if (!Number.isFinite(spendableBeforeSlippage) || spendableBeforeSlippage <= 0) return 0;

  const slippageMultiplier = 1 + Math.max(0, input.slippageBps) / 10_000;
  const bufferedUsd = (spendableBeforeSlippage / slippageMultiplier) * (1 - safetyBufferBps / 10_000);
  if (!Number.isFinite(bufferedUsd) || bufferedUsd <= 0) return 0;
  return Math.min(input.requestedUsd, bufferedUsd);
}

export function describeCopyError(error: unknown) {
  return classifyCopyError(error).reason;
}

export function classifyCopyError(error: unknown): { bucket: CopyFailureBucket; reason: string } {
  const message = error instanceof Error ? error.message : "Could not copy candidate.";
  const lower = message.toLowerCase();

  if (lower.includes("already been copied")) {
    return { bucket: "already-copied", reason: "This candidate has already been copied." };
  }
  if (lower.includes("no token contract address")) {
    return { bucket: "missing-token-address", reason: "This candidate has no token contract address to copy." };
  }
  if (lower.includes("allowlist") || lower.includes("blocklist")) {
    return { bucket: "blocked-token", reason: message };
  }
  if (lower.includes("liquidity") || lower.includes("route")) {
    return { bucket: "no-liquidity", reason: "No usable 0x liquidity or route was found for this copied trade size." };
  }
  if (lower.includes("token metadata")) {
    return { bucket: "token-metadata", reason: "Token metadata could not be resolved for this candidate." };
  }
  if (lower.includes("paper cash") || lower.includes("insufficient cash")) {
    return { bucket: "insufficient-cash", reason: message };
  }
  if (lower.includes("no matching position")) {
    return {
      bucket: "missing-position",
      reason: "This sell candidate cannot be copied because the paper portfolio has no matching position."
    };
  }
  if (lower.includes("only buy or sell") || lower.includes("positive copy size") || lower.includes("positive sell quantity")) {
    return { bucket: "unsupported-pattern", reason: message };
  }

  return { bucket: "unknown", reason: message };
}

function normalizeAsset(asset: string) {
  return asset.trim().toUpperCase();
}
