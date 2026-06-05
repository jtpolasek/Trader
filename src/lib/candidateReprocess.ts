import type { TradeCandidate } from "./types";

export type ReprocessCandidate = Pick<
  TradeCandidate,
  | "walletAddress"
  | "chainId"
  | "chainName"
  | "hash"
  | "status"
  | "confidence"
  | "side"
  | "tokenInAsset"
  | "tokenInAddress"
  | "tokenInAmount"
  | "tokenOutAsset"
  | "tokenOutAddress"
  | "tokenOutAmount"
  | "reason"
  | "transferCount"
  | "sourceTimestamp"
>;

export type ReprocessChangeKind = "status" | "side" | "copy-token-address" | "newly-derived" | "missing-derived";

export type ReprocessChange = {
  key: string;
  walletAddress: string;
  chainId: number;
  chainName: string;
  hash: string;
  kinds: ReprocessChangeKind[];
  storedStatus?: string;
  derivedStatus?: string;
  storedSide?: string;
  derivedSide?: string;
  storedCopyTokenAddress?: string;
  derivedCopyTokenAddress?: string;
  storedReason?: string;
  derivedReason?: string;
};

export type CandidateReprocessReport = {
  summary: {
    stored: number;
    derived: number;
    changed: number;
    statusChanges: number;
    sideChanges: number;
    copiedTokenAddressImprovements: number;
    newlyDerived: number;
    missingDerived: number;
  };
  changes: ReprocessChange[];
};

export function summarizeCandidateReprocess(
  storedCandidates: ReprocessCandidate[],
  derivedCandidates: ReprocessCandidate[]
): CandidateReprocessReport {
  const storedByKey = new Map(storedCandidates.map((candidate) => [candidateKey(candidate), candidate]));
  const derivedByKey = new Map(derivedCandidates.map((candidate) => [candidateKey(candidate), candidate]));
  const changes: ReprocessChange[] = [];
  let statusChanges = 0;
  let sideChanges = 0;
  let copiedTokenAddressImprovements = 0;
  let newlyDerived = 0;
  let missingDerived = 0;

  for (const [key, derived] of derivedByKey) {
    const stored = storedByKey.get(key);
    if (!stored) {
      newlyDerived += 1;
      changes.push(toChange(key, undefined, derived, ["newly-derived"]));
      continue;
    }

    const kinds: ReprocessChangeKind[] = [];
    if (parserStatus(stored.status) !== derived.status) {
      statusChanges += 1;
      kinds.push("status");
    }
    if (stored.side !== derived.side) {
      sideChanges += 1;
      kinds.push("side");
    }
    if (!copyTokenAddress(stored) && copyTokenAddress(derived)) {
      copiedTokenAddressImprovements += 1;
      kinds.push("copy-token-address");
    }
    if (kinds.length) changes.push(toChange(key, stored, derived, kinds));
  }

  for (const [key, stored] of storedByKey) {
    if (derivedByKey.has(key)) continue;
    missingDerived += 1;
    changes.push(toChange(key, stored, undefined, ["missing-derived"]));
  }

  return {
    summary: {
      stored: storedCandidates.length,
      derived: derivedCandidates.length,
      changed: changes.length,
      statusChanges,
      sideChanges,
      copiedTokenAddressImprovements,
      newlyDerived,
      missingDerived
    },
    changes: changes.sort((a, b) => a.key.localeCompare(b.key))
  };
}

export function candidateKey(candidate: Pick<ReprocessCandidate, "walletAddress" | "chainId" | "hash">) {
  return `${candidate.walletAddress.toLowerCase()}|${candidate.chainId}|${candidate.hash.toLowerCase()}`;
}

function toChange(
  key: string,
  stored: ReprocessCandidate | undefined,
  derived: ReprocessCandidate | undefined,
  kinds: ReprocessChangeKind[]
): ReprocessChange {
  const candidate = derived ?? stored;
  if (!candidate) throw new Error("A reprocess change needs a stored or derived candidate.");

  return {
    key,
    walletAddress: candidate.walletAddress,
    chainId: candidate.chainId,
    chainName: candidate.chainName,
    hash: candidate.hash,
    kinds,
    storedStatus: stored?.status,
    derivedStatus: derived?.status,
    storedSide: stored?.side,
    derivedSide: derived?.side,
    storedCopyTokenAddress: stored ? copyTokenAddress(stored) : undefined,
    derivedCopyTokenAddress: derived ? copyTokenAddress(derived) : undefined,
    storedReason: stored?.reason,
    derivedReason: derived?.reason
  };
}

function copyTokenAddress(candidate: Pick<ReprocessCandidate, "side" | "tokenInAddress" | "tokenOutAddress">) {
  if (candidate.side === "buy") return candidate.tokenOutAddress;
  if (candidate.side === "sell") return candidate.tokenInAddress;
  return "";
}

function parserStatus(status: string) {
  if (status === "copied" || status === "partial") return "decoded";
  if (status === "failed") return "candidate";
  return status;
}
