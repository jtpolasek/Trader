import { NextResponse } from "next/server";
import { fetchWalletTransfers } from "@/lib/external";
import { normalizeAddress } from "@/lib/money";
import { insertWalletActivity, listWalletActivity } from "@/lib/repositories";

export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await context.params;
    const walletAddress = normalizeAddress(address);
    const { transfers, warnings } = await fetchWalletTransfers(walletAddress);
    insertWalletActivity(transfers);
    return NextResponse.json({
      activity: listWalletActivity(walletAddress),
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
