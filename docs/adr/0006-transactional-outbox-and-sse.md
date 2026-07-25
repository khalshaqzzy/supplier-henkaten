# 0006 Transactional Outbox and Server-Sent Events

Status: Accepted

Date: 2026-07-23

Implementation refinement: durable event processing claims work with `FOR UPDATE SKIP LOCKED`,
while browser invalidation is distributed by one API-local ordered outbox pump. `LISTEN/NOTIFY` and
Redis are not used.

Scope: durable domain events, asynchronous processing, browser updates, and replay behavior

## Context

Assignment boards, notification centers, warnings, and dashboards must update without a page
reload. The system runs as one API process and must not add Redis. A database commit must not be
reported to realtime clients unless its event is durably recorded.

Polling the outbox separately for every SSE connection multiplied database work and used a
15-second interval, which could not meet the five-second Assignment Board propagation target.

## Decision

Domain mutations insert an outbox record in the same PostgreSQL transaction as business state. An
API-hosted worker claims processable records with `FOR UPDATE SKIP LOCKED`, performs at-least-once
delivery, and records attempts and outcomes. Consumers use event IDs and domain uniqueness to remain
idempotent.

One API-local realtime pump reads the globally ordered durable outbox at a validated one-second
default interval. It fans sanitized invalidations to connected clients in memory. Each connection
applies tenant and authorized-line scope before delivery. Browser realtime uses Server-Sent Events,
with the outbox ID as the opaque event ID and `Last-Event-ID` for replay.

When the requested cursor is absent from retained history or exceeds the bounded replay window, the
server emits an additive resync event. The browser marks its data stale and refetches the
authoritative REST read model. Redis and a separate message broker are not introduced.

## Rationale

The transactional outbox removes the database/event dual-write gap. A single ordered poll decouples
database load from the number of browser connections and satisfies the propagation target without a
new infrastructure dependency. SSE is sufficient for server-to-browser invalidation and works
through standard HTTP infrastructure.

## Alternatives Considered

- **Publish after commit without outbox:** rejected because a process crash can permanently lose the
  event.
- **One database poll per SSE connection:** rejected because load scales with connected browsers and
  the previous interval missed the propagation target.
- **WebSocket:** rejected because client-to-server realtime messages are not required.
- **Redis streams or pub/sub:** rejected because Redis is outside the selected topology.
- **Short polling only:** rejected because it increases stale windows and browser query load.
- **Exactly-once delivery claims:** rejected because at-least-once plus idempotency is the realistic
  contract.

## Implementation Details

The event envelope contains event ID/type/schema version, aggregate identity/version, supplier
scope, occurrence time, actor/client context, correlation/causation IDs, and sanitized payload.
Outbox rows record availability, attempts, lock ownership, processed time, and last safe error.

`REALTIME_POLL_MS` defaults to `1000` and is accepted only from `100` through `5000`. The pump reads
bounded batches in order and keeps a bounded event-ID deduplication window. Connections receive
15-second heartbeats. Replay is capped at 500 events, and authorization is evaluated at connect time
and for every event scope.

Browser clients display disconnected or resyncing state, retain `lastUpdatedAt`, and use realtime
only to invalidate REST-backed data.

## Consequences

Database poll frequency no longer grows with SSE connection count. Read-model and notification
consumers must remain idempotent. Permanent outbox retention requires bounded indexes and
operational monitoring.

The in-memory fan-out assumes the accepted single-API-process topology. A future multi-instance API
would require connection affinity or an explicitly selected shared distribution mechanism.

## Validation Evidence

- Unit coverage validates runtime bounds, replay, scope filtering, heartbeat behavior, reconnect
  handling, and browser resync/refetch behavior.
- PostgreSQL integration coverage proves domain state and outbox insertion remain atomic.
- Disposable full-stack browser coverage observes Assignment Board propagation in under five
  seconds through the real API and SSE stream.
- Browser teardown tests exercise connection shutdown before the Prisma pool closes.

## Risks

- A poison event can block processing without bounded retry/dead-letter visibility.
- An incorrectly scoped event can leak tenant data.
- Permanent retention can degrade scan performance without partial indexes.
- Running multiple API replicas without revisiting fan-out would make connected clients observe only
  a subset of live invalidations.

## Follow-up

Production capacity validation must measure pump lag, outbox growth, connection counts, and graceful
shutdown. Any move to multiple API replicas requires a separate architecture decision.
