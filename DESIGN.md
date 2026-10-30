---
name: Epoch / Miden Quotes
description: A compact operations table for observing quote availability.
colors:
  page: "#f6f7f8"
  surface: "#fff"
  ink: "#202629"
  secondary: "#697078"
  line: "#e6e9eb"
  accent: "#c54922"
  accent-hover: "#a63716"
  green: "#19714c"
  amber: "#865800"
  red: "#a83a3a"
  surface-subtle: "#fafbfc"
  control-background: "#f2f4f5"
  control-border: "#dce0e3"
  subtle-background: "#f0f2f4"
  subtle-text: "#525c65"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
  section-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
  control:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 550
  metadata:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
  address:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
rounded:
  count: "4px"
  compact-control: "6px"
  control: "8px"
  workspace: "12px"
spacing:
  compact: "8px"
  control: "12px"
  section: "16px"
  workspace: "20px"
  detail: "24px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-secondary-hover:
    backgroundColor: "{colors.control-background}"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.subtle-text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-subtle-hover:
    backgroundColor: "{colors.subtle-background}"
  icon-button:
    backgroundColor: "transparent"
    rounded: "{rounded.compact-control}"
    width: "32px"
    height: "32px"
  search-field:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    width: "285px"
  amount-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.compact-control}"
    padding: "9px"
  network-scope:
    textColor: "{colors.secondary}"
    typography: "{typography.control}"
  status-navigation:
    textColor: "{colors.secondary}"
    padding: "9px 0 14px"
  route-status:
    textColor: "{colors.secondary}"
    typography: "{typography.metadata}"
  workspace:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.workspace}"
---

# Design System: Epoch / Miden Quotes

## Overview

**Creative North Star: "Compact operations table"**

The confirmed visual direction is a quiet, light interface for repeated scanning. White surfaces sit on a cool grey page; charcoal type establishes hierarchy, and muted orange makes the primary action easy to find. Controls and route data carry the interface, with minimal explanatory copy.

This document records the built implementation in `src/app/globals.css` and `src/components/quote-monitor.tsx`. There are no approved image compositions. Preserve the implemented density and state language when extending the interface.

**Key Characteristics:**

- Flat surfaces with fine dividers.
- Compact system typography with aligned numbers.
- Orange actions and explicit status labels.
- Details disclosed within the table.

## Colors

The palette combines cool neutral surfaces with a restrained warm accent. The frontmatter contains the normative values extracted from the implementation.

### Primary

- **Muted orange** (`accent`): primary actions, the Miden mark, and keyboard focus. `accent-hover` darkens primary actions on hover.
- **Available green** (`green`) and **error red** (`red`): semantic outcomes paired with visible text. Neutral secondary text identifies pending and unavailable quotes. Checking uses a warm brown treatment and a pulsing dot.

### Neutral

- **Cool page** (`page`) surrounds the **white surface** (`surface`).
- **Charcoal ink** (`ink`) carries headings, assets, and results; **secondary grey** (`secondary`) carries metadata and subordinate controls.
- **Fine divider** (`line`) separates control regions and table structure. `control-border` outlines fields and secondary buttons.
- `surface-subtle` identifies table headers, active checking rows, and the amount panel. `control-background` and `subtle-background` distinguish control groups and hover states.

**The Explicit Status Rule.** Always pair a status color with its text label. Mainnet is the only network and is named once above the table.

## Typography

Use the operating system sans stack throughout. Monospace is reserved for addresses and raw response data. The hierarchy is compact: one page heading, small section titles, dense table content, and quieter metadata.

- The page heading uses the `headline` role and reduces to (27px) at the mobile breakpoint.
- Table values and controls use (12px); labels, status, timestamps, and route details primarily use the `metadata` role.
- Asset names use medium weight (550) with chain names below them. Token symbols accompany amounts in smaller, quieter type.
- Amounts, scan progress, timestamps, result counts, and pagination use tabular numerals. Numeric table columns align right.
- Exact unshortened amounts remain available in their title text; visible amounts may be formatted for scanning.

**The Numeric Alignment Rule.** Keep related quantities aligned and retain their token symbols. Typography must not imply that unlike tokens are interchangeable values.

## Layout

One horizontal application bar leads into a centered main area with a maximum width of (1440px). The desktop bar is (72px) high with (40px) horizontal inset. Main content uses (43px) top, (40px) side, and (28px) bottom padding; the top inset increases to (54px) above (1500px).

The workspace is one continuous bordered surface: network scope and amount controls, expandable amount panel, search and filters, status filters, route table, and pagination. Desktop table cells use (15px 18px) padding, with source cells inset (23px). The table remains a table when space narrows, with horizontal overflow available as a fallback.

- At (1100px) and below, page insets reduce to (24px), table cells narrow, and the Checked column is hidden. Observation time remains in expanded details.
- At (760px) and below, the application bar becomes (60px) high, main side insets become (16px), and controls wrap. Search and export occupy the first filter row; direction and chain controls share the next row. Status filters can scroll horizontally.
- Mobile keeps source, destination, receive amount, status, and disclosure. The Send column is hidden and its amount moves beside the source symbol. Asset icons disappear; chain names can wrap.
- Expanded detail labels stack above their values on mobile. Long addresses wrap. The amount panel uses an adaptive grid with a minimum field width of (120px), a gap of (14px), and wrapping footer controls.

## Elevation & Depth

