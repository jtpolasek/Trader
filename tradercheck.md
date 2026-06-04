# Claude Code Implementation Checklist
## Copy Trade Simulator

## Goal
Build a wallet-following crypto copy-trade simulator web app. The user enters a wallet address, the app watches that wallet, detects swap trades, mirrors them into a paper portfolio, and applies simulated fees like gas and slippage. This is a simulator only — no live execution or custody of funds.

---

## Phase 0 — Project setup

- [ ] Create the repo structure for frontend and backend.
- [ ] Choose the initial chain: Ethereum mainnet or Base.
- [ ] Choose the initial stack:
  - [ ] Frontend: Next.js App Router.
  - [ ] Backend: FastAPI.
  - [ ] Database: Postgres.
- [ ] Add environment variable files for RPC URLs, API keys, database URL, and auth settings.
- [ ] Add a README with local dev steps.
- [ ] Add a basic `.gitignore`.
- [ ] Add formatting and linting tools.

---

## Phase 1 — Backend skeleton

- [ ] Create the FastAPI app entrypoint.
- [ ] Split the backend into modules using routers, services, schemas, models, and workers.
- [ ] Add a health check endpoint.
- [ ] Add base config loading from environment variables.
- [ ] Add Postgres connection setup.
- [ ] Add database migration tooling.
- [ ] Add typed request/response schemas.

FastAPI’s recommended multi-file structure fits this kind of feature-based backend well [web:53][web:63].

---

## Phase 2 — Database foundation

- [ ] Create `users` table.
- [ ] Create `watched_wallets` table.
- [ ] Create `source_transactions` table.
- [ ] Create `decoded_trades` table.
- [ ] Create `simulated_trades` table.
- [ ] Create `portfolios` table.
- [ ] Create `positions` table.
- [ ] Create `ledger_entries` table.
- [ ] Add indexes for wallet address, tx hash, watcher id, and timestamps.
- [ ] Add uniqueness constraints to prevent duplicate transaction ingestion.
- [ ] Add timestamps and audit fields on all important tables.

For the portfolio layer, keep the ledger append-only and rebuildable from entries if needed.

---

## Phase 3 — Watcher APIs

- [ ] Build `POST /api/watchers`.
- [ ] Build `GET /api/watchers`.
- [ ] Build `GET /api/watchers/{id}`.
- [ ] Build `POST /api/watchers/{id}/pause`.
- [ ] Build `POST /api/watchers/{id}/resume`.
- [ ] Build `POST /api/watchers/{id}/refresh`.
- [ ] Build `GET /api/watchers/{id}/portfolio`.
- [ ] Build `GET /api/watchers/{id}/trades`.
- [ ] Build `GET /api/watchers/{id}/positions`.

- [ ] Validate wallet address format on create.
- [ ] Validate chain support on create.
- [ ] Validate copy settings on create.

---

## Phase 4 — Chain ingestion

- [ ] Add a chain adapter for the selected network.
- [ ] Add transaction backfill for a wallet address.
- [ ] Add polling for new transactions.
- [ ] Fetch transaction details by hash.
- [ ] Fetch receipts and logs for candidate trades.
- [ ] Store raw transaction payloads for debugging and reprocessing.
- [ ] Deduplicate transactions by hash.
- [ ] Retry transient RPC failures with backoff.

Ethereum JSON-RPC methods such as `eth_getTransactionByHash` are the right base for this layer, and Base uses compatible RPC methods as well [web:41][web:44].

---

## Phase 5 — Trade decoding

- [ ] Detect swap-like contract calls.
- [ ] Decode token in/out.
- [ ] Decode input and output amounts.
- [ ] Detect router addresses.
- [ ] Record gas used and gas price.
- [ ] Score confidence for decoded trades.
- [ ] Mark unsupported calls as skipped instead of failing.

- [ ] Add special handling for common DEX routers.
- [ ] Add support for wrap and unwrap flows if needed.
- [ ] Keep decoder logic isolated per chain or protocol.

Uniswap swap flows and router-based execution patterns make swap decoding a practical first target [web:36][web:47].

---

## Phase 6 — Fee engine

- [ ] Implement gas fee estimation.
- [ ] Implement EIP-1559-style base fee and priority fee logic.
- [ ] Add chain-specific gas handling for the selected chain.
- [ ] Add optional protocol fee handling.
- [ ] Add slippage modeling.
- [ ] Add configurable gas multiplier.
- [ ] Show fee breakdown per simulated trade.

Ethereum’s fee market uses base fee plus priority fee, and Base exposes chain-specific fee behavior that should be reflected in the simulator [web:32][web:40].

---

