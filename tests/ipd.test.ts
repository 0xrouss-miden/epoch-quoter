import assert from "node:assert/strict";
import test from "node:test";
import {
  U64_MAX,
  formatAmount,
  minimumReceive,
  notionalAmount,
  parseAmount,
} from "../src/lib/ipd/amounts";
import {
  classify,
  parseCatalog,
  parseEstimate,
  parsePairPrice,
} from "../src/lib/ipd/contract";
import { mainnetIdentities } from "../src/lib/ipd/config";
import { SolverService, parseScanInput } from "../src/lib/ipd/service";
import { POST } from "../src/app/api/ipd/scan/route";
import type { ScanEvent, ScanInput } from "../src/lib/ipd/types";
import {
  ETH,
  USDT,
  BTC,
  catalogFixture,
  estimateFixture,
  exactFixture,
  inputFromUrl,
  pairPriceFixture,
  roundedEstimateFixtures,
  valuationFixture,
  type Scenario,
} from "./fixtures/ipd";

test("IPD exact math preserves u64 boundaries, decimal scales, fee-once limits and preset floor", () => {
  assert.equal(minimumReceive("1000000", 6, 8, "0.01", 5), "999500");
  assert.equal(minimumReceive("100000000", 8, 6, "100", 5), "99950000");
  assert.equal(minimumReceive("1000000", 6, 6, "0.999", 5), "998500");
  assert.equal(parseAmount("18446744073709.551615", 6), U64_MAX.toString());
  assert.equal(formatAmount(U64_MAX.toString(), 6), "18446744073709.551615");
  assert.equal(notionalAmount("10", "3", 6), "3333333");
  assert.equal(notionalAmount("10", "1.0001", 6), "9999000");
  assert.equal(
    minimumReceive("9007199254740993", 0, 0, "1", 5),
    "9002695655113622",
  );
  for (const amount of [
    "0",
    "-1",
    "NaN",
    "Infinity",
    "1e3",
    "+1",
    "01",
    "",
    " 1",
    "0.0000001",
    "1.0000001",
    "18446744073709.551616",
  ])
    assert.throws(() => parseAmount(amount, 6), amount);
  assert.throws(() => minimumReceive("1", 8, 6, "0.01", 5), /zero/);
  assert.throws(() => minimumReceive(U64_MAX.toString(), 0, 8, "100", 5));
  for (const bps of [0, 101, 1.1, NaN])
    assert.throws(() => minimumReceive("100", 0, 0, "1", bps));
});

test("catalog expands only listed pairs and isolates unusable identities/decimals", () => {
  const raw = structuredClone(catalogFixture);
  raw.tokens.find((token) => token.faucetId === BTC)!.decimals =
    null as unknown as number;
  const catalog = parseCatalog(raw, mainnetIdentities);
  assert.equal(catalog.directions.length, 6);
  assert.ok(catalog.directions.some((row) => row.id === `${USDT}:${ETH}`));
  assert.ok(!catalog.directions.some((row) => row.id === `${ETH}:${BTC}`));
  assert.equal(
    catalog.directions.filter((row) => row.offered.issue || row.requested.issue)
      .length,
    2,
  );
  const unknown = structuredClone(catalogFixture);
  unknown.tokens[0].faucetId = "0x111111111111111111111111111111";
  unknown.pairs[0].faucetIds[0] = unknown.tokens[0].faucetId;
  assert.match(
    parseCatalog(unknown, mainnetIdentities).directions[0].offered.issue!,
    /mainnet/,
  );
});

