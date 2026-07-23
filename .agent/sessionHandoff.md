# Session Handoff — Architecture dan Repository Foundation

Last updated: 2026-07-23

Branch: `staging`

Repository state: Phase 0 dan Phase 1 complete; Phase 2 belum dimulai

## 1. Completed Objective

Architecture baseline dan local repository foundation untuk Enterprise Digital Henkaten Management
telah diselesaikan. Repository sekarang memiliki decision-complete architecture documents, pnpm ESM
workspace, shared Zod contracts, deterministic fixtures, PostgreSQL local lifecycle, dan baseline
CI.

Tidak ada product API, NestJS runtime, Prisma schema, frontend, atau remote deployment yang sudah
diimplementasikan.

## 2. Current Progress

- Completed: **Phase 0 — Product Contract dan Architecture Baseline**
- Completed: **Phase 1 — Repository Scaffold dan Local Tooling**
- Next: **Phase 2 — API Platform dan Persistence Foundation**
- Next subphase: **2.1 NestJS Runtime Foundation**
- Phase 2 status: **planned**

Tidak ada phase atau subphase yang saat ini ditandai `in_progress`.

## 3. Architecture Baseline

Delapan ADR berstatus Accepted tersedia di `docs/adr/`:

1. pnpm ESM monorepo dan package boundaries;
2. NestJS/Prisma/PostgreSQL modular monolith;
3. tenant isolation dan authorization boundaries;
4. database-backed session dan same-origin browser API;
5. transaction concurrency dan lock ordering;
6. transactional outbox dan SSE;
7. Hosted member-photo storage;
8. single-VM environment dan release constraints.

Normative implementation documents tersedia di `docs/architecture/`:

- aggregate ownership dan cross-aggregate transactions;
- state machines;
- domain-event dan public-error registry;
- security, privacy, dan accepted-risk baseline.

Keputusan penting:

- Node.js 22.23.1 dan pnpm 11.16.0;
- ESM menyeluruh dengan TypeScript NodeNext;
- package namespace `@tmmin-henkaten/*`;
- PostgreSQL 18;
- Zod-first dengan generated OpenAPI sebagai public wire artifact;
- tenant-scoped repositories tanpa PostgreSQL RLS;
- opaque database-backed session dengan same-origin browser API;
- PostgreSQL transactional outbox + SSE tanpa Redis;
- Sharp/private local volume untuk Hosted photo pada owning implementation;
- no backup/recovery/HA dan automatic production deployment tetap accepted risk.

## 4. Repository Foundation

Active workspaces:

- `apps/api`
  - compile-only ESM shell;
  - mengimpor shared contracts melalui package export;
  - tidak membuka HTTP port dan belum memakai NestJS/Prisma.
- `packages/contracts`
  - Zod runtime schemas;
  - shared domain/status/error/event enums;
  - common, auth/session, health/readiness, event-envelope contracts.
- `packages/test-fixtures`
  - deterministic fixture builders;
  - fixed UUID/time;
  - External fixture PII-policy checks;
  - tidak menjadi database seed atau production dependency.

Root tooling:

- exact pnpm lockfile;
- strict TypeScript 6/NodeNext;
- typed ESLint flat config dan import boundaries;
- Prettier;
- Vitest;
- root `validate` command;
- Node and pnpm version pins;
- local developer README.

Generated `.agent/*.pdf`, termasuk local `implementationPhases.pdf`, di-ignore dan tidak dihapus.

## 5. Shared Contracts

Current shared enums include:

- Hosted/External source modes;
- identity realm dan application roles;
- Shift Run states;
- Henkaten categories/statuses;
- approval routes/route states/decisions;
- cancellation and Assignment Issue states;
- External event/ingestion states;
- internal event registry;
- canonical public error codes.

Current common contracts include:

- opaque UUID;
- offset-required UTC timestamp normalization;
- safe correlation ID;
- positive optimistic version;
- cursor pagination with default 25/max 100;
- field-addressable Problem Details;
- Supplier/TMMIN login shapes;
- scoped session principal/response;
- password-change baseline;
- health/readiness;
- durable event envelope primitives.

No OpenAPI file exists yet. Endpoint implementation must generate OpenAPI from the shared Zod
schemas rather than create parallel manual schemas.

## 6. Local PostgreSQL

Configuration:

