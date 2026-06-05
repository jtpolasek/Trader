import { NextResponse } from "next/server";
import { resetPaperPortfolio } from "@/lib/repositories";

export async function POST() {
  try {
    const portfolio = resetPaperPortfolio();
    return NextResponse.json({ portfolio });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not reset paper portfolio." },
      { status: 400 }
    );
  }
}
