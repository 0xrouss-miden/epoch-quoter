import { normalizeMidenId } from "@epoch-protocol/epoch-commons-sdk/dist/utils/miden-id.js";
import registry from "@/data/miden-mainnet-tokens.json";

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback * 1000;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 3600)
    throw new Error(`${name} must be an integer from 1 to 3600 seconds.`);
  return Number(value) * 1000;
}

export function getSettings() {
  if (process.env.IPD_NETWORK && process.env.IPD_NETWORK !== "mainnet")
    throw new Error(
      "This IPD panel supports the verified mainnet network only.",
    );
  const url = new URL(
    process.env.IPD_MAINNET_URL || "https://api.forkchoice.xyz",
  );
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "IPD_MAINNET_URL must be an HTTPS origin (HTTP is allowed only on loopback for local fixtures).",
    );
  return {
    upstream: url.origin,
    expiresAfterMs: seconds("IPD_OBSERVATION_TTL_SECONDS", 120),
    priceMaxAgeMs: seconds("IPD_PRICE_MAX_AGE_SECONDS", 30),
  };
}

export const mainnetIdentities = new Map(
  registry.tokens.map((token) => [
    normalizeMidenId(token.faucetId).toLowerCase(),
    token.decimals,
  ]),
);
