import { test } from "node:test";
import assert from "node:assert/strict";
import { getCatalog } from "../src/lib/catalog";
import { toAtomic, fromAtomic } from "../src/lib/amount";
import { POST } from "../src/app/api/quote/route";
import { queryQuote } from "../src/lib/epoch";

const routes = getCatalog().routes;
const inward = routes.find(
  (route) =>
    route.environment === "mainnet" &&
    route.source.chain === "Base" &&
    route.source.symbol === "USDC" &&
    route.destination.symbol === "USDCx",
)!;
const outward = routes.find(
  (route) =>
    route.environment === "mainnet" &&
    route.source.symbol === "USDCx" &&
    route.destination.chain === "Base" &&
    route.destination.symbol === "USDC",
)!;
const health = {
  status: "healthy",
  allocatorAddresses: {
    8453: "0xC7a2E29b7ef4543a3e7c50057d83beDfCdE2fb0C",
    999999999: "0xC7a2E29b7ef4543a3e7c50057d83beDfCdE2fb0C",
  },
  arbiterAddresses: {
    8453: "0xff065285a18c4608901004788540bb83a2e29ad8",
    999999999: "0xff065285a18c4608901004788540bb83a2e29ad8",
  },
  compactLockResetPeriod: 4,
  compactLockScope: 0,
  compactExpirySeconds: 10800,
  compactExpiryBufferSeconds: 600,
  midenVirtualChainId: 999999999,
};

test("mainnet catalog contains only the requested bridge pairs in both directions", () => {
  // Product contract from the requested route matrix; no cross-asset swaps.
  const pairs = new Map([
    [42161, ["ETH", "USDC"]],
    [8453, ["ETH", "USDC"]],
    [137, ["POL", "USDC"]],
    [1, ["ETH", "USDC"]],
    [4663, ["ETH", "USDG"]],
  ]);
  assert.equal(routes.length, 20);
  assert.equal(new Set(routes.map((route) => route.id)).size, routes.length);
  for (const route of routes) {
    assert.equal(route.environment, "mainnet");
    const evm =
      route.source.chain === "Miden" ? route.destination : route.source;
    const miden =
      route.source.chain === "Miden" ? route.source : route.destination;
    assert.ok(pairs.get(evm.chainId)?.includes(evm.symbol));
    assert.equal(miden.symbol, evm.symbol === "USDC" ? "USDCx" : evm.symbol);
    if (evm.symbol === "ETH" || evm.symbol === "POL") {
      assert.equal(evm.address, "0x0000000000000000000000000000000000000000");
      assert.equal(evm.decimals, 18);
      assert.equal(miden.decimals, 8);
    }
    assert.notEqual(
      route.source.chain === "Miden",
      route.destination.chain === "Miden",
    );
    assert.ok(
      routes.some(
        (reverse) =>
          reverse.environment === route.environment &&
          reverse.source.address === route.destination.address &&
          reverse.source.chainId === route.destination.chainId &&
          reverse.destination.address === route.source.address &&
          reverse.destination.chainId === route.source.chainId,
      ),
    );
  }
  const eth = routes.find(
    (route) =>
      route.environment === "mainnet" &&
      route.source.chain === "Miden" &&
      route.source.symbol === "ETH",
  )!;
  assert.equal(eth.source.decimals, 8); // Miden's verified token list, unlike the EVM WETH graph default.
  assert.equal(inward.source.decimals, 6);
});

test("atomic amounts preserve precision and reject silent rounding", () => {
  assert.equal(
    toAtomic("9007199254740993.123456", 6),
    "9007199254740993123456",
  );
  assert.equal(fromAtomic("99139554809999999999", 18), "99.139554809999999999");
  assert.equal(fromAtomic("1", 18), "0.000000000000000001");
  for (const amount of ["0", "-1", "1e3", "NaN", "1.0000001", "01", ""])
    assert.throws(() => toAtomic(amount, 6));
});

