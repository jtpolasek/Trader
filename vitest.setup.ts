import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Tests must never touch the real data/paper-trader.db.
const testDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "paper-trader-test-")), "test.db");
process.env.PAPER_TRADER_DB_PATH = testDb;
