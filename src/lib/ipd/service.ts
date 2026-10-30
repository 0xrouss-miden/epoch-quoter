import {
  atomic,
  minimumReceive,
  notionalAmount,
  parseAmount,
  validateSlippage,
} from "./amounts";
import {
  assertFresh,
  classify,
  object,
  parseCatalog,
  parseEstimate,
  parsePairPrice,
  parseValuation,
  statusLabels,
} from "./contract";
import { budget, IpdError, SolverClient, type Budget } from "./client";
import { getSettings, mainnetIdentities } from "./config";
import type {
  Catalog,
  Check,
  Direction,
  ExactInput,
  ScanEvent,
  ScanInput,
  Settings,
  Valuation,
} from "./types";

export function parseScanInput(raw: unknown): ScanInput {
  const value = object(raw);
  if (value.network !== "mainnet")
    throw new Error("Wrong network; mainnet is required.");
  if (
    !Array.isArray(value.directionIds) ||
    value.directionIds.length > 200 ||
    value.directionIds.some(
      (id) => typeof id !== "string" || id.length > 100,
    ) ||
    new Set(value.directionIds).size !== value.directionIds.length
  )
    throw new Error("Invalid direction selection (maximum 200 per scan).");
  if (!["1", "10", "100"].includes(value.notional as string))
    throw new Error("Choose an approximate $1, $10 or $100 preset.");
  const custom = object(value.customAmounts);
  if (
    Object.keys(custom).some(
      (id) => !(value.directionIds as string[]).includes(id),
    ) ||
    Object.values(custom).some(
      (amount) => typeof amount !== "string" || amount.length > 280,
    )
  )
    throw new Error("Invalid custom amounts.");
  validateSlippage(value.slippageBps);
  return {
    network: "mainnet",
    directionIds: value.directionIds as string[],
    notional: value.notional as ScanInput["notional"],
    customAmounts: custom as Record<string, string>,
    slippageBps: value.slippageBps,
  };
}

export function asIpdError(error: unknown): IpdError {
  return error instanceof IpdError
    ? error
    : new IpdError(
        error instanceof Error ? error.message : "Unknown IPD failure.",
      );
}

export class SolverService {
  private client: SolverClient;
  constructor(readonly settings: Settings) {
    this.client = new SolverClient(settings.upstream);
  }
  catalog(signal: AbortSignal): Promise<Catalog> {
    return this.client.get(
      "/v2/pairs",
      budget(signal),
      (raw) => parseCatalog(raw, mainnetIdentities),
      300_000,
    );
  }

  async scan(
    input: ScanInput,
    signal: AbortSignal,
    emit: (event: ScanEvent) => void,
  ) {
    const catalog = await this.catalog(signal);
    const directions = new Map(catalog.directions.map((row) => [row.id, row]));
    if (input.directionIds.some((id) => !directions.has(id)))
      throw new IpdError(
        "Catalog changed or an unsupported direction was selected. Reload the catalog.",
        "invalid",
      );
    emit({ type: "start", catalog });
    const rows = input.directionIds.map((id) => directions.get(id)!);
    const valuedTokens = [
      ...new Map(
        rows
          .filter(
            (row) =>
              input.customAmounts[row.id] === undefined &&
              !row.offered.issue &&
              !row.requested.issue,
          )
          .map((row) => [row.offered.faucetId, row.offered]),
      ).values(),
    ];
    const valuations = new Map<string, Valuation | IpdError>();
    // A scan values each offered identity once, in batches of at most 50.
    for (let index = 0; index < valuedTokens.length; index += 50) {
      const chunk = valuedTokens.slice(index, index + 50);
      try {
        const path = `/v1/prices?${new URLSearchParams({
          ids: chunk
            .map((token) => token.faucetId)
            .sort()
            .join(","),
          precision: "full",
        })}`;
        const raw = await this.client.get(path, budget(signal), object);
        for (const token of chunk) {
          try {
            valuations.set(
              token.faucetId,
              parseValuation(
                raw[token.faucetId],
                token,
                this.settings.priceMaxAgeMs,
              ),
            );
          } catch (error) {
            valuations.set(
              token.faucetId,
              new IpdError(
                `Preset unavailable: ${error instanceof Error ? error.message : "missing valuation"} Enter a custom token amount.`,
                "price-unavailable",
                "valuation",
              ),
            );
          }
        }
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        for (const token of chunk)
          valuations.set(token.faucetId, asIpdError(error));
      }
    }
    let cursor = 0;
    const worker = async () => {
      while (!signal.aborted && cursor < rows.length) {
        const row = rows[cursor++];
        const check = await this.check(
          row,
          input,
          valuations.get(row.offered.faucetId),
          budget(signal),
        );
        if (!signal.aborted) emit({ type: "result", check });
      }
    };
    await Promise.all([worker(), worker()]);
    signal.throwIfAborted();
    emit({ type: "done" });
  }