test("HTTP quote boundary accepts its Host origin, rejects invalid inputs, and never submits", async (t) => {
  const sent: { url: string; body?: Record<string, any> }[] = [];
  const epochResponse = {
    tokenIn: "100000000",
    tokenOut: "99950000",
    path: [],
    depositNeeded: true,
    details: { allocator: "test", fee: "50000" },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      sent.push({ url, body });
      if (url.endsWith("/health")) return Response.json(health);
      if (url.endsWith("/miden-recipient"))
        return Response.json({
          midenP2IDRecipientAccountId: "0x593c167bec26769178dcbd1f9bcb40",
        });
      if (url.includes("/suggested-nonce/"))
        return Response.json({ nonce: "0x123" });
      assert.ok(
        url.endsWith("/checkIfDepositNeeded"),
        "Only the quote endpoint may receive a POST",
      );
      return Response.json(epochResponse);
    },
  );
  const request = (body: unknown, origin = "http://127.0.0.1:3000") =>
    new Request("http://localhost:3000/api/quote", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  for (const body of [
    { routeId: "bad", amount: "100" },
    {
      routeId:
        "mainnet:from-miden:10:0x0b2c639c533813f4aa9d7837caf62653d097ff85:0xe69e6ca6e39df1b10c1e5399399feb",
      amount: "100",
    },
    {
      routeId:
        "testnet:to-miden:84532:0x2bb4ffd7e2c6d432b697554efd77fa13bdbefd69:0x5b043dcb48d5721106f7a1ceb2b804",
      amount: "100",
    },
    { routeId: inward.id, amount: "1.0000001" },
    { routeId: inward.id, amount: 100 },
  ])
    assert.equal((await POST(request(body))).status, 400);
  assert.equal(sent.length, 0);
  assert.equal(
    (
      await POST(
        request(
          { routeId: inward.id, amount: "100" },
          "https://foreign.example",
        ),
      )
    ).status,
    403,
  );
  const result = await POST(request({ routeId: inward.id, amount: "100" }));
  assert.equal(result.status, 200);
  const quote = await result.json();
  assert.equal(quote.status, "available");
  assert.equal(quote.amountOut, "99.95");
  assert.deepEqual(quote.rawResponse, epochResponse);
  const cached = await POST(request({ routeId: inward.id, amount: "100" }));
  assert.deepEqual((await cached.json()).rawResponse, epochResponse);
  const payload = sent.find((item) => item.body)?.body!;
  assert.equal(payload.chainId, "8453");
  assert.equal(payload.compact.mandate.tokenInAmount, "100000000");
  assert.equal(payload.compact.mandate.destinationChainId, "999999999");
  assert.equal(
    payload.compact.mandate.midenFaucetId,
    "0xe69e6ca6e39df1b10c1e5399399feb",
  );
  assert.equal(payload.sponsorSignature, "0x");
  assert.equal(payload.isRegisteredOnchain, false);
});

test("quote responses distinguish liquidity absence, server errors, and malformed values", async (t) => {
  let reply: unknown = { tokenIn: "100000000", tokenOut: "99950000" };
  let status = 200;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options?: RequestInit) => {
      if (url.endsWith("/health")) return Response.json(health);
      if (url.endsWith("/miden-recipient"))
        return Response.json({
          midenP2IDRecipientAccountId: "0x593c167bec26769178dcbd1f9bcb40",
        });
      if (url.includes("/suggested-nonce/"))
        return Response.json({ nonce: "0x123" });
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload.chainId, "999999999");
      assert.equal(
        payload.compact.mandate.midenFaucetId,
        "0xe69e6ca6e39df1b10c1e5399399feb",
      );
      return Response.json(reply, { status });
    },
  );
  assert.equal((await queryQuote(outward, "100")).amountOut, "99.95");
  for (const [body, code, expected] of [
    [
      { error: "No quote available", code: "NO_QUOTE_AVAILABLE" },
      400,
      "unavailable",
    ],
    [{ error: "Upstream service failed" }, 502, "error"],
    [{ tokenIn: "100000000", tokenOut: "-1" }, 200, "error"],
    [{ tokenIn: "100000000", tokenOut: "0" }, 200, "unavailable"],
  ] as const) {
    reply = body;
    status = code;
    const quote = await queryQuote(outward, "100");
    assert.equal(quote.status, expected);
    assert.equal(quote.amountOut, undefined);
    assert.deepEqual(quote.rawResponse, body);
  }
});

test("upstream throttling is retryable and never cached as quote availability", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/suggested-nonce/")) return Response.json({ nonce: "1" });
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  });
  const response = await POST(
    new Request("http://localhost:3000/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: inward.id, amount: "101" }),
    }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  const body = await response.json();
  assert.equal(body.code, "RATE_LIMITED");
  assert.deepEqual(body.rawResponse, { error: "Too many requests" });
});
