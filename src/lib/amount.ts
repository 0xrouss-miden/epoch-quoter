/** Reject excess precision instead of silently rounding a quote's input. */
export function toAtomic(value: string, decimals: number): string {
  if (value.length > 80 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new Error("Enter a positive decimal amount.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places.`);
  const atomic = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (atomic <= 0n) throw new Error("Enter an amount greater than zero.");
  if (atomic >= 2n ** 256n) throw new Error("Amount is too large.");
  return atomic.toString();
}

export function fromAtomic(value: string, decimals: number): string {
  if (!/^\d+$/.test(value))
    throw new Error("Epoch returned an invalid token amount.");
  const padded = value.padStart(decimals + 1, "0");
  if (decimals === 0) return BigInt(value).toString();
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${BigInt(padded.slice(0, -decimals))}${fraction ? `.${fraction}` : ""}`;
}

export function displayAmount(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!fraction) return grouped;
  const precision =
    whole === "0" ? Math.min(18, fraction.search(/[1-9]/) + 5) : 6;
  const truncated = fraction.slice(0, precision).replace(/0+$/, "");
  return `${grouped}${truncated ? `.${truncated}` : ""}`;
}
