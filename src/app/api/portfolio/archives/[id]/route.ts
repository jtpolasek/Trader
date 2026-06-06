import { NextResponse } from "next/server";
import { deletePaperPortfolioArchive, renamePaperPortfolioArchive } from "@/lib/repositories";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: unknown };
    const archive = renamePaperPortfolioArchive(id, typeof body.name === "string" ? body.name : "");
    return NextResponse.json({ archive });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not rename paper portfolio archive." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const deleted = deletePaperPortfolioArchive(id);
    if (!deleted) {
      return NextResponse.json({ error: "Paper portfolio archive was not found." }, { status: 404 });
    }
    return NextResponse.json({ deleted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete paper portfolio archive." },
      { status: 400 }
    );
  }
}
