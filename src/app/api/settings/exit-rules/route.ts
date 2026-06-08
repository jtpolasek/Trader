import { NextResponse } from "next/server";
import { z } from "zod";
import { getExitRules, updateExitRules } from "@/lib/repositories";

const schema = z.object({
  enabled: z.boolean(),
  takeProfitPct: z.number().positive().nullable(),
  stopLossPct: z.number().positive().nullable(),
  exitSizePct: z.number().min(1).max(100),
  checkIntervalSecs: z.union([
    z.literal(30),
    z.literal(60),
    z.literal(120),
    z.literal(300),
    z.literal(600)
  ])
});

export async function GET() {
  return NextResponse.json({ exitRules: getExitRules() });
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const exitRules = updateExitRules(body);
    return NextResponse.json({ exitRules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save exit rules." },
      { status: 400 }
    );
  }
}
