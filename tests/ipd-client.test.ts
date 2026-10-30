import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { budget, IpdError, SolverClient } from "../src/lib/ipd/client";
import { object } from "../src/lib/ipd/contract";

test("typed HTTP errors, empty timeouts, malformed errors and Retry-After never become successful quotes", async (t) => {
  let response = new Response();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response.clone();
  });
  const cases: [number, unknown, string][] = [
    [503, { error: "no_market", message: "No market" }, "unsupported"],
    [503, { error: "no_price", message: "No quote" }, "price-unavailable"],
    [503, { error: "stale", message: "Old quote" }, "price-unavailable"],
    [503, { error: "not_ready", message: "Starting" }, "starting"],
    [503, { error: "overloaded", message: "Busy" }, "busy"],
    [400, { error: "bad_amount", message: "Amount" }, "invalid"],
    [404, { error: "unknown_faucet", message: "Unknown faucet" }, "invalid"],
    [408, "", "error"],
    [503, "<html>Proxy unavailable</html>", "error"],
    [429, "", "busy"],
    [503, { error: "no_market", message: 9 }, "error"],
  ];
  for (const [status, raw, expected] of cases) {
    const service = new SolverClient("https://solver.example");
    response =
      typeof raw === "string"
        ? new Response(raw, { status })
        : Response.json(raw, { status });
    const before = calls;
    const context = {
      ...budget(new AbortController().signal),
      deadline: Date.now() + 100,
    };
    await assert.rejects(
      service.get("/v2/pair-price", context, object),
      (error: IpdError) =>
        error.status === expected && error.httpStatus === status,
    );
    assert.equal(calls - before, 1);
  }
  response = new Response("", {
    status: 429,
    headers: { "Retry-After": "60" },
  });
  const client = new SolverClient("https://solver.example"),
    context = budget(new AbortController().signal);
  await assert.rejects(
    client.get("/v2/pairs", context, object),
    (error: IpdError) =>
      error.status === "busy" && error.retryAt! > Date.now() + 59000,
  );
  const before = calls;
  response = Response.json({ healthy: true });
  await assert.rejects(
    client.get("/v2/pairs", budget(new AbortController().signal), object),
    (error: IpdError) => error.code === "cooldown",
  );
  assert.equal(
    calls,
    before,
    "future requests must honor the shared cooldown without contacting upstream",
  );
});

test("one transient retry, permanent rejection, and failed-schema responses are never cached", async (t) => {
  let calls = 0,
    mode = "retry";
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (mode === "retry" && calls === 1)
      return new Response("", { status: 408 });
    if (mode === "invalid") return Response.json({ missing: true });
    if (mode === "permanent")
      return Response.json(
        { error: "bad_request", message: "Invalid" },
        { status: 400 },
      );
    return Response.json({ valid: true });
  });
  const client = new SolverClient("https://solver.example");
  assert.deepEqual(
    await client.get("/retry", budget(new AbortController().signal), object),
    { valid: true },
  );
  assert.equal(calls, 2);
  mode = "permanent";
  await assert.rejects(
    client.get("/permanent", budget(new AbortController().signal), object),
  );
  assert.equal(calls, 3);
  mode = "invalid";
  const validate = (raw: unknown) => {
    const value = object(raw);
    if (value.valid !== true) throw new Error("Missing required field");
    return value;
  };
  await assert.rejects(
    client.get(
      "/schema",
      budget(new AbortController().signal),
      validate,
      300000,
    ),
  );
  mode = "valid";
  assert.deepEqual(
    await client.get(
      "/schema",
      budget(new AbortController().signal),
      validate,
      300000,
    ),
    { valid: true },
  );
  assert.equal(calls, 5);
});

test("the global request queue bounds actual fetches to two and cancels obsolete queued requests", async (t) => {
  let active = 0,
    peak = 0;
  const sent: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      sent.push(url);
      active++;
      peak = Math.max(peak, active);
      try {
        await delay(30, undefined, { signal: options.signal! });
        return Response.json({ valid: true });
      } finally {
        active--;
      }
    },
  );
  const client = new SolverClient("https://solver.example");
  const cancel = new AbortController();
  const jobs = Array.from({ length: 6 }, (_, index) =>
    client.get(
      `/row-${index}`,
      budget(index === 5 ? cancel.signal : new AbortController().signal),
      object,
    ),
  );
  cancel.abort();
  const results = await Promise.allSettled(jobs);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    5,
  );
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.ok(sent.every((url) => !url.endsWith("row-5")));
});

test("shared prices deduplicate subscribers without cancellation poisoning; cache obeys upstream no-store and expires", async (t) => {
  let calls = 0,
    cacheControl = "max-age=1";
  t.mock.method(
    globalThis,
    "fetch",
    async (_: string, options: RequestInit) => {
      calls++;
      await delay(10, undefined, { signal: options.signal! });
      return Response.json(
        { quote: calls },
        { headers: { "Cache-Control": cacheControl } },
      );
    },
  );
  const client = new SolverClient("https://solver.example"),
    cancelled = new AbortController();
  const first = client.get("/price", budget(cancelled.signal), object, 1000);
  const second = client.get(
    "/price",
    budget(new AbortController().signal),
    object,
    1000,
  );
  cancelled.abort();
  assert.equal(
    (await Promise.allSettled([first, second]))[1].status,
    "fulfilled",
  );
  assert.equal(calls, 1);
  await client.get(
    "/price",
    budget(new AbortController().signal),
    object,
    1000,
  );
  assert.equal(calls, 1);
  await delay(1050);
  await client.get(
    "/price",
    budget(new AbortController().signal),
    object,
    1000,
  );
  assert.equal(calls, 2);
  cacheControl = "no-store";
  await client.get(
    "/uncached-price",
    budget(new AbortController().signal),
    object,
    1000,
  );
  await client.get(
    "/uncached-price",
    budget(new AbortController().signal),
    object,
    1000,
  );
  assert.equal(calls, 4);
  await client.get("/estimate", budget(new AbortController().signal), object);
  await client.get("/estimate", budget(new AbortController().signal), object);
  assert.equal(calls, 6, "estimates must not be cached");
  cacheControl = "max-age=300, s-maxage=0";
  await client.get(
    "/strict-policy",
    budget(new AbortController().signal),
    object,
    1000,
  );
  await client.get(
    "/strict-policy",
    budget(new AbortController().signal),
    object,
    1000,
  );
  assert.equal(
    calls,
    8,
    "the stricter shared-cache policy must win regardless of header order",
  );
});

test("request timeout and remaining row budget abort the transport and release its slot", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (_: string, options: RequestInit) => {
      await delay(20000, undefined, { signal: options.signal! });
      return Response.json({});
    },
  );
  const client = new SolverClient("https://solver.example");
  const start = Date.now();
  await assert.rejects(
    client.get(
      "/slow",
      { ...budget(new AbortController().signal), deadline: start + 40 },
      object,
    ),
    (error: IpdError) => error.code === "timeout",
  );
  assert.ok(Date.now() - start < 500);
});
