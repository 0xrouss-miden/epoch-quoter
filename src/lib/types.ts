export type Environment = "mainnet";
export type Direction = "to-miden" | "from-miden";
export type Asset = {
  symbol: string;
  address: string;
  decimals: number;
  chain: string;
  chainId: number;
};
export type Route = {
  id: string;
  environment: Environment;
  direction: Direction;
  source: Asset;
  destination: Asset;
};
export type QuoteStatus = "available" | "unavailable" | "error";
export type Quote = {
  routeId: string;
  status: QuoteStatus;
  requestedAmount: string;
  amountIn?: string;
  amountOut?: string;
  checkedAt: string;
  durationMs: number;
  message?: string;
  code?: string;
  retryAfter?: number;
  paths?: unknown;
  pathCount?: number;
  /** Complete JSON body from Epoch's quote endpoint, before normalization. */
  rawResponse?: unknown;
};
export type Catalog = {
  routes: Route[];
  amounts: Record<string, string>;
  endpoints: Record<Environment, string>;
  version: string;
};
