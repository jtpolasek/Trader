import { NextResponse } from "next/server";
import { BASE_CHAIN_ID, getChainTokens } from "@/lib/constants";
import { fromBaseUnits, toBaseUnits } from "@/lib/money";
import { getToken } from "@/lib/repositories";
import { getZeroxPrice } from "@/lib/zerox";

const SELL_USD = 10;
const MAX_TOKENS = 20;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get("tokens") ?? "";
    const chainId = Number(searchParams.get("chainId") ?? BASE_CHAIN_ID);

    const addresses = raw
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => /^0x[a-f0-9]{40}$/.test(a))
      .slice(0, MAX_TOKENS);

    if (!addresses.length) {
      return NextResponse.json({ prices: {}, fetchedAt: new Date().toISOString() });
    }

    const chainTokens = getChainTokens(chainId);
    const sellAmount = toBaseUnits(SELL_USD, chainTokens.usdc.decimals);

    const results = await Promise.allSettled(
      addresses.map(async (address) => {
        const token = getToken(address);
        if (!token) throw new Error(`Token not found: ${address}`);

        const quote = await getZeroxPrice({
          chainId,
          sellToken: chainTokens.usdc.address,
          buyToken: address,
          sellAmount
        });

        const tokensReceived = fromBaseUnits(quote.buyAmount, token.decimals);
        if (!tokensReceived) throw new Error(`Zero buy amount for ${address}`);

        return { address, priceUsd: SELL_USD / tokensReceived };
      })
    );

    const prices: Record<string, number | null> = {};
    for (let i = 0; i < addresses.length; i++) {
      const result = results[i];
      prices[addresses[i]] = result.status === "fulfilled" ? result.value.priceUsd : null;
    }

    return NextResponse.json({ prices, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not fetch prices." },
      { status: 400 }
    );
  }
}
