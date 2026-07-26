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
