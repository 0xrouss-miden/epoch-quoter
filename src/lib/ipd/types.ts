export type Token = {
  faucetId: string;
  ticker: string;
  decimals: number | null;
  binanceAsset: string | null;
  issue?: string;
};
export type Direction = {
  id: string;
  name: string;
  binanceSymbol: string;
  offered: Token;
  requested: Token;
};
export type Catalog = {
  network: "mainnet";
  directions: Direction[];
  warnings: string[];
  rawResponse: Record<string, unknown>;
};
export type PairPrice = Record<string, unknown> & {
  offeredFaucet: string;
  requestedFaucet: string;
  marketPrice: string;
  expectedPrice: string;
  fillPrice: string;
  feePpm: number;
  offeredDecimals: number;
  requestedDecimals: number;
  asOf: number;
};
export type Valuation = Record<string, unknown> & {
  faucet_id: string;
  price: string;
  vs_currency: "usdt";
  decimals: number;
  as_of: number;
  stale: false;
};
export type Estimate = Record<string, unknown> & {
  offeredFaucet: string;
  requestedFaucet: string;
  offeredAmount: string;
  requestedAmount: string;
  priceBand: "at_market" | "tolerated" | "off_market" | null;
  fillStatus: "full" | "partial" | "none";
  reason: "price" | "liquidity" | "no_market" | "no_price" | null;
  fillableOfferedAmount: string;
  fillableRequestedAmount: string;
  maxOfferedAmount: string | null;
  expectedRequestedAmount: string | null;
  marketPrice: string | null;
  expectedPrice: string | null;
  fillPrice: string | null;
  feePpm: number;
  feeAmount: string | null;
  settlementsRunning: boolean;
  estimatedSeconds: number | null;
  median24hSeconds: number | null;
};
export type Status =
  | "full"
  | "partial"
  | "waiting"
  | "delayed"
  | "no-liquidity"
  | "limit"
  | "unsupported"
  | "price-unavailable"
  | "invalid"
  | "error"
  | "starting"
  | "busy"
  | "stale";
export type ScanInput = {
  network: "mainnet";
  directionIds: string[];
  notional: "1" | "10" | "100";
  customAmounts: Record<string, string>;
  slippageBps: number;
};
export type ExactInput = {
  network: "mainnet";
  offeredFaucet: string;
  requestedFaucet: string;
  offeredAmount: string;
  requestedAmount: string;
  slippageBps: number;
  minFillStep: "0";
};
export type Check = {
  directionId: string;
  status: Status;
  validity: "valid" | "invalid" | "unknown";
  message: string;
  checkedAt: number;
  policy: {
    notional: string;
    customAmount?: string;
    slippageBps: number;
    minFillStep: "0";
  };
  identity?: string;
  offeredAmount?: string;
  input?: ExactInput;
  pairPrice?: PairPrice;
  valuation?: Valuation;
  estimate?: Estimate;
  request?: string;
  rawResponse?: unknown;
  httpStatus?: number;
  errorCode?: string;
  retryAt?: number;
};
export type Settings = {
  upstream: string;
  expiresAfterMs: number;
  priceMaxAgeMs: number;
};
export type ScanEvent =
  | { type: "start"; catalog: Catalog }
  | { type: "result"; check: Check }
  | { type: "done" }
  | { type: "error"; status: Status; message: string; retryAt?: number };
