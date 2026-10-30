# IPD implementation record

## Baseline and plan

- Private repository: `0xrouss-miden/epoch-quoter`; clean `main` at
  `9db39faea1da7d5cd8777d146a49794ed50fdb0c`; local branch `pablo/ipd-availability`.
- Baseline: `npm run typecheck`, `npm test` (5 tests), `npm run build` passed.
  No lint script, browser runner, middleware, authentication implementation, or
  AggLayer implementation exists in this checkout. Preserve deployment auth/proxy.
- Existing owners: `src/components/quote-monitor.tsx`, `src/lib/use-monitor.ts`,
  `src/app/api/quote/route.ts`, `src/lib/catalog.ts`.
- Routing: `next.config.ts` reads build-time `NEXT_PUBLIC_BASE_PATH`; no assetPrefix.
  Existing nginx forwards all `/epoch/` paths. New page is `/ipd` locally and
  `/epoch/ipd` under that prefix. No proxy changes required or authorized.

File-level plan (recorded before implementation):

1. `src/lib/ipd/amounts.ts`, `contract.ts`, `types.ts`: exact u64 amount math,
   runtime validation and separate validity/fillability/executor data.
2. `config.ts`, `client.ts`, `service.ts`: fixed server upstream, verified mainnet
   identities, bounded shared HTTP queue, caching/cooldown, streamed exact checks.
3. `src/app/api/ipd/{catalog,scan}/route.ts`: same-origin read-only adapter.
4. `use-ipd-monitor.ts`, `components/ipd-monitor.tsx`, `app/ipd/page.tsx`:
   cancellable scan generations, expiry, controls and accessible result details.
   Shared navigation added without altering Epoch requests or defaults.
5. `tests/ipd*.test.ts`, browser fixtures: independent arithmetic/contract checks,
   actual adapter transport tests, browser lifecycle and original-incident fixtures.
6. `docs/ipd.md`, `.env.example`: operator policy, evidence, local commands,
   deployment/rollback notes. No commits, pushes, PRs or deployment.

Test authoring scope: arithmetic owns scaling/rounding; adapter tests own public
HTTP validation, classifications and queue behavior; browser tests own rendered
states, edits, cancellation, visibility and expiry. Fixtures exercise these
boundaries, not a simulated matching algorithm. Existing tests cover Epoch.

## Initial live contract checks — 2026-10-30

Mainnet wallet configuration (`wallet-config/main/mainnet.json`, version 16)
advertises `swap.etaUrl=https://api.forkchoice.xyz`. The catalog returned 7 tokens
and 11 pairs at inspection (dynamic observations, not application constants).

At 09:32:35–09:32:56 UTC, public GETs confirmed batch valuation snake_case,
directional pair-price camelCase/exact strings, `max-age=1`, and v2 estimate
`no-store`. USDT → ETH, offered `10000000`, minimum `449192`, step `0`, returned
`at_market / none / liquidity`, executor running. The minimum was constructed
from the preceding price at 5 bps; price moved between calls. This is advisory
connectivity/schema evidence, not a trade or a stable liquidity assertion.

The pinned Bread slippage file confirms initial 5 bps and range 1–100. A current
shipped wallet version is not inferred from that pin. The supplied solver docs
were accessible; their example devnet URL is deliberately not used.

## Final verification ledger — 2026-10-30

| Gate / exact command                                        | Result                                                | Evidence type                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                         | PASS                                                  | Strict TypeScript, final source.                                                                                |
| `npm test`                                                  | PASS, 17 tests                                        | 12 IPD + 5 unchanged Epoch tests; mocked HTTP.                                                                  |
| `npm run test:browser`                                      | PASS, 5 scenarios (13.0 seconds final run)            | Chromium + actual Next adapter + local mock solver at `/epoch`.                                                 |
| `NEXT_PUBLIC_BASE_PATH=/epoch npm run build`                | PASS                                                  | Production route table includes existing `/`, catalog/quote APIs, new `/ipd` and IPD APIs.                      |
| `git diff --check`                                          | PASS                                                  | Whitespace check.                                                                                               |
| `npm run test:ipd:live`                                     | PASS, 09:58:53–09:58:55 UTC / 10:58:53–10:58:55 Paris | Public mainnet GETs through the implemented service, ≈$10, 5 bps, step 0, both first supported pair directions. |
| `NEXT_PUBLIC_BASE_PATH=/epoch npm run start -- --port 3109` | PASS, left running locally                            | Loopback production build, no deployment.                                                                       |

The local production HTTP smoke used Node `fetch` against
`http://127.0.0.1:3109/epoch`, `/epoch/ipd`, and `/epoch/api/catalog`: all HTTP 200.
It asserted the IPD heading, all 12 asset references starting `/epoch/_next/`,
and HTTP 200 for a referenced asset. HTML fetches do not start browser scans.
**Actual running review URL: `http://127.0.0.1:3109/epoch/ipd`.**

Formatting replacement for the absent lint gate passed with this exact command:

