"use client";

import {
  Activity,
  BadgeDollarSign,
  Eye,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Target,
  Trash2,
  WalletCards
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { DEFAULT_GAS_BUFFER_BPS, DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";
import { formatNumber, formatUsd } from "@/lib/money";
import type { Position, QuotePreview, Trade, TradeSide, Wallet, WalletActivity } from "@/lib/types";

type PortfolioPayload = {
  portfolio: {
    cashUsd: number;
    startingCashUsd: number;
    realizedPnlUsd: number;
    feesPaidUsd: number;
  };
  positions: Position[];
  trades: Trade[];
  wallets: Wallet[];
  stats: {
    openCostBasisUsd: number;
    equityUsd: number;
    totalFeesUsd: number;
    wins: number;
    losses: number;
  };
};

const initialTrade = {
  side: "buy" as TradeSide,
  tokenAddress: "",
  usdAmount: "250",
  tokenQuantity: "",
  slippageBps: String(DEFAULT_SLIPPAGE_BPS),
  gasBufferBps: String(DEFAULT_GAS_BUFFER_BPS)
};

export default function Home() {
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [tradeForm, setTradeForm] = useState(initialTrade);
  const [walletForm, setWalletForm] = useState({ address: "", label: "", notes: "", gmgnUrl: "" });
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [activity, setActivity] = useState<WalletActivity[]>([]);
  const [activityContext, setActivityContext] = useState<{ label: string; address: string; fetched: number } | null>(
    null
  );
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const response = await fetch("/api/portfolio", { cache: "no-store" });
    const payload = (await response.json()) as PortfolioPayload;
    setData(payload);
  };

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load portfolio."));
  }, []);

  const selectedPosition = useMemo(
    () =>
      data?.positions.find(
        (position) => position.tokenAddress.toLowerCase() === tradeForm.tokenAddress.trim().toLowerCase()
      ),
    [data?.positions, tradeForm.tokenAddress]
  );

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
      setActivityContext({ label: wallet.label, address, fetched: payload.fetched });
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
    setPreview(null);
    try {
      const response = await fetch("/api/trades/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTradePayload())
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not preview trade.");
      setPreview(payload.preview);
      setMessage("Quote preview ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview trade.");
    } finally {
      setBusy("");
    }
  }

  async function executeTrade() {
    setBusy("execute");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/trades/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildTradePayload())
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not execute trade.");
      setPreview(payload.preview);
      setMessage("Paper trade executed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not execute trade.");
    } finally {
      setBusy("");
    }
  }

  function buildTradePayload() {
    const sellQuantity =
      tradeForm.tokenQuantity || (selectedPosition?.quantity ? String(selectedPosition.quantity) : "");

    return {
      side: tradeForm.side,
      tokenAddress: tradeForm.tokenAddress,
      usdAmount: tradeForm.side === "buy" ? Number(tradeForm.usdAmount) : undefined,
      tokenQuantity: tradeForm.side === "sell" ? Number(sellQuantity) : undefined,
      slippageBps: Number(tradeForm.slippageBps),
      gasBufferBps: Number(tradeForm.gasBufferBps)
    };
  }

  const portfolio = data?.portfolio;
  const stats = data?.stats;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">Ethereum paper execution</p>
          <h1>GMGN wallet simulator</h1>
        </div>
        <button className="button secondary" onClick={() => refresh()} title="Refresh portfolio">
          <RefreshCw size={18} />
          Refresh
        </button>
      </header>

      {error ? <div className="alert">{error}</div> : null}
      {message ? <div className="alert success">{message}</div> : null}

      <section className="section grid dashboard-grid">
        <Metric icon={<BadgeDollarSign size={20} />} label="Cash" value={formatUsd(portfolio?.cashUsd ?? 0)} />
        <Metric icon={<Target size={20} />} label="Equity basis" value={formatUsd(stats?.equityUsd ?? 0)} />
        <Metric icon={<Activity size={20} />} label="Realized PnL" value={formatUsd(portfolio?.realizedPnlUsd ?? 0)} />
        <Metric icon={<History size={20} />} label="Fees paid" value={formatUsd(stats?.totalFeesUsd ?? 0)} />
      </section>

      <section className="section grid main-grid">
        <div className="stack">
          <div className="panel">
            <div className="row">
              <h2>Trade ticket</h2>
              <span className="pill">0x quote</span>
            </div>
            <form className="stack" onSubmit={previewTrade}>
              <div className="segmented" aria-label="Trade side">
                {(["buy", "sell"] as TradeSide[]).map((side) => (
                  <button
                    type="button"
                    className={tradeForm.side === side ? "active" : ""}
                    onClick={() => {
                      setPreview(null);
                      setTradeForm((current) => ({ ...current, side }));
                    }}
                    key={side}
                  >
                    {side.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="form-grid">
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
                <div className="row">
                  <div>
                    <h3>
                      {preview.side.toUpperCase()} {preview.token.symbol}
                    </h3>
                    <p className="subtle">
                      {formatNumber(preview.quantity, 6)} tokens at {formatUsd(preview.priceUsd)}
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
                {preview.warnings.map((warning) => (
                  <div className="alert" key={warning}>
                    {warning}
                  </div>
                ))}
                <button className="button" onClick={executeTrade} disabled={busy === "execute"}>
                  {busy === "execute" ? <Loader2 size={18} /> : <Send size={18} />}
                  Execute paper trade
                </button>
              </div>
            ) : null}
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
                    placeholder="0x..."
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
          <div className="panel">
            <div className="row">
              <h2>Positions</h2>
              <span className="pill">{data?.positions.length ?? 0} open</span>
            </div>
            <div className="list">
              {data?.positions.length ? (
                data.positions.map((position) => (
                  <article className="card" key={position.tokenAddress}>
                    <div className="row">
                      <div>
                        <h3>
                          {position.symbol} <span className="subtle">{position.name}</span>
                        </h3>
                        <p className="mono subtle">{position.tokenAddress}</p>
                      </div>
                      <span className={position.realizedPnlUsd >= 0 ? "pill good" : "pill bad"}>
                        {formatUsd(position.realizedPnlUsd)}
                      </span>
                    </div>
                    <div className="grid dashboard-grid">
                      <Mini label="Quantity" value={formatNumber(position.quantity, 6)} />
                      <Mini label="Avg entry" value={formatUsd(position.averageEntryUsd)} />
                      <Mini label="Cost basis" value={formatUsd(position.costBasisUsd)} />
                      <Mini label="Fees" value={formatUsd(position.feesPaidUsd)} />
                    </div>
                  </article>
                ))
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
                      <td>{formatNumber(trade.quantity, 6)}</td>
                      <td>{formatUsd(trade.priceUsd)}</td>
                      <td>{formatUsd(trade.gasUsd + trade.slippageUsd + trade.dexFeeUsd)}</td>
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
              <span className="pill">{activity.filter((item) => item.isSwapLike).length} swap-like</span>
            </div>
            {activityContext ? (
              <p className="subtle">
                {activityContext.label} fetched {activityContext.fetched} ETH/ERC-20 transfers from Alchemy.
              </p>
            ) : null}
            <div className="list">
              {activity.slice(0, 8).map((item) => (
                <article className="card" key={item.id}>
                  <div className="row">
                    <div>
                      <div className="activity-meta">
                        <span>{formatActivityDate(item.timestamp)}</span>
                        <span className={activityTypeClass(item)}>{activityTypeLabel(item)}</span>
                        <span className="pill">{item.category}</span>
                      </div>
                      <h3>
                        {item.asset} {formatNumber(item.value, 4)}
                      </h3>
                      <p className="mono subtle">{item.hash}</p>
                    </div>
                  </div>
                </article>
              ))}
              {!activity.length ? (
                <p className="subtle">
                  {activityContext
                    ? "No matching inbound or outbound ETH/ERC-20 transfers were returned for this wallet."
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

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <span className="row">
        {label}
        {icon}
      </span>
      <strong>{value}</strong>
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

function formatActivityDate(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString();
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