- PostgreSQL: 18.4;
- pgvector: 0.8.5;
- image:
  `pgvector/pgvector:0.8.5-pg18-bookworm@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0`;
- Compose project: `supplier-henkaten-local`;
- local port: `55432`;
- main DB: `supplier_henkaten`;
- disposable test DB: `supplier_henkaten_test`.

Root commands:

- `pnpm db:up`
- `pnpm db:wait`
- `pnpm db:verify`
- `pnpm db:migrate`
- `pnpm db:test:reset`
- `pnpm db:down`
- `pnpm db:destroy`

`db:migrate` currently reports zero registered migrations. Phase 2.3 must replace the dispatcher with
Prisma while preserving the root command.

Safety verified:

- test database name must end with `_test`;
- test reset does not alter a sentinel in the main DB;
- `db:down` preserves the main named volume;
- `db:destroy` explicitly removes only the project volume;
- no product tables remain or were introduced.

## 7. Baseline CI

`.github/workflows/ci.yml` runs on push/PR for `staging` and `main`, plus manual dispatch.

Jobs:

- `quality`: frozen install, format, lint, typecheck, tests, build;
- `database-smoke`: Compose validation, PostgreSQL lifecycle, version/extension checks, test reset,
  and always-on cleanup;
- `secret-scan`: Gitleaks with read-only repository permission.

There is no deployment job. CodeQL, dependency review, Trivy, Playwright, images, and deployment
remain owned by later phases.

The workflow has been parsed by Prettier and its local-equivalent commands passed. The remote
workflow is triggered by the final push to `staging`; its GitHub result remains the authoritative
clean-checkout confirmation.

## 8. Validation Evidence

Runtime:

- official temporary Node.js 22.23.1 distribution, SHA-256 verified;
- pnpm 11.16.0.

Commands/checks passed:

- `pnpm install --frozen-lockfile`;
- `pnpm clean` and clean rebuild;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm build`;
- `pnpm validate`;
- negative cross-workspace import lint probe;
- negative strict TypeScript probe;
- `docker compose config --quiet`;
- database start/wait/verify;
- PostgreSQL 18.4 and vector 0.8.5 verification;
- disposable test database reset;
- main-database isolation sentinel;
- volume persistence across `db:down`;
- explicit project volume destroy;
- ADR/architecture structure checks;
- final review confirmed that the eight existing ADR boundaries cover every durable decision in this
  batch, so no duplicate ninth ADR was required;
- high-confidence repository secret-pattern scan;
- ignored-artifact inspection confirmed that `.agent/implementationPhases.pdf`, build output,
  dependencies, and materials are not staged;
- `git diff --check`.

Test result:

- contracts: 11 tests passed;
- deterministic fixtures: 6 tests passed;
- API workspace shell: 1 test passed;
- total: 18 tests passed.

Final audit note:

- the complete workspace validation was rerun immediately before delivery using the pinned Node.js
  and pnpm versions;
- the first OrbStack start command reported a client-side startup timeout, but the VM reached
  `Running`; Docker then responded normally and the complete database smoke sequence passed;
- the temporary database container, network, and volume created by the final smoke test were removed
  after validation.

## 9. Runtime Cleanup

- PostgreSQL container stopped and removed.
- Compose network removed.
- project PostgreSQL volume removed after persistence validation.
- no application server, watcher, or worker remains.
- OrbStack was started only for database validation and was stopped before final handoff.

## 10. Known Constraints dan Risks

- Host default Node.js is v26; project commands must use Node.js 22.23.1.
- Permanent Hosted data retention remains a governance dependency.
- There is no database/photo backup, restore, RPO/RTO, or HA.
- Single VM remains a critical accepted failure domain.
- Production deployment remains automatic without manual approval.
- Baseline CI is not a substitute for later full security and E2E gates.

## 11. Next Recommended Action

Begin Phase 2.1 only:

1. turn the compile-only API shell into a NestJS 11 Express runtime;
2. preserve ESM/NodeNext and package boundaries;
3. add environment validation and global Problem Details mapping;
4. add structured logging and correlation in 2.2;
5. introduce Prisma 7 and the first non-domain persistence migration in 2.3;
6. replace the zero-migration dispatcher without renaming root `db:migrate`;
7. implement tenant context, audit/outbox, liveness/readiness, and PostgreSQL integration harness
   before supplier domain features.

Do not start frontend, Hosted domain workflows, External ingestion, or remote deployment during the
next batch.
