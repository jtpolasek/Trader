# Tradebot — Crypto Copy-Trading Platform (Paper Trading)

**Implementation plan.** This document is the single source of truth for building the system. Follow phases in order. Each phase has explicit deliverables and acceptance criteria. Do not skip ahead; later phases depend on earlier contracts.

---

## 1. What we are building

A low-latency platform that:

1. **Watches** a configurable set of wallets ("leaders") on **Ethereum mainnet and Base** (priority chains), with Solana as a later add-on.
2. **Detects** their DEX trades (swaps) in real time — from the mempool when possible, from confirmed blocks always.
3. **Mirrors** each detected trade into a **simulated paper-trading account** with realistic fill modeling (slippage, gas, latency delay).
4. **Records** everything, then **scores leaders and adapts**: position sizing per leader, trade filters, and entry/exit rules improve based on accumulated trade data.

**Non-goals (do not build):** real order execution, private key custody, MEV bots, CEX trading, front-running. All money is simulated.

---

## 2. Architecture

```
                        ┌──────────────────────────────────────────────┐
                        │              packages/ingest                  │
  Alchemy/QuickNode ──▶ │  EVM WS subscriptions (pending tx + logs)     │
  WS endpoints          │  per-chain ChainWatcher (eth, base)           │
                        └──────────────┬───────────────────────────────┘
                                       │ RawTxEvent (in-proc event bus)
                        ┌──────────────▼───────────────────────────────┐
                        │            packages/decoder                   │
                        │  Swap detection: router ABIs + balance-delta  │
                        │  Emits normalized TradeSignal                 │
                        └──────────────┬───────────────────────────────┘
                                       │ TradeSignal
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
   ┌──────────────────────┐ ┌────────────────────┐ ┌──────────────────┐
   │ packages/paper-engine│ │ packages/pricing   │ │ packages/store   │
   │ mirror decision →    │ │ pool spot price,   │ │ Postgres writes  │
   │ simulated fill →     │ │ token metadata,    │ │ (signals, fills, │
   │ portfolio ledger     │ │ liquidity depth    │ │  positions, pnl) │
   └──────────┬───────────┘ └────────────────────┘ └──────────────────┘
              │ nightly / rolling
   ┌──────────▼───────────┐          ┌──────────────────────────────┐
   │ packages/brain       │          │ apps/api  (Fastify REST+WS)  │
   │ leader scoring,      │          │ apps/web  (Next.js dashboard)│
   │ sizing weights,      │          └──────────────────────────────┘
   │ trade filters        │
   └──────────────────────┘
```

Single Node.js process for the hot path (ingest → decode → paper fill) to avoid network hops; Postgres for durability; the API/dashboard read from Postgres. Everything is a TypeScript monorepo.

**Latency budget (signal seen → paper fill recorded):** target < 150 ms after the event arrives on the WebSocket. Pending-tx detection gives us the trade before it even confirms; confirmed-log detection is the reliable fallback (~1 block: 12 s ETH, 2 s Base).

---

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 22, ESM) | One language across hot path, API, dashboard; fast enough for paper trading |
| Monorepo | pnpm workspaces + turborepo | Simple, standard |
| EVM lib | **viem** | Modern, typed, fast ABI decoding, native WS support. Do NOT use ethers v5/web3.js |
| RPC providers | Alchemy (primary) + QuickNode (fallback), per chain | WS `eth_subscribe` for logs + `alchemy_pendingTransactions` filtered by `fromAddress` for mempool-level latency |
| DB | PostgreSQL 16 + Drizzle ORM | Relational fits ledger/analytics; Drizzle is typed and light |
| Cache/hot state | In-process `Map`s; Redis ONLY if a second process appears later | Avoid premature infra |
| API | Fastify + zod | Fast, typed |
| Dashboard | Next.js 15 (App Router) + Tailwind | Phase 6, optional |
| Tests | Vitest | |
| Validation | zod everywhere at boundaries | |
| Runtime config | `.env` + zod-validated config module | Never commit `.env` |

---

## 4. Repository layout

