import { asIpdError, parseScanInput, solverService } from "@/lib/ipd/service";
import type { ScanEvent } from "@/lib/ipd/types";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin) {
    try {
      if (new URL(origin).host !== host)
        return Response.json(
          { error: "Origin not allowed." },
          { status: 403, headers },
        );
    } catch {
      return Response.json(
        { error: "Invalid origin." },
        { status: 403, headers },
      );
    }
  }
  let input;
  try {
    const body = await request.text();
    if (body.length > 64_000) throw new Error("Scan request is too large.");
    input = parseScanInput(JSON.parse(body));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid scan input." },
      { status: 400, headers },
    );
  }
  const service = solverService();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ScanEvent) => {
        if (!signal.aborted)
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await service.scan(input, signal, emit);
      } catch (error) {
        const failure = asIpdError(error);
        emit({
          type: "error",
          status: failure.status,
          message: failure.message,
          retryAt: failure.retryAt,
        });
      } finally {
        if (!cancellation.signal.aborted) controller.close();
      }
    },
    cancel() {
      cancellation.abort();
    },
  });
  return new Response(stream, {
    headers: {
      ...headers,
      "Content-Type": "application/x-ndjson",
      "X-Accel-Buffering": "no",
    },
  });
}
