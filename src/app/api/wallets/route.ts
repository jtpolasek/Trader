import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeAddress } from "@/lib/money";
import { listWallets, upsertWallet } from "@/lib/repositories";

const schema = z.object({
  address: z.string(),
  label: z.string().min(1).max(80),
  notes: z.string().max(500).optional().default(""),
  gmgnUrl: z.string().max(300).optional().default("")
});

export async function GET() {
  return NextResponse.json({ wallets: listWallets() });
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const wallet = upsertWallet({
      address: normalizeAddress(body.address),
      label: body.label.trim(),
      notes: body.notes.trim(),
      gmgnUrl: body.gmgnUrl.trim()
    });
    return NextResponse.json({ wallet });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save wallet." },
      { status: 400 }
    );
  }
}