```
tradebot/
  package.json            # pnpm workspace root
  turbo.json
  .env.example            # every env var documented here; never commit .env
  docker-compose.yml      # postgres only
  packages/
    core/                 # shared types, config loader, event bus, logger
    store/                # drizzle schema + migrations + repositories
    ingest/               # chain watchers (evm now, solana later)
    decoder/              # swap detection & normalization
    pricing/              # token metadata, USD pricing, liquidity reads
    paper-engine/         # mirroring rules, fill simulation, ledger
    brain/                # scoring, weights, filters, (later) ML
  apps/
    runner/               # the long-running daemon wiring everything together
    api/                  # fastify REST + WS
    web/                  # next.js dashboard (phase 6)
```

---

## 5. Core domain types (`packages/core/src/types.ts`)

Implement exactly these; every package speaks them.

```ts
export type ChainId = "eth" | "base" | "sol"; // sol reserved for phase 7

export interface TrackedWallet {
  id: string;            // uuid
  chain: ChainId;
  address: string;       // lowercase 0x…
  label: string;
  active: boolean;
  addedAt: Date;
}

/** Raw observation from a chain watcher. */
export interface RawTxEvent {
  chain: ChainId;
  source: "mempool" | "confirmed";
  txHash: string;
  from: string;
  to: string | null;
  blockNumber: number | null;   // null when mempool
  observedAt: number;           // Date.now() at receipt
  // confirmed events carry full receipt logs; mempool carries calldata
  input?: `0x${string}`;
  logs?: { address: string; topics: string[]; data: string }[];
}

/** Normalized, decoded trade by a leader wallet. */
export interface TradeSignal {
  id: string;                   // uuid
  chain: ChainId;
  walletId: string;
  txHash: string;
  source: "mempool" | "confirmed";
  side: "buy" | "sell";         // relative to the non-quote token
  tokenIn: TokenRef;            // what the leader spent
  tokenOut: TokenRef;           // what the leader received
  amountIn: bigint;             // raw units
  amountOut: bigint;            // raw (estimated if mempool)
  venue: string;                // "uniswap-v3" | "uniswap-v2" | "aerodrome" | "unknown-router" | "balance-delta"
  observedAt: number;
  confirmedAt: number | null;
  blockNumber: number | null;
}

export interface TokenRef {
  chain: ChainId;
  address: string;   // lowercase; use WETH address for native wraps; "native" for raw ETH
  symbol: string;
  decimals: number;
}

export interface PaperFill {
  id: string;
  signalId: string;
  decidedAt: number;
  decision: "copied" | "skipped";
  skipReason?: string;          // "below-min-liquidity" | "leader-weight-zero" | "token-blocklist" | "insufficient-balance" | "dust" | ...
  side: "buy" | "sell";
  token: TokenRef;              // the non-quote asset
  quoteToken: TokenRef;         // USDC or WETH used to pay
  qty: number;                  // human units of token
  priceUsd: number;             // simulated fill price
  notionalUsd: number;
  feeUsd: number;               // gas + dex fee model
  slippageBps: number;          // applied slippage
  latencyMs: number;            // signal observedAt -> fill timestamp
}
```

The event bus (`packages/core/src/bus.ts`) is a tiny typed wrapper over Node `EventEmitter` with channels: `raw-tx`, `trade-signal`, `paper-fill`. Keep it synchronous in-process; handlers must never block (use queues internally if a handler does I/O).

---

## 6. Database schema (`packages/store`)

Drizzle tables (Postgres). Use `numeric` for money, `bigint` columns as text for raw token amounts.

```sql
wallets(id uuid pk, chain text, address text, label text, active bool, added_at timestamptz,
        unique(chain, address))

tokens(chain text, address text, symbol text, name text, decimals int,
       first_seen timestamptz, is_blocked bool default false,
       pk(chain, address))

trade_signals(id uuid pk, chain text, wallet_id uuid fk, tx_hash text, source text,
              side text, token_in text, token_out text, amount_in numeric, amount_out numeric,
              venue text, observed_at timestamptz, confirmed_at timestamptz, block_number bigint,
              unique(chain, tx_hash, token_in, token_out))   -- dedupe mempool+confirmed

paper_fills(id uuid pk, signal_id uuid fk, decided_at timestamptz, decision text, skip_reason text,
            side text, token_address text, quote_address text, qty numeric, price_usd numeric,
            notional_usd numeric, fee_usd numeric, slippage_bps int, latency_ms int)

positions(id uuid pk, chain text, token_address text, qty numeric, avg_cost_usd numeric,
          opened_at timestamptz, closed_at timestamptz null, realized_pnl_usd numeric default 0,
          source_wallet_id uuid)   -- which leader opened it

portfolio_snapshots(id uuid pk, ts timestamptz, equity_usd numeric, cash_usd numeric,
                    positions_value_usd numeric, daily_pnl_usd numeric)

leader_stats(wallet_id uuid pk, window text,  -- '7d' | '30d' | 'all'
             trades int, win_rate numeric, avg_return_pct numeric, median_hold_minutes numeric,
             realized_pnl_usd numeric, max_drawdown_pct numeric, score numeric, weight numeric,
             updated_at timestamptz, pk(wallet_id, window))

price_marks(chain text, token_address text, ts timestamptz, price_usd numeric, source text,
            pk(chain, token_address, ts))
```

