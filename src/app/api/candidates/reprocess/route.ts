import { NextResponse } from "next/server";
import {
  previewStoredActivityCandidateReprocess,
  reprocessStoredActivityCandidates
} from "@/lib/repositories";

export async function GET() {
  try {
    return NextResponse.json(previewStoredActivityCandidateReprocess());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not preview stored activity candidates." },
      { status: 400 }
    );
  }
}

export async function POST() {
  try {
    return NextResponse.json(reprocessStoredActivityCandidates());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not reprocess stored activity candidates." },
      { status: 400 }
    );
  }
}
