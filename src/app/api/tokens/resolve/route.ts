import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveTokenFromAlchemy } from "@/lib/external";
import { normalizeAddress } from "@/lib/money";
import { getToken, upsertToken } from "@/lib/repositories";

const schema = z.object({
  address: z.string()
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const address = normalizeAddress(body.address);
    const cached = getToken(address);
    if (cached) return NextResponse.json({ token: cached, cached: true });

    const token = await resolveTokenFromAlchemy(address);
    const saved = upsertToken(token);
    return NextResponse.json({ token: saved, cached: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve token." },
      { status: 400 }
    );
  }
}
