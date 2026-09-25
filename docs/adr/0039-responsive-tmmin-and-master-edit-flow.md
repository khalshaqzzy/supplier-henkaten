# ADR 0039: Responsive TMMIN and master edit flow

Status: Accepted  
Date: 2026-09-25

## Context

The TMMIN layout rejected viewports below 1280 × 720 despite the portal's read and correction workflows being useful on smaller screens. Existing Job API updates already accepted a name, but the Line & Job panel exposed only category changes. Master data forms stayed on the detail route after a successful edit. The Tanoko inspector placed MP, job, and line outside its scrollable body, leaving little room for level choices on short screens.

## Decision

The viewport gate is removed. At compact widths, TMMIN navigation becomes a horizontally scrollable row, the top bar wraps, and page content can scroll horizontally where a dense view needs it. Job names are editable inline in the line detail panel using the existing versioned update endpoint. A successful master data edit returns to the resource list route. Tanoko identity and level controls share one vertical scroll region; the inspector header and footer remain fixed within the panel.

## Rationale and alternatives

Keeping a hard minimum viewport would deny access to otherwise usable workflows. Rebuilding every dense TMMIN table as a mobile card was deferred because the compact navigation and local scrolling preserve all columns with less risk to monitoring semantics. A separate Job detail route was unnecessary because the existing panel and endpoint already own this operation. Returning to the fixed resource list route is predictable even after a deep link, unlike browser-history back navigation.

## Implementation and consequences

The change is frontend only; the existing tenant scoped Job API and optimistic version check remain authoritative. Job renaming validates a nonempty changed name and keeps the editor open on API failure. Compact TMMIN layout preserves all routes and logout. Table-heavy pages can require horizontal scrolling. Master edit success invalidates the matching list before navigation, so the destination receives fresh data. Tanoko scroll position now covers the selected identity, level options, eligibility, and note together.

## Validation and follow-up

Run formatting, lint, typecheck, unit and browser checks for compact TMMIN access, Job rename, master edit redirect, and Tanoko inspector scroll. Phase 15 staging and real-device checks remain required before release claims. In particular, verify dense TMMIN tables and touch scrolling at 360, 768, and 1024 px widths.
