import { getRoute } from "@/lib/catalog";
import { queryQuote } from "@/lib/epoch";
import { toAtomic } from "@/lib/amount";
import type { Quote } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 60;
let active = 0;
const cache = new Map<string, { expires: number; quote: Quote }>();

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin) {
    try {
      if (new URL(origin).host !== host)
        return Response.json({ error: "Origin not allowed." }, { status: 403 });
    } catch {
      return Response.json({ error: "Invalid origin." }, { status: 403 });
    }
  }
  let route, amount;
  try {
    const body = await request.json();
    if (typeof body.routeId !== "string" || typeof body.amount !== "string")
      throw new Error("Route and amount are required.");
    route = getRoute(body.routeId);
    if (!route) throw new Error("Unknown route.");
    amount = body.amount;
    toAtomic(amount, route.source.decimals);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 },
    );
  }
  const key = `${route.id}:${amount}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now())
    return Response.json(hit.quote, {
      headers: { "Cache-Control": "no-store" },
    });
  if (active >= 8)
    return Response.json(
      { error: "Quote server is busy. Try again shortly." },
      { status: 429, headers: { "Retry-After": "5" } },
    );
  active++;
  try {
    const quote = await queryQuote(route, amount, request.signal);
    if (quote.code === "RATE_LIMITED")
      return Response.json(
        {
          error: quote.message,
          code: quote.code,
          rawResponse: quote.rawResponse,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(quote.retryAfter ?? 60),
            "Cache-Control": "no-store",
          },
        },
      );
    if (!request.signal.aborted) {
      if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + 15_000, quote });
    }
    return Response.json(quote, { headers: { "Cache-Control": "no-store" } });
  } finally {
    active--;
  }
}
