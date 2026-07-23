# 0002 NestJS, Prisma, and PostgreSQL Modular Monolith

Status: Accepted

Date: 2026-07-23

Implementation refinement (Phase 2): Prisma 7 uses the `prisma-client` ESM generator and
`@prisma/adapter-pg`; runtime never applies migrations. Zod remains the runtime authoring source,
and the committed OpenAPI 3.1 artifact is generated and drift-checked from those schemas.

Scope: backend architecture, persistence, runtime contracts, and migration strategy

## Context

Henkaten processing includes tenant isolation, shift and assignment state, parallel approval,
reservations, warning projection, external ingestion, and immutable audit. These capabilities need
strong transaction boundaries but do not require independently deployed services. The public and
internal APIs must share runtime validation with both browser applications.

## Decision

The backend is one NestJS modular monolith using the Express adapter. Prisma is the default ORM and
migration tool. PostgreSQL 18 is the sole business-data database.

Controllers handle transport parsing, authenticated context, validation, and response mapping.
Application services own use cases and transaction boundaries. Domain services own reusable policy.
Repositories own persistence and always operate through an explicit tenant or TMMIN scope.

Zod schemas are the authoring and runtime source for request, response, and event contracts.
Published OpenAPI is generated from those schemas and becomes the external wire-contract artifact.
CI must reject drift between the generated artifact and committed or served OpenAPI.

Database migrations are forward-only and follow expand/contract. A destructive removal cannot be
combined with the code transition that stops using the old structure.

## Rationale

A modular monolith keeps transactional workflows in one process and database while preserving
ownership boundaries. Prisma provides typed queries and repeatable migrations, while PostgreSQL
constraints and locks provide defense in depth. Zod-first authoring prevents separate frontend,
backend, and documentation schemas from drifting.

## Alternatives Considered

- **Microservices:** rejected because distributed transactions and operational overhead add risk
  without a current scaling requirement.
- **Database triggers for domain policy:** rejected because policy and audit intent would be hidden
  from application tests.
- **OpenAPI-first manual authoring:** rejected because runtime validation would require a generated
  secondary representation and a larger code-generation toolchain.
- **In-memory or host-installed PostgreSQL for tests:** rejected because concurrency and constraint
  behavior must match PostgreSQL.
- **Destructive down migrations:** rejected because the product explicitly has no backup or recovery
  mechanism.

## Implementation Details

The backend module boundaries are Auth, Tenancy, Users/Members, Master Data, Shifts, Assignments,
Checklists, Henkaten, Approvals, Notifications, Dashboards, External Ingestion, Audit, and
Health/Readiness.

PostgreSQL constraints enforce referential integrity and tenant-aware uniqueness. Raw SQL is limited
to parameterized operations that Prisma cannot express safely, including selected row-lock helpers.
The local and CI database image includes pgvector for repository consistency, but no vector feature
or vector column is introduced.

## Consequences

All backend modules share one deployment and one failure domain. Cross-module mutation must be
coordinated through application services rather than direct repository calls. OpenAPI generation
becomes a required build/contract check when HTTP endpoints are introduced.

## Validation Plan

- Validate module dependency rules during backend implementation.
- Run all persistence and concurrency integration tests against PostgreSQL containers.
- Verify fresh and upgrade migrations.
- Verify generated OpenAPI against Zod schemas when endpoint contracts exist.

## Risks

- A poorly enforced modular boundary can turn the backend into a tightly coupled monolith.
- Prisma abstractions may not cover every required lock operation.
- Forward-only migration discipline is essential because database restoration is unavailable.

## Validation Evidence

The repository foundation was validated against PostgreSQL 18.4 and pgvector 0.8.5 using the pinned
multi-architecture image digest. Zod contracts compile as ESM and are consumed through workspace
exports. NestJS, Prisma, OpenAPI generation, and product migrations are intentionally not yet
implemented.

## Follow-up

NestJS, Prisma, initial migrations, environment validation, and database integration harness will be
introduced with the API platform and persistence foundation.
