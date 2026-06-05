import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { deriveTradeCandidates } from "../src/lib/candidates.ts";
import { summarizeCandidateReprocess } from "../src/lib/candidateReprocess.ts";

const dbPath = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "data/paper-trader.db";
const json = process.argv.includes("--json");
const apply = process.argv.includes("--apply");
const db = new DatabaseSync(dbPath, { readOnly: true });

const activityRows = db
  .prepare(
    `SELECT *
     FROM wallet_activity
     ORDER BY wallet_address ASC, chain_id ASC, hash ASC, timestamp ASC, id ASC`
  )
  .all();
const storedCandidates = db.prepare("SELECT * FROM trade_candidates").all().map(rowToTradeCandidate);
const activityByWallet = new Map();

for (const row of activityRows) {
  const item = rowToWalletActivity(row);
  const key = item.walletAddress.toLowerCase();
  activityByWallet.set(key, [...(activityByWallet.get(key) ?? []), item]);
}

const derivedCandidates = Array.from(activityByWallet.values()).flatMap((items) => deriveTradeCandidates(items));
const report = summarizeCandidateReprocess(storedCandidates, derivedCandidates);
if (apply) applyMissingCandidates(report.changes, dbPath);

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

function applyMissingCandidates(changes, writeDbPath) {
  const missing = changes
    .filter((change) => change.kinds.includes("newly-derived"))
    .map((change) => derivedCandidates.find((candidate) => candidateKey(candidate) === change.key))
    .filter(Boolean);
  if (!missing.length) return;

  db.close();
  const writeDb = new DatabaseSync(writeDbPath);
  const statement = writeDb.prepare(
    `INSERT OR IGNORE INTO trade_candidates
      (id, wallet_address, chain_id, chain_name, hash, status, confidence, side, token_in_asset, token_in_amount,
       token_in_address, token_out_asset, token_out_amount, token_out_address, reason, transfer_count, source_timestamp,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const timestamp = new Date().toISOString();
  writeDb.exec("BEGIN");
  try {
    for (const candidate of missing) {
      statement.run(
        crypto.randomUUID(),
        candidate.walletAddress,
        candidate.chainId,
        candidate.chainName,
        candidate.hash,
        candidate.status,
        candidate.confidence,
        candidate.side,
        candidate.tokenInAsset,
        candidate.tokenInAmount,
        candidate.tokenInAddress,
        candidate.tokenOutAsset,
        candidate.tokenOutAmount,
        candidate.tokenOutAddress,
        candidate.reason,
        candidate.transferCount,
        candidate.sourceTimestamp,
        timestamp,
        timestamp
      );
    }
    writeDb.exec("COMMIT");
  } catch (error) {
    writeDb.exec("ROLLBACK");
    throw error;
  } finally {
    writeDb.close();
  }
}

function candidateKey(candidate) {
  return `${candidate.walletAddress.toLowerCase()}|${candidate.chainId}|${candidate.hash.toLowerCase()}`;
}

function printHumanReport(report) {
  console.log("Candidate reprocess report");
  console.log(`DB: ${dbPath}`);
  console.log("");
  for (const [key, value] of Object.entries(report.summary)) {
    console.log(`${key}: ${value}`);
  }

  if (!report.changes.length) {
    console.log("");
    console.log("No candidate differences found.");
    return;
  }

  const actionableChanges = report.changes.filter(
    (change) => !change.kinds.includes("newly-derived") || change.derivedStatus !== "skipped"
  );
  console.log("");
  console.log(`Actionable changes: ${actionableChanges.length}`);
  console.log("Top actionable changes:");
  for (const change of actionableChanges.sort(compareChangePriority).slice(0, 25)) {
    console.log(
      [
        change.kinds.join("+"),
        change.chainName || change.chainId,
        change.hash,
        `${change.storedStatus ?? "-"} -> ${change.derivedStatus ?? "-"}`,
        `${change.storedSide ?? "-"} -> ${change.derivedSide ?? "-"}`,
        `${change.storedCopyTokenAddress || "-"} -> ${change.derivedCopyTokenAddress || "-"}`
      ].join(" | ")
    );
  }
}

function compareChangePriority(a, b) {
  const score = (change) => {
    if (change.kinds.includes("status") || change.kinds.includes("side")) return 0;
    if (change.kinds.includes("copy-token-address")) return 1;
    if (change.derivedStatus === "decoded") return 2;
    if (change.derivedStatus === "candidate") return 3;
    return 4;
  };
  return score(a) - score(b) || a.key.localeCompare(b.key);
}

function rowToWalletActivity(row) {
  return {
    id: String(row.id),
    walletAddress: String(row.wallet_address),
    chainId: Number(row.chain_id),
    chainName: String(row.chain_name),
    hash: String(row.hash),
    category: String(row.category),
    asset: String(row.asset),
    contractAddress: String(row.contract_address),
    value: Number(row.value),
    fromAddress: String(row.from_address),
    toAddress: String(row.to_address),
    blockNum: String(row.block_num),
    timestamp: String(row.timestamp),
    isSwapLike: Boolean(row.is_swap_like),
    rawPayload: String(row.raw_payload)
  };
}

function rowToTradeCandidate(row) {
  return {
    walletAddress: String(row.wallet_address),
    chainId: Number(row.chain_id),
    chainName: String(row.chain_name),
    hash: String(row.hash),
    status: String(row.status),
    confidence: Number(row.confidence),
    side: String(row.side),
    tokenInAsset: String(row.token_in_asset),
    tokenInAddress: String(row.token_in_address),
    tokenInAmount: Number(row.token_in_amount),
    tokenOutAsset: String(row.token_out_asset),
    tokenOutAddress: String(row.token_out_address),
    tokenOutAmount: Number(row.token_out_amount),
    reason: String(row.reason),
    transferCount: Number(row.transfer_count),
    sourceTimestamp: String(row.source_timestamp || row.updated_at)
  };
}
