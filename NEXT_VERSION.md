# Next Version Handoff

## Current Baseline

The basic simulator is ready for early manual testing:

- Local Next.js app with server-side API routes.
- Local SQLite persistence in `data/paper-trader.db`.
- Manual wallet watchlist with labels, notes, and optional GMGN URL.
- Alchemy-backed ERC-20 metadata lookup and watched-wallet activity fetch.
- 0x Swap API v2 `/swap/allowance-holder/price` previews for buy/sell simulations.
- Paper trade execution with gas, slippage, 0x fee snapshot storage, positions, trade history, and realized PnL.

This is enough to test the workflow, but it should not be treated as reliable PnL analysis until the quote and wallet parsing layers are tightened.

## Recommended Next Version

Focus the next version on simulation trustworthiness.

Completed foundation:

- 0x price calls now live in a dedicated typed `src/lib/zerox.ts` client.
- 0x v2 `/price` responses are normalized before preview/accounting code consumes them.
- Preview and executed trade snapshots now store both normalized quote metadata and the raw 0x response.

Remaining 0x hardening:

1. Broaden 0x `issues` parsing as more real responses are observed.
2. Store or expose richer quote metadata in the UI/debug views:
   - 0x endpoint used
   - chain ID
   - sell token and buy token
   - input amount
   - raw 0x response
   - normalized gas, fee, slippage, and warning assumptions
3. Keep `/swap/allowance-holder/price` as the default preview endpoint.
4. Add optional `/swap/allowance-holder/quote` firm-simulation mode only after `/price` previews are stable.
5. Keep Alchemy/on-chain wallet tracking as the source for arbitrary watched-wallet activity.

Do not rely on 0x Trade Analytics for arbitrary GMGN wallets. It only returns trades associated with our own 0x API key/app, so it is useful for our app analytics later, not for discovering or replaying random wallet trades.

## Backlog

Priority order after the 0x refactor:

1. Better wallet activity parsing into likely swaps using grouped transfers, transaction hashes, token direction, and ETH/USDC value changes.
2. Copy-trade simulation by portfolio percentage, with max trade size, token allow/block list, and slippage cap.
3. Token risk warnings for low liquidity, buy/sell tax, unreliable 0x simulation, stale quotes, and unusually high gas impact.
4. Historical backtesting mode that replays watched-wallet trades against historical or nearest-available pricing.
5. Multi-portfolio support for testing different strategies and bankroll sizes.
6. Local export/import for wallets, trades, settings, and portfolio history.
7. Better dashboard analytics: win rate, average hold time, fee drag, best/worst tokens, and realized vs open exposure.

## Acceptance Criteria

The next version is complete when:

- 0x calls are isolated in a dedicated typed client.
- Quote previews show specific warnings for known 0x issue categories.
- Executed trades store both raw and normalized quote details.
- Existing buy/sell accounting behavior remains unchanged unless a test explicitly covers the change.
- The app still supports early manual testing without requiring private keys or submitting real transactions.
- Tests cover 0x response normalization, gas warning normalization, liquidity failure, issue parsing, and existing accounting cases.
- Remaining test gaps: missing API keys and malformed 0x responses.
