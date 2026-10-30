import { createServer } from "node:http";
import {
  ETH,
  USDT,
  BTC,
  USDC,
  catalogFixture,
  estimateFixture,
  inputFromUrl,
  pairPriceFixture,
  valuationFixture,
  type Scenario,
} from "./ipd";

let control: {
  scenario?: Scenario;
  delayEtaMs?: number;
  missingValuation?: boolean;
} = {};
let calls: { path: string; query: Record<string, string>; method: string }[] =
  [];
let active = 0,
  peak = 0;
const states: Record<string, Scenario | "malformed"> = {
  [`${ETH}:${USDT}`]: "full",
  [`${USDT}:${ETH}`]: "none",
  [`${BTC}:${USDT}`]: "partial",
  [`${USDT}:${BTC}`]: "tolerated",
  [`${ETH}:${USDC}`]: "paused",
  [`${USDC}:${ETH}`]: "malformed",
};
createServer(async (request, response) => {
  const url = new URL(request.url!, "http://127.0.0.1:4419");
  const send = (value: unknown, status = 200) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === "/__control" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    control = JSON.parse(body);
    calls = [];
    peak = active;
    send({ ok: true });
    return;
  }
  if (url.pathname === "/__stats") {
    send({ calls, active, peak });
    return;
  }
  if (url.pathname === "/health") {
    send({ ok: true });
    return;
  }
  calls.push({
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    method: request.method!,
  });
  active++;
  peak = Math.max(peak, active);
  try {
    if (request.method !== "GET") {
      send({ error: "read_only", message: "Only GET accepted" }, 405);
      return;
    }
    if (url.pathname === "/v2/pairs") {
      send(catalogFixture);
      return;
    }
    if (url.pathname === "/v1/prices") {
      send(control.missingValuation ? {} : valuationFixture());
      return;
    }
    if (url.pathname === "/v2/pair-price") {
      send(
        pairPriceFixture(
          url.searchParams.get("offered_faucet")!,
          url.searchParams.get("requested_faucet")!,
        ),
      );
      return;
    }
    if (url.pathname === "/v2/swap-eta") {
      const input = inputFromUrl(url),
        scenario =
          control.scenario ??
          states[`${input.offeredFaucet}:${input.requestedFaucet}`];
      if (control.delayEtaMs)
        await new Promise((resolve) => setTimeout(resolve, control.delayEtaMs));
      send(
        scenario === "malformed"
          ? { ...estimateFixture(input), fillStatus: "unknown" }
          : estimateFixture(input, scenario),
      );
      return;
    }
    send({ error: "unexpected_endpoint", message: url.pathname }, 404);
  } finally {
    active--;
  }
}).listen(4419, "127.0.0.1");
