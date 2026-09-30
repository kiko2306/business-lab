---
name: Homelab Management Dashboard
description: A calm slate control room where state and consequence, not decoration, carry the colour.
colors:
  canvas-light: "#f4f7fb"
  surface-light: "#ffffff"
  canvas-dark: "#1e293b"
  surface-dark: "#26303f"
  well-dark: "#0f172a"
  border-dark: "#334155"
  ink-dark: "#e2e8f0"
  ink-muted-dark: "#cbd5e1"
  primary: "#0d6efd"
  success: "#198754"
  danger: "#dc3545"
  warning: "#ffc107"
typography:
  page-title:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.2
  panel-title:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
  body:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  row-detail:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  stat:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.1
rounded:
  row: "0.6rem"
  tile: "0.9rem"
  card: "1rem"
  dialog: "0.75rem"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.85rem"
  lg: "1.25rem"
components:
  service-row:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.row}"
    padding: "0.55rem 0.85rem"
  summary-tile:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.tile}"
    padding: "1.1rem 1.15rem"
  nav-link:
    textColor: "{colors.ink-muted-dark}"
    rounded: "{rounded.pill}"
    padding: "0.35rem 0.75rem"
  nav-link-active:
    backgroundColor: "{colors.border-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.pill}"
  button-start:
    backgroundColor: "{colors.success}"
    textColor: "#ffffff"
  settings-dialog:
    backgroundColor: "{colors.surface-dark}"
    rounded: "{rounded.dialog}"
---

# Design System: Homelab Management Dashboard

## Overview

**Creative North Star: "The Quiet Control Room"**

A room of slate surfaces where nothing shouts until something needs attention. The dashboard is an Operate surface for a non-technical client running their own box, so the calm is functional: ~36 apps in rows, each one a name, a state, what it needs, and three buttons. Colour is reserved for meaning (green running, red failing, amber degraded, blue for the one primary action or focus), never for atmosphere.

