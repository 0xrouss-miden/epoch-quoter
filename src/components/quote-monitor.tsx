"use client";
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  Pause,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Asset, Catalog, Quote } from "@/lib/types";
import { displayAmount, toAtomic } from "@/lib/amount";
import { useMonitor } from "@/lib/use-monitor";

const pageSize = 30;
const statusNames = {
  available: "Available",
  unavailable: "No quote",
  error: "Error",
};
function CopyJsonButton({
  label,
  value,
  title,
}: {
  label: string;
  value: unknown;
  title?: string;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copied !== "copied") return;
    const timer = setTimeout(() => setCopied("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    if (value === undefined) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <button
      className="button subtle"
      onClick={() => void copy()}
      disabled={value === undefined}
      aria-label={label}
      title={title}
    >
      {copied === "copied" ? <Check size={14} /> : <Copy size={14} />}
      <span aria-live="polite">
        {copied === "copied"
          ? "Copied"
          : copied === "failed"
            ? "Copy failed · retry"
            : label}
      </span>
    </button>
  );
}
function AssetName({ asset, amount }: { asset: Asset; amount?: string }) {
  return (
    <div className="asset">
      <span
        className={`asset-icon ${asset.chain === "Miden" ? "miden" : ""}`}
        aria-hidden="true"
      >
        {asset.chain === "Miden" ? <MidenMark /> : asset.symbol.slice(0, 1)}
      </span>
      <span>
        <strong>
          {amount && (
            <span className="mobile-input">{displayAmount(amount)} </span>
          )}
          {asset.symbol}
        </strong>
        <small>{asset.chain}</small>
      </span>
    </div>
  );
}
function MidenMark() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 14V6h4v8m0-8h4v8m0-8h4v8"
        stroke="currentColor"
        strokeWidth="2.3"
      />
    </svg>
  );
}
function time(value: string | number) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function Amount({ value, symbol }: { value?: string; symbol: string }) {
  return value ? (
    <span className="amount" title={`${value} ${symbol}`}>
      {displayAmount(value)} <span>{symbol}</span>
    </span>
  ) : (
    <span className="muted">—</span>
  );
}
function Status({ quote, checking }: { quote?: Quote; checking: boolean }) {
  return (
    <span
      className={`status ${checking ? "checking" : (quote?.status ?? "pending")}`}
    >
      <span className="status-dot" />
      {checking ? "Checking" : quote ? statusNames[quote.status] : "Pending"}
    </span>
  );
}

