# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js and TypeScript, requested by the user. Local repository application.

## Product Purpose

Monitor Epoch quotes into and out of Miden on mainnet.

## Users

The user wants to see which routes currently return quotes.

## Capabilities and Constraints

Compact route table, amount controls, automatic refresh, and unavailable-route states confirmed by the user. Read-only quoting; no transaction execution. Discover supported routes from upstream configuration where possible. Never fabricate availability or quote values.

## Brand Commitments

Simple interface. Omit copy that repeats information already implied by the controls or layout.

## Product Principles

- Make route availability immediately scannable.
- Scan only the 10 requested mainnet bridge pairs in both directions: Arbitrum ETH/USDC, Base ETH/USDC, Polygon POL/USDC, Ethereum ETH/USDC, Robinhood ETH/USDG. USDC maps to Miden USDCx; ETH and POL mean native EVM assets.
- Exclude Optimism and cross-asset pairs. Show the network once above the table.
- Report upstream errors honestly and preserve the time of each observation.
- Do not compare different tokens as if they had equal value.
