# 0003 Tenant Isolation and Authorization Boundaries

Status: Accepted

Date: 2026-07-23

Implementation refinement (Phase 2-3): immutable `TenantScope` and separate TMMIN capability paths
are implemented with default-deny route metadata. Supplier-facing mutation contracts do not expose
a freely writable `supplierId`; outside-tenant IDs resolve as not found.

Scope: supplier data isolation, cross-tenant administration, repository access, and denial behavior

## Context

The platform hosts 20–42 suppliers in one database. Supplier users must never select or infer another
supplier's data. TMMIN roles require explicit cross-supplier monitoring and administration without
becoming a hidden bypass. PostgreSQL row-level security is not a v1 requirement.

## Decision

Supplier scope is derived from the authenticated principal and represented by an immutable
`TenantScope`. Supplier-facing repositories require that scope and do not accept an arbitrary
`supplierId` from request bodies. TMMIN cross-tenant operations use separate repository entry points
that require an explicit TMMIN principal and capability.

Object lookup outside the caller's tenant or visibility scope returns `404 RESOURCE_NOT_FOUND`.
Authenticated users who can see the resource but lack the requested capability receive
`403 FORBIDDEN`.

Tenant-owned relations use `supplierId` directly or an unambiguous tenant-owned parent. Composite
tenant-aware constraints and foreign keys are used where practical to make cross-tenant links
invalid at the database layer. PostgreSQL row-level security is not used in v1.

## Rationale

Scope-bearing repository APIs make unsafe access visible at compile and review time. Separate TMMIN
paths avoid a generic unscoped mode. Consistent `404` behavior prevents opaque identifier probing,
while `403` remains useful for visible resources and role mistakes.

## Alternatives Considered

- **Trusting frontend filtering:** rejected because frontend visibility is not authorization.
- **Accepting `supplierId` in supplier request bodies:** rejected because it enables mass-assignment
  and confused-deputy failures.
- **One optional-scope repository API:** rejected because a missing scope could silently become
  global access.
- **PostgreSQL RLS:** deferred because the selected v1 model relies on scoped repositories, guards,
  constraints, and negative tests.
- **Always returning `403`:** rejected because it reveals existence outside the caller's scope.

## Implementation Details

- Authentication creates a principal containing realm, role, user ID, supplier ID when applicable,
  and session ID.
- Guards resolve capability before application service execution.
- Supplier application services receive `TenantScope`, not a free-form supplier ID.
- Cache keys, notifications, audit events, jobs, and outbox events include tenant scope.
- TMMIN support actions record the target supplier and actor in append-only audit.
- Prisma middleware may provide additional assertions but is not the sole control.

## Consequences

Repository interfaces are more explicit and some TMMIN queries require dedicated read models.
Every protected resource needs cross-role and cross-tenant negative tests. Database design must
carry supplier scope consistently.

## Validation Plan

- Compile-time review of repository signatures.
- API tests for supplier A attempting to read or mutate supplier B.
- Tests for spoofed supplier and line identifiers.
- Tests that distinguish invisible-object `404` from visible-but-forbidden `403`.
- Constraint tests that reject cross-supplier relationships.

## Risks

- A new unscoped query can bypass the intended boundary if review and negative tests are omitted.
- Background workers can lose scope if event envelopes are incomplete.
- Broad TMMIN read access increases the impact of compromised privileged accounts.

## Validation Evidence

Aggregate scope, denial precedence, and tenant-aware repository boundaries are documented in the
normative architecture baseline. Runtime guards, repositories, constraints, and negative tests now
protect tenant-owned master-data endpoints.

Supplier master data also uses explicit TMMIN cross-tenant read routes. TMMIN Admin may read Hosted
and active Hosted Preparation configuration; TMMIN Quality may read only Hosted configuration.
These reads write safe audit events. Supplier operational roles do not receive unscoped
master-data list access; their scoped board/read models remain separately owned.

## Follow-up

Shift and Henkaten repositories must preserve the same explicit scope and denial precedence.
