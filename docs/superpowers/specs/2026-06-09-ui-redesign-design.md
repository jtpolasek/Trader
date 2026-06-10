# GMGN Wallet Simulator — UI Redesign Design

**Date:** 2026-06-09
**Status:** Approved by user (brainstorm session with visual companion)

## Goal

Reorganize the dashboard to be more organized, compact, and usable. The user's
primary workflows are (1) monitoring open positions and (2) toggling per-wallet
auto-copy. Presentation-layer change only: no API changes, no behavior changes,
no new dependencies.

## Decisions made

| Question | Decision |
|---|---|
| Layout | Dense single-page dashboard, two-column grid, slim sticky topbar |
| Theme | Obsidian dark terminal (slate/teal/emerald/rose) |
| Styling | Plain CSS with design tokens in `globals.css` — **no Tailwind** |
| Positions | Compact cards, 2-up grid, all current stats and buttons retained |
| Watchlist | Mini leaderboard table with derived stat columns + toggles |
| Secondary UI | Collapsed `<details>`-style panels in-page (no drawers/modals) |

## Layout

Sticky topbar, then a two-column grid (≈2:1, collapsing to one column under
~1100px):

- **Topbar**: brand, inline metric strip (Cash · Equity basis · Realized PnL ·
  Unrealized P&L · Win rate · Fee drag · Open exposure · Avg hold), Ledger
  status pill, dashboard refresh-interval select, Refresh button, and a `⋯`
  overflow menu containing Import / Export / Reprocess / Archive / Reset paper
  (Reset keeps its confirm dialog).
- **Left column (primary)**:
  1. Positions panel (top)
  2. Candidates panel (Actionable / Review / All tabs, status summary pills)
  3. Trade history (collapsed by default)
- **Right column**:
  1. Watchlist leaderboard (top); add-wallet form collapses behind a `+` in
     the panel header
  2. Wallet activity feed (scrollable, max-height capped)
  3. Collapsed panels: Manual trade ticket, Copy settings, Auto-exit rules,
     Paper archives

## Theme (design tokens)

CSS variables defined on `:root` in `globals.css`:

- `--bg: #020617` (page), `--panel: #0f172a`, `--panel-2: #0b1222` (nested),
  `--border: #1e293b`
- `--text: #e2e8f0`, `--muted: #94a3b8`, `--faint: #64748b`
- `--accent: #2dd4bf` (teal-400), `--gain: #34d399` (emerald-400),
  `--loss: #fb7185` (rose-400), `--warn` (amber)
- 4px-base spacing scale; type scale two steps smaller than today (11–13px
  body, 9–10px uppercase labels)
- Monospace (`--font-mono`) for addresses, hashes, and quantities
- Pills keep good/bad/warn semantics, recolored with `color-mix` opacities
  (e.g. `rgba(52,211,153,.1)` backgrounds with bright text)

## Positions panel (primary)

Compact cards in a 2-up grid (1-up below ~1100px), roughly half today's card
height. Sized for 8–10 open positions. Each card:

- Header row: token symbol + masked address (mono), unrealized P&L top-right
  (colored, with % when price is known)
- Stat row: quantity · avg entry · cost basis · fees · current value
- Button row: **Sell** (opens/prefills the trade ticket for that token,
  matching today's flow) and **Mark loss** where the loss-offer flow applies

All information and actions from the current cards are retained. The
prices-stale indicator and per-position price refresh behavior are unchanged.

## Watchlist panel (primary)

Table, one row per wallet:

| Wallet | Cands | Copied | Last seen | Copy |
|---|---|---|---|---|
| label + masked address (mono) | candidate count | copied count (green) | relative time | toggle |

- Stat columns are derived client-side from already-loaded data: candidates
  filtered by `walletAddress`, copied = candidates with
  `lastCopyStatus === "copied"`, last seen = newest activity timestamp for
  the wallet. **No API changes.**
- Global auto-copy master switch lives in the panel header; the existing
  "global off while wallet toggles armed" warning is preserved.
- Per-row Activity (fetch) and Delete actions compact to icon buttons.
- Add-wallet form (address / label / notes / GMGN URL) collapses behind `+`.

## Code structure

Decompose `src/app/page.tsx` (~2,700 lines) into presentational components
under `src/components/`:

`Topbar`, `MetricStrip`, `PositionsPanel`, `PositionCard`, `CandidatesPanel`,
`WatchlistPanel`, `ActivityFeed`, `TradeTicket`, `SettingsPanels`,
`TradeHistory`

- All state, hooks, intervals (`useInterval`), and fetch functions stay in
  `page.tsx` and flow down as props. No state-management changes.
- Pure helpers (`shortAddress`, `localDateKey`, formatters) move to a shared
  module as needed by multiple components.
- `globals.css` is rewritten around the token system; class names may change
  but stay semantic (no utility classes).

## Out of scope

Charts, new analytics, mobile-first layout, light/dark theme toggle, Tailwind,
API or database changes.

## Risks & verification

- **Visual regression in rare states** (errors, empty lists, busy spinners,
  warnings): every conditional render branch is preserved verbatim during
  decomposition; main states verified in the browser against the live app.
- **Behavioral regression**: existing 178 tests must pass unchanged; the
  recently fixed auto-copy kill-switch semantics and dashboard refresh logic
  must not be touched.
- Screenshot comparison per panel (before/after) during implementation.