Repositories expose narrow typed functions (`insertSignal`, `upsertPosition`, `latestMark`, …). No raw SQL outside `packages/store`.

---

## 7. Phase plan

### Phase 0 — Scaffold (½ day)

- pnpm workspace, turbo, tsconfig (strict, ESM, NodeNext), ESLint+Prettier, Vitest.
- `docker-compose.yml` with Postgres 16; `packages/store` with all tables above + migration script (`pnpm db:migrate`).
- `packages/core`: config loader (zod-parses `.env`: `ALCHEMY_API_KEY`, `QUICKNODE_ETH_WS`, `QUICKNODE_BASE_WS`, `DATABASE_URL`, `PAPER_STARTING_CASH_USD=100000`, `LOG_LEVEL`), pino logger, event bus.
- `apps/runner` boots, connects to DB, logs "ready".

**Accept:** `pnpm build && pnpm test` green; runner starts; migration creates all tables.

### Phase 1 — EVM ingestion (2 days)

`packages/ingest/src/evm/chainWatcher.ts` — one instance per chain (eth, base), built on viem `createPublicClient({ transport: webSocket(url) })`.

Three subscriptions per chain:

1. **Confirmed logs (the reliable backbone):** `watchEvent` on ERC-20 `Transfer(address,address,uint256)` filtered by `from` OR `to` ∈ tracked wallet set. viem supports topic arrays — pass the wallet list as topic filters. When the tracked set changes, resubscribe.
2. **Pending transactions (the latency win, Alchemy only):** raw WS subscription `alchemy_pendingTransactions` with `{ fromAddress: [tracked…], hashesOnly: false }`. Emits `RawTxEvent{source:"mempool"}` with calldata. Note: Base has a private/sequencer mempool — pending-tx coverage on Base will be partial or empty; the code must work fine when this stream yields nothing.
3. **New heads:** for block timestamps + a heartbeat/health metric.

Resilience requirements:
- Auto-reconnect with exponential backoff (1s→30s cap), resubscribe all filters on reconnect.
- On reconnect after gap: backfill missed blocks via `getLogs` from last-seen block (store `last_block` per chain in DB).
- Provider failover: if Alchemy WS down > 60 s, switch to QuickNode (confirmed-logs only) and keep retrying Alchemy.
- Dedupe: keep an LRU set of `txHash` (size 50k); a tx seen in mempool then confirmed emits twice intentionally — the **decoder** dedupes signals, the watcher dedupes only exact duplicates per source.

For confirmed events, fetch the full `getTransactionReceipt` (it contains all logs needed for decoding) — batch via viem multicall-style batching where possible.

**Accept:** with 3 known active wallets configured, runner logs `RawTxEvent`s within 1 block of their on-chain activity; kill the WS (toggle Wi-Fi) and confirm backfill catches missed txs.

### Phase 2 — Swap decoding (2–3 days)

`packages/decoder`. Input `RawTxEvent`, output `TradeSignal`. Two strategies, tried in order:

**Strategy A — Known venue log decoding (confirmed txs).** Decode receipt logs against known pool events:
- Uniswap V2 `Swap(address,uint256,uint256,uint256,uint256,address)` (also covers Sushi, Aerodrome vAMM — same ABI).
- Uniswap V3 `Swap(address,address,int256,int256,uint160,uint128,int24)`.
- Uniswap V4 `Swap` (PoolManager singleton, ETH+Base).
- Aerodrome (Base) CL pools (V3-style ABI).
Maintain a `venues.ts` registry: `{ chain, name, eventAbi, addressBookOrFactoryCheck }`. Don't try to enumerate every pool address — decode by event signature, then verify the emitting contract is a pool via factory `getPool/getPair` check, cached forever per address.

