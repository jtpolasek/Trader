"use client";

import {
  Archive,
  ArchiveRestore,
  Download,
  ListRestart,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import { MetricItem, MetricStrip } from "./MetricStrip";

export type TopbarArchiveSummary = {
  id: string;
  name: string;
  tradeCount: number;
  ledgerEntryCount: number;
  quoteCount: number;
  copiedCandidateCount: number;
  createdAt: string;
};

export function Topbar(props: {
  ledgerOk: { ok: boolean; count: number } | null;
  busy: string;
  dashboardRefreshInterval: number;
  refreshOptions: { seconds: number; label: string }[];
  onRefresh: () => void;
  onIntervalChange: (seconds: number) => void;
  metricItems: MetricItem[];
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImportFile: (file: File) => void;
  onExport: () => void;
  onReprocess: () => void;
  onArchive: () => void;
  onReset: () => void;
  paperArchives: TopbarArchiveSummary[];
  selectedArchive: TopbarArchiveSummary | null;
  onSelectArchive: (id: string) => void;
  onRestoreArchive: (archive: TopbarArchiveSummary) => void;
  onRenameArchive: (archive: TopbarArchiveSummary) => void;
  onDeleteArchive: (archive: TopbarArchiveSummary) => void;
}) {
  const {
    ledgerOk,
    busy,
    dashboardRefreshInterval,
    refreshOptions,
    onRefresh,
    onIntervalChange,
    metricItems,
    importInputRef,
    onImportFile,
    onExport,
    onReprocess,
    onArchive,
    onReset,
    paperArchives,
    selectedArchive,
    onSelectArchive,
    onRestoreArchive,
    onRenameArchive,
    onDeleteArchive
  } = props;

  return (
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
      <MetricStrip items={metricItems} />
      <button className="button secondary" onClick={() => onRefresh()} title="Refresh portfolio">
        <RefreshCw size={18} />
        Refresh
      </button>
      <select
        className="archive-select"
        value={dashboardRefreshInterval}
        onChange={(event) => onIntervalChange(Number(event.target.value))}
        title="Auto-refresh dashboard data"
      >
        {refreshOptions.map((option) => (
          <option key={option.seconds} value={option.seconds}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onImportFile(file);
        }}
      />
      <details className="overflow-menu">
        <summary title="More actions">⋯</summary>
        <div className="overflow-items">
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
            onClick={() => onExport()}
            disabled={busy === "export-data"}
            title="Export local simulator data"
          >
            {busy === "export-data" ? <Loader2 size={18} /> : <Download size={18} />}
            Export data
          </button>
          <button
            className="button secondary"
            onClick={() => onReprocess()}
            disabled={busy === "reprocess-candidates"}
            title="Reprocess stored wallet activity into missing trade candidates"
          >
            {busy === "reprocess-candidates" ? <Loader2 size={18} /> : <ListRestart size={18} />}
            Reprocess
          </button>
          <button
            className="button secondary"
            onClick={() => onArchive()}
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
                onChange={(event) => onSelectArchive(event.target.value)}
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
                onClick={() => selectedArchive && onRestoreArchive(selectedArchive)}
                disabled={!selectedArchive || busy.startsWith("restore-archive-")}
                title={selectedArchive ? `Restore ${selectedArchive.name}` : "No paper archives yet"}
              >
                {busy.startsWith("restore-archive-") ? <Loader2 size={18} /> : <ArchiveRestore size={18} />}
                Restore
              </button>
              <button
                className="icon-button"
                onClick={() => selectedArchive && onRenameArchive(selectedArchive)}
                disabled={!selectedArchive || busy.startsWith("rename-archive-")}
                title={selectedArchive ? `Rename ${selectedArchive.name}` : "No paper archives yet"}
              >
                {busy.startsWith("rename-archive-") ? <Loader2 size={18} /> : <Save size={18} />}
              </button>
              <button
                className="icon-button danger"
                onClick={() => selectedArchive && onDeleteArchive(selectedArchive)}
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
            onClick={() => onReset()}
            disabled={busy === "reset-portfolio"}
            title="Reset simulated paper trades and ledger"
          >
            {busy === "reset-portfolio" ? <Loader2 size={18} /> : <Trash2 size={18} />}
            Reset paper
          </button>
        </div>
      </details>
    </header>
  );
}
