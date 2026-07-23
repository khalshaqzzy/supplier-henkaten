# 0005 Transaction Concurrency and Lock Ordering

Status: Accepted

Date: 2026-07-23

Scope: optimistic concurrency, multi-record transactions, database locking, and retry behavior

## Context

Approval decisions, Start/End Shift, Man reservations, assignment movement, source-mode cutover, and
external projections can receive concurrent requests. The platform must reject stale intent and
must never partially apply a workflow.

## Decision

Mutable aggregates carry a positive integer `version`. Mutations require the expected version and
perform an atomic version-checked update. A mismatch returns `409 VERSION_CONFLICT`.

Critical multi-record workflows use Prisma interactive transactions. Parameterized
`SELECT ... FOR UPDATE` is allowed through a reviewed repository helper when Prisma cannot express
the required lock. Lock acquisition follows this order:

1. Supplier;
2. Line and ShiftRun;
3. Henkaten;
4. approval route and MP reservation;
5. Job;
6. Member/MP;
7. warning, Assignment Issue, audit, and outbox.

Transactions that need phantom protection use PostgreSQL `SERIALIZABLE`. Retryable serialization
failures and deadlocks are retried at most three times with bounded jitter. A non-idempotent request
is not retried after an unknown commit outcome unless it carries a supported idempotency key.

## Rationale

Optimistic versioning provides clear stale-edit behavior for normal mutations. Explicit locks and
deterministic ordering protect workflows that span assignments and approvals. Bounded retry handles
normal database contention without hiding persistent errors.

## Alternatives Considered

- **Last-write-wins:** rejected because it can overwrite an approval or assignment decision.
- **Serializable isolation for every request:** rejected because it adds unnecessary contention.
- **Advisory locks as the primary mechanism:** rejected because row ownership and constraints remain
  the authoritative model.
- **Unlimited retry:** rejected because it can amplify overload and duplicate side effects.
- **Application-only uniqueness checks:** rejected because concurrent requests can pass the same
  precheck.

## Implementation Details

Application services define the complete transaction boundary. All database writes, audit entries,
warnings, notifications/outbox events, and reservation changes required by one business outcome are
committed or rolled back together. Unique constraints remain the final arbiter for one approval per
route, one active MP reservation, one active ShiftRun per line, and other invariants.

Error mapping distinguishes stale version, state conflict, idempotency conflict, reservation
conflict, and invalid transition.

## Consequences

Critical services must document lock order and idempotency behavior. Some repository methods require
a Prisma transaction client rather than a general client. Concurrency tests must use real
PostgreSQL.

## Validation Plan

- Concurrent Supervisor/QC decision tests.
- Duplicate QC route decision tests.
- End Shift versus final approval race tests.
- Concurrent MP reservation and Man movement tests.
- Source-mode cutover race tests.
- Serialization retry and retry-exhaustion tests.

## Risks

- A new workflow that acquires locks out of order can introduce deadlocks.
- Retrying code that performs side effects outside PostgreSQL can duplicate them.
- A missing expected-version condition can reintroduce silent overwrite.

## Validation Evidence

Positive optimistic versions, canonical conflict codes, transaction ownership, and lock ordering are
captured in shared contracts and normative architecture documents. Real transaction and race
validation remains owned by the persistence and domain implementation.

## Follow-up

Reusable transaction, lock, and retry helpers will be implemented with the persistence foundation
and exercised by each owning domain workflow.

Master-data capacity mutations lock Supplier before counting active members, lines, or jobs.
Checklist publish locks ChecklistTemplate before reading draft and allocating a version number.
Default assignment mutation locks DefaultAssignmentSet before assignment target and member rows.
Collection reorder locks resources in canonical UUID order and validates every expected version
before writing any display order.
