# 0006 Transactional Outbox and Server-Sent Events

Status: Accepted

Date: 2026-07-23

Implementation refinement (Phase 2): the outbox worker polls PostgreSQL and claims work using
`FOR UPDATE SKIP LOCKED`; `LISTEN/NOTIFY` is not used. SSE delivery remains owned by Phase 8.

Scope: durable domain events, asynchronous processing, browser updates, and replay behavior

## Context

Assignment boards, notification centers, warnings, and dashboards must update without a page reload.
The system runs on one VM and must not add Redis. A database commit must not be reported to realtime
clients unless its event is durably recorded.

## Decision

Domain mutations insert an outbox record in the same PostgreSQL transaction as business state. An
API-hosted worker claims records with `FOR UPDATE SKIP LOCKED`, processes them with at-least-once
delivery, and records attempts and outcomes. Consumers use event IDs and domain uniqueness to remain
idempotent.

Browser realtime uses Server-Sent Events. Events contain an opaque event ID and support
`Last-Event-ID`. If the requested position cannot be replayed, the server emits a resync-required
control event and the client reloads the authoritative read model.

Redis and a separate message broker are not introduced. Outbox records are not deleted on a
schedule in v1; growth and processing lag are monitored.

## Rationale

The transactional outbox removes the database/event dual-write gap. SSE is sufficient for
server-to-browser updates, works through standard HTTP infrastructure, and has a smaller operational
surface than bidirectional sockets. PostgreSQL is already the required durable component.

## Alternatives Considered

- **Publish after commit without outbox:** rejected because a process crash can permanently lose the
  event.
- **WebSocket:** rejected because v1 does not need client-to-server realtime messages.
- **Redis streams or pub/sub:** rejected because Redis is outside the selected topology.
- **Short polling only:** rejected because it increases stale windows and query load.
- **Exactly-once delivery claims:** rejected because at-least-once plus idempotency is the realistic
  contract.

## Implementation Details

The event envelope contains event ID/type/schema version, aggregate identity/version, supplier
scope, occurrence time, actor/client context, correlation/causation IDs, and sanitized payload.
Outbox rows record availability, attempts, lock ownership, processed time, and last safe error.

SSE authorization is evaluated at connect time and for every event scope. Clients display
disconnected/stale state and retain `lastUpdatedAt`.

## Consequences

Read-model and notification consumers must be idempotent. Permanent outbox retention increases
storage usage and requires indexes that keep pending scans bounded. SSE connections count toward API
capacity and need graceful shutdown behavior.

## Validation Plan

- Rollback tests proving business state and outbox are atomic.
- Duplicate-delivery consumer tests.
- Worker contention tests using `SKIP LOCKED`.
- SSE reconnect and `Last-Event-ID` tests.
- Unauthorized event-scope tests.
- Lag and failed-attempt metrics tests.

## Risks

- A poison event can block processing without bounded retry/dead-letter visibility.
- An incorrectly scoped event can leak tenant data.
- Permanent retention can degrade scan performance without partial indexes.

## Validation Evidence

The durable event vocabulary and envelope primitives compile and pass shared-contract validation.
No outbox table, worker, or SSE route exists yet; their required semantics are fixed by this record
and the event registry.

## Follow-up

The append-only outbox foundation will be created with persistence. Notification consumers, SSE
routes, replay limits, and monitoring will be introduced with their read models.
