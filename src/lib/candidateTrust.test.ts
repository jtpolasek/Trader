import { describe, expect, it } from "vitest";
import { candidateCopyTokenAddress, classifyCandidateTrust } from "./candidateTrust";
import type { TradeCandidate } from "./types";

function candidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    id: "candidate",
    walletAddress: "0xwallet",
    chainId: 8453,
    chainName: "Base",
    hash: "0xhash",
    status: "decoded",
    confidence: 0.9,
    side: "buy",
    tokenInAsset: "ETH",
    tokenInAddress: "",
    tokenInAmount: 0.1,
    tokenOutAsset: "PEPE",
    tokenOutAddress: "0x0000000000000000000000000000000000001000",
    tokenOutAmount: 1000,
    reason: "Paired wallet transfers indicate a likely buy using ETH for PEPE.",
    transferCount: 2,
    sourceTimestamp: "2026-06-04T00:00:00.000Z",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

describe("candidateCopyTokenAddress", () => {
  it("returns the bought token for buys and sold token for sells", () => {
    expect(candidateCopyTokenAddress(candidate({ side: "buy" }))).toBe("0x0000000000000000000000000000000000001000");
    expect(
      candidateCopyTokenAddress(
        candidate({
          side: "sell",
          tokenInAddress: "0x0000000000000000000000000000000000002000",
          tokenOutAddress: ""
        })
      )
    ).toBe("0x0000000000000000000000000000000000002000");
  });
});

describe("classifyCandidateTrust", () => {
  it("marks decoded candidates as ready", () => {
    expect(classifyCandidateTrust(candidate())).toMatchObject({ label: "Ready", tone: "good", copyable: true });
  });

  it("marks missing-token candidates as blocked by address", () => {
    expect(classifyCandidateTrust(candidate({ status: "candidate", tokenOutAddress: "" }))).toMatchObject({
      label: "No address",
      tone: "bad",
      copyable: false
    });
  });

  it("marks mixed-shape candidates as review-only", () => {
    expect(
      classifyCandidateTrust(
        candidate({
          side: "unknown",
          reason: "Transfers include plausible buy and sell shapes in the same transaction."
        })
      )
    ).toMatchObject({ label: "Mixed shape", tone: "warn", copyable: false });
  });

  it("marks multiple-token candidates as review-only", () => {
    expect(
      classifyCandidateTrust(
        candidate({
          status: "candidate",
          confidence: 0.52,
          reason: "Multiple possible received tokens were found; selected the likely buy."
        })
      )
    ).toMatchObject({ label: "Multiple tokens", tone: "warn", copyable: false });
  });

  it("surfaces failed route attempts while allowing retry when the shape is still copyable", () => {
    expect(
      classifyCandidateTrust(
        candidate({
          lastCopyStatus: "failed",
          lastCopyBucket: "no-liquidity",
          lastCopyReason: "No usable 0x liquidity or route was found."
        })
      )
    ).toMatchObject({ label: "No route", tone: "bad", copyable: true });
  });
});
