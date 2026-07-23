# ADR 0013: Durable Shift Slot, Preflight, and Working Assignment

Status: Accepted

Date: 2026-07-23

## Context

Start Shift combines a scheduled local-time slot, mutable default assignments, current member and
account eligibility, and operational conflicts that may change between preview and commit. A
preflight result cannot be the source of truth because it can become stale. Emergency continuity
also requires a visible degraded state rather than duplicate effective MP assignments.

## Decision

One permanent `ShiftRun` represents the tuple Supplier + Line + Shift Template + business date.
Repeated preflight refreshes the same `NOT_STARTED` row and replaces its pristine Working
Assignment plan. Once the shift starts, neither later preflight nor Default Assignment changes
rebuild that snapshot.

The Shift Run stores local-time and IANA timezone snapshots plus calculated UTC boundaries.
`@js-temporal/polyfill` performs cross-midnight and DST-aware conversion. PostgreSQL partial unique
indexes enforce one Active Shift Run per line and one Active Shift Run per effective Line Leader.

Preflight snapshots every active job because v1 has no optional-job flag. It persists structured,
PII-safe checks and candidate Working Assignments. Start Shift locks Supplier then Shift Run,
recomputes source epoch, master/account validity, checklist, issue, Henkaten, reservation, and
assignment availability inside a serializable transaction, and treats the stored preview only as
evidence.

Normal start requires no blocker. Supplier Admin emergency start may retain operational blockers,
but never bypasses source epoch/mode, inactive line/template, slot uniqueness, or active Line
Leader uniqueness. If the default Line Leader is missing, an active substitute Line Leader is
mandatory and is snapshotted only on the Shift Run; Default Assignment remains unchanged.

Conflicted, reserved, and vacant candidates become non-effective Working Assignment rows.
Emergency start creates an Open Assignment Issue for each affected job. Assignment Issue creation
and verified-workflow resolution are transaction-scoped services with no generic mutation route.

## Rationale

A durable plan gives operators a stable object/version for preview, refresh, audit, and eventual
pre-start resolution. Recalculation prevents time-of-check/time-of-use gaps. Keeping blocked
candidates non-effective allows production continuity without weakening the database invariant
that one MP can occupy only one active Working Assignment.

## Alternatives

- Ephemeral preflight was rejected because there would be no stable version or resolution target.
- Rebuilding from defaults during Start was rejected because it can discard an operator-reviewed
  plan silently.
- Allowing duplicate effective MP rows during override was rejected because downstream board and
  Man movement semantics would become ambiguous.
- Updating Default Assignment when choosing a substitute LL was rejected because emergency
  continuity must not rewrite the normal baseline.

## Implementation Details

`ShiftRun`, `WorkingAssignment`, and `AssignmentIssue` use supplier-aware foreign keys and
optimistic versions. Partial unique indexes own Active line, Active LL, effective MP, and Open
issue invariants. Preflight/start results and mutations write safe audit metadata; successful starts
also enqueue transactional outbox events. Role-scoped queries derive supplier and line ownership
from the authenticated principal.

## Consequences

Supplier-row locking serializes shift-slot and operational creation within a supplier. This favors
correctness and deterministic identifier/assignment behavior over maximum write concurrency.
`ENDED` persistence exists, but the End Shift command and cleanup remain deferred.

## Validation Plan

- Exercise slot/start and uniqueness races on real PostgreSQL.
- Verify preflight-to-commit changes are recalculated.
- Verify normal/override role, source-purpose, tenant, and line scopes.
- Verify stale defaults do not mutate Active Working Assignments.
- Verify local-time boundaries across midnight and DST.

## Risks

- Supplier-level serialization can become a write-contention point for very large tenants.
- New commit-time contributors can accidentally change blocker classification without matching
  contract and test changes.
- Deferred End Shift means Active operational data has no product cleanup command yet.

## Validation Evidence

PostgreSQL integration tests prove concurrent preflight creates one slot, concurrent start yields
one winner, active snapshots survive later default changes, stale default-set versions block at
commit, the blocked audit is retained, substitute-LL emergency start creates vacancy issues, and
Working Assignment effective-MP uniqueness remains intact. Unit tests cover cross-midnight and DST
boundaries. Fresh and prior-schema upgrade migrations both apply successfully.

## Follow-up

Future approval/finalization work executes verified pre-start Man resolution, approved assignment
movement/cascade, issue resolution, and End Shift.
