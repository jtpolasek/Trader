# Internal Transfer Sell Decode — Design

## Problem

DEX sell transactions produce two on-chain transfers: an outbound `erc20` (token sent to
router) and an inbound `internal` ETH transfer (router pays ETH back to wallet).
`fetchAlchemyTransfers` in `src/lib/external.ts` requests only `["erc20", "external"]`, so
the inbound ETH leg is never stored. `toCandidate` sees a lone `TOKEN:out` with no paired
inbound and either skips it or marks it unknown. Result: zero decoded sells in the DB despite
many real sell transactions in watched-wallet history.

## Goal

Extend the Alchemy fetch to include `internal` transfers so DEX sells produce a paired
`TOKEN:out` + `ETH:in` shape that the existing parser decodes as `side: "sell"`. Prove the
behavior with fixture tests. Existing stored data heals on next re-fetch + reprocess with no
migration required.

## Changes

### 1. Fetch (`src/lib/external.ts` line ~310)

Add `"internal"` to the category array:

```ts
category: ["erc20", "external", "internal"],
```

Internal transfers have the same Alchemy shape as `external` (ETH asset, numeric value, null
`rawContract.address`), so `normalizeAlchemyTransfers` handles them without any other changes.

### 2. Parser guard (`src/lib/candidates.ts`)

`hasMissingTokenDetails` skips the contract-address check when `category === "external"`
because native ETH has no contract address. Internal ETH transfers share this property.
Extend the guard:

```ts
if (item.category === "external" || item.category === "internal") return false;
```

Without this fix, the internal ETH leg would be flagged as having missing details and
incorrectly degrade candidate confidence.

### 3. Tests (`src/lib/candidates.test.ts`)

Add two fixture tests:

1. **Decoded Base sell** — erc20 token out + internal ETH in → `status: "decoded"`,
   `side: "sell"`, `tokenInAsset` is the sold token, `tokenOutAsset` is `"ETH"`.
2. **Review-only sell with missing token address** — same shape but `contractAddress: ""`
   on the token leg → `status: "candidate"`, `side: "sell"`, reason mentions missing address.

Fixtures use inline raw payloads modeled on real Base activity (same style as existing
ECHO/SNOWY fixtures).

## Existing Data

`insertWalletActivity` uses `INSERT OR IGNORE`, so a re-fetch will additively insert the
previously-missing internal legs alongside existing erc20/external rows. Running
`npm run reprocess:candidates -- --apply` afterwards decodes the new sell shapes without any
separate migration or data wipe.

## Out of Scope

- Pagination / `pageKey` handling (pre-existing gap, separate concern)
- Noise filtering for unrelated internal transfers — an internal ETH transfer with no paired
  token outbound is a single-transfer transaction and is already skipped by the
  `transferCount > 1` filter in `deriveTradeCandidates`
