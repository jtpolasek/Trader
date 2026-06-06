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

  it("decodes a noisy sell when one token-out and one proceeds leg dominate a tiny native refund", () => {
    const candidates = deriveTradeCandidates([
      activity({
        hash: "0xsellrefund",
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        hash: "0xsellrefund",
        category: "internal",
        asset: "ETH",
        contractAddress: "",
        value: 0.08,
        fromAddress: "0xrouter",
        toAddress: wallet
      }),
      activity({
        hash: "0xsellrefund",
        category: "internal",
        asset: "ETH",
        contractAddress: "",
        value: 0.00002,
        fromAddress: "0xrefund",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      confidence: 0.9,
      side: "sell",
      tokenInAsset: "PEPE",
      tokenInAddress: "0x0000000000000000000000000000000000001000",
      tokenOutAsset: "ETH",
      tokenOutAmount: 0.08
    });
  });

  it("keeps a sell with competing same-asset proceeds in review", () => {
    const candidates = deriveTradeCandidates([
      activity({
        hash: "0xsellcompetingproceeds",
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        hash: "0xsellcompetingproceeds",
        category: "internal",
        asset: "ETH",
        contractAddress: "",
        value: 0.08,
        fromAddress: "0xrouter",
        toAddress: wallet
      }),
      activity({
        hash: "0xsellcompetingproceeds",
        category: "internal",
        asset: "ETH",
        contractAddress: "",
        value: 0.04,
        fromAddress: "0xother-route",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.72,
      side: "sell",
      tokenInAsset: "PEPE",
      tokenOutAsset: "ETH",
      tokenOutAmount: 0.08
    });
    expect(candidates[0].reason).toContain("Multiple inbound or outbound transfers");
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

  it("decodes the real ECHO native ETH buy from stored Alchemy payloads", () => {
    const hash = "0x5ca252da1bb0877adfc71c7b80988423ad4c9de86d2187c86512d2d7b440296d";
    const realWallet = "0xc5a6bd7693e41b33f7f6fd6de3d82bd8b124ad8d";
    const candidates = deriveTradeCandidates([
      activity({
        walletAddress: realWallet,
        chainId: 1,
        chainName: "Ethereum",
        hash,
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.01,
        fromAddress: realWallet,
        toAddress: "0xef6fc636a63859e08ad3479fe456262eed2e5042",
        blockNum: "0x180d43d",
        timestamp: "2026-06-01T04:33:11.000Z",
        rawPayload:
          '{"blockNum":"0x180d43d","uniqueId":"0x5ca252da1bb0877adfc71c7b80988423ad4c9de86d2187c86512d2d7b440296d:external","hash":"0x5ca252da1bb0877adfc71c7b80988423ad4c9de86d2187c86512d2d7b440296d","from":"0xc5a6bd7693e41b33f7f6fd6de3d82bd8b124ad8d","to":"0xef6fc636a63859e08ad3479fe456262eed2e5042","value":0.01,"erc721TokenId":null,"erc1155Metadata":null,"tokenId":null,"asset":"ETH","category":"external","rawContract":{"value":"0x2386f26fc10000","address":null,"decimal":"0x12"},"metadata":{"blockTimestamp":"2026-06-01T04:33:11.000Z"},"chainId":1,"chainName":"Ethereum"}'
      }),
      activity({
        walletAddress: realWallet,
        chainId: 1,
        chainName: "Ethereum",
        hash,
        category: "erc20",
        asset: "ECHO",
        contractAddress: "0xcaaca3c22141bcfa3dad3662c465bb48ab6736ee",
        value: 339.6828751637203,
        fromAddress: "0x000000000004444c5dc75cb358380d2e3de08a90",
        toAddress: realWallet,
        blockNum: "0x180d43d",
        timestamp: "2026-06-01T04:33:11.000Z",
        rawPayload:
          '{"blockNum":"0x180d43d","uniqueId":"0x5ca252da1bb0877adfc71c7b80988423ad4c9de86d2187c86512d2d7b440296d:log:89","hash":"0x5ca252da1bb0877adfc71c7b80988423ad4c9de86d2187c86512d2d7b440296d","from":"0x000000000004444c5dc75cb358380d2e3de08a90","to":"0xc5a6bd7693e41b33f7f6fd6de3d82bd8b124ad8d","value":339.6828751637203,"erc721TokenId":null,"erc1155Metadata":[],"tokenId":null,"asset":"ECHO","category":"erc20","rawContract":{"value":"0x126a0bff3e90e8d911","address":"0xcaaca3c22141bcfa3dad3662c465bb48ab6736ee","decimal":"0x12"},"metadata":{"blockTimestamp":"2026-06-01T04:33:11.000Z"},"chainId":1,"chainName":"Ethereum"}'
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      confidence: 0.9,
      side: "buy",
      tokenInAsset: "ETH",
      tokenInAmount: 0.01,
      tokenOutAsset: "ECHO",
      tokenOutAmount: 339.6828751637203,
      tokenOutAddress: "0xcaaca3c22141bcfa3dad3662c465bb48ab6736ee",
      sourceTimestamp: "2026-06-01T04:33:11.000Z"
    });
  });

  it("hydrates missing stored native and erc20 amounts from raw base-unit payloads", () => {
    const hash = "0xbasehydratedamounts";
    const tokenAddress = "0x0000000000000000000000000000000000002666";

    const candidates = deriveTradeCandidates([
      activity({
        hash,
        chainId: 8453,
        chainName: "Base",
        category: "external",
        asset: "unknown",
        contractAddress: "",
        value: 0,
        fromAddress: wallet,
        toAddress: "0xrouter",
        rawPayload: JSON.stringify({
          blockNum: "0x2cc001",
          hash,
          from: wallet,
          to: "0xrouter",
          value: null,
          asset: "ETH",
          category: "external",
          rawContract: { value: "0xb1a2bc2ec50000", address: null, decimal: null },
          metadata: { blockTimestamp: "2026-06-04T18:12:00.000Z" },
          chainId: 8453,
          chainName: "Base"
        })
      }),
      activity({
        hash,
        chainId: 8453,
        chainName: "Base",
        category: "erc20",
        asset: "unknown",
        contractAddress: "",
        value: 0,
        fromAddress: "0xrouter",
        toAddress: wallet,
        rawPayload: JSON.stringify({
          blockNum: "0x2cc001",
          hash,
          from: "0xrouter",
          to: wallet,
          value: null,
          asset: "MIG",
          category: "erc20",
          rawContract: { value: "0x75bcd15", address: tokenAddress, decimal: "0x6" },
          metadata: { blockTimestamp: "2026-06-04T18:12:00.000Z" },
          chainId: 8453,
          chainName: "Base"
        })
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      side: "buy",
      tokenInAsset: "ETH",
      tokenInAmount: 0.05,
      tokenOutAsset: "MIG",
      tokenOutAddress: tokenAddress,
      tokenOutAmount: 123.456789
    });
  });

  it("keeps the real SNOWY native ETH buy review-only when the token address is missing", () => {
    const hash = "0x01c4f37290feb54c9cf2ed651baae6839bf1644f880b65db066b9fcdc9ef1b8c";
    const realWallet = "0x26f07199c35b4bc4e37935484d14bbdbcc9d6f9f";
    const candidates = deriveTradeCandidates([
      activity({
        walletAddress: realWallet,
        chainId: 1,
        chainName: "Ethereum",
        hash,
        category: "erc20",
        asset: "SNOWY",
        contractAddress: "",
        value: 85709106.87389493,
        fromAddress: "0x88c1048ba8920a4f65ea69da472b1a7448c2ccfa",
        toAddress: realWallet,
        blockNum: "0x17fabd7",
        timestamp: "2026-05-21T14:39:59.000Z",
        rawPayload: ""
      }),
      activity({
        walletAddress: realWallet,
        chainId: 1,
        chainName: "Ethereum",
        hash,
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.2501,
        fromAddress: realWallet,
        toAddress: "0x734ab9de48f6bab1f2297a34d257cd757deba6aa",
        blockNum: "0x17fabd7",
        timestamp: "2026-05-21T14:39:59.000Z",
        rawPayload: ""
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.58,
      side: "buy",
      tokenInAsset: "ETH",
      tokenInAmount: 0.2501,
      tokenOutAsset: "SNOWY",
      tokenOutAddress: "",
      tokenOutAmount: 85709106.87389493,
      sourceTimestamp: "2026-05-21T14:39:59.000Z"
    });
    expect(candidates[0].reason).toContain("no contract address");
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

  it("uses stored raw payloads to recover missing inbound token details", () => {
    const candidates = deriveTradeCandidates([
      activity({
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.05,
        fromAddress: wallet,
        toAddress: "0xrouter",
        timestamp: ""
      }),
      activity({
        asset: "unknown",
        contractAddress: "",
        value: 0,
        fromAddress: "0xrouter",
        toAddress: wallet,
        timestamp: "",
        rawPayload: JSON.stringify({
          asset: "BRETT",
          value: 250,
          rawContract: { address: "0x0000000000000000000000000000000000002000" },
          metadata: { blockTimestamp: "2026-06-04T01:23:45.000Z" }
        })
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      confidence: 0.9,
      side: "buy",
      tokenInAsset: "ETH",
      tokenOutAsset: "BRETT",
      tokenOutAmount: 250,
      tokenOutAddress: "0x0000000000000000000000000000000000002000",
      sourceTimestamp: "2026-06-04T01:23:45.000Z"
    });
  });

  it("uses stored raw payloads to recover transfer direction fields", () => {
    const candidates = deriveTradeCandidates([
      activity({
        category: "",
        asset: "",
        contractAddress: "",
        value: 0,
        fromAddress: "",
        toAddress: "",
        timestamp: "",
        rawPayload: JSON.stringify({
          category: "external",
          asset: "ETH",
          value: 0.05,
          from: wallet,
          to: "0x0000000000000000000000000000000000009999",
          blockNum: "0xabc",
          rawContract: { address: null },
          metadata: { blockTimestamp: "2026-06-04T01:23:45.000Z" }
        })
      }),
      activity({
        asset: "",
        contractAddress: "",
        value: 0,
        fromAddress: "",
        toAddress: "",
        timestamp: "",
        rawPayload: JSON.stringify({
          category: "erc20",
          asset: "BRETT",
          value: 250,
          from: "0x0000000000000000000000000000000000009999",
          to: wallet,
          rawContract: { address: "0x0000000000000000000000000000000000002000" },
          metadata: { blockTimestamp: "2026-06-04T01:23:45.000Z" }
        })
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      confidence: 0.9,
      side: "buy",
      tokenInAsset: "ETH",
      tokenInAmount: 0.05,
      tokenOutAsset: "BRETT",
      tokenOutAmount: 250,
      tokenOutAddress: "0x0000000000000000000000000000000000002000",
      sourceTimestamp: "2026-06-04T01:23:45.000Z"
    });
  });

  it("uses stored raw payloads to recover missing outbound token details for sells", () => {
    const candidates = deriveTradeCandidates([
      activity({
        asset: "",
        contractAddress: "",
        value: 0,
        fromAddress: wallet,
        toAddress: "0xrouter",
        rawPayload: JSON.stringify({
          asset: "PEPE",
          value: 1000,
          rawContract: { address: "0x0000000000000000000000000000000000001000" }
        })
      }),
      activity({ asset: "USDC", value: 45, fromAddress: "0xrouter", toAddress: wallet })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "decoded",
      confidence: 0.9,
      side: "sell",
      tokenInAsset: "PEPE",
      tokenInAmount: 1000,
      tokenInAddress: "0x0000000000000000000000000000000000001000",
      tokenOutAsset: "USDC"
    });
  });

  it("keeps noisy buys with multiple possible received tokens in review", () => {
    const candidates = deriveTradeCandidates([
      activity({
        hash: "0xnoisybuy",
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.08,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({ hash: "0xnoisybuy", asset: "USDC", value: 25, fromAddress: wallet, toAddress: "0xrouter" }),
      activity({
        hash: "0xnoisybuy",
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: "0xrouter",
        toAddress: wallet
      }),
      activity({
        hash: "0xnoisybuy",
        asset: "AIRDROP",
        contractAddress: "0x0000000000000000000000000000000000001001",
        value: 50,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.52,
      side: "buy",
      tokenOutAsset: "PEPE"
    });
    expect(candidates[0].reason).toContain("Multiple possible received tokens");
  });

  it("keeps noisy sells with multiple possible sent tokens in review", () => {
    const candidates = deriveTradeCandidates([
      activity({
        hash: "0xnoisysell",
        asset: "PEPE",
        contractAddress: "0x0000000000000000000000000000000000001000",
        value: 1000,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        hash: "0xnoisysell",
        asset: "REWARD",
        contractAddress: "0x0000000000000000000000000000000000001002",
        value: 12,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({ hash: "0xnoisysell", asset: "USDC", value: 45, fromAddress: "0xrouter", toAddress: wallet }),
      activity({
        hash: "0xnoisysell",
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.004,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.52,
      side: "sell",
      tokenInAsset: "PEPE"
    });
    expect(candidates[0].reason).toContain("Multiple possible sent tokens");
  });

  it("keeps Base raw-payload transactions with plausible buy and sell shapes as review-only", () => {
    const candidates = deriveTradeCandidates([
      activity({
        hash: "0xbaseambiguous",
        chainId: 8453,
        chainName: "Base",
        category: "external",
        asset: "unknown",
        contractAddress: "",
        value: 0,
        fromAddress: wallet,
        toAddress: "0xrouter",
        rawPayload: JSON.stringify({ asset: "ETH", value: 0.02 })
      }),
      activity({
        hash: "0xbaseambiguous",
        chainId: 8453,
        chainName: "Base",
        asset: "TOSEND",
        contractAddress: "0x0000000000000000000000000000000000002001",
        value: 100,
        fromAddress: wallet,
        toAddress: "0xrouter"
      }),
      activity({
        hash: "0xbaseambiguous",
        chainId: 8453,
        chainName: "Base",
        asset: "unknown",
        contractAddress: "",
        value: 0,
        fromAddress: "0xrouter",
        toAddress: wallet,
        rawPayload: JSON.stringify({
          asset: "TOBUY",
          value: 250,
          rawContract: { address: "0x0000000000000000000000000000000000002000" }
        })
      }),
      activity({
        hash: "0xbaseambiguous",
        chainId: 8453,
        chainName: "Base",
        asset: "USDC",
        value: 60,
        fromAddress: "0xrouter",
        toAddress: wallet
      })
    ]);

    expect(candidates[0]).toMatchObject({
      status: "candidate",
      confidence: 0.4,
      chainName: "Base",
      side: "unknown",
      tokenInAsset: "ETH",
      tokenOutAsset: "TOBUY"
    });
    expect(candidates[0].reason).toContain("plausible buy and sell shapes");
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

  it("decodes a Base sell from erc20 token-out and internal ETH-in", () => {
    const hash = "0xsellhash";
    const chainId = 8453;
    const router = "0xd0a40c6526acdebd4f6d87931098ff37a9f8e4bf";
    const tokenAddress = "0xdcb35db5e40d1b53e54bb7cfe8f9730ecddb9ba3";

    const candidates = deriveTradeCandidates([
      activity({
        hash,
        chainId,
        chainName: "Base",
        category: "erc20",
        asset: "TALOS",
        contractAddress: tokenAddress,
        value: 89492134,
        fromAddress: wallet,
        toAddress: router,
        timestamp: "2026-06-04T16:45:35.000Z",
        rawPayload: JSON.stringify({
          blockNum: "0x2cba766",
          uniqueId: `${hash}:log:799`,
          hash,
          from: wallet,
          to: router,
          value: 89492134,
          asset: "TALOS",
          category: "erc20",
          rawContract: { value: "0x4a06b254badabe8f12a84a", address: tokenAddress, decimal: "0x12" },
          metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
          chainId: 8453,
          chainName: "Base"
        })
      }),
      activity({
        hash,
        chainId,
        chainName: "Base",
        category: "internal",
        asset: "ETH",
        contractAddress: "",
        value: 0.5,
        fromAddress: router,
        toAddress: wallet,
        timestamp: "2026-06-04T16:45:35.000Z",
        rawPayload: JSON.stringify({
          blockNum: "0x2cba766",
          uniqueId: `${hash}:internal:0`,
          hash,
          from: router,
          to: wallet,
          value: 0.5,
          asset: "ETH",
          category: "internal",
          rawContract: { value: "0x6f05b59d3b20000", address: null, decimal: null },
          metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
          chainId: 8453,
          chainName: "Base"
        })
      })
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("decoded");
    expect(candidates[0].side).toBe("sell");
    expect(candidates[0].tokenInAsset).toBe("TALOS");
    expect(candidates[0].tokenInAddress).toBe(tokenAddress);
    expect(candidates[0].tokenOutAsset).toBe("ETH");
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps a Base internal-transfer sell review-only when the token address is missing", () => {
    const hash = "0xsellnoaddrHash";
    const chainId = 8453;
    const router = "0xd0a40c6526acdebd4f6d87931098ff37a9f8e4bf";

    const candidates = deriveTradeCandidates([
      activity({
        hash,
        chainId,
        chainName: "Base",
        category: "erc20",
        asset: "TALOS",
        contractAddress: "",
        value: 89492134,
        fromAddress: wallet,
        toAddress: router,
        rawPayload: JSON.stringify({
          blockNum: "0x2cba766",
          uniqueId: `${hash}:log:799`,
          hash,
          from: wallet,
          to: router,
          value: 89492134,
          asset: "TALOS",
          category: "erc20",
          rawContract: { value: "0x4a06b254badabe8f12a84a", address: null, decimal: "0x12" },
          metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
          chainId: 8453,
          chainName: "Base"
        })
      }),
      activity({
        hash,
        chainId,
        chainName: "Base",
        category: "internal",
        asset: "ETH",
        contractAddress: "",
        value: 0.5,
        fromAddress: router,
        toAddress: wallet,
        rawPayload: JSON.stringify({
          blockNum: "0x2cba766",
          uniqueId: `${hash}:internal:0`,
          hash,
          from: router,
          to: wallet,
          value: 0.5,
          asset: "ETH",
          category: "internal",
          rawContract: { value: "0x6f05b59d3b20000", address: null, decimal: null },
          metadata: { blockTimestamp: "2026-06-04T16:45:35.000Z" },
          chainId: 8453,
          chainName: "Base"
        })
      })
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("candidate");
    expect(candidates[0].side).toBe("sell");
    expect(candidates[0].tokenInAsset).toBe("TALOS");
    expect(candidates[0].tokenInAddress).toBe("");
    expect(candidates[0].tokenOutAsset).toBe("ETH");
    expect(candidates[0].reason).toContain("no contract address");
  });
});
