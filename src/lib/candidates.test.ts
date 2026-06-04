import { describe, expect, it } from "vitest";
import { deriveTradeCandidates } from "./candidates";
import type { WalletActivity } from "./types";

const wallet = "0x6332685fb57d440b9812cc5f625376f8bee6eba1";

function activity(overrides: Partial<WalletActivity>): WalletActivity {
  return {
    id: crypto.randomUUID(),
    walletAddress: wallet,
    chainId: 1,
    chainName: "Ethereum",
    hash: "0xhash",
    category: "erc20",
    asset: "USDC",
    contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    value: 100,
    fromAddress: wallet,
    toAddress: "0x0000000000000000000000000000000000000001",
    blockNum: "0x1",
    timestamp: "2026-06-04T00:00:00.000Z",
    isSwapLike: true,
    rawPayload: "{}",
    ...overrides
  };
}

describe("deriveTradeCandidates", () => {
  it("decodes a likely buy from paired cash-out and token-in transfers", () => {
    const candidates = deriveTradeCandidates([
      activity({ asset: "USDC", value: 50, fromAddress: wallet, toAddress: "0xrouter" }),
      activity({
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      status: "decoded",
      confidence: 0.9,
      side: "buy",
      tokenInAsset: "USDC",
      tokenOutAsset: "PEPE",
      tokenOutAddress: "0x0000000000000000000000000000000000001000"
    });
  });

  it("decodes a likely sell from token-out and cash-in transfers", () => {
    const candidates = deriveTradeCandidates([
      activity({
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({ asset: "USDC", value: 45, fromAddress: "0xrouter", toAddress: wallet })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      side: "sell",
      tokenInAsset: "PEPE",
      tokenInAddress: "0x0000000000000000000000000000000000001000",
      tokenOutAsset: "USDC"
    });
  });

  it("keeps ambiguous multi-transfer swaps as review candidates", () => {
    const candidates = deriveTradeCandidates([
      activity({ asset: "USDC", value: 50, fromAddress: wallet, toAddress: "0xrouter" }),
      activity({ asset: "ETH", value: 0.01, fromAddress: wallet, toAddress: "0xrouter" }),
      activity({
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.72,
      side: "buy"
    });
    expect(candidates[0].reason).toContain("Multiple inbound or outbound transfers");
  });

  it("selects the cash/native outbound leg for a buy when another outbound token is larger", () => {
    const candidates = deriveTradeCandidates([
      activity({
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.12,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        asset: "DUST",
        contractAddress: "0x0000000000000000000000000000000000003000",
        value: 50_000,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.72,
      side: "buy",
      tokenInAsset: "ETH",
      tokenOutAsset: "PEPE",
      tokenOutAddress: "0x0000000000000000000000000000000000001000"
    });
    expect(candidates[0].reason).toContain("selected the likely buy using ETH");
  });

  it("selects the token outbound leg for a sell when native value also leaves the wallet", () => {
    const candidates = deriveTradeCandidates([
      activity({
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.01,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({ asset: "USDC", value: 45, fromAddress: "0xrouter", toAddress: wallet })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.72,
      side: "sell",
      tokenInAsset: "PEPE",
      tokenInAddress: "0x0000000000000000000000000000000000001000",
      tokenOutAsset: "USDC"
    });
    expect(candidates[0].reason).toContain("selected the likely sell of PEPE");
  });

  it("decodes a Base native buy from ETH out and token in", () => {
    const candidates = deriveTradeCandidates([
      activity({
        chainId: 8453,
        chainName: "Base",
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.05,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        chainId: 8453,
        chainName: "Base",
        asset: "BRETT",
        contractAddress: "0x0000000000000000000000000000000000002000",
        value: 250,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      confidence: 0.9,
      chainName: "Base",
      side: "buy",
      tokenInAsset: "ETH",
      tokenOutAsset: "BRETT",
      tokenOutAddress: "0x0000000000000000000000000000000000002000"
    });
    expect(candidates[0].reason).toContain("likely buy using ETH");
  });

  it("skips transactions without paired transfer directions", () => {
    const candidates = deriveTradeCandidates([
      activity({ asset: "USDC", value: 50, fromAddress: wallet, toAddress: "0xrouter" })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "skipped",
      confidence: 0,
      side: "unknown"
    });
  });

  it("keeps a likely swap as a review candidate when the traded token address is missing", () => {
    const candidates = deriveTradeCandidates([
      activity({ asset: "USDC", value: 50, fromAddress: wallet, toAddress: "0xrouter" }),
      activity({ asset: "PEPE", contractAddress: "", value: 1000, fromAddress: "0xrouter", toAddress: wallet })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.58,
      side: "buy"
    });
    expect(candidates[0].reason).toContain("no contract address");
  });

  it("explains paired transfers with missing inbound token details", () => {
    const candidates = deriveTradeCandidates([
      activity({
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.05,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        asset: "",
        contractAddress: "",
        value: 0,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.6,
      side: "unknown",
      tokenInAsset: "ETH",
      tokenOutAsset: ""
    });
    expect(candidates[0].reason).toContain("missing token symbol, amount, or contract address");
  });

  it("does not merge same hash activity across chains", () => {
    const candidates = deriveTradeCandidates([
      activity({ chainId: 1, chainName: "Ethereum", hash: "0xsame", asset: "USDC", fromAddress: wallet, toAddress: "0xrouter" }),
      activity({
        chainId: 1,
        chainName: "Ethereum",
        hash: "0xsame",
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        fromAddress: "0xrouter",
        toAddress: wallet
      }),
      activity({ chainId: 8453, chainName: "Base", hash: "0xsame", asset: "USDC", fromAddress: wallet, toAddress: "0xrouter" }),
      activity({
        chainId: 8453,
        chainName: "Base",
        hash: "0xsame",
        asset: "BRETT",
        contractAddress: "0x0000000000000000000000000000000000002000",
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.chainName).sort()).toEqual(["Base", "Ethereum"]);
  });

  it("orders candidates by source transaction time newest first", () => {
    const candidates = deriveTradeCandidates([
      activity({
        hash: "0xold",
        timestamp: "2026-06-01T00:00:00.000Z",
        asset: "USDC",
        value: 50,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        hash: "0xold",
        timestamp: "2026-06-01T00:00:00.000Z",
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        fromAddress: "0xrouter",
        toAddress: wallet
      }),
      activity({
        hash: "0xnew",
        timestamp: "2026-06-03T00:00:00.000Z",
        asset: "USDC",
        value: 50,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        hash: "0xnew",
        timestamp: "2026-06-03T00:00:00.000Z",
        asset: "BRETT",
        contractAddress: "0x0000000000000000000000000000000000002000",
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates.map((candidate) => candidate.hash)).toEqual(["0xnew", "0xold"]);
    expect(candidates[0].sourceTimestamp).toBe("2026-06-03T00:00:00.000Z");
  });
});
