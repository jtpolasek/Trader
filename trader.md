# CLAUDE.md

## Project
Build a web app called **Copy Trade Simulator**.

The app lets a user enter a crypto wallet address, watch that wallet on-chain, detect trades, and mirror those trades into a **simulated paper portfolio**. The simulator must include realistic fees such as gas, slippage, and optional protocol fees. This is a simulator only — no live execution, no private keys, and no custody of real funds.

## Product goals
- Track a source wallet address on one supported chain.
- Detect swap transactions and other simple trade actions.
- Simulate those trades inside a paper portfolio.
- Subtract gas fees and other modeled costs from the simulated account.
- Show portfolio value, PnL, trade history, and performance over time.
- Keep the MVP small, reliable, and easy to extend.

## Non-goals
- No live trading.
- No private key handling.
- No cross-chain copy trading in v1.
- No advanced MEV or private mempool logic.
- No social features in v1.
- No full wallet reconstruction for every possible contract interaction.

## Suggested MVP chain support
Start with **one chain** only:
- Ethereum mainnet, or
- Base

Use chain-specific fee modeling:
- Ethereum-style EIP-1559 gas rules.
- Base-specific fee estimation including L1 data fee where applicable [web:32][web:40].

## Core user flow
1. User enters a wallet address.
2. User selects chain and copy settings.
3. App backfills historical transactions for the wallet.
4. App begins monitoring new wallet activity.
5. App detects qualifying trades.
6. App creates matching simulated trades in a paper portfolio.
7. App updates balances, positions, fees, and PnL in real time.
8. User can pause, resume, or adjust settings.

## Primary features
### Wallet tracking
- Accept a wallet address.
- Validate chain format and address format.
- Store the watched wallet.
- Backfill recent activity on start.
- Poll for new transactions on a schedule.

### Trade detection
- Identify swap transactions from wallet activity.
- Decode token in/out, trade size, and router interactions.
- Skip unsupported or ambiguous contract calls rather than crashing.
- Tag each detected trade with status: copied, skipped, failed, or partial.

### Simulation engine
- Mirror source trades into a paper portfolio.
- Support configurable copy ratio:
  - 1:1 notional copy.
  - Fixed-dollar copy.
  - Percent of source trade.
  - Max trade cap.
- Apply slippage.
- Subtract gas.
- Subtract optional protocol fees.
- Track realized and unrealized PnL.

### Portfolio dashboard
- Show cash balance.
- Show token holdings.
- Show current equity.
- Show total fees paid.
- Show cumulative and per-trade PnL.
- Show trade feed and execution details.

## Important product rules
- The app must clearly label all activity as simulated.
- Fees must be visible per trade.
- If a trade cannot be decoded with confidence, mark it skipped.
- If a simulated order would exceed cash, cap or skip it based on settings.
- Store both source transaction details and simulated transaction results.

## System architecture
Use a simple full-stack structure:

### Frontend
- Next.js App Router.
- Dashboard pages for watchlists, portfolio, trade history, and settings.
- Realtime updates via polling or websockets.

### Backend
- FastAPI API.
- Background worker for transaction polling and decoding.
- Simulation service for fee and portfolio calculations.
- Database layer for persistence.

### Database
- Postgres.
- Keep an immutable trade log.
- Keep a ledger-style portfolio state.
- Store raw tx payloads for debugging and reprocessing.

## Recommended directory structure
```txt
copy-trade-simulator/
  app/
    api/
    components/
    dashboard/
    watchlist/
    settings/
    layout.tsx
    page.tsx
  backend/
    app/
      main.py
      api/
      core/
      services/
      models/
      schemas/
      workers/
      db/
  prisma-or-sql/
  docs/
  CLAUDE.md