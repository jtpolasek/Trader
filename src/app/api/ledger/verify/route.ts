import { NextResponse } from "next/server";
import { verifyLedger } from "@/lib/ledger";
import { listLedgerEntries, listTradesForLedger } from "@/lib/repositories";

export async function GET() {
  const result = verifyLedger(listTradesForLedger(), listLedgerEntries());
  return NextResponse.json(result);
}
