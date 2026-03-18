import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generateDeck } from "@/lib/generate-deck";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();

    const body = await req.json();
    const { deck, pipelineRun } = await generateDeck(body, session.user.id);

    return NextResponse.json({ deck, pipelineRun }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message.includes("injection")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const issues = (err as Record<string, unknown>).issues;
    if (issues || message.includes("Required") || message.includes("Expected")) {
      return NextResponse.json({ error: "Invalid input", details: issues || message }, { status: 400 });
    }
    if (message.includes("chunk") || message.includes("retriev")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Generate deck error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
