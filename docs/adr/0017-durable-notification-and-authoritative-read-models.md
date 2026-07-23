# ADR 0017: Durable Notification and Authoritative Read Models

- Status: Accepted
- Date: 2026-07-23

## Context

Operational writes already commit domain state, audit evidence, and transactional outbox events in
one PostgreSQL transaction. Browser consumers require persistent per-user notifications, a current
Assignment Board, dashboard aggregations, audit timelines, and near-real-time refresh behavior.
Redis and a second durable projection store are outside the approved runtime topology.

The read interfaces must remain tenant- and role-scoped, avoid client-side joins, remain recoverable
after a disconnected browser session, and prevent outbox retries from duplicating user-visible
notifications.

## Decision

PostgreSQL remains the authoritative source for all read interfaces.

- Notifications are persisted per recipient and are uniquely keyed by source outbox event and user.
- Outbox handlers are composable; zero or more handlers may consume an event. An event without a
  side-effect handler remains a valid durable domain event and is marked processed.
- Notification read state is user-specific and does not mutate Henkaten, warning, approval, or
  assignment state.
- Assignment Board payloads are assembled from active Shift Runs, bounded Working Assignments, and
  active-shift Open or Approved Henkaten records in one server-side read boundary.
- Rejected and Cancelled records are excluded from active indicators. Approved records remain visible
  until End Shift.
- Supplier dashboards use database aggregations and bounded recent-activity queries. TMMIN dashboards
  aggregate cross-supplier state only behind an explicit TMMIN capability.
- Audit responses expose a bounded, cursor-paginated allowlisted view. Credential, token, photo, and
  registration-related keys are removed before serialization.
- Server-Sent Events carry only scoped invalidation metadata. REST endpoints remain the source of
  truth, and `Last-Event-ID` is used to resume from retained outbox events.

## Rationale

This model preserves transactional durability without adding infrastructure or eventual-consistency
repair logic. A notification remains available while a user is offline. An SSE reconnect cannot
become authoritative because the browser always refreshes a versioned REST payload. Unique recipient
indexes make notification handlers safe under worker retry.

Direct database aggregations are adequate at the accepted compact capacity and keep projection
rebuild and dual-write risk out of the initial release. An explicit measurement gate remains in place
before materialized views or projection tables may be introduced.

## Alternatives Considered

### Redis pub/sub and cached projections

Rejected because Redis is outside the locked topology and pub/sub would not provide offline
durability by itself.

### Full payloads over SSE

Rejected because they increase privacy exposure, duplicate authorization-sensitive serializers, and
make reconnect reconciliation harder.

### Dedicated projection tables for every board/dashboard widget

Deferred because current bounded relational queries meet the preliminary latency target. Such tables
would add transactional and repair complexity before evidence demonstrates a need.

### Polling only

Rejected as the primary behavior because board propagation must be observable within five seconds.
REST polling remains a safe client fallback when SSE is unavailable.

## Implementation Details

- `Notification` has a unique `(sourceEventId, recipientUserId)` key and indexes for unread and
  reverse-chronological access.
- Notification handlers resolve recipients from persisted approval responsibility, active QC users,
  tenant administrators, and affected line ownership.
- Board versions are deterministic digests of included entity IDs and versions.
- Role scoping is applied in database predicates for Supervisor and Line Leader access.
- SSE messages contain event type, aggregate identity/version, occurrence time, and refresh topics;
  domain payloads and PII are not streamed.
- Read APIs use maximum page sizes and bounded top/recent lists.

## Consequences

- Read-after-write behavior is straightforward because REST reads authoritative tables.
- Notification delivery is eventually processed by the outbox worker but remains retry-safe.
- Dashboard query cost grows with retained history and must be observed as history accumulates.
- SSE availability is tied to the single API instance, while missed events remain recoverable from
  PostgreSQL.
- Materialized views remain an additive future optimization, not a correctness dependency.

## Validation

- Fresh migration execution creates the notification schema and indexes.
- Integration coverage verifies recipient persistence, read-state isolation, Assignment Board
  content, supplier dashboard aggregation, TMMIN dashboard access, and audit redaction.
- Existing authorization, Henkaten, assignment, approval, and concurrency integration tests continue
  to pass.
- OpenAPI and shared Zod contracts describe every new REST read endpoint and the SSE transport.

## Risks

- Very large permanent history may make direct aggregations slower than the accepted target.
- In-process SSE connections are lost during a process restart.
- Event payloads without a line identifier can only be tenant-scoped, not line-scoped, for
  invalidation.

## Follow-up Work

- Measure query plans and latency with the compact representative dataset.
- Include External projections and freshness in the global dashboard without exposing an External
  Assignment Board.
- Add client stale/disconnected presentation and REST refresh behavior when frontend work begins.
