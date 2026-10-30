"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Quote, Route } from "./types";

export function useMonitor(routes: Route[], amounts: Record<string, string>) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [interval, setIntervalSeconds] = useState(300);
  const [paused, setPaused] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [waitingIds, setWaitingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scan = useCallback(async () => {
    controller.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setPaused(false);
    setCompleted(0);
    setError(null);
    setActiveIds(new Set());
    setWaitingIds(new Set());
    let cursor = 0;
    let connectionErrors = 0;
    async function worker() {
      while (!current.signal.aborted && cursor < routes.length) {
        const route = routes[cursor++];
        const amount = amounts[route.source.symbol];
        setActiveIds((previous) => new Set(previous).add(route.id));
        let rawResponse: unknown;
        try {
          const fetchQuote = () =>
            fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/quote`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ routeId: route.id, amount }),
              signal: AbortSignal.any([
                current.signal,
                AbortSignal.timeout(50_000),
              ]),
            });
          let response = await fetchQuote();
          for (let retry = 0; response.status === 429 && retry < 5; retry++) {
            const seconds = Number(response.headers.get("Retry-After") ?? 60);
            const delay = Number.isFinite(seconds)
              ? Math.min(300, Math.max(1, seconds)) * 1000
              : 60_000;
            await response.body?.cancel();
            setWaitingIds((previous) => new Set(previous).add(route.id));
            await new Promise<void>((resolve) => {
              const finish = () => {
                clearTimeout(id);
                current.signal.removeEventListener("abort", finish);
                resolve();
              };
              const id = setTimeout(finish, delay);
              current.signal.addEventListener("abort", finish, { once: true });
              if (current.signal.aborted) finish();
            });
            if (current.signal.aborted) return;
            setWaitingIds((previous) => {
              const next = new Set(previous);
              next.delete(route.id);
              return next;
            });
            response = await fetchQuote();
          }
          if (current.signal.aborted) return;
          const data = await response.json();
          rawResponse = data.rawResponse;
          if (!response.ok)
            throw new Error(data.error || "Could not reach the quote server.");
          connectionErrors = 0;
          setQuotes((previous) => ({ ...previous, [route.id]: data }));
        } catch (failure) {
          if (current.signal.aborted) return;
          connectionErrors++;
          const message =
            failure instanceof Error ? failure.message : "Connection failed.";
          setQuotes((previous) => ({
            ...previous,
            [route.id]: {
              routeId: route.id,
              requestedAmount: amount,
              status: "error",
              checkedAt: new Date().toISOString(),
              durationMs: 0,
              message,
              rawResponse,
            },
          }));
          if (connectionErrors >= 8) {
            setError("The quote server is not responding. Refresh to retry.");
            current.abort();
            setPaused(true);
            setBusy(false);
            setActiveIds(new Set());
            setWaitingIds(new Set());
            return;
          }
        }
        if (current.signal.aborted) return;
        setCompleted((previous) => previous + 1);
        setActiveIds((previous) => {
          const next = new Set(previous);
          next.delete(route.id);
          return next;
        });
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    if (!current.signal.aborted) {
      setBusy(false);
      setFinishedAt(Date.now());
    }
  }, [routes, amounts]);

  useEffect(() => {
    setQuotes({});
    setFinishedAt(null);
    void scan();
    return () => {
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scan]);

  useEffect(() => {
    if (!busy && !paused && finishedAt && interval > 0) {
      const schedule = () => {
        timer.current = setTimeout(() => {
          if (document.visibilityState === "visible") void scan();
          else schedule();
        }, interval * 1000);
      };
      schedule();
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [busy, paused, finishedAt, interval, scan]);

  const pause = () => {
    controller.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    setPaused(true);
    setActiveIds(new Set());
    setWaitingIds(new Set());
  };
  return {
    quotes,
    busy,
    completed,
    activeIds,
    waiting: waitingIds.size > 0,
    interval,
    setIntervalSeconds,
    scan,
    pause,
    paused,
    finishedAt,
    error,
  };
}