  private async check(
    row: Direction,
    scan: ScanInput,
    valuation: Valuation | IpdError | undefined,
    context: Budget,
  ): Promise<Check> {
    const customAmount = scan.customAmounts[row.id];
    const base: Check = {
      directionId: row.id,
      checkedAt: Date.now(),
      status: "error",
      validity: "unknown",
      message: "Check failed.",
      policy: {
        notional: scan.notional,
        customAmount,
        slippageBps: scan.slippageBps,
        minFillStep: "0",
      },
    };
    try {
      if (
        row.offered.issue ||
        row.requested.issue ||
        row.offered.decimals === null ||
        row.requested.decimals === null
      )
        throw new IpdError(
          row.offered.issue ||
            row.requested.issue ||
            "Token decimals are unavailable.",
          "invalid",
          "metadata",
        );
      let offeredAmount: string;
      if (customAmount !== undefined) {
        try {
          offeredAmount = parseAmount(customAmount, row.offered.decimals);
        } catch (error) {
          throw new IpdError((error as Error).message, "invalid", "amount");
        }
      } else {
        if (!valuation)
          throw new IpdError(
            "Preset valuation is missing; enter a custom token amount.",
            "price-unavailable",
            "valuation",
          );
        if (valuation instanceof IpdError) throw valuation;
        try {
          assertFresh(valuation.as_of, this.settings.priceMaxAgeMs);
        } catch {
          throw new IpdError(
            "Preset valuation expired during the scan; refresh or enter a custom amount.",
            "price-unavailable",
            "valuation",
          );
        }
        base.valuation = valuation;
        try {
          offeredAmount = notionalAmount(
            scan.notional,
            valuation.price,
            row.offered.decimals,
          );
        } catch (error) {
          throw new IpdError((error as Error).message, "invalid", "amount");
        }
      }
      base.offeredAmount = offeredAmount;
      const directionQuery = {
        offered_faucet: row.offered.faucetId,
        requested_faucet: row.requested.faucetId,
      };
      const pricePath = `/v2/pair-price?${new URLSearchParams(directionQuery)}`;
      base.request = `${this.settings.upstream}${pricePath}`;
      const pairPrice = await this.client.get(
        pricePath,
        context,
        (raw) => parsePairPrice(raw, row, this.settings.priceMaxAgeMs),
        1000,
      );
      base.pairPrice = pairPrice;
      let requestedAmount: string;
      try {
        requestedAmount = minimumReceive(
          offeredAmount,
          row.offered.decimals,
          row.requested.decimals,
          pairPrice.fillPrice,
          scan.slippageBps,
        );
      } catch (error) {
        throw new IpdError((error as Error).message, "invalid", "amount");
      }
      const exact: ExactInput = {
        network: "mainnet",
        offeredFaucet: row.offered.faucetId,
        requestedFaucet: row.requested.faucetId,
        offeredAmount: atomic(offeredAmount),
        requestedAmount,
        slippageBps: scan.slippageBps,
        minFillStep: "0",
      };
      base.input = exact;
      base.identity = JSON.stringify(exact);
      const path = `/v2/swap-eta?${new URLSearchParams({ ...directionQuery, offered_amount: offeredAmount, requested_amount: requestedAmount, min_fill_step: "0" })}`;
      base.request = `${this.settings.upstream}${path}`;
      const estimate = await this.client.get(path, context, (raw) =>
        parseEstimate(raw, exact),
      );
      // A long queue must not turn a stale construction price into a fresh check.
      try {
        assertFresh(pairPrice.asOf, this.settings.priceMaxAgeMs);
      } catch {
        throw new IpdError(
          "Construction price expired during this check; refresh to rebuild the limit.",
          "price-unavailable",
          "stale",
        );
      }
      const status = classify(estimate);
      return {
        ...base,
        estimate,
        rawResponse: estimate,
        status,
        validity: "valid",
        message: statusLabels[status],
        checkedAt: Date.now(),
      };
    } catch (error) {
      if (context.signal.aborted) throw context.signal.reason;
      const failure = asIpdError(error);
      return {
        ...base,
        checkedAt: Date.now(),
        status: failure.status,
        validity: failure.status === "invalid" ? "invalid" : "unknown",
        message: failure.message,
        errorCode: failure.code,
        rawResponse: failure.rawResponse,
        httpStatus: failure.httpStatus,
        retryAt: failure.retryAt,
      };
    }
  }
}

// Route bundles and tabs share one limiter/cooldown per server process.
const globalService = globalThis as typeof globalThis & {
  ipdSolverService?: SolverService;
};
export function solverService() {
  return (globalService.ipdSolverService ??= new SolverService(getSettings()));
}
