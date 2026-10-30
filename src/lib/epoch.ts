import { keccak256, toBytes, zeroAddress, zeroHash, isAddress } from "viem";
import { parseQuoteFromPath } from "@epoch-protocol/epoch-commons-sdk/dist/utils/path.js";
import { endpoints } from "./catalog";
import { fromAtomic, toAtomic } from "./amount";
import type { Environment, Quote, Route } from "./types";

const baseType =
  "address tokenIn,uint256 tokenInAmount,address tokenOut,uint256 minTokenOut,uint256 destinationChainId,bytes4 taskType,bytes32 protocolHashIdentifier,address recipient";
const sponsor =
  process.env.EPOCH_QUOTE_SPONSOR ||
  "0x0000000000000000000000000000000000000001";
const timeoutMs = 20_000;

type Health = {
  status: string;
  allocatorAddresses: Record<string, string>;
  arbiterAddresses: Record<string, string>;
  compactLockResetPeriod: number;
  compactLockScope: number;
  compactExpirySeconds: number;
  compactExpiryBufferSeconds: number;
  midenVirtualChainId: number;
};
type Context = { health: Health; account: string };
class UpstreamError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
const contexts = new Map<
  Environment,
  { expires: number; promise: Promise<Context> }
>();
const nextRequest = new Map<Environment, number>();
const cooldown = new Map<Environment, number>();
const nonces = new Map<string, { expires: number; promise: Promise<string> }>();

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
function checkCooldown(environment: Environment) {
  const remaining = Math.ceil(
    ((cooldown.get(environment) ?? 0) - Date.now()) / 1000,
  );
  if (remaining > 0)
    throw new UpstreamError(
      "Epoch is rate limiting requests.",
      429,
      "RATE_LIMITED",
      remaining,
    );
}

