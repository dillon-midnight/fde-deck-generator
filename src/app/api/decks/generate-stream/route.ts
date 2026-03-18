import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generateDeckStream } from "@/lib/generate-deck-stream";
import type { StreamEvent } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  // Auth must be verified before the ReadableStream is constructed.
  // Once a streaming response has started, you cannot change the HTTP status
  // code — headers are already flushed. Checking auth inside the stream
  // start() callback would mean an unauthorized request gets a 200 with an
  // error event in the stream body, which clients cannot reliably distinguish
  // from a mid-stream failure. Fail fast with a proper 401 before any bytes
  // are sent.
  let session;
  try {
    session = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // emit is defined in the outer scope of start() so it remains accessible
      // in the catch block. If generateDeckStream throws after the stream has
      // already started, we need to send an error event to the client rather than
      // silently closing the connection. The client-side EventSource reader
      // distinguishes error events from connection drops and shows the user a
      // recoverable error message instead of an infinite spinner.
      function emit(event: StreamEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      try {
        await generateDeckStream(body, session.user.id, emit);
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
