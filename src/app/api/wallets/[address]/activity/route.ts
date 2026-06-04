import { NextResponse } from "next/server";
import { deriveTradeCandidates } from "@/lib/candidates";
import { fetchWalletTransfers } from "@/lib/external";
import { normalizeAddress } from "@/lib/money";
import { insertWalletActivity, listTradeCandidates, listWalletActivity, upsertTradeCandidates } from "@/lib/repositories";

export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await context.params;
    const walletAddress = normalizeAddress(address);
    const { transfers, warnings } = await fetchWalletTransfers(walletAddress);
    insertWalletActivity(transfers);
    const activity = listWalletActivity(walletAddress);
    upsertTradeCandidates(deriveTradeCandidates(activity));
    return NextResponse.json({
      activity,
      candidates: listTradeCandidates(walletAddress),
      fetched: transfers.length,
      warnings
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not fetch wallet activity." },
      { status: 400 }
    );
  }
}