```sh
npx --no-install prettier --check src/lib/ipd src/lib/use-ipd-monitor.ts src/components/ipd-monitor.tsx src/components/dashboard-nav.tsx src/components/dashboard-nav.module.css src/components/quote-monitor.tsx src/app/ipd src/app/api/ipd tests/ipd.test.ts tests/ipd-client.test.ts tests/fixtures tests/browser playwright.config.ts scripts/ipd-smoke.ts package.json docs/ipd.md docs/ipd-implementation.md
```

No pre-existing failures were found. Initial browser launch hit sandbox `EPERM`
binding loopback, resolved by the local execution permission. During authoring,
a test table typo and the smoke script's CommonJS top-level-await incompatibility
were fixed. First browser assertions were corrected to distinguish Next's route
announcer from the app alert, pause before an eligible visibility-return refresh,
and count unique Epoch routes despite development Strict Mode's cancelled starts.
The mobile toolbar/summary spacing was corrected in IPD-scoped CSS. Final checks
above pass. A final diagnostic improvement retains the computed offered amount and attempted pair-price URL when pricing fails; the focused assertion, browser suite and production build were rerun successfully. No assertion was weakened to hide a feature failure.

Browser coverage includes the six principal states; correct partial proceeds;
keyboard disclosure; 390px viewport without page overflow; size/amount/policy
edits; cancellation of old generations; missing valuation with custom fallback;
failed refresh removing green; clock-driven expiry and visibility events;
pause/60-second auto-refresh; and unchanged Epoch routes, amounts and navigation.
Browser clocks/visibility and solver responses are deterministic fixtures.
This is not a real settlement or an assistive-technology certification.

The exact fixed-mid illustration uses buyer `100.02 quote → 1 base` against ask
`100.01`, and seller `1 base → 99.98 quote` against bid `99.99`, reference mid 100.
Stipulated band-0 `at_market/none/liquidity` remains red; stipulated band-30
`at_market/full` becomes estimated full, in both directions. A separate adapter
test verifies HTTP-successful directional prices do not promote an empty book,
and repeated exact estimates are not cached even when prices are reusable.
This tests interpretation of v2; Rust matching tests and actual trades are unrun
and outside this dashboard task.

The final live evidence discovered 22 directions and validated two full estimates;
the initial no-liquidity probe and later full estimates are time-specific samples.
No schema discrepancy was observed. Current public Bread `main` was also checked
and matched 5 bps / 1–100. Neither observation identifies the shipped solver or
wallet binary. Raw smoke evidence: `artifacts/ipd/live-smoke.json`.

Independent Impeccable finish review: **disposition: ship**. No material fixes;
the intentional amber token was documented in DESIGN.md. The one detector result
was an advisory about that then-undocumented color, not a failing UI issue.
Screenshots `artifacts/ipd/desktop.png` and `mobile.png` are synthetic fixture
evidence. The original Epoch source change is only the shared navigation import
and rendered link component; adapter, catalog, defaults and lifecycle are intact.

## Final changed-file map and source identity

- `src/lib/ipd/{types,amounts,contract,config,client,service}.ts`: contract,
  exact arithmetic, network guard, global request limit/cache/cooldown and checks.
- `src/app/api/ipd/{catalog,scan}/route.ts`: read-only same-origin adapter.
- `src/lib/use-ipd-monitor.ts`: generation cancellation, progress, expiry and polling.
- `src/components/ipd-monitor.tsx`, `src/app/ipd/{page.tsx,ipd.css}`: panel and scoped styles.
- `src/components/dashboard-nav.{tsx,module.css}`, `src/components/quote-monitor.tsx`:
  discoverable navigation, preserving the existing Epoch monitor.
- `tests/ipd*.test.ts`, `tests/fixtures/ipd*.ts`, `tests/browser/ipd.spec.ts`,
  `playwright.config.ts`: deterministic behavior and browser coverage.
- `scripts/ipd-smoke.ts`: explicit opt-in bounded live GET check.
- `package.json`, `package-lock.json`: Playwright development dependency and commands.
- `.env.example`, `README.md`, `DESIGN.md`, `docs/ipd*.md`: configuration and operator/handoff guidance.

At the local implementation handoff, HEAD was `9db39faea1da7d5cd8777d146a49794ed50fdb0c` on branch
`pablo/ipd-availability`, with the feature changes uncommitted. A SHA-256 manifest
of changed implementation, tests, tooling and example configuration is saved in
`artifacts/ipd/source-manifest.json`; prose and ignored evidence are excluded from
the implementation fingerprint: `d282ca4ac6f06debb0e938947fae569e3074995cd554fe3158faaeb3f28668fa`. At that handoff, no push, PR, publication, deployment, service
restart on a live host, auth change, private-note access or transaction had occurred.

Final status: **PASS** for the local estimate panel and recorded checks. Remaining
product limitations are the documented public v2 estimator gaps, per-process
request limits, and verified-registry review for newly introduced faucets. They
do not establish maker-specific availability or guarantee settlement. Deployment
and rollback guidance and the short Philipp summary are in `docs/ipd.md`.
