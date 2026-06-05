import { NextResponse } from "next/server";
import { exportLocalData } from "@/lib/repositories";

export async function GET() {
  try {
    const exportedAt = new Date().toISOString();
    const filename = `gmgn-export-${exportedAt.replace(/[:.]/g, "-")}.json`;
    const payload = exportLocalData();
    return NextResponse.json(payload, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not export local data." },
      { status: 400 }
    );
  }
}
