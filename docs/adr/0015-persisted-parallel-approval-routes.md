# ADR 0015: Persisted Parallel Approval Routes

Status: Accepted

Date: 2026-07-23

## Context

Hosted Henkaten requires independent Supervisor and QC decisions. Deriving approval state from the
Henkaten terminal status cannot preserve route responsibility, decision order, reject-fast
evidence, rerouting, or exact command retries. Concurrent decisions also need a durable arbiter that
cannot be replaced after commit.

## Decision

Every Henkaten is created with exactly one `SUPERVISOR` and one `QC` approval route. Open records
start Pending; Cancelled backfill records are Not Required. The Supervisor route snapshots the
Shift Run's responsible Supervisor. A missing Supervisor remains visibly Pending and cannot be
decided until a Supplier Admin appends a reroute record. The QC route is tenant-wide and the first
active QC decision wins.

The authenticated role determines the route. Request bodies cannot select it. Each decision stores
immutable actor/user/member snapshots, role, comment, time, source IP, correlation ID, expected and
result Henkaten versions, idempotency key, and canonical payload hash.

An Approve terminalizes only that route. The first Approve leaves the Henkaten Open; the second
Approve finalizes it Approved. The first Reject finalizes it Rejected and marks the other Pending
route Not Required. Terminal decisions cannot be withdrawn or replaced.

Decision and reroute commands run at PostgreSQL `SERIALIZABLE`, use optimistic Henkaten versions,
and require `Idempotency-Key`. An exact retry returns the committed detail. Reusing the key for a
different payload returns `IDEMPOTENCY_CONFLICT`; stale intent returns `VERSION_CONFLICT`; a route
that is no longer Pending returns a state conflict. Conflict audits are written outside a rolled
back decision transaction so failed attempts remain durable.

## Rationale

Persisted routes make responsibility and pending work queryable without reconstructing history.
Immutable evidence and database uniqueness make the database, rather than request timing, the
authority for concurrent decisions. Reject-fast behavior matches the operational rule while keeping
the unneeded route explicit.

## Alternatives Considered

- Derived route placeholders were rejected because they lose actor evidence and rerouting history.
- A single combined approval row was rejected because it cannot represent independent route state.
- Client-selected routes were rejected because role spoofing would cross an authorization boundary.
- Updating a Supervisor snapshot in place without history was rejected because original
  responsibility must remain auditable.
- Replacing decisions was rejected because terminal evidence must be non-repudiable.

## Implementation Details

`HenkatenApprovalRoute`, `ApprovalDecision`, and append-only `ApprovalRouteRouting` use tenant-aware
foreign keys, positive version checks, route/decision uniqueness, and idempotency indexes.
PostgreSQL triggers prevent mutation or deletion of decision/routing evidence and prevent terminal
route mutation. Henkaten list filtering can select a route and status, or match either route when no
route is selected.

Submission creates both routes in the same transaction as Henkaten evidence and warning state.
Finalization closes only the Henkaten's warning, appends lifecycle evidence, and emits
`HENKATEN_APPROVAL_RECORDED` plus the appropriate terminal events in the same transaction.

## Consequences

Every future Henkaten source must create or project two route rows. Supplier Admin can change only
Pending Supervisor responsibility. An approval response is slightly larger because it returns
persisted route and decision evidence.

## Validation

Contract and PostgreSQL integration tests cover both decision roles, first-Approve Open state,
second-Approve finalization, QC rejection, Not Required routing, exact/conflicting retries, stale
commands, Supplier Admin rerouting, preservation of initial responsibility, old-Supervisor denial,
two-QC races, warning closure, and direct database decision mutation rejection.

## Risks

- Supplier-level serialization can create contention for a very large tenant.
- New terminal workflows must use the shared finalization service or route/warning state can drift.
- Maintenance migrations must explicitly account for immutable triggers.

## Follow-up

Notification persistence, SSE delivery, approval inbox read models, and dashboards will consume the
transactional events without changing decision ownership.