**Strategy B — Balance-delta heuristic (universal fallback, REQUIRED).** For any confirmed tx from a tracked wallet: sum all ERC-20 `Transfer` logs where the wallet is `from` (token spent) or `to` (token received), plus native ETH value delta (tx.value, and WETH withdraw/deposit logs). If exactly one token decreased and one increased → it's a swap; emit signal with `venue:"balance-delta"`. This catches aggregators (1inch, 0x, CoW, UniversalRouter paths) without per-router ABIs. If >2 tokens moved, pick the largest in/out pair by USD value and log a warning.

**Mempool decoding (Strategy C, ETH only, best-effort):** decode calldata for Uniswap UniversalRouter `execute`, V2/V3 router `swapExact*` families, and 1inch v6 `swap`. On success emit `TradeSignal{source:"mempool"}` with `amountOut` = quoted estimate (use `amountOutMin` from calldata as conservative estimate). If calldata isn't recognized, do nothing — the confirmed path will catch it.

**Dedup/normalize:** key = `(chain, txHash)`. If a mempool signal exists and the confirmed version arrives, emit a `signal-confirmed` update (fills may be corrected, see Phase 3) rather than a new signal. Classify `side`: define quote assets per chain (`USDC, USDT, DAI, WETH/ETH` on eth; `USDC, WETH, cbBTC` on base). tokenOut is quote → `sell`; tokenIn is quote → `buy`; both non-quote → treat as sell of in + buy of out (emit two signals).

Token metadata: on first sight of a token address, read `symbol/decimals/name` on-chain (multicall), persist to `tokens`. Handle non-standard tokens (bytes32 symbols, missing decimals → default 18, flag).

**Accept:** unit tests with recorded real receipts (fixture JSON for: Uniswap V2 swap, V3 swap, V4 swap, 1inch aggregation, Aerodrome swap, a multi-hop UniversalRouter trade) all produce correct `TradeSignal`s. Fixtures: pull 6 real txs from Etherscan/Basescan and save receipts as JSON in `packages/decoder/test/fixtures/`.

### Phase 3 — Pricing (1–2 days)

`packages/pricing`:
- `getUsdPrice(token, blockNumber?)`: route — stablecoins = 1.0; WETH from Chainlink ETH/USD feed (eth + base have feeds); any other token from its deepest Uniswap V3/Aerodrome pool vs a quote asset (`slot0` sqrtPrice → price), falling back to DefiLlama `coins` API (`https://coins.llama.fi/prices/current/…`) with 30 s cache.
- `getLiquidityUsd(token)`: TVL of deepest pool (used by trade filters). Cache 5 min.
- A `marks` job: every 60 s, persist `price_marks` for every token with an open position (needed for unrealized PnL and leader scoring).

**Accept:** prices for WETH, USDC, and two random meme tokens within 2% of DexScreener; marks rows appear every minute.

### Phase 4 — Paper trading engine (2–3 days)

`packages/paper-engine`. State: one portfolio (cash USD + positions map), loaded from DB at boot, kept in memory, every mutation written through to DB in the same tick.

**Mirror decision** (`decide(signal): Copy | Skip`):
1. Leader weight from `brain` (Phase 5); weight 0 → skip.
2. Token blocklist / liquidity filter: `getLiquidityUsd(token) >= MIN_LIQUIDITY_USD` (default $150k) else skip.
3. Sizing: `notional = portfolioEquity * BASE_TRADE_PCT * leaderWeight` (defaults: 1%, weight 1.0), clamped to `[MIN_NOTIONAL=$50, MAX_TRADE_PCT=3% of equity]`. **Proportional mode (config flag):** scale by leader's trade as % of *their* recent typical size instead — implement both, default to fixed-pct.
4. Sells: if leader sells token X and we hold a position opened from that leader's signals, sell the **same fraction** of our position that the leader sold of theirs (estimate leader's holding from their cumulative signals; if unknown, sell 100%). No shorting: leader sells something we don't hold → skip with reason.

