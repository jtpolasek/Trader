import { describe, expect, it } from "vitest";
import { summarizeCandidateReprocess } from "./candidateReprocess";
import type { TradeCandidate } from "./types";

function candidate(overrides: Partial<TradeCandidate>): TradeCandidate {
  return {
    id: crypto.randomUUID(),
    walletAddress: "0x6332685fb57d440b9812cc5f625376f8bee6eba1",
    chainId: 8453,
    chainName: "Base",
    hash: "0xhash",
    status: "skipped",
    confidence: 0,
    side: "unknown",
    tokenInAsset: "",
    tokenInAddress: "",
    tokenInAmount: 0,
    tokenOutAsset: "",
    tokenOutAddress: "",
    tokenOutAmount: 0,
    reason: "No paired inbound and outbound wallet transfers were found for this transaction.",
    transferCount: 2,
    sourceTimestamp: "2026-06-04T00:00:00.000Z",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

describe("summarizeCandidateReprocess", () => {
  it("reports status, side, and copied-token address improvements", () => {
    const stored = [
      candidate({ hash: "0xdecoded", status: "skipped", side: "unknown" }),
      candidate({
        hash: "0xaddress",
        status: "candidate",
        confidence: 0.58,
        side: "buy",
        tokenOutAsset: "BRETT",
        tokenOutAddress: ""
      })
    ];
    const derived = [
      candidate({
        hash: "0xdecoded",
        status: "decoded",
        confidence: 0.9,
        side: "buy",
        tokenInAsset: "ETH",
        tokenOutAsset: "BRETT",
        tokenOutAddress: "0x0000000000000000000000000000000000002000"
      }),
      candidate({
        hash: "0xaddress",
        status: "decoded",
        confidence: 0.9,
        side: "buy",
        tokenOutAsset: "BRETT",
        tokenOutAddress: "0x0000000000000000000000000000000000002000"
      })
    ];

    const report = summarizeCandidateReprocess(stored, derived);

    expect(report.summary).toEqual({
      stored: 2,
      derived: 2,
      changed: 2,
      statusChanges: 2,
      sideChanges: 1,
      copiedTokenAddressImprovements: 2,
      newlyDerived: 0,
      missingDerived: 0
    });
    expect(report.changes).toHaveLength(2);
    expect(report.changes.find((change) => change.hash === "0xdecoded")).toMatchObject({
      key: "0x6332685fb57d440b9812cc5f625376f8bee6eba1|8453|0xdecoded",
      kinds: ["status", "side", "copy-token-address"],
      storedStatus: "skipped",
      derivedStatus: "decoded"
    });
  });

  it("does not treat copied lifecycle status as a parser status regression", () => {
    const stored = [
      candidate({
        hash: "0xcopied",
        status: "copied",
        confidence: 0.9,
        side: "buy",
        tokenOutAddress: "0x0000000000000000000000000000000000002000"
      })
    ];
    const derived = [
      candidate({
        hash: "0xcopied",
        status: "decoded",
        confidence: 0.9,
        side: "buy",
        tokenOutAddress: "0x0000000000000000000000000000000000002000"
      })
    ];

    const report = summarizeCandidateReprocess(stored, derived);

    expect(report.summary.statusChanges).toBe(0);
    expect(report.summary.changed).toBe(0);
    expect(report.changes).toEqual([]);
  });
});
