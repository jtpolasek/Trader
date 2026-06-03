# GMGN Paper Trader

A local Ethereum paper trading simulator for manually tracking wallets and testing fee-aware ERC-20 trades.

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in:

   ```text
   ALCHEMY_API_KEY=
   BASE_ALCHEMY_API_KEY=
   ZEROX_API_KEY=
   ETHERSCAN_API_KEY=
   ```

3. Run the app:

   ```powershell
   npm run dev
   ```

4. Open `http://localhost:3000`.

## What Works

- Manual wallet watchlist with optional GMGN URL and notes.
- Alchemy-backed Ethereum and Base wallet activity fetch for watched wallets.
- ERC-20 metadata resolution through Alchemy.
- 0x quote preview for buy/sell simulations.
- Paper trade execution with gas, slippage, and 0x fee snapshot storage.
- SQLite persistence in `data/paper-trader.db`.
- Dashboard, open positions, trade history, realized PnL, and fees paid.

## Notes

- This app never asks for private keys and never sends real transactions.
- Node's built-in `node:sqlite` module is used for local SQLite storage, so Node may print an experimental SQLite warning.
- Trade previews require `ZEROX_API_KEY`; token lookups and Ethereum wallet activity require `ALCHEMY_API_KEY`.
- Base wallet activity uses `BASE_ALCHEMY_API_KEY` when present, otherwise it falls back to `ALCHEMY_API_KEY`.