test("success contract rejects missing, malformed and contradictory data before classification", () => {
  const direction = parseCatalog(catalogFixture, mainnetIdentities)
    .directions[0];
  for (const patch of [
    { fillStatus: "maybe" },
    { reason: "liquidity" },
    { priceBand: undefined },
    { marketPrice: null },
    { fillPrice: 99 },
    { feeAmount: undefined },
    { offeredAmount: "100000001" },
    { requestedFaucet: BTC },
    { fillableOfferedAmount: "1" },
    { settlementsRunning: undefined },
    { estimatedSeconds: -1 },
    { expectedRequestedAmount: "1" },
    { maxOfferedAmount: null },
    { maxOfferedAmount: "-1" },
    { maxOfferedAmount: (U64_MAX + 1n).toString() },
    { fillPrice: "101" },
    {
      fillStatus: "partial",
      fillableOfferedAmount: "50000000",
      fillableRequestedAmount: "1",
    },
  ])
    assert.throws(
      () => parseEstimate({ ...estimateFixture(), ...patch }, exactFixture),
      JSON.stringify(patch),
    );
  for (const patch of [
    { offeredDecimals: 18 },
    { requestedFaucet: BTC },
    { asOf: 0 },
    { expectedPrice: null },
  ])
    assert.throws(() =>
      parsePairPrice({ ...pairPriceFixture(), ...patch }, direction, 30000),
    );
  const extra = parseEstimate(
    { ...estimateFixture(), futureField: { harmless: true } },
    exactFixture,
  );
  assert.deepEqual(extra.futureField, { harmless: true });
  const statuses: [Scenario, string][] = [
    ["full", "full"],
    ["none", "no-liquidity"],
    ["partial", "partial"],
    ["tolerated", "waiting"],
    ["paused", "delayed"],
    ["no_price", "price-unavailable"],
    ["no_market", "unsupported"],
    ["off_market", "limit"],
  ];
  for (const [scenario, status] of statuses)
    assert.equal(
      classify(
        parseEstimate(estimateFixture(exactFixture, scenario), exactFixture),
      ),
      status,
    );
  assert.equal(
    classify(
      parseEstimate(
        { ...estimateFixture(exactFixture, "none"), settlementsRunning: false },
        exactFixture,
      ),
    ),
    "delayed",
  );
  assert.equal(
    classify(
      parseEstimate(
        {
          ...estimateFixture(exactFixture, "no_market"),
          settlementsRunning: false,
        },
        exactFixture,
      ),
    ),
    "unsupported",
  );
});

const settings = {
  upstream: "https://solver.example",
  expiresAfterMs: 120000,
  priceMaxAgeMs: 30000,
};

for (const fixture of roundedEstimateFixtures)
  test(`rounded estimate accepts ${fixture.name}`, () => {
    const estimate = parseEstimate(fixture.estimate, fixture.input);
    assert.equal(estimate.fillStatus, fixture.estimate.fillStatus);
    assert.equal(classify(estimate), fixture.estimate.fillStatus);
  });

test("rounded positives still reject missing, mismatched and contradictory fields", () => {
  for (const fixture of roundedEstimateFixtures) {
    for (const key of Object.keys(fixture.estimate)) {
      const missing: Record<string, unknown> = { ...fixture.estimate };
      delete missing[key];
      assert.throws(
        () => parseEstimate(missing, fixture.input),
        `missing ${key}`,
      );
      if (!["reason", "estimatedSeconds", "median24hSeconds"].includes(key))
        assert.throws(
          () =>
            parseEstimate({ ...fixture.estimate, [key]: null }, fixture.input),
          `null ${key}`,
        );
    }
    for (const patch of [
      { offeredFaucet: BTC },
      { requestedFaucet: BTC },
      { offeredAmount: "1" },
      { requestedAmount: "1" },
      { fillStatus: "unknown" },
      { priceBand: "unknown" },
      { reason: "unknown" },
      { reason: "liquidity" },
      { fillableOfferedAmount: "0" },
      { fillableRequestedAmount: "0" },
      {
        fillableOfferedAmount: (
          BigInt(fixture.input.offeredAmount) + 1n
        ).toString(),
      },
      {
        fillableRequestedAmount: (
          BigInt(fixture.input.requestedAmount) + 1n
        ).toString(),
      },
      { fillableRequestedAmount: (U64_MAX + 1n).toString() },
      { settlementsRunning: false },
      { priceBand: "tolerated" },
      {
        fillStatus: fixture.estimate.fillStatus === "full" ? "partial" : "full",
      },
    ])
      assert.throws(
        () => parseEstimate({ ...fixture.estimate, ...patch }, fixture.input),
        `${fixture.name}: ${JSON.stringify(patch)}`,
      );
  }
});

test("partial amounts must equal the exact floor release, including above Number precision", () => {
  const input = {
    ...exactFixture,
    offeredAmount: U64_MAX.toString(),
    requestedAmount: (U64_MAX - 2n).toString(),
  };
  const large = {
    input,
    estimate: {
      ...estimateFixture(input, "partial"),
      fillableOfferedAmount: "9223372036854775806",
      fillableRequestedAmount: "9223372036854775806",
      expectedRequestedAmount: input.requestedAmount,
    },
  };
  const partials = [
    ...roundedEstimateFixtures.filter(
      (fixture) => fixture.estimate.fillStatus === "partial",
    ),
    large,
  ];
  for (const fixture of partials) {
    assert.equal(
      classify(parseEstimate(fixture.estimate, fixture.input)),
      "partial",
    );
    for (const delta of [-1n, 1n])
      assert.throws(
        () =>
          parseEstimate(
            {
              ...fixture.estimate,
              fillableOfferedAmount: (
                BigInt(fixture.estimate.fillableOfferedAmount) + delta
              ).toString(),
            },
            fixture.input,
          ),
        /Partial amounts disagree with the order ratio/,
      );
  }
});

