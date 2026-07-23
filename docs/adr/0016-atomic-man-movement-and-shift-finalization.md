# ADR 0016: Atomic Man Movement and Shift Finalization

Status: Accepted

Date: 2026-07-23

## Context

Final approval of a Man Henkaten can affect two Shift Runs, two Working Assignments, an MP
reservation, a donor vacancy, a target issue, warning state, and audit/outbox evidence. Planned
shifts must retain referenced assignment identities across preflight refresh. End Shift must clean
Open operational state without deleting the assignment and movement history needed for traceability.

## Decision

Approved Man finalization revalidates the active reservation and recorded source/target assignment
versions inside one `SERIALIZABLE` transaction. Locks follow Supplier, involved Shift Runs in UUID
order, Henkaten, routes/reservation, Working Assignments, members, then issue/warning/audit/outbox
state. The replacement MP is removed from a real source, the target's replaced MP is cleared, and
the replacement is assigned to the target exactly once. Default Assignment remains unchanged.

One immutable `AssignmentMovement` records source/target Shift Run, line, job, assignment, MP
snapshots, before/after versions, actor, timestamp, and correlation ID. A donor Assignment Issue is
created only when a real source job becomes vacant. An Open issue is resolved only when
`resolutionIssueId` explicitly names that target job/line/shift and the approved movement
demonstrably fills it.

A Man Henkaten may target an owned `NOT_STARTED` Shift Run. Referenced Working Assignment rows are
preserved during later preflight refresh. Current unreferenced plan rows are upserted, obsolete
unreferenced rows may be removed, and an approved resolution assignment is not overwritten by a
later default refresh. Start still recalculates every blocker before activating the resolved row.

End Shift is an idempotent LL-owned command. It locks the Active Shift Run and every Open Henkaten
owned by it or referencing one of its Working Assignments through an active reservation. Those
Henkatens become Cancelled with `SHIFT_ENDED`; Pending routes become Not Required; reservations and
warnings close; shift-owned Open issues become `CLOSED_SHIFT_ENDED`. Working Assignments are
deactivated, not deleted. The Shift Run becomes Ended with a persisted summary and command
idempotency evidence.

## Rationale

One transaction prevents partial assignment movement and makes the movement ledger a reliable
explanation of current state. Explicit issue links prevent a superficially similar assignment from
closing the wrong vacancy. Stable planned-row identity allows pre-start approval to be executed
without foreign-key breakage. Deactivation preserves the final board and movement history while the
next Shift Run can still begin from Default Assignment.

## Alternatives Considered

- Updating Default Assignment during a movement was rejected because a temporary operational change
  must not rewrite the normal baseline.
- Deleting and recreating planned assignments was rejected because Henkaten and reservation
  evidence reference those IDs.
- Resolving any Open issue on a job was rejected because it permits accidental or false resolution.
- Deleting Working Assignments at End Shift was rejected because it destroys terminal evidence.
- Asynchronous cleanup was rejected because partial terminal state would remain externally visible.

## Implementation Details

The schema adds plan-membership metadata, explicit Assignment Issue origin/resolution links,
immutable movement rows, and Shift Run end-command/summary fields. Tenant-aware foreign keys,
partial uniqueness, positive before/after version checks, and immutable ledger triggers defend the
boundary.

Henkaten, approval, movement, Withdraw, and End Shift share an operational-finalization service for
route, reservation, warning, transition, and terminal-event effects. Movement emits donor
issue-opened, issue-resolved, reservation-released, MP-moved, and recipient-targeted notification
request events; durable notification records remain outside this decision.

## Consequences

Cross-shift approval contends on both Shift Runs and the supplier row. Planned refresh is an upsert
and preservation operation rather than wholesale replacement. Ended Shift responses retain final
assignments and expose nullable end-summary counts.

## Validation

Real PostgreSQL tests cover active and planned Man approval, VACANT and assigned targets,
unassigned and cross-shift replacements, donor issue creation, explicit verified resolution,
movement/decision immutability, stable planned assignment IDs across refresh, successful Start
after resolution, exact End Shift retry, cancellation/release/route/warning summaries, and
preserved inactive Working Assignments.

## Risks

- Any new movement path that bypasses canonical locks can reintroduce deadlocks or duplicate MPs.
- New issue types must define whether they are compatible with a donor vacancy.
- Supplier-level serialization favors correctness over maximum write throughput.

## Follow-up

Notification workers and read models will materialize the emitted events. Frontend assignment board,
approval UX, dashboards, External ingestion, and deployment remain separate concerns.
