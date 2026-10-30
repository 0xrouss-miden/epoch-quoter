# Epoch quoter

A small Next.js + TypeScript monitor for Epoch quotes into and out of Miden. No wallet or API key required.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Node.js 22.18 or later is required.

## What it checks

The app checks an explicit mainnet bridge matrix: **10 pairs, 20 directional quotes**. Optimism and cross-asset pairs are excluded. The requested pairs are:

| EVM chain | Assets bridged to/from Miden |
| --------- | ---------------------------- |
| Arbitrum  | ETH, USDC                    |
| Base      | ETH, USDC                    |
| Polygon   | POL, USDC                    |
| Ethereum  | ETH, USDC                    |
| Robinhood | ETH, USDG                    |

USDC maps to USDCx on Miden. ETH and POL use native EVM currency (the zero-address sentinel in Epoch intents SDK 2.2.0), not WETH or WPOL. Miden faucet addresses and decimals come from the verified token registry. A listed pair remains visible even when Epoch returns no quote. The server queries the allocator with the `any` routing preset. Availability means the allocator returned a positive quote at the displayed time; the catalog alone does not imply liquidity, and quotes do not guarantee execution.

- Mainnet: https://mainnet-api.epochprotocol.xyz
- Quotes: `POST /checkIfDepositNeeded`, using `/health`, `/miden-recipient`, and `/suggested-nonce` for quote context.

Only these read/quote endpoints are used. The app never submits a Compact, creates notes, connects a wallet, or signs a transaction. A fixed public EVM probe address and the allocator's public Miden recipient are used as quote context. Estimates may differ for a real wallet; server environment overrides allow another public account.

## Monitoring

Four quote jobs run concurrently, with results appearing as they finish. Upstream calls are paced to one request per second, and suggested nonces are reused for read-only probes for one minute. Scan duration depends on allocator response times and rate limits. Epoch rate limits trigger a shared cooldown and automatic retries respecting `Retry-After`; they are not recorded as missing liquidity. Filters change the displayed rows; they do not narrow the background scan. `Amounts` sets a separate exact input amount per source token. The default is 100 tokens, except ETH (0.01).

Automatic refresh waits the selected interval **after** a scan completes. It does not start another scan while the page is hidden; an already running scan may finish. `Pause` cancels the current scan; `Refresh` starts a new full scan. Monitoring requires this page to remain open. Results are held in memory and clear on reload. This is not a persistent or scheduled background service.

The API caches individual observations for 15 seconds and allocator configuration for one minute, bounds concurrency to eight requests per process, and applies request timeouts. The local API accepts known route IDs, never arbitrary upstream URLs. For public hosting, add deployment-level authentication/rate limiting as needed; these in-process limits are intended for a local monitor.

Rows distinguish a positive quote, no quote/liquidity, upstream errors, and pending requests. Expand a row to inspect the exact amounts, token addresses, timestamp, endpoint, errors, and returned quote paths. Export downloads the filtered observations as JSON.

## Configuration and catalog updates

Optional server-only overrides are documented in `.env.example`; copy it to `.env.local` when needed. Defaults work without a file. Restart the server after changing configuration.

Chain IDs and ERC-20 addresses use `@epoch-protocol/epoch-commons-sdk` 2.1.1. The explicit pairs in `src/lib/catalog.ts` control the scan and API allowlist; SDK updates do not expand it. Miden mainnet decimals and symbols are taken from the checked-in `src/data/miden-mainnet-tokens.json`, downloaded from [Miden's verified token registry](https://github.com/0xMiden/token-list/blob/main/mainnet.json) on 2026-10-29. In particular, Miden ETH and POL have 8 decimals, while their native EVM counterparts have 18; Miden USDCx has 6. Do not use decimals from quote path metadata, which live responses sometimes mislabel as 18.

Reference: [Epoch chains and tokens](https://docs.epochprotocol.xyz/supported-chains-and-tokens), [Miden integration example](https://github.com/epochprotocol/miden-integration-example), [Miden wallet config](https://github.com/0xMiden/wallet-config).

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Tests cover mainnet-only routes, route-direction completeness, differing token decimals, exact amount conversion, input rejection, same-origin requests, quote-only HTTP behavior, upstream error classification, and rate-limit retry timing. Live smoke checks returned quotes in both directions on mainnet during development; liquidity changes over time.

For production, run `npm run build` followed by `npm start`.

The Contabo deployment uses Docker and the `/epoch` path. See
[deployment instructions](deploy/README.md) for its URL, configuration, and updates.
