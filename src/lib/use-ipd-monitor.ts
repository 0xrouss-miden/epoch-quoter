"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { statusLabels } from "./ipd/contract";
import type {
  Catalog,
  Check,
  ScanEvent,
  ScanInput,
  Settings,
  Status,
} from "./ipd/types";

const api = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/ipd`;
export function useIpdMonitor(
  input: ScanInput,
  ready: boolean,
  settings?: Settings,
) {
  const inputKey = JSON.stringify(input);
  const currentKey = useRef(inputKey);
  currentKey.current = inputKey;
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [resultKey, setResultKey] = useState(inputKey);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(true);
  const [catalogUpdate, setCatalogUpdate] = useState<Catalog | null>(null);

  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }, []);

  const scan = useCallback(async () => {
    if (!ready || document.visibilityState !== "visible") return;
    cancel();
    const id = generation.current;
    const key = inputKey;
    const request: ScanInput = JSON.parse(key);
    const active = new AbortController();
    controller.current = active;
    const isCurrent = () =>
      !active.signal.aborted &&
      generation.current === id &&
      currentKey.current === key;
    setChecks({}); // A refresh immediately retires every previous observation.
    setResultKey(key);
    setBusy(true);
    setPaused(false);
    setFinishedAt(null);
    setError(null);
    const received = new Set<string>();
    let done = false;
    let failureStatus: Status = "error";
    let retryAt: number | undefined;
    try {
      const response = await fetch(`${api}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
        cache: "no-store",
        signal: active.signal,
      });
      if (!response.ok) {
        let message = `Scan failed (HTTP ${response.status}).`;
        try {
          const body = await response.json();
          if (typeof body.error === "string") message = body.error;
        } catch {
          /* Proxy error. */
        }
        throw new Error(message);
      }
      if (!response.body) throw new Error("The scan response was empty.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const next = await reader.read();
          if (!isCurrent()) return;
          buffer += decoder.decode(next.value, { stream: !next.done });
          if (buffer.length > 2_000_000)
            throw new Error("Scan response exceeded the expected size.");
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines.filter(Boolean)) {
            const event = JSON.parse(line) as ScanEvent;
            if (done) throw new Error("Unexpected data after scan completion.");
            if (event.type === "error") {
              failureStatus =
                event.status in statusLabels &&
                event.status !== "full" &&
                event.status !== "partial"
                  ? event.status
                  : "error";
              retryAt = event.retryAt;
              throw new Error(event.message);
            }
            if (event.type === "start") {
              if (event.catalog.network !== "mainnet")
                throw new Error("Wrong catalog network.");
              setCatalogUpdate(event.catalog);
            } else if (event.type === "result") {
              const check = event.check;
              if (
                !request.directionIds.includes(check.directionId) ||
                received.has(check.directionId) ||
                !(check.status in statusLabels) ||
                !Number.isSafeInteger(check.checkedAt) ||
                check.policy.slippageBps !== request.slippageBps ||
                check.policy.minFillStep !== "0" ||
                check.policy.notional !== request.notional ||
                check.policy.customAmount !==
                  request.customAmounts[check.directionId]
              )
                throw new Error(
                  "Scan response does not match the current inputs.",
                );
              if (
                check.status === "full" &&
                (check.validity !== "valid" ||
                  check.estimate?.fillStatus !== "full" ||
                  check.estimate.priceBand !== "at_market" ||
                  check.estimate.reason !== null ||
                  !check.estimate.settlementsRunning ||
                  !check.input ||
                  check.input.network !== "mainnet" ||
                  check.identity !== JSON.stringify(check.input))
              )
                throw new Error("Inconsistent full-fill observation.");
              received.add(check.directionId);
              setChecks((previous) =>
                isCurrent()
                  ? { ...previous, [check.directionId]: check }
                  : previous,
              );
            } else if (event.type === "done") done = true;
            else throw new Error("Unknown scan response.");
          }
          if (next.done) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (
        buffer.trim() ||
        !done ||
        received.size !== request.directionIds.length
      )
        throw new Error(
          "Scan ended before every selected direction was checked.",
        );
    } catch (failure) {
      if (!isCurrent()) return;
      const message =
        failure instanceof Error ? failure.message : "Scan failed.";
      setError(message);
      setChecks(
        Object.fromEntries(
          request.directionIds.map((directionId) => [
            directionId,
            {
              directionId,
              status: failureStatus,
              validity: "unknown",
              checkedAt: Date.now(),
              message,
              retryAt,
              policy: {
                notional: request.notional,
                customAmount: request.customAmounts[directionId],
                slippageBps: request.slippageBps,
                minFillStep: "0",
              },
            } satisfies Check,
          ]),
        ),
      );
    } finally {
      if (isCurrent()) {
        controller.current = null;
        setBusy(false);
        setFinishedAt(Date.now());
        setNow(Date.now());
      }
    }
  }, [inputKey, ready, cancel]);

  // Editing a control cancels immediately; debounce typing before a fresh scan.
  useEffect(() => {
    cancel();
    setChecks({});
    setError(null);
    setFinishedAt(null);
    if (!ready || pausedRef.current) return;
    const timer = setTimeout(() => void scan(), 450);
    return () => {
      clearTimeout(timer);
      cancel();
    };
  }, [scan, cancel, ready]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const visibility = () => {
      const showing = document.visibilityState === "visible";
      setVisible(showing);
      setNow(Date.now());
      if (!showing) {
        cancel();
        setChecks((previous) =>
          Object.fromEntries(
            Object.entries(previous).map(([id, check]) => [
              id,
              {
                ...check,
                status: "stale",
                message: "Page was hidden; refresh for a current observation.",
              },
            ]),
          ),
        );
      }
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", visibility);
      cancel();
    };
  }, [cancel]);

  const retryAt = Math.max(
    0,
    ...Object.values(checks).map((check) => check.retryAt ?? 0),
  );
  useEffect(() => {
    if (!autoRefresh || paused || busy || !visible || !ready) return;
    const timer = setTimeout(
      () => void scan(),
      Math.max(
        0,
        Math.max((finishedAt ?? Date.now()) + 60_000, retryAt) - Date.now(),
      ),
    );
    return () => clearTimeout(timer);
  }, [autoRefresh, paused, busy, visible, ready, finishedAt, retryAt, scan]);

  const currentChecks = resultKey === inputKey ? checks : {};
  const displayed = Object.fromEntries(
    Object.entries(currentChecks).map(([id, check]) => [
      id,
      now - check.checkedAt >= (settings?.expiresAfterMs ?? 120_000)
        ? {
            ...check,
            status: "stale" as const,
            message: "Observation expired; refresh for a current estimate.",
          }
        : check,
    ]),
  );
  return {
    checks: displayed,
    busy,
    paused,
    autoRefresh,
    setAutoRefresh,
    now,
    error,
    visible,
    catalogUpdate,
    completed: Object.keys(currentChecks).length,
    finishedAt,
    refresh: () => {
      setPaused(false);
      void scan();
    },
    pause: () => {
      cancel();
      setPaused(true);
    },
  };
}