async function request(
  environment: Environment,
  path: string,
  signal: AbortSignal,
  body?: unknown,
  onResponse?: (data: unknown) => void,
) {
  checkCooldown(environment);
  // Shared by all tabs in this server process. One upstream request per second
  // per environment prevents a full catalog scan from flooding the allocator.
  const slot = Math.max(Date.now(), nextRequest.get(environment) ?? 0);
  nextRequest.set(environment, slot + 1000);
  await wait(Math.max(0, slot - Date.now()), signal);
  checkCooldown(environment);
  const response = await fetch(
    `${endpoints[environment].replace(/\/$/, "")}${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "x-integrator-id": "epoch-quoter",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
      cache: "no-store",
    },
  );
  if (response.status === 429) {
    const header = response.headers.get("Retry-After");
    const seconds =
      header && /^\d+$/.test(header)
        ? Number(header)
        : header
          ? Math.ceil((Date.parse(header) - Date.now()) / 1000)
          : 60;
    const retryAfter = Number.isFinite(seconds)
      ? Math.max(1, Math.min(300, seconds))
      : 60;
    cooldown.set(environment, Date.now() + retryAfter * 1000);
    if (onResponse) onResponse(await response.json().catch(() => undefined));
    else await response.body?.cancel();
    throw new UpstreamError(
      "Epoch is rate limiting requests.",
      429,
      "RATE_LIMITED",
      retryAfter,
    );
  }
  const data = await response.json().catch(() => {
    throw new UpstreamError(
      "Epoch returned an unreadable response.",
      response.status,
    );
  });
  onResponse?.(data);
  if (!response.ok || data.success === false || data.error) {
    throw new UpstreamError(
      typeof data.error === "string"
        ? data.error
        : `Epoch returned HTTP ${response.status}.`,
      response.status,
      typeof data.code === "string" ? data.code : undefined,
    );
  }
  return data;
}

async function getNonce(
  environment: Environment,
  chain: number,
): Promise<string> {
  const key = `${environment}:${chain}`;
  const cached = nonces.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  // Reusing a suggested nonce is safe here: quotes never register or submit it.
  const promise = request(
    environment,
    `/suggested-nonce/${chain}/${sponsor}`,
    AbortSignal.timeout(timeoutMs),
  ).then((data) => BigInt(data.nonce).toString());
  nonces.set(key, { expires: Date.now() + 60_000, promise });
  promise.catch(() => {
    if (nonces.get(key)?.promise === promise) nonces.delete(key);
  });
  return promise;
}

async function getContext(environment: Environment): Promise<Context> {
  const cached = contexts.get(environment);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    const signal = AbortSignal.timeout(timeoutMs);
    const [health, recipient] = await Promise.all([
      request(environment, "/health", signal),
      request(environment, "/miden-recipient", signal),
    ]);
    const account =
      process.env.EPOCH_MAINNET_ACCOUNT ||
      recipient.midenP2IDRecipientAccountId;
    if (health.status !== "healthy")
      throw new UpstreamError("Epoch is unhealthy.", 503);
    if (typeof account !== "string" || !/^0x[\da-f]{28,30}$/i.test(account))
      throw new UpstreamError("Epoch returned an invalid Miden account.");
    for (const [key, min, max] of [
      ["compactLockResetPeriod", 0, 7],
      ["compactLockScope", 0, 1],
      ["compactExpirySeconds", 1, 86400 * 30],
      ["compactExpiryBufferSeconds", 0, 86400],
      ["midenVirtualChainId", 1, Number.MAX_SAFE_INTEGER],
    ] as const) {
      if (
        !Number.isSafeInteger(health[key]) ||
        health[key] < min ||
        health[key] > max
      )
        throw new UpstreamError(`Epoch configuration is missing ${key}.`);
    }
    if (!isAddress(sponsor))
      throw new UpstreamError("EPOCH_QUOTE_SPONSOR must be an EVM address.");
    return { health, account };
  })();
  contexts.set(environment, { expires: Date.now() + 60_000, promise });
  promise.catch(() => {
    if (contexts.get(environment)?.promise === promise)
      contexts.delete(environment);
  });
  return promise;
}

/** Read-only Compact quote payload, matching Epoch intents SDK 2.2.0. */
export async function queryQuote(
  route: Route,
  amount: string,
  callerSignal?: AbortSignal,
): Promise<Quote> {
  const started = Date.now();
  const base = { routeId: route.id, requestedAmount: amount };
  let rawResponse: unknown;
  const timing = () => ({
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  });
  try {
    const atomic = toAtomic(amount, route.source.decimals);
    if (route.source.chain === "Miden" && BigInt(atomic) >= 2n ** 63n)
      throw new Error("Amount exceeds the Miden asset limit.");
    const { health, account } = await getContext(route.environment);
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeoutMs),
      ...(callerSignal ? [callerSignal] : []),
    ]);
    const sourceChain =
      route.direction === "from-miden"
        ? health.midenVirtualChainId
        : route.source.chainId;
    const destChain =
      route.direction === "to-miden"
        ? health.midenVirtualChainId
        : route.destination.chainId;
    const allocator = health.allocatorAddresses?.[sourceChain];
    const arbiter = health.arbiterAddresses?.[sourceChain];
    if (!allocator || !arbiter || !isAddress(allocator) || !isAddress(arbiter))
      throw new UpstreamError(
        "This chain is not configured on the allocator.",
        503,
        "CHAIN_NOT_CONFIGURED",
      );
    const nonce = await getNonce(route.environment, sourceChain);
    // Compact's 96-bit lock tag: scope (1), reset period (3), allocator ID (92).
    const leadingZeros = allocator.slice(2).match(/^0*/)?.[0].length ?? 0;
    const flag = BigInt(Math.min(15, Math.max(0, leadingZeros - 3)));
    const allocatorId =
      (flag << 88n) | (BigInt(allocator) & ((1n << 88n) - 1n));
    const lockTag =
      (BigInt(health.compactLockScope) << 95n) |
      (BigInt(health.compactLockResetPeriod) << 92n) |
      allocatorId;
    const tokenIn =
      route.direction === "from-miden" ? zeroAddress : route.source.address;
    const tokenOut =
      route.direction === "to-miden" ? zeroAddress : route.destination.address;
    const extra =
      route.direction === "from-miden"
        ? {
            midenSourceAccount: account,
            midenFaucetId: route.source.address,
            midenNoteType: "P2IDE",
            midenNoteId: "",
          }
        : {
            midenRecipientAccount: account,
            midenFaucetId: route.destination.address,
          };
    const mandate = {
      tokenIn,
      tokenInAmount: atomic,
      tokenOut,
      minTokenOut: "0",
      destinationChainId: String(destChain),
      taskType: keccak256(toBytes("gettokenout")).slice(0, 10),
      protocolHashIdentifier: zeroHash,
      recipient: sponsor,
      ...extra,
    };
    const raw = await request(
      route.environment,
      "/checkIfDepositNeeded",
      signal,
      {
        chainId: String(sourceChain),
        compact: {
          arbiter,
          sponsor,
          nonce,
          expires: String(
            Math.floor(Date.now() / 1000) +
              health.compactExpirySeconds +
              health.compactExpiryBufferSeconds,
          ),
          id: ((lockTag << 160n) | BigInt(tokenIn)).toString(),
          lockTag: `0x${lockTag.toString(16).padStart(24, "0")}`,
          token: tokenIn,
          amount: atomic,
          mandate,
        },
        witnessTypeString: `${baseType},${route.direction === "from-miden" ? "string midenSourceAccount,string midenFaucetId,string midenNoteType,string midenNoteId" : "string midenRecipientAccount,string midenFaucetId"}`,
        sponsorSignature: "0x",
        isRegisteredOnchain: false,
        routingAndLiquidityOptions: { preset: "any" },
      },
      (data) => {
        rawResponse = data;
      },
    );
    const pathQuote =
      Array.isArray(raw.path) && raw.path[0]
        ? parseQuoteFromPath(raw.path[0])
        : null;
    const out = raw.tokenOut ?? pathQuote?.tokenOut;
    const input = raw.tokenIn ?? pathQuote?.tokenIn;
    if (out == null || out === "0")
      return {
        ...base,
        ...timing(),
        status: "unavailable",
        rawResponse,
        message: "No quote returned for this amount.",
      };
    if (
      typeof out !== "string" ||
      !/^\d+$/.test(out) ||
      typeof input !== "string" ||
      !/^\d+$/.test(input)
    )
      throw new UpstreamError("Epoch returned invalid quote amounts.");
    if (BigInt(out) === 0n)
      return {
        ...base,
        ...timing(),
        status: "unavailable",
        rawResponse,
        message: "No quote returned for this amount.",
      };
    if (BigInt(input) === 0n)
      throw new UpstreamError("Epoch returned a zero input amount.");
    return {
      ...base,
      ...timing(),
      status: "available",
      rawResponse,
      amountIn: fromAtomic(input, route.source.decimals),
      amountOut: fromAtomic(out, route.destination.decimals),
      paths: raw.path,
      pathCount: Array.isArray(raw.path) ? raw.path.length : undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Quote request failed.";
    const code = error instanceof UpstreamError ? error.code : undefined;
    const noQuote =
      /NO_QUOTE|NO_ROUTE|INSUFFICIENT_LIQUIDITY|NO_VALID_TREASURY|ROUTE_NOT_FOUND/.test(
        code ?? "",
      ) ||
      /no (quote|route|path|liquidity)|insufficient liquidity|no valid treasury/i.test(
        message,
      );
    const timedOut =
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name);
    return {
      ...base,
      ...timing(),
      status: noQuote ? "unavailable" : "error",
      rawResponse,
      code,
      retryAfter: error instanceof UpstreamError ? error.retryAfter : undefined,
      message: timedOut
        ? "Request timed out. Try refreshing."
        : message.slice(0, 500),
    };
  }
}