Surfaces are flat and separated by borders and slight tonal changes. Expanded details use a cooler inset background, while raw JSON sits on a slightly darker patch with bounded vertical overflow. Avoid adding shadows to the table or page shell.

## Shapes

Use gently rounded controls and a slightly broader workspace corner, following the frontmatter scale. Fields and secondary buttons use fine single-pixel borders. Token icons are circles; the Miden mark uses a compact rounded square. Status dots remain small circles, paired with text. Do not round individual table rows into cards.

## Components

### Buttons and navigation

Primary buttons use orange with white text; secondary buttons use a white fill and border; subtle buttons sit directly on the containing surface. Standard buttons have a minimum height of (36px), with compact label-and-icon spacing. Disabled buttons reduce opacity to (0.4) and use the disabled cursor. Icon buttons have accessible names and a quiet neutral hover fill.

The network scope is a muted Mainnet label. Status filters use an ink underline and stronger text for the active choice, with small neutral count badges and `aria-pressed`.

### Search and amount controls

Search is a bordered icon-and-input group. Its wrapper receives the visible focus outline. Native select controls share the field border and compact typography. The amount panel opens inline beneath the scope toolbar, with labeled decimal inputs, Reset, and Apply & refresh. Validation appears as red text alongside the actions, taking a full line on narrow screens.

### Table and route details

Each asset combines token name and chain. Receive values are shown only for available quotes; a dash represents an absent value. Status labels are Available, No quote, Error, Checking, and Pending. Hover, expanded, and checking rows receive subtle surface changes rather than new containers.

The disclosure button exposes `aria-expanded` and rotates its chevron when open. Details reveal endpoint, input, token addresses, observation time, response duration, diagnostics, and a separate quote-path disclosure when present. Copy feedback replaces the action label with Copied or Copy failed · retry. The empty state uses one compact explanation and a Clear filters action.

### Focus and motion

Interactive elements receive a (2px) orange focus outline with a (3px) offset; the search wrapper uses a (1px) offset. Buttons transition background and text color over (0.15s) with `ease`. Only running/checking dots animate, breathing over (1.6s). Under `prefers-reduced-motion: reduce`, all transitions and animations are disabled. Preserve the semantic table, explicit control labels, polite scan updates, and alert roles for errors.

## Do's and Don'ts

### Do:

- Do preserve the compact light surface and restrained orange actions.
- Do pair status colors with text and show the network scope once.
- Do use tabular numerals and right alignment for amount columns.
- Do keep exact technical information in the expandable route details.
- Do preserve visible keyboard focus and reduced-motion behavior.

### Don't:

- Don't add marketing copy, decorative charts, metric cards, or a wallet flow to this monitor.
- Don't turn table rows into separate floating cards.
- Don't use monospace for the entire interface.
- Don't hide both the input amount and its source token on mobile.
- Don't use decoration or animation to imply successful quotes before a result exists.

## IPD extension

The IPD availability surface inherits the compact light operations dashboard: neutral page and surfaces, system typography, fine dividers, rounded controls, orange actions and focus, and inline diagnostic disclosures. Its implementation lives in `src/components/ipd-monitor.tsx` and `src/app/ipd/ipd.css`. The rules below qualify this surface only; preserve the existing Epoch components and behavior.

### Status meaning

Pair every colored dot with its visible status label. Each observation belongs to one offered-to-requested direction, exact amount, and limit policy.

- **Available green** (`green`): Estimated full fill requires a current validated response for the exact order, a full fill in the `at_market` band, and a running executor. It remains an advisory estimate.
- **Advisory amber** (`amber`): Estimated partial fill, Waiting for price move, and Settlement delayed. A tolerated price band waits for a favorable move; executor readiness takes precedence over positive fill amounts.
- **Error red** (`red`): No executable liquidity, Invalid check, and Check failed. No executable liquidity describes eligible depth for the exact order and does not identify a maker outage.
- **Neutral text** (`subtle-text`): unchecked/checking, stale, unsupported, unavailable-price, limit-mismatch, and deferred solver states. Historical amounts may remain visible with an explicit Historical label; stale results must not retain green status.

### Controls and diagnostics

The workflow is to choose an approximate USD preset or an exact offered token amount, set the limit policy, inspect the direction-specific estimate, and expand diagnostics. Presets are approximately $1, $10, and $100 using a USDT reference; each row supports a custom amount and Use preset reset. The compact policy disclosure exposes whole-basis-point slippage, initially 5 bps, and the zero minimum-fill step. Asset, Offering, and Status selects filter the view. Refresh, Pause, and the 60s-after-scan auto-refresh control reuse the shared button and field treatments.

Keep exact token quantities and their units visible: offered amount, minimum receive, full expected receive or partial proceeds, and the partial offered portion. IPD columns align left; amount inputs retain tabular numerals. Show observation time and age together. Inline details carry validity, price classification, executor readiness, fees, capacity, source-price time, expiry policy, and bounded raw request/response data. These observations convey estimated liquidity and execution conditions without implying a reservation or settlement guarantee.

### Responsive layout

Desktop uses one continuous table with a minimum width of (1040px) and horizontal overflow. At (760px) and below, rows become stacked two-column grids within that same divided surface. Direction and disclosure lead each row; visible field labels accompany values, the estimate spans both columns, and amount fields fill their cell. Keep checked time and age available. Expanded diagnostics stack labels above values and wrap long identifiers; controls and footer content wrap without introducing separate floating cards.
