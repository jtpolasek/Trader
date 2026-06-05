import { NextResponse } from "next/server";
import { parseImportBundle, summarizeImportBundle } from "@/lib/importBundle";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const bundle = parseImportBundle(body);
    return NextResponse.json({ summary: summarizeImportBundle(bundle) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read import file." },
      { status: 400 }
    );
  }
}
