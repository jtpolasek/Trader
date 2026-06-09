import { applyTradeToState } from "./accounting";
import { deriveTradeCandidates } from "./candidates";
import { classifyCopyError, sizeCopyTrade } from "./copy";
import {
  buildQuotePreview,
  fetchWalletTransfers,
  getNativeUsdPrice,
  resolveTokenFromAlchemy
} from "./external";
import {
  getCopySettings,
  getPortfolio,
  getPosition,
  getToken,
  insertWalletActivity,
  listTradeCandidates,
  listWalletActivity,
  listWallets,
  recordTrade,
  updateTradeCandidateCopyResult,
  updateTradeCandidateStatus,
  upsertTradeCandidates,
  upsertToken
} from "./repositories";
import type { TradeCandidate } from "./types";

export function shouldAutoCopy(candidate: TradeCandidate): boolean {
  return (
    candidate.status === "decoded" &&
    candidate.side === "buy" &&
    !candidate.lastCopyStatus
  );
}

const pendingCopies = new Set<string>();
let lastCheckedAt = 0;
const POLL_INTERVAL_MS = 60_000;

export async function runCopyCheck(): Promise<void> {
  const settings = getCopySettings();
  if (!settings.autoCopy) return;
  if (Date.now() - lastCheckedAt < POLL_INTERVAL_MS) return;
  lastCheckedAt = Date.now();

  const wallets = listWallets().filter((wallet) => wallet.autoCopy);
  for (const wallet of wallets) {
    try {
      const { transfers } = await fetchWalletTransfers(wallet.address);
      insertWalletActivity(transfers);
      const activity = listWalletActivity(wallet.address);
      upsertTradeCandidates(deriveTradeCandidates(activity));
    } catch {
      // Skip this wallet on error; retry next cycle
    }
  }

  const allCandidates = wallets.flatMap((w) => listTradeCandidates(w.address));
  const eligible = allCandidates.filter(
    (c) => shouldAutoCopy(c) && !pendingCopies.has(c.id)
  );
  if (!eligible.length) return;

  await Promise.allSettled(
    eligible.map(async (candidate) => {
      pendingCopies.add(candidate.id);
      try {
        const tokenAddress = candidate.tokenOutAddress;
        const position = tokenAddress ? getPosition(tokenAddress) : null;
        const nativeUsd = await getNativeUsdPrice(candidate.chainId);
        const sized = sizeCopyTrade({ candidate, settings, nativeUsd, position });

        const storedToken = getToken(sized.tokenAddress);
        const token =
          storedToken && storedToken.chainId === candidate.chainId
            ? storedToken
            : upsertToken(
                await resolveTokenFromAlchemy(sized.tokenAddress, candidate.chainId)
              );

        const preview = await buildQuotePreview({
          side: "buy",
          token,
          chainId: candidate.chainId,
          usdAmount: sized.usdAmount,
          slippageBps: settings.slippageCapBps,
          gasBufferBps: settings.gasBufferBps
        });

        const portfolio = getPortfolio();
        const next = applyTradeToState({ portfolio, position, preview });

        const quoteSnapshot = {
          ...preview.quoteSnapshot,
          autoCopied: true,
          copiedFrom: {
            candidateId: candidate.id,
            walletAddress: candidate.walletAddress,
            chainId: candidate.chainId,
            sourceHash: candidate.hash
          }
        };

        const tradeId = recordTrade({
          side: "buy",
          tokenAddress: sized.tokenAddress,
          chainId: candidate.chainId,
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

        updateTradeCandidateStatus(candidate.id, "copied", `Auto-copied as trade ${tradeId}.`);
        updateTradeCandidateCopyResult({
          id: candidate.id,
          status: "copied",
          reason: `Auto-copied as trade ${tradeId}.`,
          tradeId
        });
      } catch (error) {
        const { bucket, reason } = classifyCopyError(error);
        updateTradeCandidateCopyResult({ id: candidate.id, status: "failed", bucket, reason });
      } finally {
        pendingCopies.delete(candidate.id);
      }
    })
  );
}

export function startCopyWorker(): void {
  setInterval(() => {
    runCopyCheck().catch((err: unknown) => {
      console.error("[copy-worker] Unhandled error in runCopyCheck:", err);
    });
  }, 30_000);
}

export function resetCopyWorkerState(): void {
  lastCheckedAt = 0;
  pendingCopies.clear();
}