test("fixed-mid incident fixtures: a 100.01 ask / 99.99 bid cannot clear at 100, but the sufficient-band verdict becomes full", () => {
  // These are stipulated v2 responses for the task's fee-free books. This tests
  // interpretation of both exact note ratios, not the Rust matching algorithm.
  const fixtures = [
    {
      name: "buyer offers 100.02 for 1 base; maker asks 100.01",
      input: {
        ...exactFixture,
        offeredFaucet: USDT,
        requestedFaucet: ETH,
        offeredAmount: "100020000",
        requestedAmount: "100000000",
      },
      market: "0.01",
      selected: "0.009999000099990000",
      expected: "100000000",
    },
    {
      name: "seller offers 1 base for 99.98; maker bids 99.99",
      input: {
        ...exactFixture,
        offeredAmount: "100000000",
        requestedAmount: "99980000",
      },
      market: "100",
      selected: "99.99",
      expected: "99990000",
    },
  ];
  for (const fixture of fixtures) {
    for (const bandBps of [0, 30]) {
      const raw = {
        ...estimateFixture(fixture.input, bandBps === 0 ? "none" : "full"),
        feePpm: 0,
        feeAmount: "0",
        marketPrice: fixture.market,
        expectedPrice: bandBps === 0 ? fixture.market : fixture.selected,
        fillPrice: bandBps === 0 ? fixture.market : fixture.selected,
        expectedRequestedAmount: fixture.expected,
      };
      const verdict = parseEstimate(raw, fixture.input);
      assert.equal(verdict.priceBand, "at_market");
      assert.equal(
        classify(verdict),
        bandBps === 0 ? "no-liquidity" : "full",
        `${fixture.name}; band ${bandBps}`,
      );
    }
  }
});
function scanInput(ids = [`${ETH}:${USDT}`, `${USDT}:${ETH}`]): ScanInput {
  return {
    network: "mainnet",
    directionIds: ids,
    notional: "10",
    customAmounts: {},
    slippageBps: 5,
  };
}
async function run(service: SolverService, input = scanInput()) {
  const events: ScanEvent[] = [];
  await service.scan(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  return events.flatMap((event) =>
    event.type === "result" ? [event.check] : [],
  );
}

test("service classifies rounded estimates without invalid_response", async (t) => {
  for (const fixture of roundedEstimateFixtures)
    await t.test(fixture.name, async (t) => {
      let estimateCalls = 0;
      t.mock.method(
        globalThis,
        "fetch",
        async (input: string, options: RequestInit) => {
          const url = new URL(input);
          assert.equal(options.method, "GET");
          assert.equal(options.cache, "no-store");
          if (url.pathname === "/v2/pairs")
            return Response.json(catalogFixture);
          if (url.pathname === "/v2/pair-price")
            return Response.json({
              ...pairPriceFixture(
                fixture.input.offeredFaucet,
                fixture.input.requestedFaucet,
              ),
              marketPrice: fixture.estimate.marketPrice,
              expectedPrice: fixture.estimate.expectedPrice,
              fillPrice: fixture.estimate.fillPrice,
              feePpm: 0,
            });
          assert.equal(url.pathname, "/v2/swap-eta");
          assert.deepEqual(inputFromUrl(url), fixture.input);
          estimateCalls++;
          return Response.json(fixture.estimate);
        },
      );
      const id = `${fixture.input.offeredFaucet}:${fixture.input.requestedFaucet}`;
      const input = scanInput([id]);
      input.customAmounts[id] = "1";
      const checks = await run(new SolverService(settings), input);
      assert.equal(checks.length, 1);
      assert.equal(estimateCalls, 1);
      assert.deepEqual(checks[0].input, fixture.input);
      assert.equal(checks[0].identity, JSON.stringify(fixture.input));
      assert.equal(checks[0].status, fixture.estimate.fillStatus);
      assert.equal(checks[0].validity, "valid");
      assert.equal(checks[0].errorCode, undefined);
      assert.deepEqual(checks[0].estimate, fixture.estimate);
    });
});

test("both directions use their own price and recheck anonymous usable depth even while prices are cached", async (t) => {
  const calls: string[] = [];
  let sufficientBand = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, options: RequestInit) => {
      const url = new URL(input);
      calls.push(url.pathname);
      assert.equal(options.method, "GET");
      assert.equal(options.cache, "no-store");
      if (url.pathname === "/v2/pairs") return Response.json(catalogFixture);
      if (url.pathname === "/v1/prices")
        return Response.json(valuationFixture());
      if (url.pathname === "/v2/pair-price") {
        const offered = url.searchParams.get("offered_faucet")!,
          requested = url.searchParams.get("requested_faucet")!;
        // Reference mid=100 in both fixture books; buying queries its own direction.
        return Response.json({
          ...pairPriceFixture(offered, requested),
          marketPrice: offered === ETH ? "100" : "0.01",
          expectedPrice: offered === ETH ? "100" : "0.01",
          fillPrice: offered === ETH ? "100" : "0.01",
          feePpm: 0,
        });
      }
      assert.equal(url.pathname, "/v2/swap-eta");
      const exact = inputFromUrl(url);
      return Response.json(
        estimateFixture(exact, sufficientBand ? "full" : "none"),
      );
    },
  );
  const service = new SolverService(settings);
  const fixedMid = await run(service);
  assert.deepEqual(
    fixedMid.map((check) => check.status),
    ["no-liquidity", "no-liquidity"],
  );
  assert.ok(
    fixedMid.every(
      (check) =>
        check.pairPrice?.marketPrice &&
        check.estimate?.priceBand === "at_market",
    ),
  );
  sufficientBand = true;
  const bounded = await run(service);
  assert.deepEqual(
    bounded.map((check) => check.status),
    ["full", "full"],
  );
  assert.notEqual(
    bounded[0].input?.offeredFaucet,
    bounded[1].input?.offeredFaucet,
  );
  // Aggregate availability cannot depend on maker attribution (the public API has none).
  assert.ok(
    bounded.every(
      (check) => check.validity === "valid" && check.estimate?.reason === null,
    ),
  );
  assert.equal(calls.filter((path) => path === "/v2/swap-eta").length, 4);
  assert.ok(!calls.includes("/v1/swap-eta"));
});

