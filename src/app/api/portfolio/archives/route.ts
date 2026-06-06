import { NextResponse } from "next/server";
import { createPaperPortfolioArchive, listPaperPortfolioArchives } from "@/lib/repositories";

export async function GET() {
  try {
    return NextResponse.json({ archives: listPaperPortfolioArchives() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not list paper portfolio archives." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const archive = createPaperPortfolioArchive(typeof body.name === "string" ? body.name : undefined);
    return NextResponse.json({ archive });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not archive paper portfolio." },
      { status: 400 }
    );
  }
}
