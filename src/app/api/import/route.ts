import { NextResponse } from "next/server";
import { parseImportBundle } from "@/lib/importBundle";
import { importLocalData } from "@/lib/repositories";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const bundle = parseImportBundle(body);
    const result = importLocalData(bundle);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not import local data." },
      { status: 400 }
    );
  }
}
