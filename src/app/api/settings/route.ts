import { NextResponse } from "next/server";
import { z } from "zod";
import { getCopySettings, updateCopySettings } from "@/lib/repositories";

const addressList = z.array(z.string()).default([]);

const schema = z.object({
  mode: z.enum(["fixedUsd", "percentOfSource"]),
  fixedUsd: z.number().min(1).max(1_000_000),
  percentOfSource: z.number().min(1).max(100),
  maxTradeUsd: z.number().min(1).max(1_000_000),
  slippageCapBps: z.number().min(0).max(5000),
  gasBufferBps: z.number().min(0).max(10000),
  insufficientCashBehavior: z.enum(["skip", "cap"]),
  allowlist: addressList,
  blocklist: addressList,
  autoCopy: z.boolean()
});

export async function GET() {
  return NextResponse.json({ copySettings: getCopySettings() });
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const copySettings = updateCopySettings(body);
    return NextResponse.json({ copySettings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save copy settings." },
      { status: 400 }
    );
  }
}