**Fill simulation** (`fill(signal, notional): PaperFill`):
- Base price = `getUsdPrice` at decision time.
- Slippage model: `slippageBps = DEX_FEE_BPS(venue) + impactBps` where `impactBps = 10_000 * notional / (2 * liquidityUsd)` (linear impact approximation), plus a fixed `COPY_DELAY_PENALTY_BPS` (default 10 on eth, 5 on base) representing price drift during our latency. Buys fill at `price * (1 + slippage)`, sells at `price * (1 - slippage)`.
- Gas: flat model per chain from config (`eth: $4`, `base: $0.03`), refreshed weekly by hand; later phase can read live gas.
- Mempool-sourced fills: mark `provisional=true`; when the confirmed signal arrives, recompute price at confirmation and adjust the fill (or void it if the tx reverted — check receipt status!). Reverted leader tx → void the fill, restore cash, record `skip_reason:"leader-tx-reverted"`.

**Ledger:** maintain `positions` (avg-cost basis), realized PnL on sells, `portfolio_snapshots` every 5 min and at every fill.

**Accept:** integration test: feed 20 scripted signals (buys/sells, incl. a revert and an unknown token) through the engine; assert final cash, positions, and PnL match hand-computed expected values to the cent. Run live for 24 h against real wallets; equity curve renders from snapshots; no crash, no negative cash.

### Phase 5 — The brain: scoring & adaptation (2–3 days)

`packages/brain`. Deterministic and explainable first; ML later. Runs as a job every hour + on demand.

**Leader scoring (per wallet, per window 7d/30d/all):** reconstruct each leader's *own* round-trip trades from their signals (FIFO match buys→sells per token, mark open trades at current price):
- `win_rate`, `avg_return_pct`, `realized_pnl_usd`, `median_hold_minutes`, `max_drawdown_pct`, `trades`.
- Score: `score = 0.35*z(pnl) + 0.25*z(win_rate) + 0.25*z(avg_return) - 0.15*z(drawdown)` using z-scores across the tracked cohort; require `trades >= 5` in window else score = null (insufficient data → weight stays at default 0.5).

**Weight mapping:** `weight = clamp(sigmoid(score) * 2, 0, 2)` recomputed hourly, persisted to `leader_stats`, read by paper-engine at decision time (in-memory, refreshed on update). A leader whose 7d score < −1 gets weight 0 (auto-mute) and a logged event.

**Adaptive filters (rule learning, transparent):** weekly job computes copy-performance buckets and adjusts config bounds within hard limits:
- If fills on tokens with liquidity < $300k underperform fills above it by > X, raise `MIN_LIQUIDITY_USD` one notch (150k→300k→500k). Symmetric loosening.
- Per-leader token-category stats (stables/majors/long-tail by liquidity tier): if a leader only makes money on majors, apply per-leader category filter.
- Hold-time exit rule: track our fills' PnL-vs-time curve; if median copied trade peaks at T minutes and decays, add an optional time-based take-profit (config-gated, default off).
Every adjustment writes an `adaptation_log` row (add this table: `id, ts, rule, old_value, new_value, evidence_json`) — the system must be auditable.

**Accept:** unit tests for FIFO round-trip reconstruction and z-score weighting with synthetic data; after seeding 30 days of synthetic signals, weights diverge sensibly (profitable leader ~>1.2, losing leader →0).

### Phase 6 — API + dashboard (2–3 days, can run parallel after Phase 4)

`apps/api` (Fastify): REST — `GET/POST/DELETE /wallets`, `GET /signals?since`, `GET /fills`, `GET /portfolio` (equity, cash, positions w/ live marks), `GET /leaders` (stats+weights), `GET /adaptations`. WS channel streaming `trade-signal` and `paper-fill` events. zod schemas on every route; API key auth via `X-Api-Key` header (single key from env).

`apps/web` (Next.js + Tailwind): pages — Portfolio (equity curve from snapshots, open positions table), Leaders (score/weight table, per-leader trade history), Live Feed (WS-driven signal/fill stream), Settings (wallet CRUD, config view). Keep it server-component-first; charts with `lightweight-charts`.

**Accept:** add a wallet via UI → signals appear in feed within a block of leader activity; portfolio page matches DB snapshot values.

### Phase 7 — Solana adapter (later, nice-to-have)

Mirror the `ingest`/`decoder` interfaces: Helius LaserStream or Yellowstone gRPC subscription filtered by tracked wallet account keys; decode Jupiter v6 / Raydium / Pump.fun swaps via balance-delta on pre/post token balances in the transaction meta (Solana gives you these directly — easier than EVM). Everything downstream (pricing via Birdeye/DefiLlama, paper-engine, brain) is chain-agnostic already if Phases 1–5 honored the interfaces. **Do not start this until Phases 0–5 are accepted.**

