import { NextResponse } from "next/server";
import { getExitFailures, removeExitFailure } from "@/lib/repositories";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tokenAddress: string }> }
) {
  const { tokenAddress } = await params;
  const before = getExitFailures();
  const match = before.find((f) => f.tokenAddress === tokenAddress);
  if (!match) {
    return NextResponse.json({ error: "No exit failure found for this token." }, { status: 404 });
  }
  removeExitFailure(tokenAddress);
  return NextResponse.json({ dismissed: tokenAddress });
}
