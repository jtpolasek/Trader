# Dashboard Trust Signals Design

## Goal

Add a small dashboard trust-signal layer that makes the paper simulator easier to evaluate at a glance without crowding the existing manual trading workflow.

## Scope

This iteration adds both a compact metrics strip and one small analytics panel. The feature stays read-only and derives from existing portfolio, position, trade, and ledger-backed values. It does not add background polling, new persistence tables, market pricing, or live-trading behavior.

## Data Model

Create a pure analytics helper that accepts the current portfolio, open positions, and trade history. The helper returns:

- `closedTrades`: number of sell trades, including manual total-loss closes.
- `winningTrades` and `losingTrades`: closed trades grouped by positive or negative realized PnL.
- `winRate`: winning closed trades divided by closed trades, or `null` when there are no closed trades.
- `feeDrag`: total fees divided by total traded notional, or `null` when there is no notional.
- `averageHoldHours`: average FIFO holding time for closed quantity, or `null` when no closed quantity can be paired with a buy.
- `openExposureUsd`: current open cost basis.
- `realizedPnlUsd`: current realized PnL.
- `bestToken` and `worstToken`: realized PnL by token symbol for closed trades, or `null` when no closed token PnL exists.

The helper is deterministic and independently tested. It does not read SQLite directly.

## API

Keep `/api/portfolio` as the dashboard data source. Add `analytics` beside the existing `stats` payload so the dashboard still performs one fetch and existing consumers remain compatible.

## UI

Add a compact top strip near the existing portfolio metrics:

- Win rate
- Fee drag
- Open exposure
- Avg hold

Add one small “Trust signals” panel near the portfolio/trade-history area:

- Realized vs open exposure
- Best realized token
- Worst realized token
- Closed trade count

When there is not enough data, show honest neutral values such as `No closed trades` or `-` instead of pretending the metric is meaningful.

## Testing

Use TDD around the pure helper first:

- Empty portfolio returns neutral analytics.
- Mixed closed wins and losses compute win rate, best token, and worst token.
- Fees and notional compute fee drag.
- Buy and sell timestamps compute average FIFO hold time.

Then verify the existing app with targeted tests plus the full test/build checks.
