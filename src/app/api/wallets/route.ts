import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeAddress } from "@/lib/money";
import { deleteWallet, listWallets, upsertWallet } from "@/lib/repositories";

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

export async function DELETE(request: Request) {
  try {
    const body = z.object({ address: z.string() }).parse(await request.json());
    const address = normalizeAddress(body.address);
    const deleted = deleteWallet(address);
    if (!deleted) {
      return NextResponse.json({ error: "Wallet was not found." }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete wallet." },
      { status: 400 }
    );
  }
}
