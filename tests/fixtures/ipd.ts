import type { ExactInput } from "../../src/lib/ipd/types";
export const ETH = "0x419f8f4bff72959132aa7cea15a4c1";
export const USDT = "0x5cb79d29507d3ad17bb6dc60279e89";
export const BTC = "0x3084d3c389ececd15fda9770d18c8a";
export const USDC = "0xe69e6ca6e39df1b10c1e5399399feb";
export const catalogFixture = {
  tokens: [
    { faucetId: ETH, ticker: "ETH", decimals: 8, binanceAsset: "ETH" },
    { faucetId: USDT, ticker: "USDT", decimals: 6, binanceAsset: "USDT" },
    { faucetId: BTC, ticker: "WBTC", decimals: 8, binanceAsset: "BTC" },
    { faucetId: USDC, ticker: "USDCX", decimals: 6, binanceAsset: "USDC" },
  ],
  pairs: [
    { name: "ETH-USDT", binanceSymbol: "ETHUSDT", faucetIds: [ETH, USDT] },
    { name: "WBTC-USDT", binanceSymbol: "BTCUSDT", faucetIds: [BTC, USDT] },
    { name: "ETH-USDCX", binanceSymbol: "ETHUSDC", faucetIds: [ETH, USDC] },
  ],
};
export function pairPriceFixture(offered = ETH, requested = USDT) {
  const token = (id: string) =>
    catalogFixture.tokens.find((token) => token.faucetId === id)!;
  return {
    offeredFaucet: offered,
    requestedFaucet: requested,
    marketPrice: "100",
    expectedPrice: "100",
    fillPrice: "99.995",
    feePpm: 50,
    offeredDecimals: token(offered).decimals,
    requestedDecimals: token(requested).decimals,
    asOf: Math.floor(Date.now() / 1000),
  };
}
export function valuationFixture(
  ids = catalogFixture.tokens.map((token) => token.faucetId),
) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        faucet_id: id,
        price: id === ETH ? "100" : id === BTC ? "10000" : "1",
        decimals: catalogFixture.tokens.find((token) => token.faucetId === id)!
          .decimals,
        as_of: Math.floor(Date.now() / 1000),
        stale: false,
        vs_currency: "usdt",
        precision: "full",
      },
    ]),
  );
}
export const exactFixture: ExactInput = {
  network: "mainnet",
  offeredFaucet: ETH,
  requestedFaucet: USDT,
  offeredAmount: "100000000",
  requestedAmount: "99945002",
  slippageBps: 5,
  minFillStep: "0",
};
export type Scenario =
  | "full"
  | "none"
  | "partial"
  | "tolerated"
  | "paused"
  | "no_price"
  | "no_market"
  | "off_market";
export function estimateFixture(
  input: ExactInput = exactFixture,
  scenario: Scenario = "full",
) {
  const absent = scenario === "no_price" || scenario === "no_market";
  const none = absent || scenario === "none" || scenario === "off_market";
  const partial = scenario === "partial";
  const offered = BigInt(input.offeredAmount),
    requested = BigInt(input.requestedAmount);
  const partialPayment = requested / 2n;
  return {
    offeredFaucet: input.offeredFaucet,
    requestedFaucet: input.requestedFaucet,
    offeredAmount: input.offeredAmount,
    requestedAmount: input.requestedAmount,
    priceBand: absent
      ? null
      : scenario === "off_market"
        ? "off_market"
        : scenario === "tolerated"
          ? "tolerated"
          : "at_market",
    fillStatus: none ? "none" : partial ? "partial" : "full",
    reason: absent
      ? scenario
      : scenario === "off_market"
        ? "price"
        : scenario === "none"
          ? "liquidity"
          : null,
    fillableOfferedAmount: none
      ? "0"
      : partial
        ? ((offered * partialPayment) / requested).toString()
        : input.offeredAmount,
    fillableRequestedAmount: none
      ? "0"
      : partial
        ? partialPayment.toString()
        : input.requestedAmount,
    maxOfferedAmount:
      absent || scenario === "off_market"
        ? null
        : none
          ? "0"
          : input.offeredAmount,
    expectedRequestedAmount: absent ? null : (requested + 100n).toString(),
    marketPrice: absent ? null : "100",
    expectedPrice: absent ? null : "100",
    fillPrice: absent ? null : "99.995",
    feePpm: 50,
    feeAmount: absent ? null : "5",
    settlementsRunning: scenario !== "paused",
    estimatedSeconds:
      none || scenario === "paused" || scenario === "tolerated" ? null : 14,
    median24hSeconds: 11,
  };
}
// Stipulated v2 responses from the solver's ceiling-payment/floor-release
// arithmetic, not executed Rust matcher tests or live trades.
export const roundedEstimateFixtures = [
  {
    name: "ETH to USDT partial",
    offeredFaucet: ETH,
    requestedFaucet: USDT,
    offeredAmount: "100000000",
    requestedAmount: "3998000000",
    price: "4000",
    fillStatus: "partial" as const,
    fillableOfferedAmount: "50000000",
    fillableRequestedAmount: "1999000002",
    maxOfferedAmount: "50000000",
    expectedRequestedAmount: "4000000000",
  },
  {
    name: "USDT to ETH partial",
    offeredFaucet: USDT,
    requestedFaucet: ETH,
    offeredAmount: "1000000",
    requestedAmount: "24987",
    price: "0.00025",
    fillStatus: "partial" as const,
    fillableOfferedAmount: "500020",
    fillableRequestedAmount: "12494",
    maxOfferedAmount: "500000",
    expectedRequestedAmount: "25000",
  },
  {
    name: "USDT to ETH rounded full",
    offeredFaucet: USDT,
    requestedFaucet: ETH,
    offeredAmount: "1000000",
    requestedAmount: "24987",
    price: "0.00025",
    fillStatus: "full" as const,
    fillableOfferedAmount: "1000000",
    fillableRequestedAmount: "24987",
    maxOfferedAmount: "999960",
    expectedRequestedAmount: "25000",
  },
].map((fixture) => {
  const input: ExactInput = {
    ...exactFixture,
    offeredFaucet: fixture.offeredFaucet,
    requestedFaucet: fixture.requestedFaucet,
    offeredAmount: fixture.offeredAmount,
    requestedAmount: fixture.requestedAmount,
  };
  return {
    name: fixture.name,
    input,
    estimate: {
      ...estimateFixture(input, fixture.fillStatus),
      fillableOfferedAmount: fixture.fillableOfferedAmount,
      fillableRequestedAmount: fixture.fillableRequestedAmount,
      maxOfferedAmount: fixture.maxOfferedAmount,
      expectedRequestedAmount: fixture.expectedRequestedAmount,
      marketPrice: fixture.price,
      expectedPrice: fixture.price,
      fillPrice: fixture.price,
      feePpm: 0,
      feeAmount: "0",
      median24hSeconds: null,
    },
  };
});
export function inputFromUrl(url: URL): ExactInput {
  return {
    network: "mainnet",
    offeredFaucet: url.searchParams.get("offered_faucet")!,
    requestedFaucet: url.searchParams.get("requested_faucet")!,
    offeredAmount: url.searchParams.get("offered_amount")!,
    requestedAmount: url.searchParams.get("requested_amount")!,
    minFillStep: "0",
    slippageBps: 5,
  };
}
