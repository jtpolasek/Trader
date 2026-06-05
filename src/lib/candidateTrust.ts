import type { TradeCandidate } from "./types";

export type CandidateTrustTone = "good" | "warn" | "bad";

export type CandidateTrust = {
  label: string;
  tone: CandidateTrustTone;
  title: string;
  copyable: boolean;
};

export function candidateCopyTokenAddress(candidate: TradeCandidate) {
  if (candidate.side === "buy") return candidate.tokenOutAddress;
  if (candidate.side === "sell") return candidate.tokenInAddress;
  return candidate.tokenOutAddress || candidate.tokenInAddress;
}

export function classifyCandidateTrust(candidate: TradeCandidate): CandidateTrust {
  const tokenAddress = candidateCopyTokenAddress(candidate);
  const reason = candidate.reason.toLowerCase();
  const lastFailure = candidate.lastCopyStatus === "failed";

  if (candidate.status === "copied" || candidate.lastCopyStatus === "copied") {
    return {
      label: "Copied",
      tone: "good",
      title: "This candidate has already been copied into the paper portfolio.",
      copyable: false
    };
  }

  if (lastFailure && candidate.lastCopyBucket === "no-liquidity") {
    return {
      label: "No route",
      tone: "bad",
      title: candidate.lastCopyReason || "The last copy attempt could not find usable liquidity or a route.",
      copyable: hasCopyShape(candidate)
    };
  }

  if (candidate.status === "failed" || lastFailure) {
    return {
      label: "Failed",
      tone: "bad",
      title: candidate.lastCopyReason || candidate.reason || "The last copy attempt failed.",
      copyable: hasCopyShape(candidate)
    };
  }

  if (!tokenAddress) {
    return {
      label: "No address",
      tone: "bad",
      title: "The likely copied token has no contract address, so it cannot be safely copied.",
      copyable: false
    };
  }

  if (candidate.side === "unknown" || reason.includes("plausible buy and sell shapes")) {
    return {
      label: "Mixed shape",
      tone: "warn",
      title: "Transfers include conflicting buy/sell signals. Review the transaction before deciding what it means.",
      copyable: false
    };
  }

  if (reason.includes("multiple possible received tokens") || reason.includes("multiple possible sent tokens")) {
    return {
      label: "Multiple tokens",
      tone: "warn",
      title: "More than one token could be the copied asset. Review the transaction before copying.",
      copyable: false
    };
  }

  if (candidate.status === "decoded") {
    return {
      label: "Ready",
      tone: "good",
      title: "Parser confidence is high enough for a manual copy action.",
      copyable: true
    };
  }

  return {
    label: "Review",
    tone: "warn",
    title: candidate.reason || "Review this candidate before copying.",
    copyable: hasCopyShape(candidate)
  };
}

function hasCopyShape(candidate: TradeCandidate) {
  return (
    (candidate.status === "decoded" || candidate.status === "candidate" || candidate.status === "partial") &&
    (candidate.side === "buy" || candidate.side === "sell") &&
    Boolean(candidateCopyTokenAddress(candidate))
  );
}
