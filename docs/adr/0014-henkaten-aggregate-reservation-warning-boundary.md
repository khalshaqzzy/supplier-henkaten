# ADR 0014: Henkaten Aggregate, Reservation, and Warning Transaction Boundary

Status: Accepted

Date: 2026-07-23

## Context

A Hosted Henkaten submission must preserve the exact operational context and checklist evidence
used by the Line Leader. Man submissions additionally reserve a replacement MP and target job,
while every Open record creates an independent TMMIN warning. Partial commits would produce
untraceable evidence, double booking, or incorrect affected-part state.

## Decision

Henkaten, checklist snapshot/answers, category detail, initial lifecycle transition, warning,
audit, and outbox records are one transaction. Man submission adds `MPReservation` to the same
boundary while leaving Working Assignment unchanged until final approval.

Hosted identifiers use a supplier/business-date counter allocated atomically as
`HEN-{SUPPLIER_CODE}-{YYYYMMDD}-{SEQUENCE}`. The submission endpoint requires an
`Idempotency-Key`, scoped by supplier and creator, and stores a canonical request hash. Exact
retries return the existing aggregate; conflicting key reuse returns `IDEMPOTENCY_CONFLICT`.

The server derives line from the selected Active Shift Run owned by the authenticated LL. It
validates active job/part, current source epoch, latest active published checklist, and exactly one
`YES` per current item before any write.

Man detail stores target/source Working Assignment versions and replaced/replacement snapshots.
Partial unique indexes allow only one active reservation per replacement MP and target Working
Assignment. Withdraw locks the Henkaten and atomically transitions Open to Cancelled/Withdrawn,
releases its reservation, closes only its warning instance, appends lifecycle/audit records, and
emits outbox events.

Warning instances are retained individually. Affected-part state groups Open warnings by Supplier
plus normalized part-number snapshot, so closing one instance cannot clear another Open warning.
PostgreSQL triggers reject update/delete of checklist evidence, Man detail, and transition history;
Henkaten context is immutable and terminal Henkaten rows reject all further updates/deletes.

## Rationale

The aggregate boundary aligns every externally visible consequence with the evidence that caused
it. Creating the reservation during submission closes the double-booking window before approval.
Individual warning instances preserve correct aggregation and traceability.

## Alternatives

- Creating reservations only during approval was rejected because multiple Open Man submissions
  could promise the same MP or target.
- A single mutable affected-part flag was rejected because overlapping Open records cannot be
  closed independently.
- Reusing old checklist answers during Clone was rejected because current conditions must be
  affirmed again.
- Application-only immutability was rejected because operational data can also be accessed by
  maintenance and migration tooling.

## Implementation Details

The aggregate uses supplier-aware composite foreign keys and query indexes for date, status,
category, line, part, shift, and warning aging. A per-supplier/business-date sequence row allocates
the identifier under the submission transaction. Active reservation uniqueness is expressed by
partial indexes. Read presenters derive temporary approval-route shape while persisted route
decisions remain deferred.

## Consequences

Submission locks Supplier then Shift Run and serializes the per-supplier sequence allocation.
Warnings and reservations remain durable after release/close. Approval decisions, reject/end
release behavior, approved Man movement, and cascade remain deferred.

## Validation Plan

- Exercise identifier and reservation races on real PostgreSQL.
- Verify exact/conflicting idempotency behavior.
- Verify checklist/category/source/tenant/assignment validation occurs before writes.
- Verify withdrawal atomically releases reservation and closes only its warning.
- Verify evidence/context/terminal immutability through direct database mutation attempts.

## Risks

- Supplier locking serializes Henkaten writes and may require finer-grained sequence locking after
  observed production contention.
- Clone prefill can become stale immediately; submission must always revalidate all references.
- Database triggers require explicit review in future expand/contract migrations.

## Validation Evidence

Integration tests cover exact/conflicting idempotent retries, all-YES rejection, concurrent unique
identifier allocation, Man reservation conflict, unchanged Working Assignment before approval,
atomic release/close on Withdraw, overlapping-warning aggregation, immutable evidence/terminal
triggers, Hosted Preparation denial, role/tenant scope, and TMMIN read-only access. The migration
passes fresh and prior-schema upgrade paths on PostgreSQL.

## Follow-up

Future approval/finalization work persists decisions, releases reservations on reject/end, applies
final approved Man movement, creates cascade vacancies, and finalizes Shift Run cleanup.