## Phase 7 — Simulation engine

- [ ] Create a paper portfolio on watcher creation.
- [ ] Apply the selected copy ratio to each decoded trade.
- [ ] Apply slippage.
- [ ] Subtract gas and fee costs.
- [ ] Update position quantities and average cost.
- [ ] Update realized and unrealized PnL.
- [ ] Write a simulated trade record for every copied trade.
- [ ] Mark trades as copied, skipped, partial, or failed.

- [ ] Support a fixed-dollar copy mode.
- [ ] Support a percent-of-source-trade copy mode.
- [ ] Support a max trade size cap.
- [ ] Support skipping trades when balance is insufficient.

---

## Phase 8 — Portfolio ledger

- [ ] Write ledger entries for every portfolio change.
- [ ] Keep ledger entries immutable.
- [ ] Make portfolio state reconstructable from the ledger.
- [ ] Add a recompute job for portfolio consistency.
- [ ] Track cash balance separately from token holdings.
- [ ] Track realized and unrealized gains separately.

A ledger-style design is the safest way to keep portfolio accounting auditable and debuggable.

---

## Phase 9 — Frontend shell

- [ ] Create the Next.js App Router shell.
- [ ] Add the main layout.
- [ ] Add navigation.
- [ ] Add a homepage or dashboard landing page.
- [ ] Add a watch wallet screen.
- [ ] Add a portfolio screen.
- [ ] Add a trade history screen.
- [ ] Add a settings screen.

Next.js App Router is built for nested layouts, file-system routing, and dashboard-style apps [web:58][web:64].

---

## Phase 10 — Frontend data flows

- [ ] Connect the UI to the watcher APIs.
- [ ] Add loading and empty states.
- [ ] Add form validation.
- [ ] Add polling or websocket-based refresh.
- [ ] Render the portfolio summary.
- [ ] Render the trade table.
- [ ] Render positions and PnL.
- [ ] Render fee details per trade.

- [ ] Make the UI clearly label the system as simulated.
- [ ] Add pause/resume controls.
- [ ] Add refresh controls.
- [ ] Add error banners for ingestion or decode failures.

---

## Phase 11 — Auth and access control

- [ ] Decide whether v1 is single-user or multi-user.
- [ ] If multi-user, add authentication.
- [ ] Protect watcher endpoints by user ownership.
- [ ] Restrict access to portfolio and trade history data.
- [ ] Add session or token handling.

If using Clerk or similar auth on the Next.js side, wire it into the App Router layout and middleware flow [web:55].

---

## Phase 12 — Testing

- [ ] Test wallet address validation.
- [ ] Test watcher creation.
- [ ] Test duplicate transaction rejection.
- [ ] Test swap decoding.
- [ ] Test fee calculation.
- [ ] Test slippage calculation.
- [ ] Test copy ratio sizing.
- [ ] Test portfolio updates.
- [ ] Test pause/resume behavior.
- [ ] Test unsupported transaction handling.

- [ ] Add unit tests for simulation math.
- [ ] Add integration tests for wallet ingestion.
- [ ] Add API tests for all endpoints.

---

## Phase 13 — Observability

- [ ] Add structured logs for ingestion.
- [ ] Add structured logs for decoding.
- [ ] Add structured logs for simulation.
- [ ] Add metrics for processed transactions.
- [ ] Add metrics for decode success rate.
- [ ] Add metrics for simulation latency.
- [ ] Add health and readiness endpoints.
- [ ] Add error reporting for RPC outages.

---

## Phase 14 — MVP polish

- [ ] Add a clean empty state when no wallet is being tracked.
- [ ] Add a summary card for portfolio value and PnL.
- [ ] Add a chart for equity over time.
- [ ] Add trade details drawer.
- [ ] Add a visible fee breakdown on each trade.
- [ ] Add export for trade history as CSV.
- [ ] Add settings persistence.

---

## Acceptance criteria

The first usable version is complete when:
- [ ] A user can enter a wallet address.
- [ ] The app tracks that wallet on one chain.
- [ ] Swap trades are detected and mirrored into a paper portfolio.
- [ ] Fees are included in every simulated trade.
- [ ] The user can view portfolio value, positions, and trade history.
- [ ] The system can pause, resume, and refresh tracking.
- [ ] The app remains stable under repeated transaction ingestion.

---

## Claude Code execution order

1. Scaffold backend and frontend folders.
2. Build database schema and migrations.
3. Build watcher APIs.
4. Build chain ingestion.
5. Build trade decoding.
6. Build fee engine.
7. Build simulation engine.
8. Build portfolio ledger.
9. Build frontend dashboard.
10. Add tests and polish.