export function QuoteMonitor({ catalog }: { catalog: Catalog }) {
  const [amounts, setAmounts] = useState(catalog.amounts);
  const [draftAmounts, setDraftAmounts] = useState(catalog.amounts);
  const [showAmounts, setShowAmounts] = useState(false);
  const [amountError, setAmountError] = useState("");
  const [direction, setDirection] = useState("both");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [chain, setChain] = useState("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const monitor = useMonitor(catalog.routes, amounts);
  const chains = useMemo(
    () =>
      [
        ...new Set(
          catalog.routes.map((route) =>
            route.direction === "to-miden"
              ? route.source.chain
              : route.destination.chain,
          ),
        ),
      ].sort(),
    [catalog.routes],
  );
  const matching = useMemo(
    () =>
      catalog.routes.filter((route) => {
        if (direction !== "both" && route.direction !== direction) return false;
        if (
          chain !== "all" &&
          route.source.chain !== chain &&
          route.destination.chain !== chain
        )
          return false;
        const term = search.toLowerCase().trim();
        return (
          !term ||
          `${route.source.symbol} ${route.destination.symbol} ${route.source.chain} ${route.destination.chain}`
            .toLowerCase()
            .includes(term)
        );
      }),
    [catalog.routes, direction, chain, search],
  );
  const counts = matching.reduce(
    (acc, route) => {
      const quote = monitor.quotes[route.id];
      acc[quote?.status ?? "pending"]++;
      return acc;
    },
    { available: 0, unavailable: 0, error: 0, pending: 0 },
  );
  const filtered = matching.filter(
    (route) =>
      status === "all" ||
      (monitor.quotes[route.id]?.status ?? "pending") === status,
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  function filter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(0);
  }
  function applyAmounts(event: FormEvent) {
    event.preventDefault();
    try {
      for (const [symbol, amount] of Object.entries(draftAmounts)) {
        const decimals = Math.min(
          ...catalog.routes
            .filter((route) => route.source.symbol === symbol)
            .map((route) => route.source.decimals),
        );
        try {
          toAtomic(amount, decimals);
        } catch (error) {
          throw new Error(
            `${symbol}: ${error instanceof Error ? error.message : "Invalid amount."}`,
          );
        }
      }
      setAmounts({ ...draftAmounts });
      setShowAmounts(false);
      setAmountError("");
    } catch (error) {
      setAmountError(
        error instanceof Error ? error.message : "Check the amounts.",
      );
    }
  }
  function exportQuotes() {
    const rows = filtered.map((route) => ({
      ...route,
      quote: monitor.quotes[route.id] ?? null,
    }));
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), routes: rows },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `epoch-quotes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <header className="app-header">
        <a
          href={process.env.NEXT_PUBLIC_BASE_PATH || "/"}
          className="brand"
          aria-label="Epoch quotes home"
        >
          <span className="brand-mark">
            <MidenMark />
          </span>
          <span>
            Epoch <span className="brand-divider">/</span>{" "}
            <span className="brand-secondary">Miden</span>
          </span>
        </a>
        <a
          className="text-link"
          href="https://docs.epochprotocol.xyz/supported-chains-and-tokens"
          target="_blank"
          rel="noreferrer"
        >
          Epoch docs <ArrowUpRight size={14} />
        </a>
      </header>
      <main>
        <section className="page-heading">
          <div>
            <h1>Quotes</h1>
            <div className="scan-status" role="status" aria-live="polite">
              <span
                className={`live-dot ${monitor.busy ? "is-running" : monitor.paused ? "is-paused" : ""}`}
              />
              {monitor.waiting
                ? "Rate limited · retrying automatically"
                : monitor.busy
                  ? `Checking ${monitor.completed} of ${catalog.routes.length}`
                  : monitor.paused
                    ? "Paused"
                    : monitor.finishedAt
                      ? `Checked at ${time(monitor.finishedAt)}`
                      : "Starting…"}
            </div>
          </div>
          <div className="heading-actions">
            <label className="refresh-label">
              <RefreshCw size={14} />
              <span className="sr-only">Automatic refresh after each scan</span>
              <select
                value={monitor.interval}
                onChange={(event) =>
                  monitor.setIntervalSeconds(Number(event.target.value))
                }
              >
                <option value={0}>Auto-refresh off</option>
                <option value={60}>Every minute</option>
                <option value={300}>Every 5 min</option>
                <option value={900}>Every 15 min</option>
              </select>
            </label>
            {monitor.busy ? (
              <button className="button" onClick={monitor.pause}>
                <Pause size={15} /> Pause
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => void monitor.scan()}
              >
                <RefreshCw size={15} /> Refresh
              </button>
            )}
          </div>
        </section>
        {monitor.error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={17} />
            {monitor.error}
          </div>
        )}
        <section className="workspace" aria-label="Quote monitor">
          <div className="toolbar">
            <span className="network-scope">Mainnet</span>
            <button
              className={`button subtle ${showAmounts ? "is-active" : ""}`}
              onClick={() => {
                setShowAmounts(!showAmounts);
                setDraftAmounts(amounts);
                setAmountError("");
              }}
              aria-expanded={showAmounts}
              aria-controls="amount-controls"
            >
              <SlidersHorizontal size={15} /> Amounts{" "}
              <ChevronDown size={14} className={showAmounts ? "rotated" : ""} />
            </button>
          </div>
          {showAmounts && (
            <form
              className="amount-controls"
              id="amount-controls"
              onSubmit={applyAmounts}
            >
              <div className="amount-heading">
                <div>
                  <h2>Input amounts</h2>
                  <p>Applied per source token.</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close amount controls"
                  onClick={() => setShowAmounts(false)}
                >
                  <X size={17} />
                </button>
              </div>
              <div className="amount-grid">
                {Object.entries(draftAmounts).map(([symbol, value]) => (
                  <label key={symbol}>
                    {symbol}
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      value={value}
                      onChange={(event) =>
                        setDraftAmounts((previous) => ({
                          ...previous,
                          [symbol]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="amount-footer">
                {amountError && (
                  <p className="form-error" role="alert">
                    {amountError}
                  </p>
                )}
                <button
                  type="button"
                  className="button subtle"
                  onClick={() => setDraftAmounts(catalog.amounts)}
                >
                  Reset
                </button>
                <button className="button primary" type="submit">
                  Apply & refresh
                </button>
              </div>
            </form>
          )}
          <div className="filterbar">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search tokens or chains"
                placeholder="Search tokens or chains"
                value={search}
                onChange={(event) => filter(setSearch, event.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => filter(setSearch, "")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <label className="select-field">
              <span className="sr-only">Direction</span>
              <select
                value={direction}
                onChange={(event) => filter(setDirection, event.target.value)}
              >
                <option value="both">Both directions</option>
                <option value="to-miden">To Miden</option>
                <option value="from-miden">From Miden</option>
              </select>
            </label>
            <label className="select-field chain-filter">
              <span className="sr-only">Chain</span>
              <select
                value={chain}
                onChange={(event) => filter(setChain, event.target.value)}
              >
                <option value="all">All chains</option>
                {chains.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              className="icon-button export-button"
              title="Export filtered quotes"
              aria-label="Export filtered quotes as JSON"
              onClick={exportQuotes}
            >
              <Download size={17} />
            </button>
          </div>
          <div className="results-bar">
            <div className="status-filters" aria-label="Quote status">
              {[
                ["all", "All", matching.length],
                ["available", "Available", counts.available],
                ["unavailable", "No quote", counts.unavailable],
                ["error", "Errors", counts.error],
                ["pending", "Pending", counts.pending],
              ].map(([value, label, count]) => (
                <button
                  key={value}
                  className={status === value ? "active" : ""}
                  aria-pressed={status === value}
                  onClick={() => filter(setStatus, String(value))}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                Epoch quotes between Miden and EVM chains
              </caption>
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th className="arrow-cell">
                    <span className="sr-only">to</span>
                  </th>
                  <th scope="col">To</th>
                  <th scope="col" className="numeric input-column">
                    Send
                  </th>
                  <th scope="col" className="numeric">
                    Receive
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="checked-column">
                    Checked
                  </th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((route) => {
                  const quote = monitor.quotes[route.id];
                  const checking = monitor.activeIds.has(route.id);
                  const open = expanded === route.id;
                  return (
                    <Fragment key={route.id}>
                      <tr
                        className={`${open ? "expanded" : ""} ${checking ? "row-checking" : ""}`}
                      >
                        <td>
                          <AssetName
                            asset={route.source}
                            amount={
                              quote?.amountIn ?? amounts[route.source.symbol]
                            }
                          />
                        </td>
                        <td className="arrow-cell">
                          <ArrowRight size={15} />
                        </td>
                        <td>
                          <AssetName asset={route.destination} />
                        </td>
                        <td className="numeric input-column">
                          <Amount
                            value={
                              quote?.amountIn ?? amounts[route.source.symbol]
                            }
                            symbol={route.source.symbol}
                          />
                        </td>
                        <td className="numeric receive-cell">
                          <Amount
                            value={
                              quote?.status === "available"
                                ? quote.amountOut
                                : undefined
                            }
                            symbol={route.destination.symbol}
                          />
                        </td>
                        <td>
                          <Status quote={quote} checking={checking} />
                        </td>
                        <td className="checked-column timestamp">
                          {quote ? (
                            <time
                              dateTime={quote.checkedAt}
                              title={new Date(quote.checkedAt).toLocaleString()}
                            >
                              {time(quote.checkedAt)}
                            </time>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="detail-toggle">
                          <button
                            className="icon-button"
                            aria-label={`${open ? "Hide" : "Show"} ${route.source.symbol} on ${route.source.chain} to ${route.destination.symbol} on ${route.destination.chain} ${route.environment} details`}
                            aria-expanded={open}
                            onClick={() => {
                              setExpanded(open ? null : route.id);
                            }}
                          >
                            <ChevronDown
                              size={16}
                              className={open ? "rotated" : ""}
                            />
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="detail-row">
                          <td colSpan={8}>
                            <div className="route-detail">
                              <div className="detail-header">
                                <h3>Route details</h3>
                                <div className="detail-actions">
                                  <CopyJsonButton
                                    label="Copy JSON"
                                    value={{ route, quote: quote ?? null }}
                                    title="Copy route details and the processed quote"
                                  />
                                  <CopyJsonButton
                                    label="Copy Epoch response"
                                    value={quote?.rawResponse}
                                    title={
                                      quote?.rawResponse === undefined
                                        ? "No JSON response from Epoch is available for this quote"
                                        : "Copy the full JSON response from Epoch"
                                    }
                                  />
                                </div>
                              </div>
                              {quote?.message && (
                                <p
                                  className={`quote-message ${quote.status === "error" ? "is-error" : ""}`}
                                >
                                  <CircleAlert size={15} />
                                  {quote.message}
                                </p>
                              )}
                              <dl>
                                <div>
                                  <dt>Endpoint</dt>
                                  <dd>
                                    {catalog.endpoints[route.environment]}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Input</dt>
                                  <dd>
                                    {quote?.amountIn ??
                                      amounts[route.source.symbol]}{" "}
                                    {route.source.symbol}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Source token</dt>
                                  <dd className="address">
                                    {route.source.address}{" "}
                                    <span>
                                      ({route.source.decimals} decimals)
                                    </span>
                                  </dd>
                                </div>
                                <div>
                                  <dt>Destination token</dt>
                                  <dd className="address">
                                    {route.destination.address}{" "}
                                    <span>
                                      ({route.destination.decimals} decimals)
                                    </span>
                                  </dd>
                                </div>
                                {quote && (
                                  <div>
                                    <dt>Checked</dt>
                                    <dd>
                                      {new Date(
                                        quote.checkedAt,
                                      ).toLocaleString()}
                                    </dd>
                                  </div>
                                )}
                                {quote && (
                                  <div>
                                    <dt>Response time</dt>
                                    <dd>
                                      {(quote.durationMs / 1000).toFixed(2)} s
                                      {quote.code && ` · ${quote.code}`}
                                    </dd>
                                  </div>
                                )}
                              </dl>
                              {quote?.paths != null && (
                                <details className="raw-details">
                                  <summary>
                                    Quote paths
                                    {quote.pathCount
                                      ? ` (${quote.pathCount})`
                                      : ""}
                                  </summary>
                                  <pre>
                                    {JSON.stringify(quote.paths, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!visible.length && (
              <div className="empty-state">
                <Search size={25} />
                <h2>No matching routes</h2>
                <p>
                  {status === "available" && monitor.busy
                    ? "Quotes will appear here as the scan completes."
                    : "Try another filter or refresh the quotes."}
                </p>
                <button
                  className="button"
                  onClick={() => {
                    setSearch("");
                    setChain("all");
                    setDirection("both");
                    setStatus("all");
                    setPage(0);
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
          <div className="table-footer">
            <span>
              {filtered.length
                ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length}`
                : "0 routes"}
            </span>
            <div className="pagination">
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {currentPage + 1} / {lastPage + 1}
              </span>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={currentPage >= lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </section>
        <footer className="page-footer">
          <span>
            {catalog.routes.length} candidate routes{" "}
            <span className="footer-separator">·</span> Epoch catalog{" "}
            {catalog.version}
          </span>
          <span>Quotes refresh while this page is open.</span>
        </footer>
      </main>
    </>
  );
}
