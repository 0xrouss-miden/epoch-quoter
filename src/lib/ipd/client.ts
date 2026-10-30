import { parseError, SourcePriceError } from "./contract";
import type { Status } from "./types";

export class IpdError extends Error {
  constructor(
    message: string,
    public status: Status = "error",
    public code?: string,
    public httpStatus?: number,
    public rawResponse?: unknown,
    public retryAt?: number,
  ) {
    super(message);
  }
}
export type Budget = {
  signal: AbortSignal;
  deadline: number;
  retriesLeft: number;
};
export function budget(signal: AbortSignal): Budget {
  return { signal, deadline: Date.now() + 20_000, retriesLeft: 1 };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

class RequestQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.waiting.length >= 100)
      throw new IpdError("Local IPD queue is busy; refresh shortly.", "busy");
    await new Promise<void>((resolve, reject) => {
      const enter = () => {
        signal.removeEventListener("abort", abort);
        this.active++;
        resolve();
      };
      const abort = () => {
        this.waiting = this.waiting.filter((job) => job !== enter);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      if (this.active < 2) enter();
      else {
        this.waiting.push(enter);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }
}

type Pending = {
  promise: Promise<unknown>;
  controller: AbortController;
  users: number;
  retriesUsed: number;
};
export class SolverClient {
  private queue = new RequestQueue();
  private cooldownUntil = 0;
  private cache = new Map<string, { value: unknown; expires: number }>();
  private pending = new Map<string, Pending>();
  constructor(private readonly upstream: string) {}

  async get<T>(
    path: string,
    context: Budget,
    validate: (raw: unknown) => T,
    ttlMs = 0,
  ): Promise<T> {
    context.signal.throwIfAborted();
    if (Date.now() >= context.deadline)
      throw new IpdError(
        "The 20-second check budget expired.",
        "error",
        "timeout",
      );
    const cached = this.cache.get(path);
    if (ttlMs > 0 && cached && cached.expires > Date.now()) {
      try {
        return validate(cached.value);
      } catch {
        /* Re-fetch stale/invalid cached metadata. */
      }
    }
    this.cache.delete(path);
    // Estimates (ttl=0) are neither cached nor shared between exact checks.
    if (!ttlMs) return this.load(path, context, validate, 0);
    let entry = this.pending.get(path);
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        users: 0,
        retriesUsed: 0,
        promise: Promise.resolve(),
      };
      const shared = entry;
      const loadContext = { ...context, signal: controller.signal };
      const initialRetries = loadContext.retriesLeft;
      entry.promise = this.load(path, loadContext, validate, ttlMs).finally(
        () => {
          shared.retriesUsed = initialRetries - loadContext.retriesLeft;
          if (this.pending.get(path) === shared) this.pending.delete(path);
        },
      );
      this.pending.set(path, entry);
    }
    const shared = entry;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal.removeEventListener("abort", abort);
        shared.users--;
        context.retriesLeft = Math.max(
          0,
          context.retriesLeft - shared.retriesUsed,
        );
        if (!shared.users) {
          shared.controller.abort();
          if (this.pending.get(path) === shared) this.pending.delete(path);
        }
        if (error) reject(error);
        else resolve(value as T);
      };
      const abort = () => finish(context.signal.reason);
      const timer = setTimeout(
        () =>
          finish(
            new IpdError(
              "The 20-second check budget expired.",
              "error",
              "timeout",
            ),
          ),
        Math.max(1, context.deadline - Date.now()),
      );
      context.signal.addEventListener("abort", abort, { once: true });
      shared.promise.then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
      if (context.signal.aborted) abort();
    });
  }

  private async load<T>(
    path: string,
    context: Budget,
    validate: (raw: unknown) => T,
    ttlMs: number,
  ): Promise<T> {
    for (;;) {
      context.signal.throwIfAborted();
      const remaining = context.deadline - Date.now();
      if (remaining <= 0)
        throw new IpdError(
          "The 20-second check budget expired.",
          "error",
          "timeout",
        );
      if (this.cooldownUntil > Date.now())
        throw new IpdError(
          "Solver cooldown is active; the next check is deferred.",
          "busy",
          "cooldown",
          429,
          undefined,
          this.cooldownUntil,
        );
      const timeout = new AbortController();
      const timer = setTimeout(
        () => timeout.abort(new Error("Upstream request timed out.")),
        Math.min(10_000, remaining),
      );
      const signal = AbortSignal.any([context.signal, timeout.signal]);
      let release: (() => void) | undefined;
      let failure: IpdError | undefined;
      let retryable = false;
      try {
        release = await this.queue.acquire(signal);
        if (this.cooldownUntil > Date.now())
          throw new IpdError(
            "Solver cooldown is active.",
            "busy",
            "cooldown",
            429,
            undefined,
            this.cooldownUntil,
          );
        const response = await fetch(`${this.upstream}${path}`, {
          method: "GET",
          cache: "no-store",
          redirect: "error",
          signal,
          headers: { Accept: "application/json" },
        });
        const body = await response.text();
        let raw: unknown = body.slice(0, 8000);
        try {
          raw = JSON.parse(body);
        } catch {
          /* Empty/non-JSON proxy errors remain text. */
        }
        if (response.ok) {
          let value: T;
          try {
            value = validate(raw);
          } catch (error) {
            throw new IpdError(
              `Invalid solver response: ${error instanceof Error ? error.message : "schema mismatch"}`,
              error instanceof SourcePriceError ? "price-unavailable" : "error",
              error instanceof SourcePriceError ? "stale" : "invalid_response",
              response.status,
              raw,
            );
          }
          const control = response.headers.get("cache-control") ?? "";
          const age = Number(response.headers.get("age") ?? 0);
          const maxAges = [
            ...control.matchAll(/\b(?:s-maxage|max-age)=(\d+)/gi),
          ].map((match) => Number(match[1]) * 1000);
          const ttl = /no-store|no-cache/i.test(control)
            ? 0
            : Math.max(
                0,
                Math.min(ttlMs, ...maxAges) -
                  (Number.isFinite(age) && age >= 0 ? age * 1000 : ttlMs),
              );
          if (ttl > 0) {
            if (this.cache.size >= 500)
              this.cache.delete(this.cache.keys().next().value!);
            // Cache validated raw JSON so each caller's identities/freshness are checked again.
            this.cache.set(path, { value: raw, expires: Date.now() + ttl });
          }
          return value;
        }
        const typed = parseError(raw);
        const code = typed?.error;
        const statuses: Record<string, Status> = {
          no_market: "unsupported",
          no_price: "price-unavailable",
          stale: "price-unavailable",
          not_ready: "starting",
          overloaded: "busy",
          unknown_faucet: "invalid",
          bad_faucet_id: "invalid",
          bad_precision: "invalid",
          batch_too_large: "invalid",
          bad_request: "invalid",
          bad_amount: "invalid",
        };
        const status =
          (code && statuses[code]) ||
          (response.status === 429 ? "busy" : "error");
        retryable =
          response.status !== 400 &&
          response.status !== 404 &&
          (!code || code === "overloaded") &&
          (response.status === 408 ||
            response.status === 429 ||
            response.status >= 500);
        const retryHeader = response.headers.get("retry-after");
        if (retryHeader && retryable) {
          const delay = /^\d+(\.\d+)?$/.test(retryHeader)
            ? Number(retryHeader) * 1000
            : Date.parse(retryHeader) - Date.now();
          if (Number.isFinite(delay))
            this.cooldownUntil = Math.max(
              this.cooldownUntil,
              Date.now() + Math.max(0, delay),
            );
        } else if (response.status === 429 || code === "overloaded")
          this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + 1000);
        failure = new IpdError(
          typed?.message ||
            `Solver returned HTTP ${response.status}${body ? " with an unrecognized error body" : " with an empty body"}.`,
          status,
          code,
          response.status,
          raw,
          this.cooldownUntil > Date.now() ? this.cooldownUntil : undefined,
        );
      } catch (error) {
        if (context.signal.aborted) throw context.signal.reason;
        failure =
          error instanceof IpdError
            ? error
            : new IpdError(
                timeout.signal.aborted
                  ? "Upstream request timed out."
                  : "Could not reach the solver.",
                "error",
                timeout.signal.aborted ? "timeout" : "network",
              );
        retryable = !(error instanceof IpdError);
      } finally {
        clearTimeout(timer);
        release?.();
      }
      const delay = Math.max(250, this.cooldownUntil - Date.now());
      if (
        !retryable ||
        context.retriesLeft <= 0 ||
        Date.now() + delay + 100 >= context.deadline
      )
        throw failure;
      context.retriesLeft--;
      await wait(delay, context.signal);
    }
  }
}
