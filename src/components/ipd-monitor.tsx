"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Pause, RefreshCw } from "lucide-react";
import { DashboardNav } from "./dashboard-nav";
import { formatAmount, validateSlippage } from "@/lib/ipd/amounts";
import { statusLabels } from "@/lib/ipd/contract";
import { useIpdMonitor } from "@/lib/use-ipd-monitor";
import type {
  Catalog,
  Check,
  Direction,
  ScanInput,
  Settings,
  Status,
} from "@/lib/ipd/types";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
function tokenAmount(
  amount: string | null | undefined,
  decimals: number | null,
) {
  return amount != null && decimals !== null
    ? formatAmount(amount, decimals)
    : "—";
}
function time(value: number) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function ResultDetails({
  row,
  check,
  settings,
}: {
  row: Direction;
  check?: Check;
  settings: Settings | null;
}) {
  const estimate = check?.estimate;
  return (
    <div className="route-detail ipd-detail">
      <p>
        {check?.message ??
          row.offered.issue ??
          row.requested.issue ??
          "No observation for these inputs yet."}
      </p>
      <dl>
        <div>
          <dt>Offered faucet · {row.offered.ticker}</dt>
          <dd className="address">{row.offered.faucetId}</dd>
        </div>
        <div>
          <dt>Requested faucet · {row.requested.ticker}</dt>
          <dd className="address">{row.requested.faucetId}</dd>
        </div>
        <div>
          <dt>Catalog market</dt>
          <dd>
            {row.name} · {row.binanceSymbol}
          </dd>
        </div>
        <div>
          <dt>Validity / fill / reason / executor</dt>
          <dd>
            {check?.validity ?? "unchecked"} / {estimate?.fillStatus ?? "—"} /{" "}
            {estimate?.reason ?? "none"} /{" "}
            {estimate
              ? estimate.settlementsRunning
                ? "running"
                : "paused"
              : "unknown"}
          </dd>
        </div>
        <div>
          <dt>Slippage / hypothetical taker minimum fill</dt>
          <dd>
            {check?.policy.slippageBps ?? 5} bps / 0 requested base units (no
            extra minimum)
          </dd>
        </div>
        <div>
          <dt>Price band classification</dt>
          <dd>{estimate?.priceBand ?? "—"} · not a numeric clearing band</dd>
        </div>
        <div>
          <dt>Order market / expected / fee-adjusted price</dt>
          <dd>
            {estimate?.marketPrice ?? "—"} / {estimate?.expectedPrice ?? "—"} /{" "}
            {estimate?.fillPrice ?? "—"} {row.requested.ticker} per{" "}
            {row.offered.ticker}
          </dd>
        </div>
        <div>
          <dt>Construction fill price</dt>
          <dd>{check?.pairPrice?.fillPrice ?? "—"}</dd>
        </div>
        <div>
          <dt>Binance source-price time</dt>
          <dd>
            {check?.pairPrice
              ? new Date(check.pairPrice.asOf * 1000).toLocaleString()
              : "—"}{" "}
            · not maker/book freshness
          </dd>
        </div>
        <div>
          <dt>Fee (already included in fill price)</dt>
          <dd>
            {estimate ? `${estimate.feePpm} ppm` : "—"} ·{" "}
            {tokenAmount(estimate?.feeAmount, row.requested.decimals)}{" "}
            {row.requested.ticker} for a full fill
          </dd>
        </div>
        <div>
          <dt>Capacity at this limit after queue priority</dt>
          <dd>
            {tokenAmount(estimate?.maxOfferedAmount, row.offered.decimals)}{" "}
            {row.offered.ticker} · not pair TVL
          </dd>
        </div>
        <div>
          <dt>ETA / median over 24 hours</dt>
          <dd>
            {estimate?.estimatedSeconds ?? "—"} s /{" "}
            {estimate?.median24hSeconds ?? "—"} s · not settlement evidence
          </dd>
        </div>
        <div>
          <dt>Valuation reference</dt>
          <dd>
            {check?.valuation
              ? `${check.valuation.price} USDT per ${row.offered.ticker} at ${time(check.valuation.as_of * 1000)}`
              : "Custom amount or valuation unavailable"}
          </dd>
        </div>
        <div>
          <dt>Observation policy</dt>
          <dd>
            Expires after {(settings?.expiresAfterMs ?? 120000) / 1000} s. A
            failed refresh retires the prior result immediately.
          </dd>
        </div>
        {check?.retryAt && (
          <div>
            <dt>Retry no earlier than</dt>
            <dd>{new Date(check.retryAt).toLocaleString()}</dd>
          </div>
        )}
      </dl>
      {estimate?.fillStatus === "partial" && (
        <p>
          Unfilled:{" "}
          {tokenAmount(
            (
              BigInt(estimate.offeredAmount) -
              BigInt(estimate.fillableOfferedAmount)
            ).toString(),
            row.offered.decimals,
          )}{" "}
          {row.offered.ticker}; remaining minimum{" "}
          {tokenAmount(
            (
              BigInt(estimate.requestedAmount) -
              BigInt(estimate.fillableRequestedAmount)
            ).toString(),
            row.requested.decimals,
          )}{" "}
          {row.requested.ticker}. Partial execution pays the note’s own ratio;
          the full-order expected receive is not this portion’s proceeds.
        </p>
      )}
      <details className="raw-details">
        <summary>Exact request and solver response</summary>
        <pre>
          {JSON.stringify(
            {
              identity: check?.identity,
              input: check?.input,
              request: check?.request,
              constructionPrice: check?.pairPrice,
              valuation: check?.valuation,
              httpStatus: check?.httpStatus,
              errorCode: check?.errorCode,
              response: check?.rawResponse,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}

export function IpdMonitor() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [notional, setNotional] = useState<ScanInput["notional"]>("10");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(
    {},
  );
  const [slippage, setSlippage] = useState("5");
  const [asset, setAsset] = useState("");
  const [offered, setOffered] = useState("");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(null);
    void (async () => {
      try {
        const response = await fetch(`${basePath}/api/ipd/catalog`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Catalog unavailable.");
        if (
          body.catalog?.network !== "mainnet" ||
          !Array.isArray(body.catalog.directions)
        )
          throw new Error("Invalid mainnet catalog.");
        if (!controller.signal.aborted) {
          setCatalog(body.catalog);
          setSettings(body.settings);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setCatalogError(
            error instanceof Error ? error.message : "Catalog unavailable.",
          );
      }
    })();
    return () => controller.abort();
  }, [catalogRevision]);
  const rows = useMemo(
    () =>
      (catalog?.directions ?? []).filter(
        (row) =>
          (!asset ||
            row.offered.faucetId === asset ||
            row.requested.faucetId === asset) &&
          (!offered || row.offered.faucetId === offered),
      ),
    [catalog, asset, offered],
  );
  const tokens = useMemo(
    () => [
      ...new Map(
        (catalog?.directions ?? []).map((row) => [
          row.offered.faucetId,
          row.offered,
        ]),
      ).values(),
    ],
    [catalog],
  );
  let policyError = "";
  const bps = /^\d+$/.test(slippage) ? Number(slippage) : NaN;
  try {
    validateSlippage(bps);
  } catch (error) {
    policyError = (error as Error).message;
  }
  const input: ScanInput = {
    network: "mainnet",
    directionIds: rows.map((row) => row.id),
    notional,
    customAmounts: Object.fromEntries(
      rows
        .filter((row) => customAmounts[row.id] !== undefined)
        .map((row) => [row.id, customAmounts[row.id]]),
    ),
    slippageBps: Number.isFinite(bps) ? bps : 0,
  };
  const monitor = useIpdMonitor(
    input,
    !!catalog && !policyError && !catalogError,
    settings ?? undefined,
  );
  useEffect(() => {
    if (monitor.catalogUpdate)
      setCatalog((current) =>
        JSON.stringify(current) === JSON.stringify(monitor.catalogUpdate)
          ? current
          : monitor.catalogUpdate,
      );
  }, [monitor.catalogUpdate]);
  const displayed = rows.filter(
    (row) =>
      status === "all" ||
      (monitor.checks[row.id]?.status ?? "pending") === status,
  );
  const full = rows.filter(
    (row) => monitor.checks[row.id]?.status === "full",
  ).length;
  const changeStatus = (value: string) => {
    if (monitor.busy) monitor.pause();
    setStatus(value);
  };
  return (
    <>
      <header className="app-header ipd-header">
        <a href={basePath || "/"} className="brand">
          Miden <span className="brand-divider">/</span>
          <span className="brand-secondary">Monitors</span>
        </a>
        <DashboardNav active="ipd" />
        <span className="text-link">Read-only estimates</span>
      </header>
      <main className="ipd-page">
        <section className="page-heading">
          <div>
            <h1>IPD availability</h1>
            <div className="scan-status" role="status" aria-live="polite">
              {monitor.busy
                ? `Checking ${monitor.completed} of ${rows.length} directions`
                : monitor.paused
                  ? "Paused"
                  : monitor.finishedAt
                    ? `${monitor.completed} directions checked · ${time(monitor.finishedAt)}`
                    : catalog
                      ? "Ready to check"
                      : "Loading supported pairs"}
              {!monitor.visible && " · page hidden"}
            </div>
          </div>
          <div className="heading-actions">
            <label className="refresh-label">
              Auto-refresh{" "}
              <select
                aria-label="IPD auto-refresh"
                value={monitor.autoRefresh ? "60" : "0"}
                onChange={(event) =>
                  monitor.setAutoRefresh(event.target.value === "60")
                }
              >
                <option value="0">Off</option>
                <option value="60">60s after scan</option>
              </select>
            </label>
            <button
              className="button"
              onClick={monitor.pause}
              disabled={monitor.paused}
            >
              <Pause size={14} />
              Pause
            </button>
            <button
              className="button primary"
              onClick={monitor.refresh}
              disabled={!catalog || !!policyError || !!catalogError}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </section>
        <p className="ipd-explanation">
          Based on the solver’s current order book; liquidity is not reserved
          and execution can differ.
        </p>
        {(catalogError || monitor.error || policyError) && (
          <div className="error-banner" role="alert">
            {catalogError || policyError || monitor.error}
            {catalogError && (
              <button
                className="button"
                onClick={() => setCatalogRevision((value) => value + 1)}
              >
                Retry catalog
              </button>
            )}
          </div>
        )}
        {!!catalog?.warnings.length && (
          <p role="status">Catalog warnings: {catalog.warnings.join(" ")}</p>
        )}
        <section className="workspace" aria-label="IPD monitor">
          <div className="toolbar ipd-toolbar">
            <span className="network-scope">
              Miden mainnet ·{" "}
              {catalog
                ? `${catalog.directions.length / 2} supported pairs`
                : "discovering pairs"}
            </span>
            <label className="ipd-field">
              Amount preset{" "}
              <select
                aria-label="Amount preset"
                value={notional}
                onChange={(event) => {
                  setNotional(event.target.value as ScanInput["notional"]);
                  setCustomAmounts({});
                }}
              >
                <option value="1">≈ $1</option>
                <option value="10">≈ $10</option>
                <option value="100">≈ $100</option>
              </select>
            </label>
            <span className="ipd-reference">
              Approximate USD using USDT reference
            </span>
            <details className="ipd-policy">
              <summary>Limit policy · {slippage || "—"} bps</summary>
              <div>
                <label className="ipd-field">
                  Slippage (whole bps){" "}
                  <input
                    aria-label="Slippage in basis points"
                    inputMode="numeric"
                    value={slippage}
                    onChange={(event) => setSlippage(event.target.value)}
                  />
                </label>
                <p>
                  1–100 bps; initial 5 bps = 0.05%. Fee is included once.
                  Minimum fill step: 0 requested base units, with no extra
                  minimum.
                </p>
              </div>
            </details>
          </div>
          <div className="filterbar ipd-filters">
            <label className="ipd-field">
              Asset{" "}
              <select
                aria-label="Filter by asset"
                value={asset}
                onChange={(event) => setAsset(event.target.value)}
              >
                <option value="">All assets</option>
                {tokens.map((token) => (
                  <option key={token.faucetId} value={token.faucetId}>
                    {token.ticker} · {token.faucetId.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ipd-field">
              Offering{" "}
              <select
                aria-label="Filter by offered asset"
                value={offered}
                onChange={(event) => setOffered(event.target.value)}
              >
                <option value="">Both directions</option>
                {tokens.map((token) => (
                  <option key={token.faucetId} value={token.faucetId}>
                    {token.ticker} →
                  </option>
                ))}
              </select>
            </label>
            <label className="ipd-field">
              Status{" "}
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(event) => changeStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="results-bar">
            <span>
              {displayed.length} directions shown · {full} estimated full fills
            </span>
            <span>Slippage {slippage || "—"} bps · min fill step 0</span>
          </div>
          {monitor.busy && (
            <progress
              className="ipd-progress"
              aria-label="Scan progress"
              max={rows.length || 1}
              value={monitor.completed}
            />
          )}
          <div
            className="table-scroll ipd-table-scroll"
            role="region"
            aria-label="Directional IPD estimates"
            tabIndex={0}
          >
            <table className="ipd-table">
              <caption className="sr-only">
                Exact order estimates on Miden mainnet
              </caption>
              <thead>
                <tr>
                  <th scope="col">Direction</th>
                  <th scope="col">Offered amount</th>
                  <th scope="col">Minimum receive</th>
                  <th scope="col">Estimate / receive</th>
                  <th scope="col">Checked</th>
                  <th scope="col">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((row) => {
                  const check = monitor.checks[row.id];
                  const open = expanded === row.id;
                  const amount =
                    customAmounts[row.id] ??
                    (check?.offeredAmount
                      ? tokenAmount(check.offeredAmount, row.offered.decimals)
                      : "");
                  const label = `${row.offered.ticker} to ${row.requested.ticker}`;
                  const estimate = check?.estimate;
                  const shownOutput =
                    estimate?.fillStatus === "partial"
                      ? estimate.fillableRequestedAmount
                      : estimate?.fillStatus === "full"
                        ? estimate.expectedRequestedAmount
                        : null;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        data-direction={row.id}
                        className={open ? "expanded" : undefined}
                      >
                        <th scope="row" className="ipd-direction">
                          <span>
                            {row.offered.ticker}{" "}
                            <ArrowRight size={14} aria-hidden="true" />{" "}
                            {row.requested.ticker}
                          </span>
                          <small>{row.name}</small>
                        </th>
                        <td data-label="Offered amount">
                          <label
                            className="sr-only"
                            htmlFor={`amount-${row.id}`}
                          >
                            Offered amount for {label}
                          </label>
                          <input
                            id={`amount-${row.id}`}
                            className="ipd-amount"
                            inputMode="decimal"
                            value={amount}
                            placeholder={`≈ $${notional}`}
                            onChange={(event) =>
                              setCustomAmounts((previous) => ({
                                ...previous,
                                [row.id]: event.target.value,
                              }))
                            }
                          />
                          <small>
                            {row.offered.ticker} ·{" "}
                            {customAmounts[row.id] === undefined
                              ? `≈ $${notional} preset`
                              : "custom"}
                          </small>
                          {customAmounts[row.id] !== undefined && (
                            <button
                              className="ipd-reset"
                              onClick={() =>
                                setCustomAmounts((previous) => {
                                  const next = { ...previous };
                                  delete next[row.id];
                                  return next;
                                })
                              }
                            >
                              Use preset
                            </button>
                          )}
                        </td>
                        <td data-label="Minimum receive">
                          <span className="amount">
                            {tokenAmount(
                              check?.input?.requestedAmount,
                              row.requested.decimals,
                            )}
                          </span>
                          <small>
                            {row.requested.ticker} ·{" "}
                            {check?.policy.slippageBps ?? slippage} bps · step 0
                          </small>
                        </td>
                        <td data-label="Estimate">
                          <span
                            className={`ipd-status ipd-${check?.status ?? "pending"}`}
                          >
                            <span className="status-dot" />
                            {check
                              ? statusLabels[check.status]
                              : monitor.busy
                                ? "Checking…"
                                : "Not checked"}
                          </span>
                          {shownOutput && (
                            <small>
                              {check?.status === "stale" ? "Historical: " : ""}
                              {estimate?.fillStatus === "partial"
                                ? "Partial receive: "
                                : "Full receive: ≈ "}
                              {tokenAmount(shownOutput, row.requested.decimals)}{" "}
                              {row.requested.ticker}
                            </small>
                          )}
                          {estimate?.fillStatus === "partial" && (
                            <small>
                              Fills{" "}
                              {tokenAmount(
                                estimate.fillableOfferedAmount,
                                row.offered.decimals,
                              )}{" "}
                              of{" "}
                              {tokenAmount(
                                estimate.offeredAmount,
                                row.offered.decimals,
                              )}{" "}
                              {row.offered.ticker}
                            </small>
                          )}
                          {check && !estimate && (
                            <small className="ipd-row-error">
                              {check.message}
                            </small>
                          )}
                        </td>
                        <td data-label="Checked" className="timestamp">
                          {check ? (
                            <>
                              <time
                                dateTime={new Date(
                                  check.checkedAt,
                                ).toISOString()}
                              >
                                {time(check.checkedAt)}
                              </time>
                              <small>
                                {Math.max(
                                  0,
                                  Math.floor(
                                    (monitor.now - check.checkedAt) / 1000,
                                  ),
                                )}
                                s ago
                              </small>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="detail-toggle">
                          <button
                            className="icon-button"
                            aria-label={`Details for ${label}`}
                            aria-expanded={open}
                            aria-controls={`details-${row.id}`}
                            onClick={() => setExpanded(open ? null : row.id)}
                          >
                            <ChevronDown
                              size={16}
                              className={open ? "rotated" : ""}
                            />
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="detail-row" id={`details-${row.id}`}>
                          <td colSpan={6}>
                            <ResultDetails
                              row={row}
                              check={check}
                              settings={settings}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {catalog && displayed.length === 0 && (
              <div className="empty-state">
                No directions match these filters. Change the filters to check
                another pair.
              </div>
            )}
          </div>
        </section>
        <details className="ipd-limitations">
          <summary>What this estimate covers</summary>
          <p>
            The accepted solver book includes eligible Pragma orders and other
            counterparties anonymously. No executable liquidity means no
            eligible depth for this exact order; it does not identify a maker
            outage. Supported pairs and reference prices alone do not prove
            fillability.
          </p>
          <p>
            V2 can expose the original fixed-midpoint mismatch when no other
            eligible liquidity exists. It omits opposite orders’ minimum-fill
            and all-or-nothing constraints, maker self-trade filtering, and some
            cap, admission and fallback behavior. A maker offering 10 tokens
            all-or-nothing may look sufficient for a user buying 1 even when
            that partial settlement cannot execute.
          </p>
          <p>
            These are estimates, not reservations or settlement guarantees. A
            tolerated result waits for a favourable price move. The
            clearing-band width and running solver build are not exposed by this
            panel. Future accuracy work could use a shared, side-effect-free
            matcher preview; this dashboard does not run a second matcher.
          </p>
        </details>
        <footer className="page-footer">
          <span>
            IPD v2 · {settings?.upstream ?? "mainnet solver"} · session-only
            observations
          </span>
          <span>Read-only GETs · no wallet or transactions</span>
        </footer>
      </main>
    </>
  );
}
