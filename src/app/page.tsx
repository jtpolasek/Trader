"use client";

import {
  Activity,
  Archive,
  ArchiveRestore,
  BadgeDollarSign,
  Download,
  Eye,
  History,
  ListRestart,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Save,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  WalletCards
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { candidateCopyTokenAddress, classifyCandidateTrust } from "@/lib/candidateTrust";
import { isQuoteStale } from "@/lib/quoteAge";
import { DEFAULT_COPY_SETTINGS, DEFAULT_GAS_BUFFER_BPS, DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";
import { formatNumber, formatUsd, formatUsdPrice } from "@/lib/money";
import type {
  CopySettings,
  PortfolioAnalytics,
  Position,
  QuotePreview,
  Trade,
  TradeCandidate,
  TradeSide,
  Wallet,
  WalletActivity
} from "@/lib/types";

type PortfolioPayload = {
  portfolio: {
    cashUsd: number;
    startingCashUsd: number;
    realizedPnlUsd: number;
    feesPaidUsd: number;
  };
  copySettings: CopySettings;
  positions: Position[];
  trades: Trade[];
  wallets: Wallet[];
  candidateAttention: CandidateAttention;
  analytics: PortfolioAnalytics;
  stats: {
    openCostBasisUsd: number;
    equityUsd: number;
    totalFeesUsd: number;
    wins: number;
    losses: number;
  };
};

type CopySettingsForm = {
  mode: CopySettings["mode"];
  fixedUsd: string;
  percentOfSource: string;
  maxTradeUsd: string;
  slippageCapBps: string;
  gasBufferBps: string;
  insufficientCashBehavior: CopySettings["insufficientCashBehavior"];
  allowlist: string;
  blocklist: string;
};

type QuoteDebugSnapshot = {
  provider?: string;
  quoteKind?: string;
  endpoint?: string;
  chainId?: number;
  side?: string;
  sellToken?: string;
  buyToken?: string;
  inputAmount?: string;
  assumptions?: {
    ethUsd?: number;
    slippageBps?: number;
    gasBufferBps?: number;
    gasUnits?: number;
    gasPriceWei?: number;
    dexFeeUsd?: number;
  };
  valuedFeeUsd?: number;
  valuedFeeTokens?: string[];
  stillUnpricedFees?: { type?: string; token?: string; amount?: string }[];
  rawQuote?: unknown;
};

type CopyResult = {
  candidateId: string;
  status: "copied" | "failed";
  bucket?: string;
  reason: string;
  sourceHash?: string;
  chainName?: string;
  side?: TradeSide;
  tokenSymbol?: string;
  tokenAddress?: string;
  quantity?: number;
  notionalUsd?: number;
  totalFeesUsd?: number;
  totalCostUsd?: number;
  sellProceedsUsd?: number;
  cashCap?: { fromUsd: number; toUsd: number } | null;
  tradeId?: string;
};

type CandidateAttention = {
  ready: number;
  review: number;
  blocked: number;
  failed: number;
  copied: number;
  total: number;
};

type PaperArchiveSummary = {
  id: string;
  name: string;
  tradeCount: number;
  ledgerEntryCount: number;
  quoteCount: number;
  copiedCandidateCount: number;
  createdAt: string;
};

type TradeSignal = {
  label: string;
  tone: "warn" | "bad";
  title: string;
};

const initialTrade = {
  side: "buy" as TradeSide,
  chainId: "8453",
  tokenAddress: "",
  usdAmount: "250",
  tokenQuantity: "",
  slippageBps: String(DEFAULT_SLIPPAGE_BPS),
  gasBufferBps: String(DEFAULT_GAS_BUFFER_BPS)
};

const initialCopySettingsForm = settingsToForm(DEFAULT_COPY_SETTINGS);

export default function Home() {
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [tradeForm, setTradeForm] = useState(initialTrade);
  const [copySettingsForm, setCopySettingsForm] = useState<CopySettingsForm>(initialCopySettingsForm);
  const [walletForm, setWalletForm] = useState({ address: "", label: "", notes: "", gmgnUrl: "" });
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [activity, setActivity] = useState<WalletActivity[]>([]);
  const [candidates, setCandidates] = useState<TradeCandidate[]>([]);
  const [copyResults, setCopyResults] = useState<Record<string, CopyResult>>({});
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});
  const [pricesFetchedAt, setPricesFetchedAt] = useState<number | null>(null);
  const [isPricesStale, setIsPricesStale] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);
  const [lossOfferTokenAddress, setLossOfferTokenAddress] = useState("");
  const [activityContext, setActivityContext] = useState<{
    label: string;
    address: string;
    fetched: number;
    warnings: string[];
  } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ledgerOk, setLedgerOk] = useState<{ ok: boolean; count: number } | null>(null);
  const [paperArchives, setPaperArchives] = useState<PaperArchiveSummary[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState("");
  const fetchPricesRef = useRef<() => void>(() => {});

  const refresh = async () => {
    const response = await fetch("/api/portfolio", { cache: "no-store" });
    const payload = await readJsonResponse<PortfolioPayload>(response, "Could not load portfolio.");
    setData(payload);
  };

  const refreshLedgerStatus = async () => {
    const response = await fetch("/api/ledger/verify", { cache: "no-store" });
    const payload = await readJsonResponse<{ ok: boolean; mismatches: unknown[] }>(
      response,
      "Could not verify ledger."
    );
    setLedgerOk({ ok: payload.ok, count: payload.mismatches.length });
  };

  const refreshPaperArchives = async () => {
    const response = await fetch("/api/portfolio/archives", { cache: "no-store" });
    const payload = await readJsonResponse<{ archives: PaperArchiveSummary[] }>(
      response,
      "Could not load paper portfolio archives."
    );
    setPaperArchives(payload.archives);
    setSelectedArchiveId((current) => (payload.archives.some((archive) => archive.id === current) ? current : payload.archives[0]?.id ?? ""));
  };

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load portfolio."));
    refreshLedgerStatus().catch(() => setLedgerOk(null));
    refreshPaperArchives().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not load paper portfolio archives.")
    );
  }, []);

  useEffect(() => {
    if (data?.copySettings) {
      setCopySettingsForm(settingsToForm(data.copySettings));
    }
  }, [data?.copySettings]);

  useEffect(() => {
    if (!fetchedAt) return;
    const interval = setInterval(() => {
      if (isQuoteStale(fetchedAt, Date.now(), 120_000)) setIsStale(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchedAt]);

  useEffect(() => {
    if (!pricesFetchedAt) return;
    const interval = setInterval(() => {
      if (isQuoteStale(pricesFetchedAt, Date.now(), 120_000)) setIsPricesStale(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [pricesFetchedAt]);

  useEffect(() => { fetchPricesRef.current = fetchPositionPrices; });

  useEffect(() => {
    if (!autoRefreshInterval) return;
    const id = setInterval(() => fetchPricesRef.current(), autoRefreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefreshInterval]);

  const selectedPosition = useMemo(
    () =>
      data?.positions.find(
        (position) => position.tokenAddress.toLowerCase() === tradeForm.tokenAddress.trim().toLowerCase()
      ),
    [data?.positions, tradeForm.tokenAddress]
  );
  const candidateStats = useMemo(() => getCandidateStats(candidates), [candidates]);

  const totalUnrealizedPnlUsd = useMemo(() => {
    if (!data?.positions.length || !Object.keys(positionPrices).length) return null;
    let total = 0;
    let priced = 0;
    for (const pos of data.positions) {
      const price = positionPrices[pos.tokenAddress];
      if (price !== undefined) {
        total += (price - pos.averageEntryUsd) * pos.quantity;
        priced++;
      }
    }
    return priced > 0 ? total : null;
  }, [data?.positions, positionPrices]);

  async function submitWallet(event: FormEvent) {
    event.preventDefault();
    setBusy("wallet");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/wallets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(walletForm)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save wallet.");
      setWalletForm({ address: "", label: "", notes: "", gmgnUrl: "" });
      setMessage("Wallet saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save wallet.");
    } finally {
      setBusy("");
    }
  }

  async function fetchActivity(wallet: Wallet) {
    const address = wallet.address;
    setBusy(address);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/wallets/${address}/activity`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not fetch activity.");
      setActivity(payload.activity);
      setCandidates(Array.isArray(payload.candidates) ? payload.candidates : []);
      setActivityContext({
        label: wallet.label,
        address,
        fetched: payload.fetched,
        warnings: Array.isArray(payload.warnings) ? payload.warnings : []
      });
      setMessage(`Fetched ${payload.fetched} wallet transfers.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch activity.");
    } finally {
      setBusy("");
    }
  }

  async function deleteWatchedWallet(wallet: Wallet) {
    if (!window.confirm(`Delete ${wallet.label} from the watchlist? Cached activity for this wallet will also be removed.`)) {
      return;
    }

    setBusy(`delete-${wallet.address}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/wallets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: wallet.address })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not delete wallet.");
      if (activityContext?.address === wallet.address) {
        setActivity([]);
        setCandidates([]);
        setActivityContext(null);
      }
      setMessage("Wallet deleted.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete wallet.");
    } finally {
      setBusy("");
    }
  }

  async function previewTrade(event: FormEvent) {
    event.preventDefault();
    setBusy("preview");
    setError("");
    setMessage("");
    setLossOfferTokenAddress("");
    setPreview(null);
    setFetchedAt(null);
    setIsStale(false);
    try {
      const response = await fetch("/api/trades/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTradePayload())
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not preview trade.");
      setPreview(payload.preview);
      setFetchedAt(Date.now());
      setIsStale(false);
      setMessage("Quote preview ready.");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not preview trade.";
      if (tradeForm.side === "sell" && selectedPosition && isNoRouteError(reason)) {
        setLossOfferTokenAddress(selectedPosition.tokenAddress);
      }
      setError(reason);
    } finally {
      setBusy("");
    }
  }

  async function fetchPositionPrices() {
    if (!data?.positions.length) return;
    setBusy("prices");
    setError("");
    setIsPricesStale(false);
    try {
      const byChain = new Map<number, string[]>();
      for (const position of data.positions) {
        byChain.set(position.chainId, [...(byChain.get(position.chainId) ?? []), position.tokenAddress]);
      }
      const payloads = await Promise.all(
        Array.from(byChain.entries()).map(async ([chainId, addresses]) => {
          const tokens = addresses.join(",");
          const response = await fetch(`/api/prices?tokens=${tokens}&chainId=${chainId}`, { cache: "no-store" });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Could not fetch prices.");
          return payload as { prices: Record<string, number | null> };
        })
      );
      const resolved: Record<string, number> = {};
      for (const payload of payloads) {
        for (const [addr, price] of Object.entries(payload.prices)) {
          if (typeof price === "number" && Number.isFinite(price) && price > 0) {
            resolved[addr] = price;
          }
        }
      }
      setPositionPrices(resolved);
      setPricesFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch prices.");
    } finally {
      setBusy("");
    }
  }

  async function executeTrade() {
    setBusy("execute");
    setError("");
    setMessage("");
    setLossOfferTokenAddress("");
    try {
      const response = await fetch("/api/trades/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTradePayload())
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not execute trade.");
      setPreview(payload.preview);
      setFetchedAt(Date.now());
      setIsStale(false);
      setMessage("Paper trade executed.");
      await refresh();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not execute trade.";
      if (tradeForm.side === "sell" && selectedPosition && isNoRouteError(reason)) {
        setLossOfferTokenAddress(selectedPosition.tokenAddress);
      }
      setError(reason);
    } finally {
      setBusy("");
    }
  }

  async function saveCopySettings(event: FormEvent) {
    event.preventDefault();
    setBusy("settings");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCopySettingsPayload(copySettingsForm))
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save copy settings.");
      setCopySettingsForm(settingsToForm(payload.copySettings));
      setMessage("Copy settings saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save copy settings.");
    } finally {
      setBusy("");
    }
  }

  async function copyCandidate(candidate: TradeCandidate) {
    setBusy(`copy-${candidate.id}`);
    setError("");
    setMessage("");
    setCopyResults((current) => {
      const next = { ...current };
      delete next[candidate.id];
      return next;
    });
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/copy`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        const failedResult = (payload.copyResult as CopyResult | undefined) ?? {
          candidateId: candidate.id,
          status: "failed",
          bucket: "unknown",
          reason: payload.error ?? "Could not copy candidate."
        };
        setCopyResults((current) => ({ ...current, [candidate.id]: failedResult }));
        setError(failedResult.reason);
        return;
      }
      const result = payload.copyResult as CopyResult | undefined;
      setCandidates((current) =>
        current.map((item) =>
          item.id === candidate.id
            ? { ...item, status: "copied", reason: result?.reason ?? "Copied into the paper portfolio." }
            : item
        )
      );
      if (result) {
        setCopyResults((current) => ({ ...current, [candidate.id]: result }));
      }
      setMessage(result?.tradeId ? `Candidate copied as trade ${result.tradeId}.` : "Candidate copied into paper portfolio.");
      await refresh();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not copy candidate.";
      const failedResult: CopyResult = { candidateId: candidate.id, status: "failed", bucket: "unknown", reason };
      setCopyResults((current) => ({ ...current, [candidate.id]: failedResult }));
      setError(reason);
    } finally {
      setBusy("");
    }
  }

  async function markPositionTotalLoss(position: Position) {
    if (
      !window.confirm(
        `Mark ${position.symbol} as a total loss? This will close the paper position with $0 proceeds and realize ${formatUsd(
          -position.costBasisUsd
        )} PnL.`
      )
    ) {
      return;
    }

    setBusy(`loss-${position.tokenAddress}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/positions/${position.tokenAddress}/zero`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not mark position as a total loss.");
      setLossOfferTokenAddress("");
      setMessage(`Marked ${position.symbol} as a total loss.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark position as a total loss.");
    } finally {
      setBusy("");
    }
  }

  const importInputRef = useRef<HTMLInputElement>(null);

  async function importSimulatorData(file: File) {
    setError("");
    setMessage("");

    let bundle: unknown;
    try {
      bundle = JSON.parse(await file.text());
    } catch {
      setError("File is not valid JSON.");
      return;
    }

    setBusy("import-data");
    try {
      const previewResponse = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle)
      });
      const previewPayload = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(previewPayload.error ?? "Could not read import file.");

      const s = previewPayload.summary as {
        wallets: number; tokens: number; trades: number; ledgerEntries: number; quotes: number;
        walletActivity: number; tradeCandidates: number; settings: number; startingCashUsd: number;
      };
      const confirmed = window.confirm(
        "Import will REPLACE all local data with the selected file:\n\n" +
          `- ${s.wallets} wallets\n` +
          `- ${s.tokens} tokens\n` +
          `- ${s.trades} trades\n` +
          `- ${s.ledgerEntries} ledger entries\n` +
          `- ${s.quotes} quotes\n` +
          `- ${s.walletActivity} activity rows\n` +
          `- ${s.tradeCandidates} candidates\n` +
          `- ${s.settings} settings\n` +
          `Starting cash: ${formatUsd(s.startingCashUsd)}\n\n` +
          "This cannot be undone. Continue?"
      );
      if (!confirmed) {
        setBusy("");
        return;
      }

      const importResponse = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle)
      });
      const importPayload = await importResponse.json();
      if (!importResponse.ok) throw new Error(importPayload.error ?? "Could not import local data.");

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import local data.");
      setBusy("");
    }
  }

  async function exportSimulatorData() {
    setBusy("export-data");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/export", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof payload?.error === "string" ? payload.error : "Could not export local data.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `gmgn-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Export downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export local data.");
    } finally {
      setBusy("");
    }
  }

  async function archivePaperPortfolio() {
    const defaultName = `Before experiment ${new Date().toLocaleString()}`;
    const name = window.prompt("Archive name", defaultName);
    if (name === null) return;

    setBusy("archive-paper");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/portfolio/archives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not archive paper portfolio.");
      await refreshPaperArchives();
      setMessage(`Archived paper portfolio as "${payload.archive.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive paper portfolio.");
    } finally {
      setBusy("");
    }
  }

  async function restorePaperPortfolioArchive(archive: PaperArchiveSummary) {
    const confirmed = window.confirm(
      `Restore "${archive.name}"?\n\n` +
        `- ${archive.tradeCount} trades\n` +
        `- ${archive.ledgerEntryCount} ledger entries\n` +
        `- ${archive.quoteCount} quotes\n\n` +
        "This replaces the current paper portfolio but preserves watched wallets, activity, candidates, and settings."
    );
    if (!confirmed) return;

    setBusy(`restore-archive-${archive.id}`);
    setError("");
    setMessage("");
    setPreview(null);
    setFetchedAt(null);
    setIsStale(false);
    setPositionPrices({});
    setPricesFetchedAt(null);
    setIsPricesStale(false);
    setLossOfferTokenAddress("");
    try {
      const response = await fetch(`/api/portfolio/archives/${archive.id}/restore`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not restore paper portfolio archive.");
      setCopyResults({});
      await refresh();
      await refreshLedgerStatus();
      await refreshPaperArchives();
      setMessage(`Restored paper portfolio archive "${payload.archive.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore paper portfolio archive.");
    } finally {
      setBusy("");
    }
  }

  async function renamePaperPortfolioArchive(archive: PaperArchiveSummary) {
    const name = window.prompt("Archive name", archive.name);
    if (name === null || name.trim() === archive.name) return;

    setBusy(`rename-archive-${archive.id}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/portfolio/archives/${archive.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not rename paper portfolio archive.");
      await refreshPaperArchives();
      setMessage(`Renamed archive to "${payload.archive.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename paper portfolio archive.");
    } finally {
      setBusy("");
    }
  }

  async function deletePaperPortfolioArchive(archive: PaperArchiveSummary) {
    if (!window.confirm(`Delete paper archive "${archive.name}"? This does not affect the current portfolio.`)) return;

    setBusy(`delete-archive-${archive.id}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/portfolio/archives/${archive.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not delete paper portfolio archive.");
      await refreshPaperArchives();
      setMessage(`Deleted archive "${archive.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete paper portfolio archive.");
    } finally {
      setBusy("");
    }
  }

  async function resetPaperPortfolio() {
    if (
      !window.confirm(
        "Reset the simulated paper portfolio? This clears paper trades, ledger entries, quote previews, and copy attempt results. Watched wallets, raw wallet activity, candidates, and copy settings are preserved."
      )
    ) {
      return;
    }

    setBusy("reset-portfolio");
    setError("");
    setMessage("");
    setPreview(null);
    setFetchedAt(null);
    setIsStale(false);
    setLossOfferTokenAddress("");
    try {
      const response = await fetch("/api/portfolio/reset", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not reset paper portfolio.");
      setCopyResults({});
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.status === "copied" || candidate.status === "failed"
            ? {
                ...candidate,
                status: "candidate",
                reason: "Paper portfolio was reset; review this candidate before copying again.",
                lastCopyStatus: "",
                lastCopyBucket: "",
                lastCopyReason: "",
                lastCopyTradeId: "",
                lastCopyAt: ""
              }
            : {
                ...candidate,
                lastCopyStatus: "",
                lastCopyBucket: "",
                lastCopyReason: "",
                lastCopyTradeId: "",
                lastCopyAt: ""
              }
        )
      );
      setMessage("Paper portfolio reset.");
      await refresh();
      await refreshLedgerStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset paper portfolio.");
    } finally {
      setBusy("");
    }
  }

  async function reprocessStoredCandidates() {
    setBusy("reprocess-candidates");
    setError("");
    setMessage("");
    try {
      const previewResponse = await fetch("/api/candidates/reprocess", { cache: "no-store" });
      const previewPayload = await previewResponse.json();
      if (!previewResponse.ok) {
        throw new Error(previewPayload.error ?? "Could not preview stored activity candidates.");
      }

      const s = previewPayload.summary as {
        stored: number; derived: number; missing: number;
        newDecoded: number; newReview: number; newSkipped: number;
      };
      if (s.missing === 0) {
        setMessage(`No new candidates to reprocess (stored ${s.stored}, derived ${s.derived}).`);
        return;
      }

      const confirmed = window.confirm(
        `Reprocess stored wallet activity into ${s.missing} missing candidate(s)?\n\n` +
          `- ${s.newDecoded} decoded\n` +
          `- ${s.newReview} review\n` +
          `- ${s.newSkipped} skipped\n\n` +
          "Existing candidates (including copied/failed) are left untouched. Continue?"
      );
      if (!confirmed) return;

      const applyResponse = await fetch("/api/candidates/reprocess", { method: "POST" });
      const applyPayload = await applyResponse.json();
      if (!applyResponse.ok) {
        throw new Error(applyPayload.error ?? "Could not reprocess stored activity candidates.");
      }

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reprocess stored activity candidates.");
      setBusy("");
    }
  }

  function buildTradePayload() {
    const sellQuantity =
      tradeForm.tokenQuantity || (selectedPosition?.quantity ? String(selectedPosition.quantity) : "");

    return {
      side: tradeForm.side,
      chainId: Number(tradeForm.chainId),
      tokenAddress: tradeForm.tokenAddress,
      usdAmount: tradeForm.side === "buy" ? Number(tradeForm.usdAmount) : undefined,
      tokenQuantity: tradeForm.side === "sell" ? Number(sellQuantity) : undefined,
      slippageBps: Number(tradeForm.slippageBps),
      gasBufferBps: Number(tradeForm.gasBufferBps)
    };
  }

  const portfolio = data?.portfolio;
  const stats = data?.stats;
  const analytics = data?.analytics;
  const selectedArchive = paperArchives.find((archive) => archive.id === selectedArchiveId) ?? paperArchives[0] ?? null;
  const lossOfferPosition =
    lossOfferTokenAddress && data?.positions.find((position) => position.tokenAddress === lossOfferTokenAddress);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">Ethereum paper execution</p>
          <h1>GMGN wallet simulator</h1>
        </div>
        {ledgerOk ? (
          <span className={ledgerOk.ok ? "pill good" : "pill bad"} title="Ledger consistency check against the trade log">
            {ledgerOk.ok ? "Ledger ✓ verified" : `⚠ ${ledgerOk.count} ledger mismatches`}
          </span>
        ) : null}
        <button className="button secondary" onClick={() => refresh()} title="Refresh portfolio">
          <RefreshCw size={18} />
          Refresh
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importSimulatorData(file);
          }}
        />
        <button
          className="button secondary"
          onClick={() => importInputRef.current?.click()}
          disabled={busy === "import-data"}
          title="Import a local simulator export"
        >
          {busy === "import-data" ? <Loader2 size={18} /> : <Upload size={18} />}
          Import data
        </button>
        <button
          className="button secondary"
          onClick={() => exportSimulatorData()}
          disabled={busy === "export-data"}
          title="Export local simulator data"
        >
          {busy === "export-data" ? <Loader2 size={18} /> : <Download size={18} />}
          Export data
        </button>
        <button
          className="button secondary"
          onClick={() => reprocessStoredCandidates()}
          disabled={busy === "reprocess-candidates"}
          title="Reprocess stored wallet activity into missing trade candidates"
        >
          {busy === "reprocess-candidates" ? <Loader2 size={18} /> : <ListRestart size={18} />}
          Reprocess
        </button>
        <button
          className="button secondary"
          onClick={() => archivePaperPortfolio()}
          disabled={busy === "archive-paper"}
          title="Archive the current paper trades, ledger, quotes, and copied candidate links"
        >
          {busy === "archive-paper" ? <Loader2 size={18} /> : <Archive size={18} />}
          Archive paper
        </button>
        {paperArchives.length ? (
          <>
            <select
              className="archive-select"
              value={selectedArchive?.id ?? ""}
              onChange={(event) => setSelectedArchiveId(event.target.value)}
              title="Select a paper portfolio archive"
            >
              {paperArchives.map((archive) => (
                <option key={archive.id} value={archive.id}>
                  {archive.name} · {archive.tradeCount} trades · {new Date(archive.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              onClick={() => selectedArchive && restorePaperPortfolioArchive(selectedArchive)}
              disabled={!selectedArchive || busy.startsWith("restore-archive-")}
              title={selectedArchive ? `Restore ${selectedArchive.name}` : "No paper archives yet"}
            >
              {busy.startsWith("restore-archive-") ? <Loader2 size={18} /> : <ArchiveRestore size={18} />}
              Restore
            </button>
            <button
              className="icon-button"
              onClick={() => selectedArchive && renamePaperPortfolioArchive(selectedArchive)}
              disabled={!selectedArchive || busy.startsWith("rename-archive-")}
              title={selectedArchive ? `Rename ${selectedArchive.name}` : "No paper archives yet"}
            >
              {busy.startsWith("rename-archive-") ? <Loader2 size={18} /> : <Save size={18} />}
            </button>
            <button
              className="icon-button danger"
              onClick={() => selectedArchive && deletePaperPortfolioArchive(selectedArchive)}
              disabled={!selectedArchive || busy.startsWith("delete-archive-")}
              title={selectedArchive ? `Delete ${selectedArchive.name}` : "No paper archives yet"}
            >
              {busy.startsWith("delete-archive-") ? <Loader2 size={18} /> : <Trash2 size={18} />}
            </button>
            <span className="pill">{paperArchives.length} archived</span>
          </>
        ) : null}
        <button
          className="button danger"
          onClick={() => resetPaperPortfolio()}
          disabled={busy === "reset-portfolio"}
          title="Reset simulated paper trades and ledger"
        >
          {busy === "reset-portfolio" ? <Loader2 size={18} /> : <Trash2 size={18} />}
          Reset paper
        </button>
      </header>

      {error ? (
        <div className="alert stack">
          <p>{error}</p>
          {lossOfferPosition ? (
            <button
              className="button danger"
              onClick={() => markPositionTotalLoss(lossOfferPosition)}
              disabled={busy === `loss-${lossOfferPosition.tokenAddress}`}
              title="Mark position as total loss"
            >
              {busy === `loss-${lossOfferPosition.tokenAddress}` ? <Loader2 size={18} /> : <Trash2 size={18} />}
              Mark {lossOfferPosition.symbol} as total loss
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? <div className="alert success">{message}</div> : null}

      <section className="section grid dashboard-grid">
        <Metric icon={<BadgeDollarSign size={20} />} label="Cash" value={formatUsd(portfolio?.cashUsd ?? 0)} />
        <Metric icon={<Target size={20} />} label="Equity basis" value={formatUsd(stats?.equityUsd ?? 0)} />
        <Metric icon={<Activity size={20} />} label="Realized PnL" value={formatUsd(portfolio?.realizedPnlUsd ?? 0)} />
        <Metric icon={<History size={20} />} label="Fees paid" value={formatUsd(stats?.totalFeesUsd ?? 0)} />
        <Metric
          icon={<TrendingUp size={20} />}
          label="Unrealized P&L"
          value={totalUnrealizedPnlUsd !== null ? formatUsd(totalUnrealizedPnlUsd) : "—"}
          valueClassName={totalUnrealizedPnlUsd !== null ? (totalUnrealizedPnlUsd >= 0 ? "good" : "bad") : ""}
        />
      </section>

      <section className="section grid dashboard-grid trust-strip">
        <Metric
          className="compact-metric"
          icon={<Activity size={18} />}
          label="Win rate"
          value={formatNullablePercent(analytics?.winRate, "No closed trades")}
        />
        <Metric
          className="compact-metric"
          icon={<BadgeDollarSign size={18} />}
          label="Fee drag"
          value={formatNullablePercent(analytics?.feeDrag)}
        />
        <Metric
          className="compact-metric"
          icon={<Target size={18} />}
          label="Open exposure"
          value={formatUsd(analytics?.openExposureUsd ?? 0)}
        />
        <Metric
          className="compact-metric"
          icon={<History size={18} />}
          label="Avg hold"
          value={formatHoldHours(analytics?.averageHoldHours)}
        />
      </section>

      <section className="section">
        <div className="row">
          <h2>Candidate attention</h2>
          <span className="pill">{data?.candidateAttention.total ?? 0} saved</span>
        </div>
        <CandidateAttentionStrip summary={data?.candidateAttention} />
      </section>

      <section className="section grid main-grid">
        <div className="stack">
          <div className="panel">
            <div className="row">
              <h2>Trade ticket</h2>
              <span className="pill">0x + Uniswap quote</span>
            </div>
            <form className="stack" onSubmit={previewTrade}>
              <div className="segmented" aria-label="Trade side">
                {(["buy", "sell"] as TradeSide[]).map((side) => (
                  <button
                    type="button"
                    className={tradeForm.side === side ? "active" : ""}
                    onClick={() => {
                      setPreview(null);
                      setFetchedAt(null);
                      setIsStale(false);
                      setTradeForm((current) => ({ ...current, side }));
                    }}
                    key={side}
                  >
                    {side.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="tradeChain">Chain</label>
                  <select
                    id="tradeChain"
                    value={tradeForm.chainId}
                    onChange={(event) => {
                      setPreview(null);
                      setFetchedAt(null);
                      setIsStale(false);
                      setTradeForm({ ...tradeForm, chainId: event.target.value });
                    }}
                  >
                    <option value="8453">Base</option>
                    <option value="1">Ethereum</option>
                  </select>
                </div>
                <div className="field full">
                  <label htmlFor="tokenAddress">ERC-20 contract</label>
                  <input
                    id="tokenAddress"
                    value={tradeForm.tokenAddress}
                    onChange={(event) => setTradeForm({ ...tradeForm, tokenAddress: event.target.value })}
                    placeholder="0x..."
                  />
                </div>
                {tradeForm.side === "buy" ? (
                  <div className="field">
                    <label htmlFor="usdAmount">USD amount</label>
                    <input
                      id="usdAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={tradeForm.usdAmount}
                      onChange={(event) => setTradeForm({ ...tradeForm, usdAmount: event.target.value })}
                    />
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="tokenQuantity">Token quantity</label>
                    <input
                      id="tokenQuantity"
                      type="number"
                      min="0"
                      step="any"
                      value={tradeForm.tokenQuantity || selectedPosition?.quantity || ""}
                      onChange={(event) => setTradeForm({ ...tradeForm, tokenQuantity: event.target.value })}
                    />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="slippageBps">Slippage bps</label>
                  <input
                    id="slippageBps"
                    type="number"
                    min="0"
                    max="5000"
                    value={tradeForm.slippageBps}
                    onChange={(event) => setTradeForm({ ...tradeForm, slippageBps: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="gasBufferBps">Gas buffer bps</label>
                  <input
                    id="gasBufferBps"
                    type="number"
                    min="0"
                    max="10000"
                    value={tradeForm.gasBufferBps}
                    onChange={(event) => setTradeForm({ ...tradeForm, gasBufferBps: event.target.value })}
                  />
                </div>
              </div>
              <button className="button" type="submit" disabled={busy === "preview"}>
                {busy === "preview" ? <Loader2 size={18} /> : <Eye size={18} />}
                Preview
              </button>
            </form>

            {preview ? (
              <div className="quote-box stack">
                {isStale && (
                  <div className="alert">
                    ⚠ Quote is over 2 minutes old — prices may have moved. Consider refreshing.
                  </div>
                )}
                <div className="row">
                  <div>
                    <h3>
                      {preview.side.toUpperCase()} {preview.token.symbol}
                    </h3>
                    <p className="subtle">
                      {formatNumber(preview.quantity, 6)} tokens at {formatUsdPrice(preview.priceUsd)}
                    </p>
                  </div>
                  <span className="pill">{preview.token.name}</span>
                </div>
                <div className="grid dashboard-grid">
                  <Mini label="Notional" value={formatUsd(preview.notionalUsd)} />
                  <Mini label="Gas" value={formatUsd(preview.gasUsd)} />
                  <Mini label="Slippage" value={formatUsd(preview.slippageUsd)} />
                  <Mini
                    label={preview.side === "buy" ? "All-in cost" : "Net proceeds"}
                    value={formatUsd(preview.side === "buy" ? preview.totalCostUsd : preview.sellProceedsUsd)}
                  />
                </div>
                <p className="subtle">
                  0x fee {formatUsd(preview.dexFeeUsd)}
                  {getValuedFeeUsd(preview.quoteSnapshot) > 0
                    ? ` (incl. ${formatUsd(getValuedFeeUsd(preview.quoteSnapshot))} valued from a non-USDC token)`
                    : ""}
                </p>
                {preview.warnings.map((warning) => (
                  <div className="alert" key={warning}>
                    {warning}
                  </div>
                ))}
                <QuoteDebug snapshot={preview.quoteSnapshot} />
                <button className="button" onClick={executeTrade} disabled={busy === "execute"}>
                  {busy === "execute" ? <Loader2 size={18} /> : <Send size={18} />}
                  Execute paper trade
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="row">
              <h2>Copy settings</h2>
              <span className="pill">{copySettingsForm.mode === "fixedUsd" ? "Fixed USD" : "Percent"}</span>
            </div>
            <form className="stack" onSubmit={saveCopySettings}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="copyMode">Copy mode</label>
                  <select
                    id="copyMode"
                    value={copySettingsForm.mode}
                    onChange={(event) =>
                      setCopySettingsForm({
                        ...copySettingsForm,
                        mode: event.target.value as CopySettingsForm["mode"]
                      })
                    }
                  >
                    <option value="fixedUsd">Fixed USD</option>
                    <option value="percentOfSource">Percent of source</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="insufficientCashBehavior">Insufficient cash</label>
                  <select
                    id="insufficientCashBehavior"
                    value={copySettingsForm.insufficientCashBehavior}
                    onChange={(event) =>
                      setCopySettingsForm({
                        ...copySettingsForm,
                        insufficientCashBehavior: event.target.value as CopySettingsForm["insufficientCashBehavior"]
                      })
                    }
                  >
                    <option value="skip">Skip</option>
                    <option value="cap">Cap</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="fixedUsd">Fixed USD</label>
                  <input
                    id="fixedUsd"
                    type="number"
                    min="1"
                    step="0.01"
                    value={copySettingsForm.fixedUsd}
                    onChange={(event) => setCopySettingsForm({ ...copySettingsForm, fixedUsd: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="percentOfSource">Source percent</label>
                  <input
                    id="percentOfSource"
                    type="number"
                    min="1"
                    max="100"
                    step="0.1"
                    value={copySettingsForm.percentOfSource}
                    onChange={(event) =>
                      setCopySettingsForm({ ...copySettingsForm, percentOfSource: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="maxTradeUsd">Max trade USD</label>
                  <input
                    id="maxTradeUsd"
                    type="number"
                    min="1"
                    step="0.01"
                    value={copySettingsForm.maxTradeUsd}
                    onChange={(event) => setCopySettingsForm({ ...copySettingsForm, maxTradeUsd: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="slippageCapBps">Slippage cap bps</label>
                  <input
                    id="slippageCapBps"
                    type="number"
                    min="0"
                    max="5000"
                    value={copySettingsForm.slippageCapBps}
                    onChange={(event) =>
                      setCopySettingsForm({ ...copySettingsForm, slippageCapBps: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="copyGasBufferBps">Gas buffer bps</label>
                  <input
                    id="copyGasBufferBps"
                    type="number"
                    min="0"
                    max="10000"
                    value={copySettingsForm.gasBufferBps}
                    onChange={(event) =>
                      setCopySettingsForm({ ...copySettingsForm, gasBufferBps: event.target.value })
                    }
                  />
                </div>
                <div className="field full">
                  <label htmlFor="allowlist">Allowlist</label>
                  <textarea
                    id="allowlist"
                    value={copySettingsForm.allowlist}
                    onChange={(event) => setCopySettingsForm({ ...copySettingsForm, allowlist: event.target.value })}
                    placeholder="0x..."
                  />
                </div>
                <div className="field full">
                  <label htmlFor="blocklist">Blocklist</label>
                  <textarea
                    id="blocklist"
                    value={copySettingsForm.blocklist}
                    onChange={(event) => setCopySettingsForm({ ...copySettingsForm, blocklist: event.target.value })}
                    placeholder="0x..."
                  />
                </div>
              </div>
              <button className="button secondary" type="submit" disabled={busy === "settings"}>
                {busy === "settings" ? <Loader2 size={18} /> : <Save size={18} />}
                Save settings
              </button>
            </form>
          </div>

          <div className="panel">
            <div className="row">
              <h2>Watchlist</h2>
              <span className="pill">{data?.wallets.length ?? 0} wallets</span>
            </div>
            <form className="stack" onSubmit={submitWallet}>
              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="walletAddress">Wallet address</label>
                  <input
                    id="walletAddress"
                    value={walletForm.address}
                    onChange={(event) => setWalletForm({ ...walletForm, address: event.target.value })}
                    placeholder="0x... or https://gmgn.ai/base/address/0x..."
                  />
                </div>
                <div className="field">
                  <label htmlFor="walletLabel">Label</label>
                  <input
                    id="walletLabel"
                    value={walletForm.label}
                    onChange={(event) => setWalletForm({ ...walletForm, label: event.target.value })}
                    placeholder="GMGN wallet"
                  />
                </div>
                <div className="field">
                  <label htmlFor="gmgnUrl">GMGN URL</label>
                  <input
                    id="gmgnUrl"
                    value={walletForm.gmgnUrl}
                    onChange={(event) => setWalletForm({ ...walletForm, gmgnUrl: event.target.value })}
                    placeholder="https://gmgn.ai/..."
                  />
                </div>
                <div className="field full">
                  <label htmlFor="walletNotes">Notes</label>
                  <textarea
                    id="walletNotes"
                    value={walletForm.notes}
                    onChange={(event) => setWalletForm({ ...walletForm, notes: event.target.value })}
                  />
                </div>
              </div>
              <button className="button secondary" type="submit" disabled={busy === "wallet"}>
                {busy === "wallet" ? <Loader2 size={18} /> : <Plus size={18} />}
                Add wallet
              </button>
            </form>
            <div className="list">
              {data?.wallets.map((wallet) => (
                <article className="card" key={wallet.address}>
                  <div className="row">
                    <div>
                      <h3>{wallet.label}</h3>
                      <p className="mono subtle">{wallet.address}</p>
                      {wallet.notes ? <p>{wallet.notes}</p> : null}
                    </div>
                    <div className="row compact">
                      <button
                        className="button secondary"
                        onClick={() => fetchActivity(wallet)}
                        disabled={busy === wallet.address || busy === `delete-${wallet.address}`}
                        title="Fetch wallet activity"
                      >
                        {busy === wallet.address ? <Loader2 size={18} /> : <WalletCards size={18} />}
                        Activity
                      </button>
                      <button
                        className="icon-button danger"
                        onClick={() => deleteWatchedWallet(wallet)}
                        disabled={busy === wallet.address || busy === `delete-${wallet.address}`}
                        title="Delete wallet"
                      >
                        {busy === `delete-${wallet.address}` ? <Loader2 size={18} /> : <Trash2 size={18} />}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="panel trust-panel">
            <div className="row">
              <h2>Trust signals</h2>
              <span className="pill">{analytics?.closedTrades ?? 0} closed</span>
            </div>
            <div className="grid dashboard-grid">
              <Mini label="Realized" value={formatUsd(analytics?.realizedPnlUsd ?? 0)} />
              <Mini label="Open exposure" value={formatUsd(analytics?.openExposureUsd ?? 0)} />
              <Mini label="Best token" value={formatTokenResult(analytics?.bestToken)} />
              <Mini label="Worst token" value={formatTokenResult(analytics?.worstToken)} />
            </div>
          </div>

          <div className="panel">
            <div className="row">
              <h2>Positions</h2>
              <span className="pill">{data?.positions.length ?? 0} open</span>
              <select
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                disabled={!data?.positions.length}
                title="Auto-refresh interval for position prices"
              >
                <option value={0}>Manual</option>
                <option value={60}>1 min</option>
                <option value={120}>2 min</option>
                <option value={300}>5 min</option>
              </select>
              <button
                className="button secondary"
                onClick={() => fetchPositionPrices()}
                disabled={busy === "prices" || !data?.positions.length}
                title="Fetch current prices for open positions"
              >
                {busy === "prices" ? <Loader2 size={18} /> : <RefreshCw size={18} />}
                Refresh prices
              </button>
            </div>
            {isPricesStale && (
              <div className="alert">
                ⚠ Position prices are over 2 minutes old — values may have moved. Consider refreshing.
              </div>
            )}
            <div className="list">
              {data?.positions.length ? (
                data.positions.map((position) => {
                  const currentPrice = positionPrices[position.tokenAddress];
                  const currentValueUsd = currentPrice !== undefined ? currentPrice * position.quantity : undefined;
                  const unrealizedPnlUsd = currentPrice !== undefined
                    ? (currentPrice - position.averageEntryUsd) * position.quantity
                    : undefined;
                  return (
                  <article className="card" key={position.tokenAddress}>
                    <div className="row">
                      <div>
                        <h3>
                          {position.symbol} <span className="subtle">{position.name}</span>
                        </h3>
                        <p className="mono subtle">{position.tokenAddress}</p>
                      </div>
                      <div className="row compact">
                        <span className={position.realizedPnlUsd >= 0 ? "pill good" : "pill bad"}>
                          {formatUsd(position.realizedPnlUsd)}
                        </span>
                        <button
                          className="button danger"
                          onClick={() => markPositionTotalLoss(position)}
                          disabled={busy === `loss-${position.tokenAddress}`}
                          title="Mark position as total loss"
                        >
                          {busy === `loss-${position.tokenAddress}` ? <Loader2 size={18} /> : <Trash2 size={18} />}
                          Mark loss
                        </button>
                      </div>
                    </div>
                    <div className="grid dashboard-grid">
                      <Mini label="Quantity" value={formatNumber(position.quantity, 6)} />
                      <Mini label="Avg entry" value={formatUsdPrice(position.averageEntryUsd)} />
                      <Mini label="Cost basis" value={formatUsd(position.costBasisUsd)} />
                      <Mini label="Fees" value={formatUsd(position.feesPaidUsd)} />
                      <Mini
                        label="Current value"
                        value={currentValueUsd !== undefined ? formatUsd(currentValueUsd) : "-"}
                      />
                      <UnrealizedPnl value={unrealizedPnlUsd} />
                    </div>
                  </article>
                  );
                })
              ) : (
                <p className="subtle">Open positions will appear after your first paper buy.</p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="row">
              <h2>Trade history</h2>
              <span className="pill">
                {stats?.wins ?? 0}W / {stats?.losses ?? 0}L
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Token</th>
                    <th>Signals</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Fees</th>
                    <th>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.trades.map((trade) => (
                    <tr key={trade.id}>
                      <td>{new Date(trade.createdAt).toLocaleString()}</td>
                      <td>
                        <span className={trade.side === "buy" ? "pill good" : "pill warn"}>{trade.side}</span>
                      </td>
                      <td>{trade.symbol}</td>
                      <td>
                        <TradeSignals trade={trade} />
                      </td>
                      <td>{formatNumber(trade.quantity, 6)}</td>
                      <td>{formatUsdPrice(trade.priceUsd)}</td>
                      <td>
                        <FeeBreakdown trade={trade} />
                      </td>
                      <td>{formatUsd(trade.realizedPnlUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="row">
              <h2>Wallet activity</h2>
              <span className="pill">{candidates.length} candidates</span>
            </div>
            <CandidateStatusSummary stats={candidateStats} />
            {activityContext ? (
              <p className="subtle">
                {activityContext.label} fetched {activityContext.fetched} ETH/ERC-20 transfers from Ethereum and Base.
              </p>
            ) : null}
            {activityContext?.warnings?.length ? (
              <div className="notice">
                {activityContext.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            {candidates.length ? (
              <div className="candidate-list">
                {candidates.slice(0, 5).map((candidate) => {
                  const isCopying = busy === `copy-${candidate.id}`;
                  const visibleCopyResult = isCopying
                    ? null
                    : copyResults[candidate.id] ?? candidateLastCopyResult(candidate);
                  const trust = classifyCandidateTrust(candidate);
                  return (
                  <article className="candidate" key={candidate.id}>
                    <div className="row">
                      <div>
                        <div className="activity-meta">
                          <span className={candidateStatusClass(candidate.status)}>{candidate.status}</span>
                          <span className={`pill ${trust.tone}`} title={trust.title}>{trust.label}</span>
                          <span className="pill">{candidate.chainName}</span>
                          <span className="pill">{Math.round(candidate.confidence * 100)}% confidence</span>
                        </div>
                        <h3>{candidateTitle(candidate)}</h3>
                        <TimestampLine timestamp={candidate.sourceTimestamp} />
                        <p className="subtle">{candidate.reason}</p>
                        {candidateCopyTokenAddress(candidate) ? (
                          <p className="mono subtle">{candidateCopyTokenAddress(candidate)}</p>
                        ) : null}
                        <ExplorerLink chainId={candidate.chainId} hash={candidate.hash} />
                      </div>
                      {trust.copyable ? (
                        <button
                          className="button secondary"
                          onClick={() => copyCandidate(candidate)}
                          disabled={isCopying}
                          title={candidateCopyButtonTitle(candidate, copyResults[candidate.id])}
                        >
                          {isCopying ? <Loader2 size={18} /> : <Send size={18} />}
                          {candidateCopyButtonLabel(candidate, copyResults[candidate.id])}
                        </button>
                      ) : trust.label === "Copied" ? null : (
                        <button className="button secondary" disabled title={trust.title}>
                          <Eye size={18} />
                          Review
                        </button>
                      )}
                    </div>
                    <div className="grid dashboard-grid">
                      <Mini label="Input" value={`${formatNumber(candidate.tokenInAmount, 6)} ${candidate.tokenInAsset || "-"}`} />
                      <Mini
                        label="Output"
                        value={`${formatNumber(candidate.tokenOutAmount, 6)} ${candidate.tokenOutAsset || "-"}`}
                      />
                      <Mini label="Transfers" value={String(candidate.transferCount)} />
                      <Mini label="Side" value={candidate.side} />
                    </div>
                    {visibleCopyResult ? <CopyResultPanel result={visibleCopyResult} /> : null}
                  </article>
                );
                })}
              </div>
            ) : null}
            <div className="list">
              {activity.slice(0, 8).map((item) => (
                <article className="card" key={item.id}>
                  <div className="row">
                    <div>
                      <div className="activity-meta">
                        <TimestampLine timestamp={item.timestamp} compact />
                        <span className={activityTypeClass(item)}>{activityTypeLabel(item)}</span>
                        <span className="pill">{item.chainName}</span>
                        <span className="pill">{item.category}</span>
                      </div>
                      <h3>
                        {item.asset} {formatNumber(item.value, 4)}
                      </h3>
                      <ExplorerLink chainId={item.chainId} hash={item.hash} />
                    </div>
                  </div>
                </article>
              ))}
              {!activity.length ? (
                <p className="subtle">
                  {activityContext
                    ? "No matching inbound or outbound ETH/ERC-20 transfers were returned for this wallet on Ethereum or Base."
                    : "Fetch a watched wallet to cache recent transfer activity."}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  className = "",
  valueClassName = ""
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`metric ${className}`.trim()}>
      <span className="row">
        {label}
        {icon}
      </span>
      <strong className={valueClassName || undefined}>{value}</strong>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label>{label}</label>
      <p>{value}</p>
    </div>
  );
}

function UnrealizedPnl({ value }: { value: number | undefined }) {
  if (value === undefined) {
    return (
      <div>
        <label>Unrealized P&amp;L</label>
        <p>-</p>
      </div>
    );
  }
  return (
    <div>
      <label>Unrealized P&amp;L</label>
      <p className={value >= 0 ? "good" : "bad"}>{formatUsd(value)}</p>
    </div>
  );
}

function CandidateStatusSummary({ stats }: { stats: ReturnType<typeof getCandidateStats> }) {
  return (
    <div className="status-strip" aria-label="Candidate status counts">
      <span className="pill good">{stats.copied} copied</span>
      <span className="pill good">{stats.decoded} decoded</span>
      <span className="pill warn">{stats.review} review</span>
      <span className="pill bad">{stats.failed} failed</span>
      <span className="pill bad">{stats.skipped} skipped</span>
    </div>
  );
}

function CandidateAttentionStrip({ summary }: { summary?: CandidateAttention }) {
  const counts = summary ?? { ready: 0, review: 0, blocked: 0, failed: 0, copied: 0, total: 0 };
  return (
    <div className="status-strip" aria-label="Saved candidate attention counts">
      <span className="pill good">{counts.ready} ready</span>
      <span className="pill warn">{counts.review} review</span>
      <span className="pill bad">{counts.blocked} blocked</span>
      <span className="pill bad">{counts.failed} failed</span>
      <span className="pill good">{counts.copied} copied</span>
    </div>
  );
}

function FeeBreakdown({ trade }: { trade: Trade }) {
  const totalFees = trade.gasUsd + trade.slippageUsd + trade.dexFeeUsd;
  const snapshot = parseSnapshot(trade.quoteSnapshot);
  const valuedFeeUsd = getValuedFeeUsd(snapshot);
  return (
    <div className="fee-stack">
      <strong>{formatUsd(totalFees)}</strong>
      <span>Gas {formatUsd(trade.gasUsd)}</span>
      <span>Slip {formatUsd(trade.slippageUsd)}</span>
      <span>0x {formatUsd(trade.dexFeeUsd)}</span>
      {valuedFeeUsd > 0 ? (
        <span className="subtle" title="Portion of the 0x fee that 0x reported in a non-USDC token and the simulator valued into USD.">
          incl. {formatUsd(valuedFeeUsd)} valued
        </span>
      ) : null}
    </div>
  );
}

function TradeSignals({ trade }: { trade: Trade }) {
  const signals = getTradeSignals(trade);
  if (!signals.length) return <span className="subtle">-</span>;

  return (
    <div className="signal-stack">
      {signals.map((signal) => (
        <span className={`pill ${signal.tone}`} title={signal.title} key={signal.label}>
          {signal.label}
        </span>
      ))}
    </div>
  );
}

function CopyResultPanel({ result }: { result: CopyResult }) {
  return (
    <div className={result.status === "copied" ? "copy-result success-result" : "copy-result failed-result"}>
      <div className="row">
        <div>
          <h3>{result.status === "copied" ? "Copied trade" : "Copy failed"}</h3>
          <p className="subtle">{result.reason}</p>
        </div>
        {result.status === "failed" && result.bucket ? (
          <span className="pill bad">{copyFailureBucketLabel(result.bucket)}</span>
        ) : null}
        {result.tradeId ? <span className="pill good">{shortId(result.tradeId)}</span> : null}
      </div>
      {result.status === "copied" ? (
        <div className="grid dashboard-grid">
          <Mini label="Paper side" value={result.side ?? "-"} />
          <Mini
            label="Size"
            value={
              result.quantity !== undefined && result.tokenSymbol
                ? `${formatNumber(result.quantity, 6)} ${result.tokenSymbol}`
                : "-"
            }
          />
          <Mini label="Notional" value={formatUsd(result.notionalUsd ?? 0)} />
          <Mini label="Fees" value={formatUsd(result.totalFeesUsd ?? 0)} />
        </div>
      ) : null}
    </div>
  );
}

function copyFailureBucketLabel(bucket: string) {
  const labels: Record<string, string> = {
    "already-copied": "Already copied",
    "blocked-token": "Blocked token",
    "insufficient-cash": "Cash",
    "missing-position": "No position",
    "missing-token-address": "No address",
    "no-liquidity": "No liquidity",
    "token-metadata": "Metadata",
    "unsupported-pattern": "Unsupported",
    unknown: "Unknown"
  };
  return labels[bucket] ?? "Unknown";
}

function candidateLastCopyResult(candidate: TradeCandidate): CopyResult | null {
  if (candidate.lastCopyStatus !== "copied" && candidate.lastCopyStatus !== "failed") return null;
  return {
    candidateId: candidate.id,
    status: candidate.lastCopyStatus,
    bucket: candidate.lastCopyBucket || undefined,
    reason: candidate.lastCopyReason || (candidate.lastCopyStatus === "copied" ? "Copied into the paper portfolio." : "Copy failed."),
    tradeId: candidate.lastCopyTradeId || undefined
  };
}

function candidateCopyButtonLabel(candidate: TradeCandidate, copyResult?: CopyResult) {
  const lastStatus = copyResult?.status ?? candidate.lastCopyStatus;
  return lastStatus === "failed" ? "Retry" : "Copy";
}

function candidateCopyButtonTitle(candidate: TradeCandidate, copyResult?: CopyResult) {
  const lastStatus = copyResult?.status ?? candidate.lastCopyStatus;
  return lastStatus === "failed" ? "Retry copy into paper portfolio" : "Copy into paper portfolio";
}

function settingsToForm(settings: CopySettings | typeof DEFAULT_COPY_SETTINGS): CopySettingsForm {
  return {
    mode: settings.mode,
    fixedUsd: String(settings.fixedUsd),
    percentOfSource: String(settings.percentOfSource),
    maxTradeUsd: String(settings.maxTradeUsd),
    slippageCapBps: String(settings.slippageCapBps),
    gasBufferBps: String(settings.gasBufferBps),
    insufficientCashBehavior: settings.insufficientCashBehavior,
    allowlist: Array.from(settings.allowlist).join("\n"),
    blocklist: Array.from(settings.blocklist).join("\n")
  };
}

function buildCopySettingsPayload(form: CopySettingsForm): CopySettings {
  return {
    mode: form.mode,
    fixedUsd: Number(form.fixedUsd),
    percentOfSource: Number(form.percentOfSource),
    maxTradeUsd: Number(form.maxTradeUsd),
    slippageCapBps: Number(form.slippageCapBps),
    gasBufferBps: Number(form.gasBufferBps),
    insufficientCashBehavior: form.insufficientCashBehavior,
    allowlist: parseTokenList(form.allowlist),
    blocklist: parseTokenList(form.blocklist)
  };
}

function parseTokenList(value: string) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

type CandidateTab = "actionable" | "review" | "all";

const ACTIONABLE_TRUST = new Set(["Ready", "Copied"]);

function candidateTab(candidate: TradeCandidate): "actionable" | "review" {
  return ACTIONABLE_TRUST.has(classifyCandidateTrust(candidate).label) ? "actionable" : "review";
}

function CandidateList({
  candidates,
  copyResults,
  busy,
  copyCandidate,
}: {
  candidates: TradeCandidate[];
  copyResults: Record<string, CopyResult>;
  busy: string;
  copyCandidate: (candidate: TradeCandidate) => void;
}) {
  const [activeTab, setActiveTab] = useState<CandidateTab>("actionable");
  const [visibleCount, setVisibleCount] = useState(5);

  useEffect(() => {
    setVisibleCount(5);
  }, [activeTab]);

  const tabCandidates = useMemo(
    () => (activeTab === "all" ? candidates : candidates.filter((c) => candidateTab(c) === activeTab)),
    [candidates, activeTab]
  );

  const visibleCandidates = tabCandidates.slice(0, visibleCount);
  const remaining = Math.max(0, tabCandidates.length - visibleCount);

  function tabCount(tab: CandidateTab) {
    if (tab === "all") return candidates.length;
    return candidates.filter((c) => candidateTab(c) === tab).length;
  }

  return (
    <div>
      <div className="tab-row">
        {(["actionable", "review", "all"] as CandidateTab[]).map((tab) => (
          <button
            key={tab}
            className={`tab-button${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}{" "}
            <span className="pill">{tabCount(tab)}</span>
          </button>
        ))}
      </div>
      <div className="candidate-list">
        {visibleCandidates.map((candidate) => {
          const isCopying = busy === `copy-${candidate.id}`;
          const visibleCopyResult = isCopying
            ? null
            : copyResults[candidate.id] ?? candidateLastCopyResult(candidate);
          const trust = classifyCandidateTrust(candidate);
          return (
            <article className="candidate" key={candidate.id}>
              <div className="row">
                <div>
                  <div className="activity-meta">
                    <span className={candidateStatusClass(candidate.status)}>{candidate.status}</span>
                    <span className={`pill ${trust.tone}`} title={trust.title}>{trust.label}</span>
                    <span className="pill">{candidate.chainName}</span>
                    <span className="pill">{Math.round(candidate.confidence * 100)}% confidence</span>
                  </div>
                  <h3>{candidateTitle(candidate)}</h3>
                  <TimestampLine timestamp={candidate.sourceTimestamp} />
                  <p className="subtle">{candidate.reason}</p>
                  {candidateCopyTokenAddress(candidate) ? (
                    <p className="mono subtle">{candidateCopyTokenAddress(candidate)}</p>
                  ) : null}
                  <ExplorerLink chainId={candidate.chainId} hash={candidate.hash} />
                </div>
                {trust.copyable ? (
                  <button
                    className="button secondary"
                    onClick={() => copyCandidate(candidate)}
                    disabled={isCopying}
                    title={candidateCopyButtonTitle(candidate, copyResults[candidate.id])}
                  >
                    {isCopying ? <Loader2 size={18} /> : <Send size={18} />}
                    {candidateCopyButtonLabel(candidate, copyResults[candidate.id])}
                  </button>
                ) : trust.label === "Copied" ? null : (
                  <button className="button secondary" disabled title={trust.title}>
                    <Eye size={18} />
                    Review
                  </button>
                )}
              </div>
              <div className="grid dashboard-grid">
                <Mini label="Input" value={`${formatNumber(candidate.tokenInAmount, 6)} ${candidate.tokenInAsset || "-"}`} />
                <Mini
                  label="Output"
                  value={`${formatNumber(candidate.tokenOutAmount, 6)} ${candidate.tokenOutAsset || "-"}`}
                />
                <Mini label="Transfers" value={String(candidate.transferCount)} />
                <Mini label="Side" value={candidate.side} />
              </div>
              {visibleCopyResult ? <CopyResultPanel result={visibleCopyResult} /> : null}
            </article>
          );
        })}
      </div>
      {remaining > 0 ? (
        <button
          className="button secondary"
          style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
          onClick={() => setVisibleCount((n) => n + 10)}
        >
          Show {Math.min(10, remaining)} more ({remaining} remaining in {activeTab})
        </button>
      ) : null}
    </div>
  );
}

function getCandidateStats(candidates: TradeCandidate[]) {
  return candidates.reduce(
    (stats, candidate) => {
      if (candidate.status === "copied") stats.copied += 1;
      if (candidate.status === "decoded") stats.decoded += 1;
      if (candidate.status === "failed") stats.failed += 1;
      if (candidate.status === "skipped") stats.skipped += 1;
      if (candidate.status === "candidate" || candidate.status === "partial") stats.review += 1;
      return stats;
    },
    { copied: 0, decoded: 0, review: 0, failed: 0, skipped: 0 }
  );
}

function getTradeSignals(trade: Trade): TradeSignal[] {
  const snapshot = parseSnapshot(trade.quoteSnapshot);
  const signals: TradeSignal[] = [];
  const gasImpact = trade.notionalUsd > 0 ? trade.gasUsd / trade.notionalUsd : 0;
  const slippageImpact = trade.notionalUsd > 0 ? trade.slippageUsd / trade.notionalUsd : 0;
  const snapshotWarnings = getSnapshotWarnings(snapshot);

  if (snapshot.action === "mark-total-loss" || (trade.side === "sell" && trade.priceUsd === 0 && trade.realizedPnlUsd < 0)) {
    signals.push({
      label: "Manual loss",
      tone: "bad",
      title: "This position was manually closed at $0 because liquidity or routing was unavailable."
    });
  }

  if (gasImpact >= 0.02) {
    signals.push({
      label: "High gas",
      tone: "warn",
      title: `Gas was ${formatPercent(gasImpact)} of simulated notional.`
    });
  }

  if (slippageImpact >= 0.02 || trade.slippageUsd >= 10) {
    signals.push({
      label: "High slip",
      tone: "warn",
      title: `Slippage buffer was ${formatPercent(slippageImpact)} of simulated notional.`
    });
  }

  if (snapshotWarnings.length) {
    signals.push({
      label: "Quote warn",
      tone: "warn",
      title: snapshotWarnings.join(" ")
    });
  }

  const unpricedFeeTokens = getStillUnpricedFeeTokens(snapshot);
  if (unpricedFeeTokens.length) {
    signals.push({
      label: "Unpriced fee",
      tone: "bad",
      title: `0x reported a fee in ${unpricedFeeTokens.join(", ")} the simulator could not value in USD; the real cost is higher than shown.`
    });
  }

  return signals;
}

function parseSnapshot(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getSnapshotWarnings(snapshot: Record<string, unknown>) {
  const normalizedQuote = snapshot.normalizedQuote;
  if (!normalizedQuote || typeof normalizedQuote !== "object" || Array.isArray(normalizedQuote)) return [];

  const warnings = (normalizedQuote as Record<string, unknown>).warnings;
  return Array.isArray(warnings) ? warnings.filter((warning): warning is string => typeof warning === "string") : [];
}

function getValuedFeeUsd(snapshot: Record<string, unknown>) {
  const valued = (snapshot as QuoteDebugSnapshot).valuedFeeUsd;
  return typeof valued === "number" && Number.isFinite(valued) ? valued : 0;
}

function getStillUnpricedFeeTokens(snapshot: Record<string, unknown>) {
  const fees = (snapshot as QuoteDebugSnapshot).stillUnpricedFees;
  if (!Array.isArray(fees)) return [];
  return fees.map((fee) => fee?.token).filter((token): token is string => typeof token === "string" && token.length > 0);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNullablePercent(value: number | null | undefined, fallback = "-") {
  return value === null || value === undefined ? fallback : formatPercent(value);
}

function formatHoldHours(value: number | null | undefined) {
  if (value === null || value === undefined) return "No closed trades";
  if (value < 24) return `${formatNumber(value, 1)} hrs`;
  return `${formatNumber(value / 24, 1)} days`;
}

function formatTokenResult(token: PortfolioAnalytics["bestToken"] | undefined) {
  if (!token) return "-";
  return `${token.symbol} ${formatUsd(token.realizedPnlUsd)}`;
}

function ExplorerLink({ chainId, hash }: { chainId: number; hash: string }) {
  const href = explorerTxUrl(chainId, hash);
  if (!href) return <p className="mono subtle">{hash}</p>;

  return (
    <a className="hash-link mono" href={href} target="_blank" rel="noreferrer" title="Open transaction">
      {hash}
    </a>
  );
}

function TimestampLine({ timestamp, compact = false }: { timestamp: string; compact?: boolean }) {
  const formatted = formatLocalTimestamp(timestamp);
  return <span className={compact ? "timestamp compact" : "timestamp"}>{formatted}</span>;
}

function QuoteDebug({ snapshot }: { snapshot: Record<string, unknown> }) {
  const debug = snapshot as QuoteDebugSnapshot;
  const rows = [
    ["Provider", debug.provider],
    ["Endpoint", debug.endpoint],
    ["Chain", debug.chainId ? String(debug.chainId) : ""],
    ["Sell token", debug.sellToken],
    ["Buy token", debug.buyToken],
    ["Input amount", debug.inputAmount],
    ["Gas units", debug.assumptions?.gasUnits ? formatNumber(debug.assumptions.gasUnits, 0) : ""],
    ["Gas price wei", debug.assumptions?.gasPriceWei ? formatNumber(debug.assumptions.gasPriceWei, 0) : ""],
    ["ETH/USD", debug.assumptions?.ethUsd ? formatUsd(debug.assumptions.ethUsd) : ""],
    ["Slippage bps", debug.assumptions?.slippageBps?.toString()],
    ["Gas buffer bps", debug.assumptions?.gasBufferBps?.toString()],
    ["0x fee", debug.assumptions?.dexFeeUsd !== undefined ? formatUsd(debug.assumptions.dexFeeUsd) : ""],
    ["Valued 0x fee", debug.valuedFeeUsd ? formatUsd(debug.valuedFeeUsd) : ""],
    ["Unpriced fee tokens", getStillUnpricedFeeTokens(snapshot).join(", ")]
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <details className="debug-panel">
      <summary>Quote details</summary>
      <div className="debug-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <label>{label}</label>
            <p className={value.startsWith("0x") ? "mono" : ""}>{value}</p>
          </div>
        ))}
      </div>
      {debug.rawQuote ? (
        <details className="raw-panel">
          <summary>Raw 0x response</summary>
          <pre>{JSON.stringify(debug.rawQuote, null, 2)}</pre>
        </details>
      ) : null}
    </details>
  );
}

function formatLocalTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return `${formatRelativeTime(date)} | ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(date)}`;
}

function formatRelativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const absMs = Math.abs(diffMs);
  const units = [
    { label: "day", ms: 86_400_000 },
    { label: "hr", ms: 3_600_000 },
    { label: "min", ms: 60_000 }
  ];

  for (const unit of units) {
    const value = Math.floor(absMs / unit.ms);
    if (value >= 1) {
      const suffix = diffMs >= 0 ? "ago" : "from now";
      const label = unit.label === "hr" ? "hrs" : value === 1 ? unit.label : `${unit.label}s`;
      return `${value} ${label} ${suffix}`;
    }
  }

  return "just now";
}

function isNoRouteError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("no usable 0x liquidity") || lower.includes("no usable liquidity") || lower.includes("route");
}

function activityTypeLabel(item: WalletActivity) {
  if (item.isSwapLike) return "Swap-like";

  const wallet = item.walletAddress.toLowerCase();
  const from = item.fromAddress.toLowerCase();
  const to = item.toAddress.toLowerCase();

  if (from === wallet && to === wallet) return "Self-transfer";
  if (to === wallet) return "Incoming";
  if (from === wallet) return "Outgoing";
  return "Related";
}

function activityTypeClass(item: WalletActivity) {
  const label = activityTypeLabel(item);
  if (label === "Incoming") return "pill good";
  if (label === "Outgoing") return "pill warn";
  if (label === "Swap-like") return "pill good";
  return "pill";
}

function candidateStatusClass(status: TradeCandidate["status"]) {
  if (status === "decoded" || status === "copied") return "pill good";
  if (status === "skipped" || status === "failed") return "pill bad";
  if (status === "partial" || status === "candidate") return "pill warn";
  return "pill";
}

function candidateTitle(candidate: TradeCandidate) {
  if (candidate.side !== "unknown") {
    return `${candidate.side.toUpperCase()} ${candidate.tokenOutAsset || "unknown"} from ${
      candidate.tokenInAsset || "unknown"
    }`;
  }

  const input = candidate.tokenInAsset || "unknown asset";
  const output = candidate.tokenOutAsset || "token details missing";
  if (!candidate.tokenOutAsset || !candidate.tokenOutAmount || !candidate.tokenOutAddress) {
    return `Review needed: ${input} out, ${output}`;
  }
  return `Review needed: ${input} out, ${output} in`;
}

function explorerTxUrl(chainId: number, hash: string) {
  if (!hash) return "";
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${hash}`;
  return "";
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : fallbackMessage);
  }
  if (!payload) throw new Error(fallbackMessage);
  return payload as T;
}
