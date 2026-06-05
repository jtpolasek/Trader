import { NextResponse } from "next/server";
import {
  getCandidateAttentionSummary,
  getCopySettings,
  getPortfolio,
  listPositions,
  listTrades,
  listWallets
} from "@/lib/repositories";
import { derivePortfolioAnalytics } from "@/lib/portfolioAnalytics";

export async function GET() {
  const portfolio = getPortfolio();
  const positions = listPositions();
  const trades = listTrades();
  const wallets = listWallets();
  const analytics = derivePortfolioAnalytics({ portfolio, positions, trades });
  const openCostBasisUsd = positions.reduce((sum, position) => sum + position.costBasisUsd, 0);
  const totalFeesUsd = portfolio.feesPaidUsd;
  const wins = trades.filter((trade) => trade.realizedPnlUsd > 0).length;
  const losses = trades.filter((trade) => trade.realizedPnlUsd < 0).length;

  return NextResponse.json({
    portfolio,
    copySettings: getCopySettings(),
    candidateAttention: getCandidateAttentionSummary(),
    analytics,
    positions,
    trades,
    wallets,
    stats: {
      openCostBasisUsd,
      equityUsd: portfolio.cashUsd + openCostBasisUsd,
      totalFeesUsd,
      wins,
      losses
    }
  });
}
