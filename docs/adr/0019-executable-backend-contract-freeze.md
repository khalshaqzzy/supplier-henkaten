# ADR 0019: Executable Backend Contract Freeze

- Status: Accepted
- Date: 2026-07-23

## Context

Frontend implementation needs a stable backend wire contract. The API uses NestJS decorators for
runtime route registration, Zod for shared validation, and a generated OpenAPI artifact. A manually
maintained route map can drift even when generation itself is deterministic: reconciliation found
eleven implemented operations missing from OpenAPI and five documented assignment routes whose path
parameter names differed from the controllers.

Backend hardening also needs performance evidence at the accepted capacity without turning load
fixtures into normal integration-test state or introducing a cache service.

## Decision

Freeze backend v1 through executable reconciliation and a separate repeatable Compact baseline.

- A unit test recursively inspects the NestJS module/controller metadata, normalizes route
  parameters, and requires the implemented operation set to equal the OpenAPI operation set.
- The committed OpenAPI document remains generated from shared Zod schemas and is checked for byte
  drift.
- OpenAPI `3.1.0`, API version `1.0.0`, enum values, status names, and problem codes are frozen for
  frontend development.
- Post-freeze changes within v1 may add optional read fields, pagination metadata, safe filters or
  sort options, safe problem codes, and database indexes. Removing/renaming fields, changing
  semantics, making optional input required, or changing enum values requires an explicit contract
  migration or a new API/schema version.
- The Compact baseline is a dedicated Vitest project, not part of unit or functional integration
  fixtures. It refuses to run unless connected to an empty database whose name ends in `_test`.
- Baseline data represents 42 suppliers with per-supplier maximum line/member/job counts plus deeper
  projection and audit history. Measurements occur at the HTTP server boundary after warmup.
- Query-plan evidence may add bounded composite indexes; no cache, materialized view, Redis, or
  second projection store is introduced without evidence that relational queries miss targets.

## Rationale

Checking generated-file drift proves only that generator input and output match. Comparing NestJS
metadata to OpenAPI proves that every registered HTTP operation has a documented counterpart and
that obsolete documented operations cannot survive unnoticed.

Keeping the capacity fixture in an explicit project makes destructive seeding intentional and keeps
the normal 31-test PostgreSQL suite fast. HTTP-boundary percentiles include routing, guards,
serialization, and database work while remaining deterministic enough for a preliminary frontend
gate.

## Alternatives Considered

### Manual route checklist

Rejected because it already allowed missing job, checklist, and TMMIN read operations plus parameter
name drift.

### Generate OpenAPI directly from NestJS decorators only

Rejected because shared Zod schemas are the runtime/public validation authority and must remain the
single DTO vocabulary.

### Run the full capacity seed in every integration test

Rejected because it would slow feature feedback, increase cross-test state risk, and obscure
functional failures.

### Add a cache or materialized views before measurement

Rejected because measured relational reads are far below preliminary targets and index-only scans
are available for the high-cardinality tenant lists.

## Consequences

- Adding a controller route without OpenAPI, or an OpenAPI operation without a controller, fails the
  unit gate.
- Parameter names are contract-significant and must match across runtime and documentation.
- The explicit baseline takes longer and destroys only its verified disposable test database.
- Local preliminary percentiles are evidence for frontend readiness, not final concurrent staging
  load certification.
- Composite indexes increase write and storage cost modestly in exchange for stable tenant
  pagination and cursor ordering.

## Validation

- Runtime/OpenAPI reconciliation passes with 124 paths and 140 HTTP operations.
- The Compact baseline passes with 42 suppliers, 20 lines, 300 members, and 500 jobs per supplier,
  plus 500 External projections and 1,000 audit rows per supplier.
- Dashboard, projection, audit, notification, standard mutation, and External ingestion p95 values
  meet their preliminary targets with zero unexpected errors.
- PostgreSQL uses the new composite indexes for job, member, External projection, and audit bounded
  reads.
- Fresh migration and the upgrade path from the previous migration checkpoint both apply
  successfully.

## Follow-up Work

- Generate frontend typed clients from the frozen artifact.
- Run the release-level concurrent staging load profile, including 30 users per supplier and
  approval/board propagation, before production readiness.
- Version public External schema changes rather than changing `1.0` in place.
