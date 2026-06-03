import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_GAS_BUFFER_BPS, DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";
import { buildQuotePreview, resolveTokenFromAlchemy } from "@/lib/external";
import { normalizeAddress } from "@/lib/money";
import { getToken, insertQuote, upsertToken } from "@/lib/repositories";

const schema = z.object({
  side: z.enum(["buy", "sell"]),
  tokenAddress: z.string(),
  usdAmount: z.number().positive().optional(),
  tokenQuantity: z.number().positive().optional(),
  slippageBps: z.number().min(0).max(5000).optional().default(DEFAULT_SLIPPAGE_BPS),
  gasBufferBps: z.number().min(0).max(10000).optional().default(DEFAULT_GAS_BUFFER_BPS)
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const tokenAddress = normalizeAddress(body.tokenAddress);
    const token = getToken(tokenAddress) ?? upsertToken(await resolveTokenFromAlchemy(tokenAddress));
    const preview = await buildQuotePreview({
      side: body.side,
      token,
      usdAmount: body.usdAmount,
      tokenQuantity: body.tokenQuantity,
      slippageBps: body.slippageBps,
      gasBufferBps: body.gasBufferBps
    });
    insertQuote({
      tokenAddress,
      side: body.side,
      quantity: preview.quantity,
      priceUsd: preview.priceUsd,
      notionalUsd: preview.notionalUsd,
      gasUsd: preview.gasUsd,
      slippageUsd: preview.slippageUsd,
      dexFeeUsd: preview.dexFeeUsd,
      quoteSnapshot: JSON.stringify(preview.quoteSnapshot)
    });
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build quote." },
      { status: 400 }
    );
  }
}
