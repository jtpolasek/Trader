import { NextResponse } from "next/server";
import { applyTradeToState } from "@/lib/accounting";
import { calculateCashCappedBuyUsd, classifyCopyError, sizeCopyTrade } from "@/lib/copy";
import { buildQuotePreview, getNativeUsdPrice, resolveTokenFromAlchemy } from "@/lib/external";
import type { Token, TradeCandidate } from "@/lib/types";
import {
  getCopySettings,
  getPortfolio,
  getPosition,
  getToken,
  getTradeCandidate,
  getWalletActivityTokenHint,
  recordTrade,
  updateTradeCandidateCopyResult,
  updateTradeCandidateStatus,
  upsertToken
} from "@/lib/repositories";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const candidate = getTradeCandidate(id);
    if (!candidate) {
      return NextResponse.json({ error: "Candidate was not found." }, { status: 404 });
    }
    if (candidate.status === "copied") {
      return NextResponse.json({ error: "Candidate has already been copied." }, { status: 400 });
    }

    const settings = getCopySettings();
    const tokenAddress = candidate.side === "buy" ? candidate.tokenOutAddress : candidate.tokenInAddress;
    const position = tokenAddress ? getPosition(tokenAddress) : null;
    const nativeUsd = await getNativeUsdPrice(candidate.chainId);
    const sized = sizeCopyTrade({ candidate, settings, nativeUsd, position });
    const token = getToken(sized.tokenAddress) ?? upsertToken(await resolveCopyToken(candidate, sized.tokenAddress));
    let preview = await buildQuotePreview({
      side: sized.side,
      token,
      chainId: candidate.chainId,
      usdAmount: sized.side === "buy" ? sized.usdAmount : undefined,
      tokenQuantity: sized.side === "sell" ? sized.tokenQuantity : undefined,
      slippageBps: settings.slippageCapBps,
      gasBufferBps: settings.gasBufferBps
    });

    const portfolio = getPortfolio();
    let cashCap: { fromUsd: number; toUsd: number } | null = null;
    if (sized.side === "buy" && preview.side === "buy" && portfolio.cashUsd < preview.totalCostUsd) {
      if (settings.insufficientCashBehavior === "skip") {
        throw new Error("Insufficient paper cash for this copy after fees.");
      }

      let cappedUsd = calculateCashCappedBuyUsd({
        cashUsd: portfolio.cashUsd,
        requestedUsd: sized.usdAmount,
        gasUsd: preview.gasUsd,
        dexFeeUsd: preview.dexFeeUsd,
        slippageBps: settings.slippageCapBps
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!Number.isFinite(cappedUsd) || cappedUsd <= 0) {
          throw new Error("Insufficient paper cash for this copy after fees.");
        }

        preview = await buildQuotePreview({
          side: "buy",
          token,
          chainId: candidate.chainId,
          usdAmount: cappedUsd,
          slippageBps: settings.slippageCapBps,
          gasBufferBps: settings.gasBufferBps
        });

        if (portfolio.cashUsd >= preview.totalCostUsd) break;
        cappedUsd *= Math.max(0.1, (portfolio.cashUsd / preview.totalCostUsd) * 0.995);
      }

      if (portfolio.cashUsd < preview.totalCostUsd) {
        throw new Error("Insufficient paper cash after fee-aware cap re-quoting.");
      }

      cashCap = { fromUsd: sized.usdAmount, toUsd: preview.notionalUsd };
    }

    const next = applyTradeToState({ portfolio, position, preview });

    const quoteSnapshot = {
      ...preview.quoteSnapshot,
      copiedFrom: {
        candidateId: candidate.id,
        walletAddress: candidate.walletAddress,
        chainId: candidate.chainId,
        chainName: candidate.chainName,
        sourceHash: candidate.hash,
        sourceTimestamp: candidate.sourceTimestamp,
        sourceSide: candidate.side,
        sourceNotionalUsd: sized.sourceNotionalUsd,
        cashCap,
        copySettings: settings
      }
    };

    const tradeId = recordTrade({
      side: preview.side,
      tokenAddress: sized.tokenAddress,
      quantity: preview.quantity,
      priceUsd: preview.priceUsd,
      notionalUsd: preview.notionalUsd,
      gasUsd: preview.gasUsd,
      slippageUsd: preview.slippageUsd,
      dexFeeUsd: preview.dexFeeUsd,
      totalCostUsd: preview.totalCostUsd,
      realizedPnlUsd: next.realizedPnlUsd,
      quoteSnapshot: JSON.stringify(quoteSnapshot)
    });

    const totalFeesUsd = preview.gasUsd + preview.slippageUsd + preview.dexFeeUsd;
    const statusReason = cashCap
      ? `Copied with cash cap: resized from $${cashCap.fromUsd.toFixed(2)} to $${cashCap.toUsd.toFixed(
          2
        )} after fees as trade ${tradeId}.`
      : `Copied into paper portfolio as trade ${tradeId}.`;
    updateTradeCandidateStatus(candidate.id, "copied", statusReason);
    updateTradeCandidateCopyResult({
      id: candidate.id,
      status: "copied",
      reason: statusReason,
      tradeId
    });

    return NextResponse.json({
      tradeId,
      preview,
      copyResult: {
        candidateId: candidate.id,
        status: "copied",
        reason: statusReason,
        sourceHash: candidate.hash,
        chainName: candidate.chainName,
        side: preview.side,
        tokenSymbol: token.symbol,
        tokenAddress: sized.tokenAddress,
        quantity: preview.quantity,
        notionalUsd: preview.notionalUsd,
        totalFeesUsd,
        totalCostUsd: preview.side === "buy" ? preview.totalCostUsd : preview.totalCostUsd,
        sellProceedsUsd: preview.sellProceedsUsd,
        cashCap,
        tradeId
      }
    });
  } catch (error) {
    const { bucket, reason } = classifyCopyError(error);
    updateTradeCandidateCopyResult({ id, status: "failed", bucket, reason });
    return NextResponse.json(
      { error: reason, copyResult: { candidateId: id, status: "failed", bucket, reason } },
      { status: 400 }
    );
  }
}

async function resolveCopyToken(candidate: TradeCandidate, tokenAddress: string): Promise<Omit<Token, "createdAt">> {
  try {
    return await resolveTokenFromAlchemy(tokenAddress, candidate.chainId);
  } catch (error) {
    const hint = getWalletActivityTokenHint({
      walletAddress: candidate.walletAddress,
      chainId: candidate.chainId,
      hash: candidate.hash,
      tokenAddress
    });
    if (!hint) throw error;
    return {
      address: tokenAddress.toLowerCase(),
      symbol: hint.symbol,
      name: hint.name,
      decimals: hint.decimals
    };
  }
}
