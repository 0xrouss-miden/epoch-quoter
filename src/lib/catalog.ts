import mainnet from "@epoch-protocol/epoch-commons-sdk/dist/data/epochgraphmainnet.json";
import { normalizeMidenId } from "@epoch-protocol/epoch-commons-sdk/dist/utils/miden-id.js";
import { zeroAddress } from "viem";
import midenTokens from "@/data/miden-mainnet-tokens.json";
import type { Asset, Catalog, Route } from "./types";

export const endpoints = {
  mainnet:
    process.env.EPOCH_MAINNET_URL || "https://mainnet-api.epochprotocol.xyz",
};

// The requested bridge matrix is deliberate: no Optimism or cross-asset pairs.
// Do not expand it automatically when Epoch adds tokens or chains.
const pairs = [
  ["Arbitrum", "ETH"],
  ["Arbitrum", "USDC"],
  ["Base", "ETH"],
  ["Base", "USDC"],
  ["Polygon", "POL"],
  ["Polygon", "USDC"],
  ["Ethereum", "ETH"],
  ["Ethereum", "USDC"],
  ["Robinhood", "ETH"],
  ["Robinhood", "USDG"],
] as const;

type Token = (typeof pairs)[number][1];
function midenAsset(symbol: Token): Asset {
  const token = midenTokens.tokens.find(
    (token) => token.symbol === (symbol === "USDC" ? "USDCX" : symbol),
  );
  if (!token) throw new Error(`Missing verified Miden token: ${symbol}`);
  return {
    symbol: symbol === "USDC" ? "USDCx" : symbol,
    address: normalizeMidenId(token.faucetId),
    decimals: token.decimals,
    chain: "Miden",
    chainId: mainnet.chains.Miden.chainId,
  };
}

const routes: Route[] = pairs.flatMap(([chain, symbol]) => {
  const native = symbol === "ETH" || symbol === "POL";
  // Epoch intents SDK 2.2.0 get-task-data uses the zero address for native
  // assets. ETH/POL here are native currency, never relabeled WETH/WPOL.
  const erc20 = native ? undefined : mainnet.tokens[symbol];
  const address = native
    ? zeroAddress
    : (erc20?.contractAddress as Record<string, string>)[chain];
  if (!address) throw new Error(`Missing Epoch token: ${chain} ${symbol}`);
  const evm: Asset = {
    symbol,
    address,
    decimals: native ? 18 : erc20!.decimals,
    chain,
    chainId: mainnet.chains[chain].chainId,
  };
  const miden = midenAsset(symbol);
  return (["to-miden", "from-miden"] as const).map((direction) => ({
    id: `mainnet:${direction}:${evm.chainId}:${evm.address.toLowerCase()}:${miden.address.toLowerCase()}`,
    environment: "mainnet",
    direction,
    source: direction === "to-miden" ? evm : miden,
    destination: direction === "to-miden" ? miden : evm,
  }));
});

const routeMap = new Map(routes.map((route) => [route.id, route]));
export function getRoute(id: string) {
  return routeMap.get(id);
}
export function getCatalog(): Catalog {
  const symbols = [
    ...new Set(routes.map((route) => route.source.symbol)),
  ].sort();
  return {
    routes,
    amounts: Object.fromEntries(
      symbols.map((symbol) => [symbol, symbol === "ETH" ? "0.01" : "100"]),
    ),
    endpoints,
    version: "2.1.1",
  };
}
