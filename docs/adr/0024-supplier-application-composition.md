# ADR 0024: Supplier Application Composition

- Status: Accepted
- Date: 2026-07-26

## Context

The Hosted Supplier application combines dense administration, shift lifecycle, immutable 4M
records, parallel approvals, realtime monitoring, notifications, and scoped audit. These pages
share failure behavior and permissions but have different mutation and freshness needs.

## Decision

`supplier-web` is composed as:

1. application providers for session, QueryClient, CSRF, router, metadata, and error boundary;
2. capability and purpose route guards;
3. a compact product shell whose navigation derives from server capabilities;
4. feature pages that use the typed API catalog and server-authoritative aggregates;
5. shared states for loading, empty, forbidden, conflict, rate limit, offline, stale, and realtime
   disconnect.

URL query strings own durable list/filter state. Cursor navigation preserves browser history.
Optimistic mutations always submit the current expected version, lock duplicate submission, and
recover conflicts by refresh rather than client merge.

Realtime events are invalidation hints only. Reconnect triggers authoritative refetch; the browser
does not apply domain events as an independent source of truth.

The production UI is Bahasa Indonesia with domain codes retained where useful. It is light,
desktop-only at a minimum of 1280×720, and follows the established Henkaten design system:
near-white canvas, compact shell, thin borders, low elevation, dense tables, selective orange, and
short reduced-motion-safe feedback.

The visual composition uses a preserve-mode refinement with low layout variance, restrained motion,
and high information density. Navigation is grouped into Operasional, Data & Konfigurasi, and
Sistem after capability and Hosted Preparation filtering. The sidebar may be collapsed without
changing route authority; collapsed links retain accessible names and titles. The topbar exposes
only active-area, Supplier identity, notification, account, and logout context.

Reusable composition remains local to `supplier-web`: summary strips, metric tiles, fact strips,
filter strips, contextual rails, legends, and sticky action surfaces. Shared Henkaten Design System
exports remain stable because no missing generic primitive was identified. This isolation prevents
Supplier density or workflow emphasis from changing the independently refined TMMIN application.

The six reference-led workflows use the following presentation rules:

- Overview applies filters explicitly while the URL remains authoritative and displays only
  server-provided totals and groupings;
- Assignment Board contains horizontal density internally and derives its contextual rail only from
  the authoritative board projection;
- Default Assignment uses an accessible side sheet with atomic-move consequences, optimistic
  conflict recovery, and focus return;
- Henkaten create preserves form fields and order while exposing operational sections, readiness,
  checklist progress, and a sticky review rail;
- Henkaten detail groups immutable facts, parallel approval state, evidence, lifecycle history, and
  capability/lifecycle-gated decisions;
- Shift detail shares one composition across Not Started, Active, and Ended states. Emergency Start
  remains a dangerous Admin-only exception and never presents a blocked preflight as passed.

The Henkaten create, clone, and detail workflows apply a second targeted refinement without
changing that composition boundary:

- create and clone render the existing field order as one operational workspace. A semantic 4M
  selector, compact Shift Run context, selected-part confirmation, Man source-to-destination
  preview, numbered checklist responses, and a readiness rail make input completeness visible
  without claiming to replace server validation;
- Man previews show only assignment, member, availability, reservation, and donor facts returned by
  the existing endpoints. Non-Man categories use the same before-to-after visual grammar for the
  existing affected and replacement object fields;
- detail renders cause and narrative as change evidence, then presents either the object transition
  or the Man reservation/completed movement from the aggregate response. Approval routes remain
  parallel and show current responsibility, decision evidence, Not Required, and terminal state;
- Approve, Reject, Reroute, and Withdraw use the existing focus-managed `AlertDialog`. Their
  visibility still derives exclusively from role, capability, lifecycle, and route state;
- all workflow-specific presentation remains in a local module next to `HenkatenPages.tsx`; it does
  not extend the public `packages/ui` contract.
- Create/Clone layout corrections remain CSS-local: category glyphs are centered independently from
  selection affordances, confirmation and movement surfaces have explicit separation from their
  controlling fields, and fixed square sizing is restricted to checklist number markers instead of
  leaking into question or answer content.

The Supplier Overview applies a further read-model and composition refinement:

- the dashboard retains the newest 20 role/line-scoped audit events, enriched through bounded batch
  lookups with actor identity and an optional current Henkaten snapshot. Henkaten enrichment is
  constrained by the same Supplier and line scope as the dashboard; non-Henkaten events remain
  valid with a null Henkaten context;
- actor kind, display name, and role plus Henkaten identifier, category, current status, line/job,
  and part are additive read-model evidence. Cause and freeform change detail are deliberately
  excluded from the feed;
- recent activity is a full-width operational feed. It renders five events initially, expands
  inline to the already-loaded batch, and collapses whenever URL-authoritative filters are applied
  again. Henkaten links and operational summary links remain capability-gated;
- `ChartFrame` owns a definite plot height so Recharts `ResponsiveContainer` always receives a
  non-zero box. Empty data renders an explicit state, while single-point series retain a visible
  marker and labelled tooltip;
