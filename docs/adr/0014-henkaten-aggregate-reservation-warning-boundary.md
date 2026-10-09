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

The server derives line from the selected owned Shift Run. Non-Man categories require Active state;
Man may target a `NOT_STARTED` plan for pre-start resolution. Submission validates active job/part,
current source epoch, latest active published checklist, and exactly one `YES` per current item
before any write.

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

### Historical withdrawal and retention review (2026-10-09)

This review describes the baseline before visibility deletion. [ADR 0047](0047-tmmin-henkaten-deletion.md)
supersedes the absence of a TMMIN removal path and introduces a narrowly allowed, one-way metadata
update while preserving the business/evidence immutability described here.

The reservation and Shift Run lifecycle portions of this decision are superseded by ADR 0033.
The retention and atomic finalization boundary remain applicable. No application deletion path is
provided for a persisted Hosted Henkaten. The PostgreSQL Henkaten trigger rejects DELETE for every
status, preserves submitted context, and rejects subsequent updates to terminal rows. Checklist,
Man detail, transition, and approval evidence are also protected against mutation/deletion.

Withdrawal is exposed as POST `/api/v1/supplier/henkatens/:id/withdraw`. A normal Supplier session
for the active Hosted source is required. Only a Line Leader with the matching historical
occurrence `shiftRun.lineLeaderMemberId` can withdraw an Open record in the same tenant. This check
does not compare `createdById`, require the current clock to be inside the occurrence, or grant
the newly assigned LL ownership of an older occurrence. The request requires the expected record
version and a trimmed, nonempty reason of at most 1,000 characters.

Supplier, occurrence, and Henkaten locks protect one serializable transaction. Status becomes
Cancelled with cancellation reason WITHDRAWN, the supplied reason and finalization actor/time are
retained, pending approval routes become Not Required, and only this record's warning is closed.
Existing decisions are preserved. Lifecycle transition, audit, and outbox events are appended.
For recurring Man records, the effective assignment is recomputed from the latest other
Open/Approved change for the same job and occurrence, falling back to the configured default.
Reservation release remains only for historical records without a LineShift reference.

Occurrence expiry does not cancel an Open Henkaten. Assignment effects cease with the occurrence;
Open status and its warning remain until an authorized terminal transition. Reset setup is blocked
by Open Henkaten and retains Henkaten history after reset. Clone opens a separate form with a new
submission and the latest checklist; it neither withdraws the original nor reopens a terminal row.
PCR assessment remains separate and is not cleared by withdrawal.

Static review found a retry/contract discrepancy: the API client sends Idempotency-Key and OpenAPI
requires it, but the withdrawal controller does not validate/pass the key and the service stores
no withdrawal retry receipt. A repeated request after successful withdrawal returns resource-not-
found because the Open predicate no longer matches. A version mismatch on a still-Open record
returns conflict. No behavior change is adopted by this review; receipt-based retries and explicit
terminal errors require a separately reviewed implementation. Clone is currently offered for all
LL-visible lifecycle statuses, so correction guidance must distinguish cloning from cancellation.

Validation was limited to source, contracts, generated OpenAPI, SQL migration, existing integration
test, and prior browser-evidence inspection. The existing integration test checks default Man
restoration on withdrawal. No fresh runtime, database, or browser execution is claimed. Follow-up
coverage should exercise partial approval, concurrent approval/withdrawal, successful-response loss
and retry, historical LL reassignment, multiple effective overrides, and direct deletion rejection.

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
partial indexes. Submission creates persisted Supervisor and QC routes atomically. Read presenters
return route responsibility and immutable decision evidence rather than derived placeholders.

## Consequences

Submission locks Supplier then Shift Run and serializes the per-supplier sequence allocation.
Warnings and reservations remain durable after release/close. Reject, Withdraw, approved Man
movement, and End Shift share one terminal-effects boundary for route, reservation, warning,
transition, audit, and outbox consistency.

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

Notification persistence, SSE, approval inboxes, assignment board, and dashboard read models will
consume the committed route/finalization events.
