export const U64_MAX = (1n << 64n) - 1n;

export function decimals(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}

/** Prices stay rational; no binary floating-point amount/price calculations. */
export function decimalRatio(value: unknown): [bigint, bigint] {
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)
  )
    throw new Error("Expected an exact positive decimal string.");
  const [whole, fraction = ""] = value.split(".");
  const numerator = BigInt(whole + fraction);
  if (numerator <= 0n) throw new Error("Price must be positive.");
  return [numerator, 10n ** BigInt(fraction.length)];
}

export function atomic(value: unknown, allowZero = false): string {
  if (
    typeof value !== "string" ||
    value.length > 20 ||
    !/^(0|[1-9]\d*)$/.test(value)
  )
    throw new Error("Expected an integer amount string.");
  const amount = BigInt(value);
  if ((!allowZero && amount === 0n) || amount > U64_MAX)
    throw new Error("Amount must be positive and fit in u64 base units.");
  return value;
}

export function parseAmount(value: string, scale: number): string {
  if (!decimals(scale)) throw new Error("Token decimals are unavailable.");
  if (value.length > 280 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error("Enter a positive decimal token amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale)
    throw new Error(
      `Use at most ${scale} decimal places; amounts are not rounded.`,
    );
  return atomic(BigInt(whole + fraction.padEnd(scale, "0")).toString());
}

export function formatAmount(value: string, scale: number): string {
  atomic(value, true);
  if (!decimals(scale)) throw new Error("Token decimals are unavailable.");
  if (scale === 0) return value;
  const padded = value.padStart(scale + 1, "0");
  const tail = padded.slice(-scale).replace(/0+$/, "");
  return `${padded.slice(0, -scale)}${tail ? `.${tail}` : ""}`;
}

export function validateSlippage(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  )
    throw new Error("Slippage must be a whole number from 1 to 100 bps.");
}

export function notionalAmount(
  notional: string,
  price: string,
  scale: number,
): string {
  if (!decimals(scale)) throw new Error("Token decimals are unavailable.");
  const [n, nd] = decimalRatio(notional);
  const [p, pd] = decimalRatio(price);
  return atomic(((n * pd * 10n ** BigInt(scale)) / (nd * p)).toString());
}

export function minimumReceive(
  amount: string,
  offeredDecimals: number,
  requestedDecimals: number,
  fillPrice: string,
  slippageBps: number,
): string {
  atomic(amount);
  validateSlippage(slippageBps);
  if (!decimals(offeredDecimals) || !decimals(requestedDecimals))
    throw new Error("Token decimals are unavailable.");
  const [price, scale] = decimalRatio(fillPrice);
  const result =
    (BigInt(amount) *
      price *
      BigInt(10000 - slippageBps) *
      10n ** BigInt(requestedDecimals)) /
    (scale * 10000n * 10n ** BigInt(offeredDecimals));
  if (result === 0n)
    throw new Error(
      "Minimum receive rounds to zero; increase the offered amount.",
    );
  return atomic(result.toString());
}
