import { atomic, decimalRatio, decimals } from "./amounts";
import type {
  Catalog,
  Direction,
  Estimate,
  ExactInput,
  PairPrice,
  Status,
  Token,
  Valuation,
} from "./types";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as Record<string, unknown>;
}
export function faucet(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{30}$/i.test(value))
    throw new Error("Invalid hex faucet identity.");
  return value.toLowerCase();
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200)
    throw new Error("Invalid text field.");
  return value;
}
function member<T>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T))
    throw new Error("Unknown or missing enum field.");
  return value as T;
}
function unsigned(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new Error("Invalid numeric field.");
  return value;
}
function price(value: unknown): string {
  decimalRatio(value);
  return value as string;
}
function nullable<T>(value: unknown, parse: (v: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
export class SourcePriceError extends Error {}
export function assertFresh(
  seconds: number,
  maxAgeMs: number,
  now = Date.now(),
) {
  unsigned(seconds);
  if (seconds * 1000 > now + 5000 || now - seconds * 1000 >= maxAgeMs)
    throw new SourcePriceError(
      "Source price is stale or its timestamp is in the future.",
    );
}

/** Trust identities from the existing mainnet registry; never match tickers. */
export function parseCatalog(
  raw: unknown,
  mainnet: ReadonlyMap<string, number>,
): Catalog {
  const data = object(raw);
  if (!Array.isArray(data.tokens) || !Array.isArray(data.pairs))
    throw new Error("Catalog tokens/pairs are missing.");
  const warnings: string[] = [];
  const tokens = new Map<string, Token>();
  for (const entry of data.tokens) {
    try {
      const value = object(entry);
      const id = faucet(value.faucetId);
      if (tokens.has(id)) {
        tokens.get(id)!.issue =
          "Duplicate faucet metadata; verify the catalog before checking.";
        throw new Error(`Duplicate faucet ${id}.`);
      }
      const scale = decimals(value.decimals) ? value.decimals : null;
      const issue = !mainnet.has(id)
        ? "Faucet is not in the verified mainnet registry; verify identity before checking."
        : scale === null
          ? "Catalog decimals are unavailable or invalid."
          : mainnet.get(id) !== scale
            ? "Catalog decimals disagree with the verified mainnet registry."
            : undefined;
      tokens.set(id, {
        faucetId: id,
        ticker:
          typeof value.ticker === "string" && value.ticker.length <= 40
            ? value.ticker
            : "Unknown token",
        decimals: scale,
        binanceAsset:
          typeof value.binanceAsset === "string" ? value.binanceAsset : null,
        issue,
      });
    } catch (error) {
      // Unidentifiable metadata must not erase unrelated usable pairs.
      warnings.push(
        error instanceof Error ? error.message : "Malformed catalog token.",
      );
    }
  }
  const directions: Direction[] = [];
  const seen = new Set<string>();
  for (const entry of data.pairs) {
    try {
      const pair = object(entry);
      if (!Array.isArray(pair.faucetIds) || pair.faucetIds.length !== 2)
        throw new Error("Malformed pair identities.");
      const ids = pair.faucetIds.map(faucet);
      if (ids[0] === ids[1]) throw new Error("Catalog contains a self pair.");
      const key = [...ids].sort().join(":");
      if (seen.has(key)) throw new Error("Duplicate catalog pair.");
      seen.add(key);
      const name = text(pair.name);
      const binanceSymbol = text(pair.binanceSymbol);
      const getToken = (id: string): Token =>
        tokens.get(id) ?? {
          faucetId: id,
          ticker: "Unknown token",
          decimals: null,
          binanceAsset: null,
          issue: "Missing catalog token metadata.",
        };
      for (const [offered, requested] of [
        [getToken(ids[0]), getToken(ids[1])],
        [getToken(ids[1]), getToken(ids[0])],
      ])
        directions.push({
          id: `${offered.faucetId}:${requested.faucetId}`,
          name,
          binanceSymbol,
          offered,
          requested,
        });
    } catch (error) {
      warnings.push(
        error instanceof Error ? error.message : "Malformed catalog pair.",
      );
    }
  }
  return { network: "mainnet", directions, warnings, rawResponse: data };
}

export function parsePairPrice(
  raw: unknown,
  direction: Direction,
  maxAgeMs: number,
): PairPrice {
  const data = object(raw);
  if (
    faucet(data.offeredFaucet) !== direction.offered.faucetId ||
    faucet(data.requestedFaucet) !== direction.requested.faucetId
  )
    throw new Error("Pair-price echoed different faucet identities.");
  if (
    !decimals(data.offeredDecimals) ||
    !decimals(data.requestedDecimals) ||
    data.offeredDecimals !== direction.offered.decimals ||
    data.requestedDecimals !== direction.requested.decimals
  )
    throw new Error("Pair-price decimals disagree with the catalog.");
  price(data.marketPrice);
  price(data.expectedPrice);
  price(data.fillPrice);
  unsigned(data.feePpm, 1_000_000);
  unsigned(data.asOf);
  assertFresh(data.asOf as number, maxAgeMs);
  assertFeePrice(data.expectedPrice as string, data.fillPrice as string);
  return data as PairPrice;
}
function assertFeePrice(expected: string, fill: string) {
  const [e, ed] = decimalRatio(expected),
    [f, fd] = decimalRatio(fill);
  if (f * ed > e * fd)
    throw new Error("Fee-adjusted price exceeds the expected price.");
}

export function parseValuation(
  raw: unknown,
  token: Token,
  maxAgeMs: number,
): Valuation {
  const data = object(raw);
  if (
    faucet(data.faucet_id) !== token.faucetId ||
    data.vs_currency !== "usdt" ||
    data.stale !== false ||
    !decimals(data.decimals) ||
    data.decimals !== token.decimals
  )
    throw new Error(
      "Valuation is stale, missing or inconsistent with the catalog.",
    );
  price(data.price);
  assertFresh(unsigned(data.as_of), maxAgeMs);
  return data as Valuation;
}

export function parseEstimate(raw: unknown, input: ExactInput): Estimate {
  const data = object(raw);
  if (
    faucet(data.offeredFaucet) !== input.offeredFaucet ||
    faucet(data.requestedFaucet) !== input.requestedFaucet ||
    atomic(data.offeredAmount) !== input.offeredAmount ||
    atomic(data.requestedAmount) !== input.requestedAmount
  )
    throw new Error("Estimate does not match the exact request.");
  const band = member(data.priceBand, [
    "at_market",
    "tolerated",
    "off_market",
    null,
  ] as const);
  const fill = member(data.fillStatus, ["full", "partial", "none"] as const);
  const reason = member(data.reason, [
    "price",
    "liquidity",
    "no_market",
    "no_price",
    null,
  ] as const);
  const fo = BigInt(atomic(data.fillableOfferedAmount, true));
  const fr = BigInt(atomic(data.fillableRequestedAmount, true));
  const capacity = nullable(data.maxOfferedAmount, (v) => atomic(v, true));
  const expected = nullable(data.expectedRequestedAmount, (v) =>
    atomic(v, true),
  );
  const fee = nullable(data.feeAmount, (v) => atomic(v, true));
  unsigned(data.feePpm, 1_000_000);
  for (const key of ["marketPrice", "expectedPrice", "fillPrice"])
    nullable(data[key], price);
  if (typeof data.settlementsRunning !== "boolean")
    throw new Error("Missing executor readiness.");
  nullable(data.estimatedSeconds, unsigned);
  nullable(data.median24hSeconds, unsigned);
  const offered = BigInt(input.offeredAmount),
    requested = BigInt(input.requestedAmount);
  if (fo > offered || fr > requested)
    throw new Error("Fillable amounts exceed the order.");
  const noPrice = reason === "no_price" || reason === "no_market";
  if (noPrice) {
    if (
      fill !== "none" ||
      band !== null ||
      capacity !== null ||
      expected !== null ||
      fee !== null ||
      [data.marketPrice, data.expectedPrice, data.fillPrice].some(
        (v) => v !== null,
      )
    )
      throw new Error("Contradictory no-price estimate.");
  } else {
    if (
      band === null ||
      [
        data.marketPrice,
        data.expectedPrice,
        data.fillPrice,
        expected,
        fee,
      ].some((v) => v === null)
    )
      throw new Error("Estimate is missing coherent price fields.");
    assertFeePrice(data.expectedPrice as string, data.fillPrice as string);
    if (expected !== null && BigInt(expected) < requested)
      throw new Error("Expected full receive is below the order minimum.");
  }
  if (fill === "none") {
    if (reason === null || fo !== 0n || fr !== 0n)
      throw new Error("Contradictory empty fill.");
    if ((band === "off_market") !== (reason === "price"))
      throw new Error("Contradictory price rejection.");
  } else {
    if (
      reason !== null ||
      (band !== "at_market" && band !== "tolerated") ||
      capacity === null ||
      fo === 0n ||
      fr === 0n ||
      BigInt(capacity) < fo
    )
      throw new Error("Contradictory positive fill.");
    if (fill === "full" && (fo !== offered || fr !== requested))
      throw new Error("Full fill does not cover the order.");
    if (fill === "partial" && (fo >= offered || fr >= requested))
      throw new Error("Partial fill must leave an unfilled portion.");
    // The note ratio can round by one requested base unit.
    const difference = fo * requested - fr * offered;
    if (difference > offered || difference < -offered)
      throw new Error("Partial amounts disagree with the order ratio.");
  }
  if (
    data.estimatedSeconds !== null &&
    (!data.settlementsRunning || band !== "at_market" || fill === "none")
  )
    throw new Error("ETA contradicts execution readiness.");
  return data as Estimate;
}

export const statusLabels: Record<Status, string> = {
  full: "Estimated full fill",
  partial: "Estimated partial fill",
  waiting: "Waiting for price move",
  delayed: "Settlement delayed",
  "no-liquidity": "No executable liquidity",
  limit: "Limit no longer matches",
  unsupported: "Unsupported pair",
  "price-unavailable": "Price unavailable",
  invalid: "Invalid check",
  error: "Check failed",
  starting: "Solver starting",
  busy: "Solver busy · deferred",
  stale: "Stale observation",
};
export function classify(estimate: Estimate): Status {
  if (estimate.reason === "no_market") return "unsupported";
  if (estimate.reason === "no_price") return "price-unavailable";
  if (!estimate.settlementsRunning) return "delayed";
  if (estimate.priceBand === "off_market" || estimate.reason === "price")
    return "limit";
  if (estimate.fillStatus === "none" && estimate.reason === "liquidity")
    return "no-liquidity";
  if (estimate.priceBand === "tolerated" && estimate.fillStatus !== "none")
    return "waiting";
  if (estimate.priceBand === "at_market" && estimate.fillStatus === "partial")
    return "partial";
  if (estimate.priceBand === "at_market" && estimate.fillStatus === "full")
    return "full";
  return "error";
}

/** Error bodies have their own schema; they never need success fields. */
export function parseError(
  raw: unknown,
): { error: string; message: string } | null {
  try {
    const data = object(raw);
    if (
      typeof data.error !== "string" ||
      !/^[a-z_]+$/.test(data.error) ||
      typeof data.message !== "string" ||
      data.message.length > 4000
    )
      return null;
    return { error: data.error, message: data.message };
  } catch {
    return null;
  }
}