The look is Bootstrap 5.3 recoloured, not replaced: its components, tokens and colour modes stay, and the app points them at a slate palette (Tailwind's `slate` ramp, the same one the public Home Page runs on, so the two read as one product). Dark is the default and the design target; light is a supported, subtler sibling. Soft, legible, unhurried: rounded rows and tiles, pill-shaped navigation and search, generous radius, no hard edges.

**Key Characteristics:**
- Slate canvas, one card colour a step above it, hairline borders plus a soft two-layer shadow for lift.
- State colours carry meaning only; the accent blue appears on focus rings and primary actions.
- Compact full-width rows for apps rather than a grid of large cards; density serves scanning 36 items.
- Dependency and blocked-start reasons sit next to the control they explain.
- English and pt-PT text lengths differ; layouts wrap rather than truncate labels that carry meaning.

## Colors

A cool, desaturated slate ground with Bootstrap's stock semantic hues on top.

### Primary
- **Interface Blue** (#0d6efd): focus rings (2px outline, 2px offset), primary buttons, links, the search pill's focus halo. Bootstrap's default primary, deliberately not re-themed; code reads it through `--bs-primary`.

### Neutral
- **Page Slate** (#1e293b dark, #f4f7fb light): the canvas behind everything (`--app-canvas`).
- **Card Slate** (#26303f dark, #ffffff light): headers, panels, rows, tiles, modals (`--app-surface`, `--app-surface-raised`).
- **Well Slate** (#0f172a): hover wells and tertiary backgrounds in dark.
- **Rule Slate** (#334155): borders, dividers, the active nav pill.
- **Ink** (#e2e8f0 body, #ffffff headings and emphasis) and **Muted Ink** (#cbd5e1): secondary text, readable at small sizes on both canvas and card.

### Semantic
- **Running Green** (#198754), **Failure Red** (#dc3545), **Attention Amber** (#ffc107, text via Bootstrap's warning-emphasis): app state, health, dependency-down chips, the break-glass Recovery nav link.

### Named Rules
**The Meaning-Only Colour Rule.** Green, red and amber mean state and nothing else. A decorative use of them makes a healthy box look broken.
**The Both-Themes Rule.** Every colour lives as a token with light and dark values kept in step (`styles.css`); component CSS never hard-codes a theme colour, and reads the primary through `--bs-primary-rgb`.

## Typography

**Body Font:** Inter, falling back to the platform system stack. No separate display face.

**Character:** Plain, neutral, highly legible at small sizes. Hierarchy comes from weight, size and case, not from typeface changes.

### Hierarchy
- **Page title** (500, 1.75rem, 1.2): one per page, with a `text-body-secondary` subtitle beneath.
- **Panel title** (600, 1.05rem): collapsible panel headings.
- **Body** (400, 1rem, 1.5): forms, descriptions.
- **Row detail** (400, 0.8125rem): the description line under an app name; truncates with an ellipsis on one line.
- **Label** (600, 0.68-0.78rem, +0.04 to 0.08em, uppercase): group headings, summary labels, "needs" chip prefix.
- **Stat** (700, 1.75rem, tabular numerals): summary counts only.

### Named Rules
**The Tabular Numerals Rule.** Counts and versions use `font-variant-numeric: tabular-nums` so they do not jitter as state changes.

## Layout

Fluid `container-fluid` pages with 1.5rem vertical padding. A stack of collapsible panels; inside them, app groups by category, each a vertical list of full-width rows (0.5rem gap). The summary strip is `auto-fit, minmax(9rem, 1fr)` so four tiles reflow to 2x2 on a phone without a media query. Below 768px, tables collapse to labelled card-per-row; below 576px, a service row wraps and its actions drop to a right-aligned line below. The shell header is sticky; on narrow screens the nav becomes a single-line swipeable strip. In-page anchors offset by 4.5rem for the sticky header.

## Elevation & Depth

Hybrid: tone first, shadow second. A surface is lifted off the canvas by being one tone lighter, then a two-layer shadow (a tight contact shadow plus a wide soft one) seats it. Alpha is scaled per theme by `--app-shadow-k` (1 dark, 0.3 light) because dark-tuned shadows read as smudges on white.

### Shadow Vocabulary
- **Card** (`0 2px 6px rgba(0,0,0,.3k), 0 22px 45px -22px rgba(0,0,0,.65k)`): Bootstrap `.card`, panels.
- **Service row** (`--app-shadow-service-card`: dark `0 3px 8px rgba(2,6,23,.22), 0 18px 34px -18px rgba(2,6,23,.6)`): app rows.
- **Summary tile**: `0 3px 8px` and `0 24px 44px -22px`, lifting slightly further on hover.
- **Dialog** (`0 1rem 3rem rgba(0,0,0,.55)`): modals over a `rgba(15,23,42,.5)` backdrop.

### Named Rules
**The Diffuse-Only Rule.** Shadows are offset and soft. No zero-blur block shadows, no coloured halos except the focus ring.

## Shapes

Generous, friendly radii scaled to size: rows 0.6rem, summary tiles 0.9rem, cards 1rem, dialogs 0.75rem. Interactive chrome that filters or navigates is pill-shaped (999px): nav links, the search field, dependency chips, count badges. Borders are 1px hairlines in Rule Slate; a dashed chip border marks "needs this to work well" versus a solid one for "needs this to start".

## Components

### Service Row
- **Shape:** 0.6rem radius, 1px hairline border, card shadow.
- **Content:** icon tile (2.25rem, primary at 12% fill), name (600, ellipsis at 16rem), state badge, health badge, version glyph, exposure links as small badges, one-line description, dependency chips.
- **Error state:** danger-subtle background and border.
- **Actions:** Start (solid success), Stop (outline danger), Settings (outline secondary); all small, min-width 4.25rem; Start is disabled with a reason in its title when a hard dependency is down.

### Summary Tile
- **Style:** 0.9rem radius, surface fill, hairline border, uppercase label above a large tabular number; the label colour, not the number, carries running/stopped/issues meaning.
- **Hover:** lifts 2px and deepens its shadow.

### Navigation
- **Style:** plain text pills, 0.875rem/500. Hover and keyboard focus fill with the well colour; the active route is a solid Rule Slate pill in bold. Recovery is amber and visually separate. Mobile: single-line swipeable strip, no scrollbar.

### Search
- **Style:** one pill combining icon add-on, field and Clear button; focus lifts the whole pill with a 0.2rem primary halo at 25% instead of ringing only the input.

### Dialogs
- **Settings dialog:** 560px max, 0.75rem radius, raised surface, header row with icon tile and title, hairline-divided sections, `role="dialog"` named by its title.
- **Startup-log popup:** the one intentionally dark, monospace surface (#1e1e1e), terminal-like; also a named modal dialog. Escape closes both.

### Dependency Chip
- **Style:** pill with a status dot; down state uses warning-subtle fill; optional dependency uses a dashed outline.

## Do's and Don'ts

### Do:
- **Do** express every colour through a token with light and dark values, and read the primary via `--bs-primary-rgb`.
- **Do** put the reason next to a disabled control (blocked start names the dependency).
- **Do** route every visible string through the translate service, with en and pt-PT keys together.
- **Do** keep counts and versions in tabular numerals.
- **Do** give every dialog `role="dialog"`, `aria-modal` and a name from its heading.

### Don't:
- **Don't** use green, red or amber for anything but state.
- **Don't** add hard offset shadows, gradient text, or glass and blur as decoration.
- **Don't** nest cards inside cards; rows sit in panels, nothing sits in a row but its own content.
- **Don't** hard-code a theme colour or a Bootstrap default hex in component CSS.
- **Don't** put layout in inline `style` attributes; use a class.