### Phase 8 (optional, future) — ML upgrade

Only after ≥ 60 days of data: gradient-boosted classifier (probability a copied trade is profitable) over features already in DB (leader stats, token liquidity tier, time-of-day, hold-time, trade size percentile). Shadow-mode first (log predictions, don't act), promote when AUC > 0.6 out-of-sample. Not part of initial build.

---

## 8. Configuration (`.env.example` — document all of these)

```
DATABASE_URL=postgres://tradebot:tradebot@localhost:5432/tradebot
ALCHEMY_API_KEY=
QUICKNODE_ETH_WS=
QUICKNODE_BASE_WS=
API_KEY=                      # for apps/api auth
PAPER_STARTING_CASH_USD=100000
BASE_TRADE_PCT=0.01
MAX_TRADE_PCT=0.03
MIN_NOTIONAL_USD=50
MIN_LIQUIDITY_USD=150000
COPY_DELAY_PENALTY_BPS_ETH=10
COPY_DELAY_PENALTY_BPS_BASE=5
SIZING_MODE=fixed             # fixed | proportional
LOG_LEVEL=info
```

Hard rule: secrets only via env; `.env` is gitignored; fail fast at boot if required vars missing (zod).

---

## 9. Testing & verification strategy

- **Unit:** decoder fixtures (real receipts), fill math, FIFO reconstruction, scoring. Target: every formula in §7 has a test with hand-computed expected values.
- **Integration:** in-memory bus end-to-end with scripted `RawTxEvent`s → assert DB state. Use a disposable Postgres (testcontainers or docker-compose test profile).
- **Replay harness (build in Phase 2, invaluable):** `apps/runner --replay <file.jsonl>` feeds recorded `RawTxEvent`s at original or accelerated timing. Record live events to JSONL continuously (`recordings/` dir, gitignored). This lets you re-run the whole pipeline deterministically after any change and is the backbone of brain-tuning.
- **Soak:** 72 h live run; assert zero unhandled rejections, WS reconnects recover, memory flat (heap snapshot before/after).
- `pnpm test` must pass before any phase is declared done.

## 10. Known pitfalls (read before coding)

1. **Base mempool is private** — pending-tx stream may be empty there; never assume mempool coverage. Confirmed-log path is the source of truth on both chains.
2. **Reverted transactions**: always check `receipt.status`; mempool-fills must be voidable.
3. **Mempool signals can be replaced** (same nonce, repriced): if a different tx with same `from`+nonce confirms, void the provisional fill.
4. **Fee-on-transfer / rebasing tokens**: amounts from Transfer logs ≠ amounts received. Balance-delta strategy handles this naturally; never compute received amount from calldata alone.
5. **bigint discipline**: raw token amounts stay `bigint` until the last moment; convert to `number` only for USD values. Never `parseFloat` a raw amount.
6. **Wallet address case**: lowercase everywhere, checksum only for display.
7. **One tx, many swaps** (aggregator split routes): balance-delta collapses these correctly into net in/out — prefer it whenever Strategy A finds multiple conflicting Swap logs.
8. **Don't block the event loop** in handlers: DB writes go through a small async queue (`p-queue`, concurrency 4); the decode path itself is pure/sync.
9. **Subscription topic limits**: with > ~100 tracked wallets, split log filters into chunks of 50 addresses per subscription.
10. **Time**: store all timestamps UTC; latency math uses `Date.now()` captured at WS receipt, not block time.

## 11. Build order summary

| Phase | Deliverable | Est. |
|---|---|---|
| 0 | Scaffold + DB + config | 0.5 d |
| 1 | ETH+Base watchers, resilient WS, backfill | 2 d |
| 2 | Swap decoder (3 strategies) + replay harness | 3 d |
| 3 | Pricing + marks | 1.5 d |
| 4 | Paper engine + ledger | 3 d |
| 5 | Brain: scoring, weights, adaptive filters | 3 d |
| 6 | API + dashboard | 3 d |
| 7 | Solana adapter | later |
| 8 | ML shadow mode | much later |

Total to a self-improving paper-trading system on ETH+Base: **~13 working days** for a competent implementer following this document.
