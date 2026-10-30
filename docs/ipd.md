# IPD availability monitor

The panel answers whether the solver estimates a full, partial or absent fill for
one exact direction, offered amount and minimum receive. It queries the accepted
book, including eligible Pragma orders and other counterparties anonymously.
It has no signer, account creation, notes, orders, cancellation or settlement path.

## Run locally

Node 22.18+ and npm are the existing repository tools:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000/ipd`. The original Epoch page remains at `/`.
`NEXT_PUBLIC_BASE_PATH=/epoch` changes those URLs to `/epoch/ipd` and `/epoch`;
the prefix is a build-time setting and is also applied to adapter requests and
navigation. No `assetPrefix` is configured. Browser tests exercise `/epoch`.

The existing public host would serve the panel at
`https://185.249.225.58/epoch/ipd` **after a separately authorized deployment**.
This task did not publish that route, change the nginx proxy or modify auth.
AggLayer is a separate application and is not present in this checkout.

## Configuration and identity

| Server setting                | Default                      | Meaning                                                                                                                                               |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IPD_NETWORK`                 | `mainnet`                    | Other networks are rejected.                                                                                                                          |
| `IPD_MAINNET_URL`             | `https://api.forkchoice.xyz` | Fixed upstream origin; browsers cannot select it. HTTPS required, except loopback fixture servers. No credentials, path, query or redirect following. |
| `IPD_OBSERVATION_TTL_SECONDS` | `120`                        | Displayed observation lifetime.                                                                                                                       |
| `IPD_PRICE_MAX_AGE_SECONDS`   | `30`                         | Maximum construction/valuation source-price age. Future timestamps beyond 5 seconds are rejected.                                                     |

TTL settings accept integer seconds from 1–3600. Restart after server setting
changes. Keep the default TTL for operational monitoring unless intentionally
changing the observation policy. No `.env.local` values or credentials were
changed by this task.