- the Overview uses a 12-column composition with approval aging, 4M trend, line/part ranking,
  grouped outcomes, assignment issues, overrides, and full-width activity. Its 1280 px arrangement
  keeps trend and activity full width and reorders the remaining two-column widgets without
  changing document authority or page-level overflow behavior.

The Shift assignment-resolution surface applies the same presentation quality bar while preserving
the existing resolution authority:

- Shift Detail exposes a capability-aware resolution affordance. Line Leaders receive the primary
  action to resolve an assignment issue, while other roles receive a secondary read-only path;
- the resolution page derives line, issue counts, job labels, issue origin, and linked Henkaten
  evidence only from the authoritative Shift context response. Missing display labels fall back to
  stable identifiers instead of inferred data;
- an existing resolution Henkaten always takes precedence as the next action. Only an open issue
  without that link offers Line Leaders the existing linked Man Henkaten create route; other roles
  see an explicit waiting state;
- the refinement is presentation-only. It adds no mutation or API contract, and an issue remains
  resolved only after the linked Man movement is Approved or the Shift ends.

Presentational links are emitted only when the corresponding capability exists. No browser-derived
lifecycle status or partial-data queue is presented as authoritative.

## Consequences

- Business aggregation, permission authority, and readiness policy remain on the API.
- There is no production fixture fallback, Save Draft for Henkaten, export, global search, bulk
  workflow, dark theme, or mobile operational UI.
- Supplier workflows can evolve independently from Phase 13 TMMIN workflows while sharing the
  browser boundary and design primitives.
- High density at the 1280×720 minimum requires internal scrolling for boards, tables, sheets, and
  long rails; page-level horizontal scrolling is prohibited.
- Sticky rails improve decision context but consume width, so the main content column deliberately
  reduces panel columns at the minimum viewport.
- Sidebar collapse is session-local rather than persisted, avoiding a new browser-storage contract.
- The richer Henkaten workspace increases vertical density, especially at 1280×720. The explicit
  fallback therefore stacks operational panels, keeps the review/action rail visible, and removes
  nonessential category microcopy rather than introducing page-level horizontal scrolling.
- Readiness labels are presentation guidance only. Submission eligibility, reservation conflicts,
  optimistic versions, and lifecycle transitions remain server-authoritative.
- Dashboard activity carries a current Henkaten status beside a historical action. Consumers must
  not interpret the current status as the status at the time of the event.
- The activity refinement adds read-model fields and bounded queries but no mutation, schema, or
  lifecycle changes. A maximum batch of 20 keeps enrichment cost and disclosure surface bounded.

## Validation

Supplier route and state tests cover authentication, role/capability guards, query retry policy,
and accessibility smoke. PostgreSQL integration tests validate session context, readiness,
dashboard, board override, Henkaten source traceability, and role-scoped audit behavior.

Reference-led visual validation captures Overview, Assignment Board, Default Assignment, Create
Henkaten, Henkaten Detail/Approval, and Blocked Shift at 1672×941 and 1280×720 using deterministic
test data and real typed API responses. The capture journey also asserts no page-level horizontal
overflow, emulates reduced motion, and runs axe at the minimum viewport. Visual references are
reopened at original resolution before implementation, after context compaction, after major page
groups, and before final acceptance.

The targeted Henkaten refinement adds component coverage for 4M selection, Yes/No/unanswered
checklist states, readiness, Man reservation/donor evidence, non-Man transitions, parallel route
states, and accessible decision confirmation. The Hosted lifecycle visual journey captures the
refined create and QC-pending detail pages at both reference viewports; contrast findings discovered
by axe are corrected in source before acceptance.

A corrective Hosted lifecycle capture at 1672×941 and 1280×720 additionally verifies category-icon
centering and field-to-preview spacing. The minimum viewport retains zero page-level horizontal
overflow and zero axe violations. Supplier lint, typecheck, unit tests, and production build remain
the source-level regression gate for the CSS-local correction.

The Overview refinement adds strict contract coverage for complete and null activity enrichment,
PostgreSQL integration coverage for ordering, the 20-event bound, actor fallback, tenant isolation,
and line scope, plus UI coverage for the five-event initial state, inline expansion/collapse,
filter-reset behavior, capability-aware Henkaten links, and safe non-Henkaten fallback. Shared chart
tests cover empty and single-point rendering. The Hosted lifecycle browser journey asserts a
non-zero chart box, a visible single-point marker, a five-item activity limit, full-width activity,
no page-level horizontal overflow, reduced motion, and axe at 1280×720, with visual captures at both
reference viewports.

The Shift resolution corrective pass adds a unit-tested capability/state action matrix and extends
the Man concurrency journey through the Board-to-resolution path. Chromium captures at 1672×941
and 1280×720 verify the primary Line Leader CTA, non-zero action geometry, authoritative issue
context, zero page-level horizontal overflow, and zero axe violations at the minimum viewport; the
existing Edge journey continues to validate the linked Man resolution lifecycle.
