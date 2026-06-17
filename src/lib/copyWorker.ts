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
let isChecking = false;
const DEFAULT_COPY_WORKER_INTERVAL_MS = 10_000;
const MIN_COPY_WORKER_INTERVAL_MS = 5_000;

function copyWorkerIntervalMs() {
  const configured = Number(process.env.COPY_WORKER_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_COPY_WORKER_INTERVAL_MS;
  return Math.max(MIN_COPY_WORKER_INTERVAL_MS, configured);
}

export async function runCopyCheck(options: { force?: boolean } = {}): Promise<void> {
  const settings = getCopySettings();
  if (!settings.autoCopy) return;
  const wallets = listWallets().filter((wallet) => wallet.autoCopy);
  if (!wallets.length) return;
  if (isChecking) return;
  const intervalMs = copyWorkerIntervalMs();
  if (!options.force && Date.now() - lastCheckedAt < intervalMs) return;
  isChecking = true;
  lastCheckedAt = Date.now();

  try {
    await Promise.allSettled(
      wallets.map(async (wallet) => {
        try {
          const { transfers } = await fetchWalletTransfers(wallet.address);
          insertWalletActivity(transfers);
          const activity = listWalletActivity(wallet.address);
          upsertTradeCandidates(deriveTradeCandidates(activity));
        } catch {
          // Skip this wallet on error; retry next cycle
        }
      })
    );

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
            gasBufferBps: settings.gasBufferBps,
            nativeUsdPrice: nativeUsd
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
  } finally {
    isChecking = false;
  }
}

export function startCopyWorker(): void {
  const intervalMs = copyWorkerIntervalMs();
  setInterval(() => {
    runCopyCheck().catch((err: unknown) => {
      console.error("[copy-worker] Unhandled error in runCopyCheck:", err);
    });
  }, intervalMs);
}

export function resetCopyWorkerState(): void {
  lastCheckedAt = 0;
  isChecking = false;
  pendingCopies.clear();
}
