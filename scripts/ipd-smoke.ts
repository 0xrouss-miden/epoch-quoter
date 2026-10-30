/** Opt-in, bounded, public GET-only corroboration. No live liquidity assertions. */
import { mkdir, writeFile } from "node:fs/promises";
import { getSettings } from "../src/lib/ipd/config";
import { SolverService } from "../src/lib/ipd/service";
import type { ScanEvent } from "../src/lib/ipd/types";

async function main() {
  const startedAt = new Date().toISOString();
  const settings = getSettings();
  const configUrl =
    "https://raw.githubusercontent.com/0xMiden/wallet-config/main/mainnet.json";
  const published = await fetch(configUrl, {
    signal: AbortSignal.timeout(10000),
  }).then((response) => {
    if (!response.ok) throw new Error(`Mainnet config HTTP ${response.status}`);
    return response.json();
  });
  if (
    published.network !== "mainnet" ||
    published.swap?.etaUrl !== settings.upstream
  )
    throw new Error(
      "Configured solver does not match the current published mainnet mapping.",
    );
  const service = new SolverService(settings);
  const signal = AbortSignal.timeout(60000);
  const catalog = await service.catalog(signal);
  const first = catalog.directions.find(
    (row) => !row.offered.issue && !row.requested.issue,
  );
  if (!first) throw new Error("No verified mainnet direction is available.");
  const reverse = catalog.directions.find(
    (row) =>
      row.offered.faucetId === first.requested.faucetId &&
      row.requested.faucetId === first.offered.faucetId,
  );
  if (!reverse)
    throw new Error("Catalog does not contain the reverse direction.");
  const input = {
    network: "mainnet" as const,
    directionIds: [first.id, reverse.id],
    notional: "10" as const,
    customAmounts: {},
    slippageBps: 5,
  };
  const events: ScanEvent[] = [];
  await service.scan(input, signal, (event) => events.push(event));
  const checks = events.flatMap((event) =>
    event.type === "result" ? [event.check] : [],
  );
  const evidence = {
    startedAt,
    completedAt: new Date().toISOString(),
    settings,
    mainnetConfig: {
      url: configUrl,
      version: published.version,
      network: published.network,
      swap: published.swap,
    },
    supportedDirections: catalog.directions.length,
    input,
    checks,
  };
  await mkdir("artifacts/ipd", { recursive: true });
  await writeFile(
    "artifacts/ipd/live-smoke.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        startedAt,
        supportedDirections: catalog.directions.length,
        checks: checks.map((check) => ({
          direction: check.directionId,
          status: check.status,
          validity: check.validity,
          error: check.errorCode,
        })),
        evidence: "artifacts/ipd/live-smoke.json",
      },
      null,
      2,
    ),
  );
  if (
    checks.length !== 2 ||
    checks.some(
      (check) =>
        check.errorCode === "invalid_response" ||
        check.status === "invalid" ||
        check.status === "error",
    )
  )
    process.exitCode = 1;
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
