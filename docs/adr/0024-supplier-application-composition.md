# ADR 0024: Supplier Application Composition

- Status: Accepted
- Date: 2026-07-24

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

## Consequences

- Business aggregation, permission authority, and readiness policy remain on the API.
- There is no production fixture fallback, Save Draft for Henkaten, export, global search, bulk
  workflow, dark theme, or mobile operational UI.
- Supplier workflows can evolve independently from Phase 13 TMMIN workflows while sharing the
  browser boundary and design primitives.

## Validation

Supplier route and state tests cover authentication, role/capability guards, query retry policy,
and accessibility smoke. PostgreSQL integration tests validate session context, readiness,
dashboard, board override, Henkaten source traceability, and role-scoped audit behavior.
