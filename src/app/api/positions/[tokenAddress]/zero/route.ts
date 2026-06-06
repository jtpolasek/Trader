import { NextResponse } from "next/server";
import { applyTotalLossToState } from "@/lib/accounting";
import { normalizeAddress } from "@/lib/money";
import {
  getPortfolio,
  getPosition,
  recordTrade
} from "@/lib/repositories";

export async function POST(_request: Request, context: { params: Promise<{ tokenAddress: string }> }) {
  try {
    const { tokenAddress: rawTokenAddress } = await context.params;
    const tokenAddress = normalizeAddress(decodeURIComponent(rawTokenAddress));
    const position = getPosition(tokenAddress);
    if (!position || position.quantity <= 0) {
      return NextResponse.json({ error: "Open position was not found." }, { status: 404 });
    }

    const portfolio = getPortfolio();
    const next = applyTotalLossToState({ portfolio, position });

    const tradeId = recordTrade({
      side: "sell",
      tokenAddress,
      chainId: position.chainId,
      quantity: position.quantity,
      priceUsd: 0,
      notionalUsd: 0,
      gasUsd: 0,
      slippageUsd: 0,
      dexFeeUsd: 0,
      totalCostUsd: 0,
      realizedPnlUsd: next.realizedPnlUsd,
      quoteSnapshot: JSON.stringify({
        provider: "manual",
        action: "mark-total-loss",
        reason: "Position was manually marked as a total loss because no usable liquidity/route was available.",
        tokenAddress,
        chainId: position.chainId,
        quantity: position.quantity,
        costBasisUsd: position.costBasisUsd,
        createdAt: new Date().toISOString()
      })
    });

    return NextResponse.json({
      tradeId,
      realizedPnlUsd: next.realizedPnlUsd,
      positionClosed: true
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not mark position as a total loss." },
      { status: 400 }
    );
  }
}
