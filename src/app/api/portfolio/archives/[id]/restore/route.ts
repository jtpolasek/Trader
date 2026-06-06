import { NextResponse } from "next/server";
import { restorePaperPortfolioArchive } from "@/lib/repositories";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(restorePaperPortfolioArchive(id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not restore paper portfolio archive." },
      { status: 400 }
    );
  }
}