test("valuation failures preserve custom checks; sizes generate independent exact estimates; invalid dust stops before ETA", async (t) => {
  let missing = true;
  let priceUnavailable = false;
  const exactRequests: ReturnType<typeof inputFromUrl>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v2/pairs") return Response.json(catalogFixture);
    if (url.pathname === "/v1/prices") {
      assert.equal(url.searchParams.get("precision"), "full");
      assert.equal(url.searchParams.has("allow_stale"), false);
      return Response.json(
        missing
          ? { [ETH]: { ...valuationFixture()[ETH], stale: true } }
          : valuationFixture(),
      );
    }
    if (url.pathname === "/v2/pair-price")
      return priceUnavailable
        ? Response.json(
            { error: "no_price", message: "Price unavailable" },
            { status: 503 },
          )
        : Response.json(pairPriceFixture());
    const exact = inputFromUrl(url);
    exactRequests.push(exact);
    return Response.json(estimateFixture(exact));
  });
  const service = new SolverService(settings),
    input = scanInput([`${ETH}:${USDT}`]);
  assert.equal((await run(service, input))[0].status, "price-unavailable");
  assert.equal(exactRequests.length, 0);
  input.customAmounts[input.directionIds[0]] = "1";
  assert.equal((await run(service, input))[0].status, "full");
  input.customAmounts[input.directionIds[0]] = "0.00000001";
  assert.equal((await run(service, input))[0].status, "invalid");
  assert.equal(exactRequests.length, 1);
  input.customAmounts = {};
  missing = false;
  input.notional = "1";
  const small = (await run(service, input))[0];
  input.notional = "100";
  const large = (await run(service, input))[0];
  assert.equal(small.input?.offeredAmount, "1000000");
  assert.equal(large.input?.offeredAmount, "100000000");
  assert.notEqual(small.identity, large.identity);
  priceUnavailable = true;
  const failedPrice = (await run(new SolverService(settings), input))[0];
  assert.equal(failedPrice.status, "price-unavailable");
  assert.equal(failedPrice.offeredAmount, "100000000");
  assert.ok(failedPrice.request?.includes("/v2/pair-price?"));
  assert.equal(
    failedPrice.input,
    undefined,
    "no minimum or exact ETA request may be invented without a price",
  );
});

test("read-only HTTP scan boundary rejects origin, network, upstream injection and invalid policy before solver calls", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("must not fetch");
  });
  const request = (body: unknown, origin = "http://localhost:3000") =>
    new Request("http://localhost:3000/api/ipd/scan", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await POST(request(scanInput(), "https://foreign.example"))).status,
    403,
  );
  for (const patch of [
    { network: "devnet" },
    { slippageBps: 101 },
    { notional: "1000" },
    { directionIds: ["a", "a"] },
    { customAmounts: { extra: "1" } },
  ])
    assert.equal(
      (await POST(request({ ...scanInput(), ...patch }))).status,
      400,
    );
  const parsed = parseScanInput({
    ...scanInput(),
    upstream: "http://evil.example",
  });
  assert.equal("upstream" in parsed, false);
  assert.equal(calls, 0);
});