The [published mainnet configuration](https://github.com/0xMiden/wallet-config/blob/main/mainnet.json)
still advertised this solver on 2026-10-30 (version 16). `/v2/pairs` determines
the supported matrix: exactly two directions per listed pair, not a Cartesian
product. The existing verified mainnet token registry anchors identity and
decimals by faucet ID. New unverified faucets, missing/invalid decimals or
disagreements remain visible but unavailable for checks; update the verified
registry after reviewing a legitimate token addition. Tickers are labels only.
Malformed metadata does not remove unrelated usable rows.

## Amount, limit and minimum-fill policy

- Initial preset is approximately **$10**, with $1 and $100 choices. Only the
  selected size is checked. Every direction also accepts an exact custom token
  amount. Selecting a new preset clears custom overrides and creates new checks.
- Presets use `/v1/prices?ids=...&precision=full`, with at most 50 identities per
  batch. This endpoint is for valuation only; availability uses **only v2**.
  The batch shape is an ID-keyed object. Singular valuation is not used.
  Missing, omitted or stale valuations cannot produce a preset; a custom amount
  remains possible. USD is approximate using USDT, with no stablecoin peg assumption.
- Offered units are `floor(notionalUSDT × 10^offeredDecimals / valuationPrice)`.
- Slippage starts at **5 bps (0.05%)**, editable from 1–100 whole bps. The current
  public [Bread slippage source](https://github.com/0xMiden/wallet/blob/main/src/lib/miden/swap/slippage-bounds.ts)
  and the supplied `3700fdb` pin both matched on 2026-10-30. This does not identify
  the wallet build shipped to any particular user.
- Each direction fetches its own `/v2/pair-price`. No reciprocal approximation.
  `requested = floor(A × fillPrice × (10000−bps) × 10^dR / (10000 × 10^dO))`.
  `fillPrice` already includes the fee; the adapter applies no second fee.
- `min_fill_step=0` requested-token base units. This means no additional minimum
  for the hypothetical taker. It is neither a maker minimum nor all-or-nothing.
- All amount/price calculations use BigInt rational scaling. Zero, negative,
  malformed, excess-precision, sub-unit, u64-overflow and rounded-to-zero minimum
  amounts fail before `/v2/swap-eta`. Displayed amounts are exact, not rounded.

## Interpretation

Every result is an estimate with its check time. Liquidity is not reserved;
execution can differ. The `priceBand` enum does not disclose a numeric band width.

| Display                  | Meaning                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Invalid / failed / stale | Input, identity, schema, transport or freshness problem. Never inferred missing liquidity.                               |
| Unsupported pair         | Explicit `no_market`, including a typed HTTP 503 error.                                                                  |
| Price unavailable        | `no_price`, stale construction price, or an uncomputable preset.                                                         |
| Solver starting / busy   | Typed `not_ready` / `overloaded`, rate limiting or cooldown.                                                             |
| Settlement delayed       | Executor paused; underlying fill and reason stay in details.                                                             |
| Limit no longer matches  | `off_market` or reason `price`; refresh rebuilds the limit.                                                              |
| No executable liquidity  | `none/liquidity` for this exact order; not a maker diagnosis.                                                            |
| Waiting for price move   | `tolerated` with full/partial; not currently available.                                                                  |
| Estimated partial fill   | `at_market/partial`; amber, showing the fillable amounts and unfilled portion.                                           |
| Estimated full fill      | Green only for a valid current `at_market/full`, reason null, running executor, coherent prices and echoed exact inputs. |

Partial receive is `fillableRequestedAmount` at the note's own ratio. Full-order
`expectedRequestedAmount` is not substituted for partial proceeds. Full fills
may receive the selected batch rate after fees. Details separate the Binance
source-price time from observation time; neither proves maker/book freshness.
Capacity is at this limit after priority, not total pair TVL. ETA/history are
nullable advisory summaries, not evidence this swap settled.

## Requests, caching and lifecycle

`GET /api/ipd/catalog` returns validated catalog and public settings.
`POST /api/ipd/scan` accepts mainnet IDs, selected preset, per-direction custom
amounts and slippage, then streams NDJSON row results. It follows the existing
quote adapter's same-origin check. Every upstream operation is a public GET.

- Global per-process limiter: **two actual upstream HTTP requests**, including
  catalog, valuation, prices and estimates. Browser tabs share the limiter and
  cooldown. Multiple server processes would each have their own limiter; a
  distributed limiter is outside this local feature's scope.
- Pair metadata: at most 300 seconds. Directional prices: at most 1 second,
  deduplicated in flight. A stricter upstream max-age/no-cache/no-store or Age
  header shortens reuse. Failed or invalid results are not cached.
- Valuations: one batch per unique offered token group in a scan; not reused
  across scans. Estimates are always `no-store`, never cached or extrapolated.
- Upstream timeout: 10 seconds, including queue wait. Per-row check budget:
  20 seconds for construction price and exact verdict. Shared catalog/valuation
  preparation happens before row checks and has its own bounded 20-second
  request budget. At most one transient retry per budget, if it fits. No retries
  for 400/404 or permanent typed errors. Retry-After sets a shared cooldown;
  a delay beyond the budget yields a deferred result instead of an early retry.
- Default auto-refresh is **off**. Optional refresh waits 60 seconds after the
  previous scan completes and runs only while visible. Scans cannot overlap
  in a page. Input edits cancel immediately and debounce 450 ms before checking.
  Asset/offering filters narrow the scan. Status filtering pauses an active scan
  and filters its received observations; use Refresh to finish a new scan.
- Pause/unmount/hiding cancels work. Generations and policy identities prevent
  obsolete responses overwriting edited inputs. Hiding marks received results
  stale, even before expiry. A manual refresh clears old observations immediately;
  a failed refresh never leaves a prior green result current.
- Age advances every second; default expiry is 120 seconds. Results live only in
  this browser session. Nothing persists to a database or background collector.

## Accuracy limits and original-incident evidence

V2 considers usable depth at a selected clearing price. It would detect the
original fixed-mid mismatch when no other eligible liquidity exists. Other
eligible counterparties can keep aggregate availability positive even when a
particular maker cannot fill; the panel makes no maker attribution.

The deterministic regression fixtures represent both maker asks above mid and
bids below mid: a successful price lookup plus `at_market/none/liquidity` stays
red, while the corresponding sufficient-band `at_market/full` response becomes
estimated full. These verify dashboard interpretation, not the solver's matching
implementation. The upstream Rust regression named
`swap_eta_with_a_band_fills_a_buyer_at_the_makers_ask` was referenced in the task;
**we did not execute the Rust solver tests or modify its band**.

The public v2 estimator omits opposite orders' minimum-fill/all-or-nothing
constraints, maker self-trade filtering and some admission, per-side cap and
fallback behavior. A maker offering 10 base all-or-nothing may appear sufficient
for a user buying 1 even though that settlement cannot execute. The UI exposes
this gap; it does not invent a failure verdict or implement a second matcher.
A possible accuracy follow-up is a shared, side-effect-free matcher preview.
Maker-specific attribution and guaranteed/actual settlement analytics remain
outside scope. Running solver build, maker sizes and numeric band widths were
not inferred.

## Verification

```sh
npm test
npm run typecheck
npm run test:browser
npm run build
# Optional public network corroboration, never run by the deterministic suite:
npm run test:ipd:live
```

Install the browser once with `npx playwright install chromium` if needed.
The browser runner starts loopback fixture port 4419 and Next dev port 3108 under
`/epoch`; it shuts both down on completion. It requires permission to bind local
ports and launch Chromium. No public solver is contacted by automated fixtures.
There is no pre-existing lint command/config in this repo; targeted Prettier
checking plus strict TypeScript and `git diff --check` are the recorded replacement.

See [implementation and verification record](ipd-implementation.md) for baseline,
final commands and evidence. Local ignored artifacts include
`artifacts/ipd/desktop.png`, `mobile.png`, `live-smoke.json`, and browser failure
traces when applicable. Screenshots show **synthetic fixture data**, not live
market claims. The opt-in smoke tests one current catalog pair in both directions
at ≈$10, 5 bps, step 0 and saves exact input/response/timestamps locally. It fails
on malformed/invalid responses but does not require a positive liquidity result.

## Deployment review and rollback — not executed

Before a separately authorized rollout: review this local branch, retain existing
authentication/rate limits, build with `NEXT_PUBLIC_BASE_PATH=/epoch`, and retain
the normal single-process limit assumption. Existing nginx `/epoch/` forwarding
already includes the new page and APIs; streaming uses `X-Accel-Buffering: no`.
No production proxy, secrets, service restart or Vercel action was performed.

Rollback is the preceding application build/source: no database migration,
external orders or persistent IPD state need reversal. Remove the navigation
link and IPD routes/modules as one change if rolling back source selectively.
The original Epoch adapter, catalog, defaults and lifecycle are untouched.

## Maintainer summary for Philipp

The dashboard now has an IPD panel that checks exact direction/size/limit
through mainnet `/v2/pair-price` and `/v2/swap-eta`. It includes eligible accepted
Pragma liquidity anonymously, distinguishes unavailable depth from stale prices,
errors and paused settlement, and reproduces the fixed-mid failure classification
with deterministic fixtures in both directions. No orders or trades were sent.
The estimator's maker-minimum/all-or-nothing gap remains explicit. Local checks
are documented in the repository; raw evidence stays in the local workspace.
Publishing was subsequently authorized, including a push to the public repository
and Vercel deployment verification.
