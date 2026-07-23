# ADR 0011: Permanent Master Data and Member Account Lifecycle

Status: Accepted

Date: 2026-07-23

## Context

Hosted suppliers require operational members and configuration that remain traceable after
assignment and Henkaten history are introduced. Correction workflows must not erase identity or
allow a person's approval role to change retrospectively. TMMIN support and Quality also require
controlled investigation access to Hosted operational data.

## Decision

Supplier master records are permanent from creation. Public hard-delete endpoints are not
provided; records are corrected in place or logically deactivated. Member role is immutable and is
enforced by both request contracts and a PostgreSQL trigger. A role correction creates a new member
after the incorrect member is deactivated.

Supervisor, Line Leader, and QC members have one linked supplier-realm User. MP members cannot have
credentials. Member deactivation disables the linked account and revokes sessions atomically.
Reactivation of a member does not implicitly reactivate its account.

The active limits are 300 members, 20 lines, and 500 jobs per supplier. Capacity-changing
transactions lock the Supplier row before counting and writing.

TMMIN Admin and TMMIN Quality may read Hosted master data across tenants through explicit
read-only routes. This includes member name, registration number, and photo for investigation.
Every such read writes a safe audit event. TMMIN Quality cannot see Hosted Preparation data,
usernames, or credentials.

## Rationale

Permanent identity prevents broken historical references. Immutable role avoids silently changing
the meaning of past and future decisions. Supplier-row locking provides a deterministic capacity
boundary. Explicit TMMIN routes keep privileged access visible and auditable.

## Alternatives

- Pre-activation hard deletion was rejected because it creates a second lifecycle and weakens
  traceability.
- Mutable member roles were rejected because account, assignment, and approval meaning could drift.
- Counting all retained rows toward limits was rejected because long-term deactivated history
  would eventually prevent normal operations.
- Unscoped TMMIN repository access was rejected because it hides privileged authorization.

## Implementation Details

Member, User, and tenant relations use supplier-aware foreign keys. Operational User creation is
validated by a database trigger against the linked member role and supplier. Normalized
registration numbers and usernames remain reserved after deactivation.

Deactivation is blocked while current default assignments reference the entity. Later operational
modules extend reference protection for active shifts, Open Henkaten, reservations, and working
assignments.

## Consequences

Incorrect records remain stored and consume permanent retention. Operational support must use
deactivate-and-recreate for role mistakes. TMMIN Quality receives sensitive Hosted PII access, so
production privacy approval remains a launch blocker.

## Validation Plan

- Member-role and operational-account database constraints.
- Active-capacity and concurrency tests.
- Tenant and role negative tests.
- Session revocation and one-time credential tests.
- Audited TMMIN Admin/Quality reads and Hosted Preparation denial.

## Validation Evidence

Phase 4 PostgreSQL integration and Supertest suites verify that Supervisor, Line Leader, and QC
creation returns one-time credentials while MP creation cannot create an account; the database
trigger rejects an in-place member-role update; member deactivation is blocked by a current
Default Assignment; and TMMIN Quality can read Hosted member PII through the read-only route while
the access produces a redacted audit event. Cross-tenant and cross-realm mutation attempts are
rejected. A fresh migration and an upgrade from the Phase 3 schema both completed successfully on
PostgreSQL 18.

## Risks

Permanent PII retention and the absence of backups remain accepted high/critical risks.
Privileged reads may create audit volume and must not record the PII values themselves.

## Follow-up

Assignment Board and audit read views must reuse these authorization rules. Operational reference
contributors are added with Shift and Henkaten persistence.

Deactivation guards now include planned/Active Shift Runs, active Working Assignments, Open
Henkaten, and active MP reservations. Line, Job, Part, Shift Template, checklist, and member
deactivation fail with `RESOURCE_IN_USE` when the operational references would be invalidated.
