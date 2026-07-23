# ADR 0012: Versioned Checklists and Typed Default Assignments

Status: Accepted

Date: 2026-07-23

## Context

Henkaten submission requires a deterministic checklist snapshot, while Supplier Admin needs a
working draft that can change without rewriting history. Default Supervisor, Line Leader, and MP
relationships have different cardinality and movement rules.

## Decision

Each supplier has one ChecklistTemplate per 4M category. The template owns a mutable persisted
draft. Publishing locks the template and appends an immutable numbered ChecklistVersion with
ordered version items. PostgreSQL triggers reject update or deletion of published versions and
items.

Default assignments use separate typed relations: DefaultLineSupervisor, DefaultLineLeader, and
DefaultJobMp. A supplier-level DefaultAssignmentSet owns a monotonic version incremented by every
assignment mutation. Line Leader and MP moves update donor and target state in one transaction.
Supervisor may be assigned to multiple lines.

## Rationale

Persisted drafts support iterative administration without weakening published history. Typed
relations allow PostgreSQL uniqueness and foreign keys to express role-specific cardinality more
reliably than a polymorphic table. The assignment-set version gives Shift Run a stable future
snapshot boundary.

## Alternatives

- Publishing request items directly without a draft was rejected because draft recovery and
  concurrent administration would be unclear.
- Editing a published checklist in place was rejected because existing Henkaten snapshots would
  become unverifiable.
- A single polymorphic assignment table was rejected because nullable target/member columns and
  partial constraints would be harder to validate.

## Implementation Details

Draft replacement and publish use optimistic template versions. Normalized labels are unique in a
draft. A usable Hosted configuration has an active published version for MAN, MACHINE, MATERIAL,
and METHOD.

Assignment mutations lock DefaultAssignmentSet before target/member rows. Supplier-aware composite
foreign keys prevent cross-tenant relations. Removing an assignment deletes only the current
relation; immutable audit retains the change.

## Consequences

Draft items may be replaced because they are unpublished working state. Published rows grow
permanently. Default assignment history is reconstructed from audit and future shift snapshots,
not retained relation rows.

## Validation Plan

- Draft optimistic concurrency and duplicate-label tests.
- Empty-publish rejection and version sequencing tests.
- Database-level immutable-version tests.
- Assignment uniqueness, atomic move, tenant, role, and stale-version tests.
- Hosted cutover completeness checks.

## Validation Evidence

Phase 4 PostgreSQL integration tests publish all four category checklists, verify that direct
updates to a published version are rejected by PostgreSQL, and exercise typed Supervisor, Line
Leader, and MP assignments. The same flow proves that the Hosted configuration contributor moves
from detailed Phase 4 blockers to eligible after complete active configuration, while the Phase 9
contributor remains fail-closed. Unit and contract tests cover checklist input contracts and
normal/cross-midnight Shift Template time calculations.

## Risks

Concurrent moves require canonical locking to avoid deadlocks. Checklist growth is permanent and
must be monitored with other retained domain history.

## Follow-up

Shift Run snapshots DefaultAssignmentSet version and current assignments. Henkaten snapshots the
selected published checklist version and item labels.
