# Enterprise Digital Henkaten Management - Implementation Phases

Document status: Active implementation roadmap
Created: 2026-07-23
Last updated: 2026-08-04
Source of truth: `.agent/PRD.md`
Implementation approach: Backend-first
Workspace tooling: Node.js 22 + pnpm workspaces, tanpa Turborepo
Estimation policy: Dependency-driven, tanpa estimasi kalender atau engineer-days

## 1. Tujuan Dokumen

Dokumen ini menerjemahkan PRD Enterprise Digital Henkaten Management menjadi urutan implementasi coding yang dapat dijalankan oleh engineer atau coding agent tanpa harus menentukan kembali arsitektur, dependency, scope, atau quality gate.

Roadmap mencakup:

- repository dan local development foundation;
- NestJS API, Prisma, PostgreSQL, security, dan multi-tenancy;
- domain Supplier, shift, assignment, Henkaten, approval, warning, dan audit;
- External REST API;
- dua React Vite frontend;
- integration dan end-to-end testing;
- Docker, Caddy, CI/CD, staging, production, UAT, dan handoff.

Roadmap tidak memberikan estimasi waktu. Urutan didasarkan pada dependency dan risk containment. Phase atau subphase hanya boleh dimulai bila entry dependency-nya terpenuhi.

## 2. Current Repository Status

Kondisi repository setelah Phase 0-10:

- branch aktif: `feat/typography-elements`;
- `.agent/PRD.md` tersedia dan menjadi product contract;
- dua puluh ADR dan delapan architecture/security baseline tersedia;
- Node.js 22.23.1 + pnpm 11.16.0 ESM workspace tersedia;
- active workspace: NestJS API, shared contracts, dan deterministic test fixtures;
- strict TypeScript, ESLint, Prettier, Vitest, root validation, dan lockfile tersedia;
- local PostgreSQL 18 + pgvector 0.8.5 Compose lifecycle tersedia;
- baseline GitHub CI memiliki quality, database-integration, dan secret-scan jobs;
- root quality/integration commands bersifat hermetic pada clean checkout, Gitleaks version dipin,
  dan local CI-parity verification wajib dilakukan sebelum commit;
- NestJS/Express runtime, Prisma 7 adapter, initial PostgreSQL migration, OpenAPI 3.1, audit,
  outbox, health/readiness, authentication, RBAC, TMMIN administration, supplier provisioning, dan
  source-governance core tersedia;
- pure External provisioning dan Hosted Preparation boundary telah diimplementasikan;
- Hosted supplier master data telah tersedia: member/account, private photo, line/job, part, Shift
  Template, versioned 4M checklist, typed Default Assignment, logical deactivation, dan audited
  TMMIN read-only access;
- minimum Hosted configuration contributor dan External next-epoch credential contributor telah
  aktif;
- durable Shift Run plan, atomic normal/emergency Start Shift, Working Assignment snapshot,
  Assignment Issue foundation, scoped query, reference protection, dan operational cutover
  contributor telah tersedia;
- immutable Hosted Henkaten 4M, checklist evidence, idempotent identifier allocation, warning
  aggregation, MP reservation, Withdraw + Clone, dan TMMIN read-only query telah tersedia;
- persisted parallel Supervisor/QC approval, immutable decision/reroute evidence, reject-fast,
  atomic approved Man movement, linked vacancy resolution, pre-start Man execution, dan
  transactional End Shift telah tersedia;
- durable per-user notification, scoped Assignment Board, supplier/TMMIN dashboard, audit read API,
  dan resumable SSE invalidation stream telah tersedia;
- epoch-bound external client/secret lifecycle, opaque 15-minute token, strict public event
  contracts, immutable ordered ingestion, per-item batch processing, External projection/warning,
  TMMIN notification, dan unified dashboard/freshness telah tersedia;
- executable 146-operation NestJS/OpenAPI reconciliation, direct external policy/rate-limit tests,
  migration upgrade evidence, additive cursor indexes, dan repeatable Compact HTTP/query-plan
  baseline telah tersedia;
- role-scoped route, page-state, user-flow, dan frontend contract-gap specification tersedia di
  `.agent/PAGES.md`;
- dua React/Vite frontend workspace, shared Henkaten Design System, typed browser API boundary,
  session-aware shells, seluruh Hosted Supplier workflow, dan seluruh TMMIN governance/monitoring
  workflow tersedia;
- local full-stack Compose, centralized realtime outbox fan-out, isolated Playwright Chromium/Edge
  E2E, production containers, dan deployment workflows tersedia; aktivasi staging eksternal masih
  berjalan;
- materi slide tersedia sebagai reference-only input.

Completed phases: **Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, Phase 9, Phase 10, Phase 11, Phase 12, Phase 13, dan Phase 14**
Current phase: **Phase 15 - Production Containers, CI/CD, dan Staging (`in_progress`)**
Current subphase: **15.9 Automatic Staging Deployment (`in_progress`)**
Next subphase: **15.11 Staging Deployment Rehearsal (`planned`)**

Tidak ada application behavior yang boleh ditandai implemented sampai source code dan acceptance checks terkait benar-benar tersedia di repository.

## 3. Status Model dan Progress Rules

Status yang diizinkan:

- `planned`: belum dimulai dan dependency belum atau sudah tersedia;
- `in_progress`: sedang dikerjakan;
- `blocked`: tidak dapat dilanjutkan karena dependency atau external input;
- `done`: seluruh exit criteria dan validation lulus;
- `deferred`: sengaja dipindahkan keluar scope atau ke release berikutnya.

Progress rules:

- maksimal satu phase berstatus `in_progress`;
- di dalam current phase, maksimal satu subphase berstatus `in_progress`;
- subphase tidak boleh `done` hanya karena source file dibuat; seluruh verification dan exit criteria harus lulus;
- blocker dan alasan defer wajib ditulis eksplisit;
- dependency tidak boleh dilewati diam-diam;
- bila implementasi menyimpang dari PRD atau roadmap, dokumen terkait wajib diperbarui pada session yang sama;
- setiap substantive implementation batch wajib memperbarui:
  - `.agent/implementationPhases.md`;
  - `.agent/sessionHandoff.md`;
  - ADR terkait di `docs/adr/`;
- development server, test process, watcher, dan Docker container yang dijalankan agent wajib dihentikan setelah tidak diperlukan.

## 4. Cross-cutting Engineering Rules

### 4.1 Architecture

- Backend-first: frontend feature work tidak dimulai sebelum backend contract freeze pada Phase 10.
- Domain policy tidak boleh berada di controller, route handler, React component, atau database trigger yang tidak terdokumentasi.
- Controller hanya menangani transport, validation boundary, authentication context, dan response mapping.
- Domain service/application service menangani use case dan transaction boundary.
- Repository layer wajib tenant-scoped dan tidak menerima arbitrary `supplierId` dari supplier-facing request body.
- PostgreSQL constraints menjadi defense-in-depth untuk uniqueness dan referential integrity.
- PostgreSQL Row-Level Security tidak menjadi requirement v1; tenant isolation dibuktikan melalui scoped repository, authorization guard, constraint, dan negative tests.
- Frontend tidak pernah mengakses PostgreSQL secara langsung.
- Redis tidak ditambahkan. Session, outbox, notification, idempotency, dan read-model state menggunakan PostgreSQL.
- Realtime browser menggunakan Server-Sent Events (SSE). Domain event durability menggunakan transactional outbox; SSE bukan source of truth.

### 4.2 Contracts

- Zod schema di `packages/contracts` menjadi runtime validation dan shared TypeScript contract.
- OpenAPI v1 diturunkan atau direkonsiliasi dengan shared Zod schemas.
- Backend dan frontend tidak boleh memiliki enum/status duplikat yang dapat drift.
- Breaking public API change memerlukan version baru atau explicit migration plan.
- Internal API change setelah Phase 10 hanya boleh additive atau disertai contract migration.

### 4.3 Database dan Migrations

- Local dan automated database tests memakai Docker-managed PostgreSQL dengan pgvector available.
- Host-machine PostgreSQL tidak menjadi normal development dependency.
- Setiap schema change memiliki Prisma migration dan integration test.
- Migration production bersifat forward-only dan expand/contract.
- `prisma migrate reset` dilarang pada staging/production.
- Destructive migration tidak boleh digabung dengan code transition dalam satu release.
- Tidak ada backup/recovery pada v1; roadmap tidak boleh menyiratkan sebaliknya.

### 4.4 Security dan Privacy

- Password di-hash menggunakan Argon2id.
- Session memakai opaque random ID yang disimpan hashed/database-backed dan dikirim melalui secure HttpOnly cookie.
- Supplier-facing authorization selalu memverifikasi tenant, role, dan object scope.
- TMMIN cross-tenant access menggunakan explicit guard dan audit.
- External API credential terikat supplier + source epoch + scope.
- Hosted PII tidak boleh muncul di log.
- External API tidak menerima nomor registrasi, foto, username, password, email, phone, health, attendance, atau skill data.
- Secret, cookie, access token, password, dan Authorization header wajib disensor dari log/audit.

### 4.5 Testing

- Test capability ditulis dalam phase yang sama dengan implementation capability.
- Dedicated hardening phase tidak menggantikan unit/integration tests per feature.
- Database concurrency rule wajib diuji dengan real PostgreSQL, bukan in-memory mock.
- Playwright E2E memakai real API dan disposable PostgreSQL test database.
- Test fixture tidak boleh menjadi production behavior fallback.
- Cross-tenant dan cross-role negative tests wajib untuk setiap new protected resource.

### 4.6 Frontend

- Business policy tetap di backend/shared contracts, bukan React components.
- Kedua frontend menggunakan typed API client, TanStack Query, React Hook Form, dan Zod.
- Server pagination/filtering digunakan untuk list dan dashboard.
- Loading, empty, error, forbidden, conflict, dan stale state wajib.
- Desktop minimum target 1280×720.
- Status 4M tidak hanya dibedakan dengan warna.

### 4.7 Documentation

- PRD tetap menjadi product contract.
- Roadmap menyimpan progress dan sequencing, bukan mengulang seluruh requirement.
- ADR mencatat keputusan arsitektur dan tradeoff.
- Session handoff mencatat pekerjaan aktual dan next task.
- Secret value, production IP, credential, atau private key tidak boleh ditulis ke docs.

## 5. Target Repository Layout

```text
apps/
  api/
  supplier-web/
  tmmin-web/
  e2e/
packages/
  contracts/
  ui/
  test-fixtures/
deploy/
  caddy/
  compose/
  env/
  scripts/
.github/
  workflows/
docs/
  adr/
.agent/
  PRD.md
  implementationPhases.md
  sessionHandoff.md
```

Ownership:

- `apps/api`: NestJS API, Prisma, authentication, domain services, SSE, workers, and health.
- `apps/supplier-web`: seluruh Hosted supplier-facing workflows.
- `apps/tmmin-web`: TMMIN Admin dan Quality workflows.
- `apps/e2e`: Playwright full-stack scenarios dan harness.
- `packages/contracts`: Zod schemas, DTO types, enums, error codes, and OpenAPI-related definitions.
- `packages/ui`: shared shadcn/Tailwind primitives dan accessible design tokens.
- `packages/test-fixtures`: deterministic tenant, user, member, line, job, part, shift, Henkaten, and external-event fixtures.
- `deploy`: runtime Compose, Caddy, release scripts, env templates, and smoke checks.

Jangan membuat placeholder package manifest untuk package yang belum diimplementasikan. Directory/package dibuat ketika phase terkait dimulai.

## 6. Locked Technical Baseline

- Runtime: Node.js 22.
- Package manager: pnpm workspaces.
- Language: TypeScript.
- Backend: NestJS dengan Express adapter.
- Database: PostgreSQL; local/test image menyediakan pgvector.
- ORM/migration: Prisma.
- Shared validation/contracts: Zod.
- Password hashing: Argon2id.
- Backend HTTP testing: Supertest + Vitest.
- Frontend: React + Vite.
- Routing: React Router.
- Server state: TanStack Query.
- Table/filter presentation: TanStack Table.
- Forms: React Hook Form + Zod resolver.
- Styling/components: Tailwind CSS + shadcn/ui.
- Browser E2E: Playwright.
- Realtime: SSE backed by PostgreSQL transactional outbox.
- Member image processing: server-side signature/MIME validation, metadata stripping, and thumbnail generation; implementation library dipilih dan dikunci dalam ADR sebelum Phase 4.2.
- Local files: persistent volume abstraction; no object storage in v1.
- Reverse proxy/TLS: Caddy.
- Hosted runtime: Docker Compose, one VM per environment.
- Staging deployment: dikerjakan pada Phase 15 menjelang UAT.
- Production deployment: automatic after successful `main` CI; no manual approval gate.

## 7. Global Definition of Done

Sebuah subphase hanya dapat ditandai `done` bila:

1. implementation code dan required migrations tersedia;
2. shared contracts diperbarui;
3. lint dan typecheck lulus untuk affected workspace;
4. unit tests affected capability lulus;
5. PostgreSQL integration tests lulus bila menyentuh persistence/concurrency;
6. negative authorization tests lulus bila menambah protected resource;
7. no secret/PII logging diperiksa;
8. API/OpenAPI docs diperbarui bila contract berubah;
9. relevant ADR dibuat/diperbarui;
10. roadmap dan session handoff diperbarui;
11. tidak ada agent-started process/container tertinggal;
12. exit criteria subphase terpenuhi.

Sebuah phase hanya `done` bila seluruh required subphase `done`, phase exit criteria lulus, dan tidak ada blocker yang disembunyikan.

---

## 8. Phase 0 - Product Contract dan Architecture Baseline

Status: **done**

Goal: menghilangkan keputusan arsitektur fundamental sebelum scaffolding dan memastikan roadmap konsisten dengan PRD.

Depends on:

- `.agent/PRD.md`;
- source slide dan prototype analysis yang sudah tercermin di PRD.

Unlocks:

- Phase 1 dan seluruh implementation.

### 0.1 PRD dan Roadmap Alignment

Status: **done**

Dependency: PRD tersedia.

Execution:

- Pastikan roadmap mencakup seluruh Hosted dan External scope.
- Petakan role, state machine, data entities, warning, PII policy, deployment, test, dan accepted risks.
- Pastikan out-of-scope tidak masuk coding phase.
- Pastikan tidak ada compatibility requirement terhadap prototype Streamlit/Excel.

Verification:

- Setiap PRD acceptance area memiliki owning phase.
- Locked decisions tercermin pada sequencing.

Data/migration impact:

- Tidak ada.

Exit criteria:

- PRD dan roadmap tidak memiliki conflict yang diketahui.

### 0.2 Architecture Decisions

Status: **done**

Dependency: 0.1.

Execution:

- Buat ADR pnpm monorepo dan package boundaries.
- Buat ADR NestJS modular monolith + Prisma/PostgreSQL.
- Buat ADR tenant isolation tanpa PostgreSQL RLS.
- Buat ADR opaque database-backed sessions.
- Buat ADR transaction boundary, optimistic concurrency, dan locking.
- Buat ADR transactional outbox + SSE tanpa Redis.
- Buat ADR local member-photo storage dan image processing.
- Buat ADR single-VM per environment dan deployment constraints.

Verification:

- Setiap ADR memuat decision, alternatives, consequences, validation, dan follow-up.
- Tidak ada ADR yang mengubah PRD.

Data/migration impact:

- Menetapkan strategy; belum membuat migration.

Exit criteria:

- Engineer Phase 1-2 tidak perlu memilih ulang monorepo, auth, tenancy, realtime, file storage, atau deployment architecture.

### 0.3 Domain dan State Model Baseline

Status: **done**

Dependency: 0.2.

Execution:

- Definisikan aggregate boundaries:
  - Supplier/SourceMode;
  - Identity/Session;
  - Master Data;
  - Shift/Assignment;
  - Henkaten/Approval;
  - Notification;
  - External Ingestion;
  - Audit.
- Definisikan exact enum/status values dari PRD.
- Definisikan ownership transaction untuk:
  - Start Shift;
  - final approval;
  - Man movement;
  - End Shift;
  - source mode cutover;
  - external event projection.
- Definisikan domain event vocabulary untuk outbox.
- Definisikan canonical error codes untuk conflict, stale version, forbidden transition, dan tenant denial.

Verification:

- State transition table dapat dipetakan ke service method dan tests.
- Tidak ada ambiguous owner untuk mutation transaksional.

Data/migration impact:

- Menjadi input Prisma schema Phase 2-7.

Exit criteria:

- Core domain state dan event names siap dimasukkan ke shared contracts.

### 0.4 Security, Privacy, dan Accepted Risk Baseline

Status: **done**

Dependency: 0.2.

Execution:

- Dokumentasikan Hosted PII boundary.
- Dokumentasikan External minimal-PII boundary.
- Dokumentasikan no-backup/no-recovery sebagai Critical Accepted Risk.
- Dokumentasikan automatic production deploy sebagai High Accepted Risk.
- Definisikan minimum security validation yang tidak dapat ditunda.
- Definisikan production privacy/risk sign-off sebagai launch blocker.

Verification:

- Security/privacy requirements memiliki owning phase dan test.
- Roadmap tidak menambahkan backup, MFA, SSO, atau external notification secara diam-diam.

Data/migration impact:

- Menentukan classification dan audit requirements.

Exit criteria:

- Risk posture eksplisit sebelum source code dibuat.

Phase 0 exit criteria:

- Subphase 0.1-0.4 done.
- Required architecture ADRs tersedia.
- State model dan security boundaries decision-complete.

---

## 9. Phase 1 - Repository Scaffold dan Local Tooling

Status: **done**

Goal: membuat foundation pnpm workspace, local database, contracts, test fixtures, dan quality commands yang dipakai seluruh application.

Depends on:

- Phase 0.

Unlocks:

- Phase 2.

### 1.1 pnpm Workspace Scaffold

Status: **done**

Dependency: Phase 0.

Execution:

- Tambahkan root `package.json`.
- Tambahkan `pnpm-workspace.yaml`.
- Pin package manager version.
- Pin Node.js 22 melalui supported version metadata.
- Buat initial workspaces:
  - `apps/api`;
  - `packages/contracts`;
  - `packages/test-fixtures`.
- Tunda frontend workspaces sampai Phase 11.
- Tambahkan root scripts untuk dev/build/typecheck/test/lint/format.
- Tambahkan `.gitignore` untuk dependencies, build output, local env, test output, Playwright artifacts, uploads, dan database volumes.

Verification:

- `pnpm install --frozen-lockfile` berhasil setelah lockfile dibuat.
- Workspace dependency resolution bekerja tanpa relative source imports.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Root workspace dapat menginstall dan menjalankan script package yang sudah ada.

### 1.2 TypeScript dan Code Quality Baseline

Status: **done**

Dependency: 1.1.

Execution:

- Tambahkan root TypeScript base config.
- Konfigurasikan strict mode.
- Tambahkan ESLint flat config.
- Tambahkan Prettier config dan ignore.
- Tambahkan consistent import boundaries.
- Tambahkan `lint`, `format:check`, `typecheck`, `test`, dan `build`.
- Pastikan generated files tidak dilint secara salah.

Verification:

- Root lint, format check, dan typecheck lulus pada scaffold.
- Intentional type error menyebabkan CI command gagal.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Semua workspace memakai shared strict baseline.

### 1.3 Shared Contracts

Status: **done**

Dependency: 1.1-1.2 dan Phase 0.3.

Execution:

- Buat Zod schemas untuk common:
  - UUID/opaque ID;
  - timestamps;
  - pagination;
  - problem details;
  - correlation IDs;
  - optimistic version.
- Definisikan enums dari PRD.
- Definisikan auth/session and health contracts.
- Definisikan package export boundary.
- Tambahkan schema parsing and serialization tests.

Verification:

- Contracts build menghasilkan types tanpa runtime drift.
- Invalid enum/time/pagination fixtures ditolak.

Data/migration impact:

- Tidak ada database migration.

Exit criteria:

- API foundation dapat menggunakan shared schemas tanpa local duplicate DTO.

### 1.4 Deterministic Test Fixtures

Status: **done**

Dependency: 1.3.

Execution:

- Buat builders/fixtures untuk:
  - Hosted/External supplier;
  - TMMIN Admin/Quality;
  - Supplier Admin/Supervisor/LL/QC/MP;
  - shift, line, job, part;
  - checklist versions;
  - default/working assignments;
  - Henkaten categories/statuses;
  - external events.
- Pastikan fixture ID dan timestamp deterministic.
- Pisahkan fixture contract dari database seeding.

Verification:

- Fixture package build/test lulus.
- Tidak ada real PII atau secret di fixture.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Backend tests dapat memakai consistent domain data sejak Phase 2.

### 1.5 Local PostgreSQL Compose

Status: **done**

Dependency: 1.1.

Execution:

- Tambahkan local Compose untuk PostgreSQL pgvector-enabled.
- Gunakan project-specific ports, volume, database, dan healthcheck.
- Tambahkan `.env.example` tanpa secret nyata.
- Tambahkan scripts:
  - database start;
  - health wait;
  - migration;
  - test database reset;
  - database stop/cleanup.
- Pastikan app/test menggunakan environment URL.

Verification:

- Database start, health, connect, dan stop berhasil.
- Tidak memerlukan host PostgreSQL.
- Cleanup menghapus test state yang disposable tanpa menghapus unrelated data.

Data/migration impact:

- Membuat local persistent database volume; belum ada product tables.

Exit criteria:

- Local dan test PostgreSQL lifecycle repeatable dari root.

### 1.6 Baseline GitHub CI Validation

Status: **done**

Dependency: 1.1-1.5.

Execution:

- Tambahkan CI workflow untuk install, format check, lint, typecheck, test, dan build.
- Gunakan pnpm cache.
- Gunakan PostgreSQL service/container bila integration test mulai tersedia.
- Tambahkan docs-only path behavior yang tidak menghambat future deployment rules.
- Deployment belum dibuat pada phase ini.

Verification:

- Workflow syntax valid.
- Local-equivalent commands lulus.
- Failing test/lint membuat workflow gagal.

Data/migration impact:

- CI test database disposable.

Exit criteria:

- Repository memiliki automated quality baseline tanpa staging deployment.

Phase 1 exit criteria:

- Fresh clone dapat install, validate, start/stop database, dan menjalankan test scaffold dari root.

---

## 10. Phase 2 - API Platform dan Persistence Foundation

Status: **done**

Goal: membuat NestJS runtime, Prisma persistence, tenant context, audit, outbox, health, dan real PostgreSQL test harness.

Depends on:

- Phase 1.

Unlocks:

- Phase 3-9 backend domain work.

### 2.1 NestJS Runtime Foundation

Status: **done**

Dependency: Phase 1.

Execution:

- Scaffold `apps/api` sebagai NestJS modular monolith dengan Express adapter.
- Tambahkan environment schema validation.
- Tambahkan global prefix `/api/v1`.
- Tambahkan global Zod validation integration.
- Tambahkan global exception filter dengan `application/problem+json`.
- Tambahkan request body limit.
- Tambahkan graceful shutdown.
- Pisahkan bootstrap, app module, config, dan transport concerns.

Verification:

- API start dan shutdown clean.
- Missing/invalid required env gagal fast.
- Invalid request menghasilkan structured problem response.

Data/migration impact:

- Tidak ada product migration.

Exit criteria:

- API runtime siap menerima modules tanpa duplicated bootstrap policy.

### 2.2 Structured Logging dan Correlation

Status: **done**

Dependency: 2.1.

Execution:

- Tambahkan JSON logger.
- Generate/validate `X-Correlation-ID`.
- Bind request context untuk correlation, actor, supplier, dan release metadata.
- Redact cookie, authorization, password, token, dan secret.
- Tambahkan HTTP duration/status logs.
- Hindari logging raw freeform Henkaten payload.

Verification:

- Request logs memiliki correlation ID.
- Redaction tests memastikan secret tidak muncul.
- Error log tidak mengekspos stack pada production response.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Seluruh module dapat memakai request-scoped safe logging.

### 2.3 Prisma Foundation dan Initial Migration

Status: **done**

Dependency: 2.1 dan 1.5.

Execution:

- Tambahkan Prisma schema/config.
- Tambahkan database client lifecycle.
- Buat foundational tables:
  - Supplier;
  - User;
  - UserSession;
  - PasswordHistory;
  - AuditEvent;
  - OutboxEvent.
- Tambahkan UUID IDs, timestamps, version, active/state fields.
- Tambahkan generated migration.
- Tambahkan seed framework untuk TMMIN bootstrap pada local/test.

Verification:

- Fresh migration lulus.
- Prisma client generate/build lulus.
- Upgrade migration test dari empty database lulus.
- Unique/index constraints foundational tervalidasi.

Data/migration impact:

- Initial persistent product schema.

Exit criteria:

- Database foundation dapat dipakai auth, tenancy, audit, dan domain modules.

### 2.4 Tenant Context dan Scoped Repository Convention

Status: **done**

Dependency: 2.2-2.3.

Execution:

- Definisikan authenticated principal dan tenant context.
- Implement helper/repository pattern yang mewajibkan tenant scope.
- Larang direct unscoped Prisma access dari supplier-facing application services.
- Definisikan explicit TMMIN cross-tenant query path.
- Tambahkan object ownership guard.
- Tambahkan code review/lint convention bila feasible.

Verification:

- Supplier A query tidak mengembalikan Supplier B.
- Arbitrary body `supplierId` diabaikan/ditolak.
- TMMIN explicit permission dapat cross-tenant dan diaudit.

Data/migration impact:

- Index `supplierId` untuk tenant-scoped foundational tables.

Exit criteria:

- Domain modules memiliki satu canonical tenant access pattern.

### 2.5 Append-only Audit

Status: **done**

Dependency: 2.2-2.4.

Execution:

- Implement AuditService.
- Simpan actor, role, supplier, action, resource, summary, reason, correlation, IP, user agent, source mode/epoch, result.
- Redact secret dan sensitive payload.
- Tidak sediakan update/delete route.
- Tambahkan audit write helper yang dapat ikut transaction.

Verification:

- Sensitive mutation dapat menulis audit dalam transaction.
- Audit update/delete melalui service tidak tersedia.
- Secret redaction tests lulus.

Data/migration impact:

- Audit indexes untuk supplier, actor, resource, occurredAt.

Exit criteria:

- Subsequent modules dapat menulis immutable audit consistently.

### 2.6 Transactional Outbox

Status: **done**

Dependency: 2.3.

Execution:

- Implement outbox write dalam domain transaction.
- Implement in-process poller/dispatcher.
- Tambahkan retry metadata dan failure state.
- Tambahkan handler idempotency convention.
- Gunakan PostgreSQL wake-up mechanism bila dipilih ADR; durability tetap pada table.
- Tambahkan clean shutdown dan health visibility.

Verification:

- Transaction rollback tidak meninggalkan event.
- Retry tidak menggandakan handled side effect.
- Restart memproses pending event.

Data/migration impact:

- Outbox indexes untuk state/availableAt/createdAt.

Exit criteria:

- Notification/read-model modules dapat mengandalkan durable domain events.

### 2.7 Health, Readiness, dan Database Checks

Status: **done**

Dependency: 2.1-2.6.

Execution:

- Implement `/health`.
- Implement `/ready`.
- Readiness memeriksa database, migration compatibility, dan critical initialization.
- Tambahkan response contract.
- Jangan expose credentials/topology.

Verification:

- Health tetap alive saat DB unavailable.
- Readiness gagal saat DB unavailable atau migration invalid.
- Response sesuai shared contract.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Runtime dapat diobservasi Compose dan CI.

### 2.8 PostgreSQL Integration-test Harness

Status: **done**

Dependency: seluruh Phase 2 sebelumnya.

Execution:

- Tambahkan test env config.
- Provision disposable database/schema.
- Jalankan migrations sebelum integration suite.
- Sediakan deterministic seed/factory helpers.
- Isolasi/reset data per suite.
- Pastikan cleanup berjalan pada success/failure.

Verification:

- Integration suite repeatable dan tidak bergantung pada host DB.
- Parallel test policy tidak menyebabkan cross-test contamination.

Data/migration impact:

- Disposable test database only.

Exit criteria:

- Phase 3+ dapat menulis real database integration tests.

Phase 2 exit criteria:

- NestJS API, Prisma, tenant context, audit, outbox, health, dan database harness lulus root validation.

---

## 11. Phase 3 - Authentication, Authorization, dan TMMIN Administration Backend

Status: **done**

Goal: mengimplementasikan identity realms, session lifecycle, RBAC, tenant provisioning, dan source-mode governance sebelum supplier domain APIs.

Depends on:

- Phase 2.

Unlocks:

- Phase 4-9 protected APIs.

### 3.1 Password Hashing dan History

Status: **done**

Dependency: Phase 2.

Execution:

- Implement Argon2id hashing dengan parameter yang dikonfigurasi.
- Implement constant-behavior password verification.
- Enforce 12-128 character policy.
- Simpan password history hash untuk lima password terakhir.
- Implement temporary password flag.
- Implement forced-change state.
- Pastikan password tidak masuk log/audit.

Verification:

- Correct/incorrect verification tests.
- Reuse lima password terakhir ditolak.
- Temporary password memaksa change flow.
- Redaction tests lulus.

Data/migration impact:

- Finalize PasswordHistory relation dan indexes.

Exit criteria:

- Password lifecycle memenuhi PRD tanpa plaintext persistence.

### 3.2 Database-backed Session Lifecycle

Status: **done**

Dependency: 3.1.

Execution:

- Generate cryptographically random opaque session ID.
- Simpan hanya hash/token fingerprint yang diperlukan di database.
- Set secure HttpOnly SameSite cookie.
- Implement idle 30 menit dan absolute 12 jam.
- Implement session refresh activity dengan write throttling.
- Implement logout dan revoke-all.
- Revoke sessions pada reset, deactivation, role/source changes.
- Bedakan TMMIN dan supplier identity realm.

Verification:

- Session create/fetch/logout.
- Idle/absolute expiry.
- Revocation immediately blocks reuse.
- Cookie attributes benar pada production/staging.

Data/migration impact:

- Add expiry, lastActivityAt, revokedAt, realm, and indexes to UserSession.

Exit criteria:

- Session behavior stabil dan dapat dipakai seluruh protected route.

### 3.3 Login Throttling dan Account Lockout

Status: **done**

Dependency: 3.1-3.2.

Execution:

- Track failure per account key dan IP.
- Lima kegagalan dalam 15 menit mengunci account 15 menit.
- Gunakan generic authentication failure.
- Audit login success/failure/lockout.
- Prevent supplier-code or username enumeration.
- Add API rate limiting.

Verification:

- Threshold/window/expiry tests.
- Unknown supplier/username memiliki response shape yang sama.
- Successful login mereset relevant failure state.

Data/migration impact:

- Add LoginAttempt/lockout fields or dedicated table sesuai ADR.

Exit criteria:

- Authentication abuse controls bekerja tanpa leaking account existence.

### 3.4 RBAC dan Object-level Authorization

Status: **done**

Dependency: 3.2 dan Phase 2.4.

Execution:

- Definisikan canonical role enum:
  - TMMIN_ADMIN;
  - TMMIN_QUALITY;
  - SUPPLIER_ADMIN;
  - SUPERVISOR;
  - LINE_LEADER;
  - QC.
- Implement route role guards.
- Implement supplier, line, and resource scope guards.
- Implement default-deny behavior.
- Pisahkan mutation permissions dari read scope.
- Audit privileged cross-tenant TMMIN action.

Verification:

- Permission matrix tests dari PRD.
- IDOR/cross-tenant negative tests.
- Hidden frontend control tidak diperlukan untuk backend denial.

Data/migration impact:

- User role/realm constraints and indexes.

Exit criteria:

- Protected domain modules dapat deklaratif memakai canonical guards.

### 3.5 TMMIN Account Administration

Status: **done**

Dependency: 3.1-3.4.

Execution:

- Implement bootstrap TMMIN Admin dari environment.
- Implement TMMIN Admin create/deactivate/reset TMMIN Quality.
- Implement TMMIN account list/detail.
- Implement forced first reset.
- Prevent last required bootstrap/admin lockout according to operational policy recorded in ADR.
- Audit account operations.

Verification:

- TMMIN Quality tidak dapat manage accounts.
- Disabled account/session ditolak.
- Bootstrap idempotent.

Data/migration impact:

- Seed/bootstrap metadata only.

Exit criteria:

- TMMIN identity realm operasional melalui API.

### 3.6 Supplier Provisioning dan Supplier Admin

Status: **done**

Dependency: 3.1-3.5.

Execution:

- Implement create/list/detail/update/activate/deactivate Supplier.
- Enforce global case-insensitive supplier code uniqueness.
- Implement create/replace exactly one active Supplier Admin.
- Implement Supplier Code + Username login resolution.
- Implement TMMIN reset Supplier Admin.
- Invalidate replaced admin sessions atomically.
- Audit all provisioning.

Verification:

- Dua active Supplier Admin tidak mungkin.
- Supplier username unik hanya dalam tenant.
- Supplier Admin tidak dapat cross-tenant.

Data/migration impact:

- Supplier source fields, user supplier relation, active-admin uniqueness strategy.

Exit criteria:

- Hosted tenant dapat diprovision dengan secure primary admin.

### 3.7 Source Mode dan Source Epoch Cutover

Status: **done - core governance; production contributors deferred to owning phases**

Dependency: 3.6.

Execution:

- Implement HOSTED/EXTERNAL mode fields.
- Implement cutover preflight.
- Block active shift/Open Henkaten.
- Increment source epoch.
- Revoke sessions/credentials source lama.
- Preserve history source lama read-only.
- Require external credential before EXTERNAL activation.
- Require minimum Hosted configuration before HOSTED activation; validation hook dapat diselesaikan setelah Phase 4.
- Audit old/new mode, reason, actor, and timestamp.

Verification:

- Mixed writes rejected.
- Token/session old epoch invalid.
- History preserved.
- Cutover with blocker fails atomically.

Data/migration impact:

- Supplier sourceMode/sourceEpoch/cutover metadata.

Exit criteria:

- Source mode governance tersedia dan extensible untuk Phase 9.

Implementation note:

- `HostedPreparation`, contributor registry, locking transaction, source epoch/session invalidation,
  audit, dan outbox contract tersedia.
- Production cutover sengaja fail-closed sampai Phase 4 menambahkan minimum Hosted configuration
  contributor dan Phase 9 menambahkan External credential/projection contributors.
- Supplier `EXTERNAL` baru tetap inactive sampai credential Phase 9 tersedia.

### 3.8 Auth dan Tenant Security Suite

Status: **done**

Dependency: 3.1-3.7.

Execution:

- Consolidate unit/integration tests untuk password, session, lockout, role, object scope, supplier provisioning, and cutover.
- Add concurrent Supplier Admin replacement test.
- Add CSRF/CORS baseline tests where transport configured.
- Add audit verification.

Verification:

- Seluruh PRD identity acceptance checks lulus backend.
- Cross-tenant negative suite mandatory pada CI.

Data/migration impact:

- Test database only.

Exit criteria:

- Auth/tenancy dianggap stable dependency untuk supplier domain.

Phase 3 exit criteria:

- Identity realms, sessions, RBAC, supplier provisioning, dan source-mode lifecycle stabil melalui real PostgreSQL tests.

---

## 12. Phase 4 - Supplier Master Data Backend

Status: **done**

Goal: menyediakan seluruh master data dan default configuration yang diperlukan Hosted supplier sebelum shift atau Henkaten dapat berjalan.

Depends on:

- Phase 3.

Unlocks:

- Phase 5-7.

### 4.1 Member dan Account Linkage

Status: **done**

Dependency: Phase 3.

Execution:

- Tambahkan Member schema dan role.
- Enforce registration number uniqueness per supplier.
- Implement create/list/detail/update/deactivate.
- Untuk Supervisor/LL/QC, provision linked User credential.
- MP tidak boleh memiliki login.
- Enforce satu active role per member.
- Preserve actor/member snapshots pada future history.
- Audit mutations.

Verification:

- Duplicate registration ditolak.
- MP credential creation ditolak.
- Cross-tenant member access ditolak.
- Deactivation rules tested.

Data/migration impact:

- Member table, User-member relation, indexes.

Exit criteria:

- Supplier member dan account model siap untuk assignment/approval.

### 4.2 Member Photo Processing

Status: **done**

Dependency: 4.1 dan photo-storage ADR.

Execution:

- Implement multipart upload endpoint.
- Validate extension, MIME, dan binary signature.
- Limit 2 MB.
- Strip metadata.
- Normalize image orientation.
- Generate bounded thumbnail.
- Store file under supplier/resource-safe generated path.
- Store metadata/path/checksum di database.
- Delete replaced orphan file only through safe targeted operation.
- Provide initials fallback contract.

Verification:

- Valid JPG/PNG/WebP accepted.
- Spoofed/oversized/corrupt file rejected.
- Path traversal impossible.
- Cross-tenant photo access denied.

Data/migration impact:

- MemberPhoto metadata and persistent local volume path.

Exit criteria:

- Hosted board dapat memperoleh safe photo/thumbnail URL atau initials fallback.

### 4.3 Line dan Job

Status: **done**

Dependency: 4.1.

Execution:

- Implement Line CRUD/deactivation/reorder.
- Enforce lineCode uniqueness per supplier.
- Implement Job CRUD/deactivation/reorder within line.
- Enforce case-insensitive job-name uniqueness per line.
- Prevent hard delete after reference.
- Add list pagination/search.
- Audit mutations.

Verification:

- Duplicate and cross-line/supplier constraints.
- Referenced resource deactivation rules.
- Reorder tidak mengubah identity/history.

Data/migration impact:

- Line, Job, indexes, active/version fields.

Exit criteria:

- Supplier line/job hierarchy stabil.

### 4.4 Part

Status: **done**

Dependency: Phase 3.

Execution:

- Implement Part CRUD/deactivation.
- Require part number and part name.
- Enforce case-insensitive part number uniqueness per supplier.
- Implement search by number/name.
- Add pagination.
- Prevent hard delete after reference.

Verification:

- Search and uniqueness tests.
- Cross-tenant denial.
- Active/inactive filtering.

Data/migration impact:

- Part table and search indexes.

Exit criteria:

- Part selection contract siap untuk Henkaten.

### 4.5 Configurable Shift Template

Status: **done**

Dependency: Phase 3.

Execution:

- Implement ShiftTemplate CRUD/deactivation/reorder.
- Validate IANA timezone.
- Support cross-midnight start/end.
- Define business-date calculation helper.
- Prevent deactivation when used by active/planned shift according to policy.

Verification:

- Normal/cross-midnight/timezone tests.
- Invalid/ambiguous config rejected.

Data/migration impact:

- ShiftTemplate table and indexes.

Exit criteria:

- Shift scheduling configuration siap untuk Shift Run.

### 4.6 Versioned 4M Quality Checklist

Status: **done**

Dependency: Phase 3.

Execution:

- Implement ChecklistTemplate per 4M category.
- Implement draft/publish workflow.
- Publish immutable version dengan ordered yes/no items.
- Enforce minimum one active item.
- Prevent edit/delete version used by Henkaten.
- Implement current version query.
- Audit publish/deactivation.

Verification:

- Version increments.
- Historical version immutable.
- Empty checklist cannot publish.
- Category isolation.

Data/migration impact:

- ChecklistTemplate, ChecklistVersion, ChecklistItem.

Exit criteria:

- Henkaten can snapshot deterministic checklist.

### 4.7 Default Assignment

Status: **done**

Dependency: 4.1 dan 4.3.

Execution:

- Implement default Supervisor assignment per line.
- Implement default LL assignment with one-line-per-LL.
- Implement default MP assignment with one-job-per-MP.
- Support assign/change/remove.
- Support atomic LL/MP move.
- Enforce same-supplier relationships.
- Record effective version.
- Ensure current Working Assignment is not mutated by default changes.
- Audit before/after.

Verification:

- Unique constraints and atomic moves.
- Active shift unaffected.
- Invalid role/tenant/resource rejected.

Data/migration impact:

- DefaultAssignment tables or typed relations and partial uniqueness strategy.

Exit criteria:

- Valid baseline assignment can be snapshotted into a shift.

### 4.8 Deactivation dan Referenced-data Protection

Status: **done**

Dependency: 4.1-4.7.

Execution:

- Centralize active/reference validation.
- Block deactivation when current default assignment requires resource.
- Extend the same policy in Phase 5–7 for active Shift Run, Working Assignment, Open Henkaten,
  dan reservation.
- Preserve historical snapshots.
- Keep every master record under permanent logical retention; do not expose hard-delete APIs.
- Ensure no broad cascade deletes.

Verification:

- Referenced resource cannot disappear.
- Deactivation with a current Default Assignment returns `RESOURCE_IN_USE`.
- No master-data `DELETE` route exists.
- Audit records correct action.

Data/migration impact:

- Foreign-key delete behavior and active indexes reviewed.

Exit criteria:

- Master data lifecycle cannot break future history or active operations.

### 4.9 Master-data API Hardening

Status: **done**

Dependency: 4.1-4.8.

Execution:

- Complete pagination/search/sort/error contracts.
- Add optimistic version checks.
- Add CRUD/uniqueness/concurrency/authorization tests.
- Review indexes using representative Compact fixtures.
- Complete Hosted cutover minimum-configuration hook from Phase 3.7.

Verification:

- Supplier Admin can create a complete valid configuration using APIs.
- Non-admin mutation attempts denied.

Data/migration impact:

- Additive indexes only.

Exit criteria:

- Master data backend complete dan stable untuk shift.

Phase 4 exit criteria:

- Hosted supplier dapat diprovision sampai valid default assignment dan published 4M checklists melalui API.

---

## 13. Phase 5 - Shift dan Working Assignment Backend

Status: **done**

Goal: mengimplementasikan Shift Run, assignment snapshot, preflight, hard gates, override, dan Assignment Issue foundation.

Depends on:

- Phase 4.

Unlocks:

- Phase 6-7.

### 5.1 Shift Run Schema dan State Machine

Status: **done**

Dependency: Phase 4.

Execution:

- Add ShiftRun dengan NOT_STARTED/ACTIVE/ENDED.
- Store line, ShiftTemplate snapshot, business date, timezone, LL, and version.
- Enforce maximum one ACTIVE shift per line.
- Implement create/preflight preparation contract.
- Implement valid transition guards.

Verification:

- Invalid transitions rejected.
- Cross-midnight business date correct.
- Concurrent Start cannot create two active shifts.

Data/migration impact:

- ShiftRun table, unique/partial indexes.

Exit criteria:

- Shift state can be safely persisted and locked.

### 5.2 Working Assignment Snapshot

Status: **done**

Dependency: 5.1 dan Phase 4.7.

Execution:

- Snapshot default Supervisor/LL/MP assignments for planned/start shift.
- Preserve source default version.
- Model assigned/vacant/conflicted/reserved states.
- Keep default and working data separate.
- Add current assignment queries.

Verification:

- Default changes after snapshot do not mutate active working state.
- Snapshot deterministic.
- Duplicate MP conflict detected.

Data/migration impact:

- WorkingAssignment and snapshot metadata.

Exit criteria:

- Shift can represent actual assignments independently from defaults.

### 5.3 Preflight Engine dan Hard Gates

Status: **done**

Dependency: 5.1-5.2.

Execution:

- Evaluate:
  - active overlapping shift;
  - missing Supervisor/LL;
  - required vacancy;
  - duplicate/conflicted MP;
  - MP unavailable/reserved;
  - unresolved Assignment Issue;
  - carry-over Open Henkaten via future hook;
  - missing checklist configuration.
- Return structured check codes/severity/resource references.
- Ensure check result is recalculated at commit.
- Implement normal Start Shift transaction.

Verification:

- Each hard gate has unit/integration case.
- TOCTOU change between preview and commit is rejected/recalculated.

Data/migration impact:

- Optional preflight snapshot/audit metadata.

Exit criteria:

- Valid shift starts atomically; invalid shift cannot start normally.

### 5.4 Emergency Start Shift Override

Status: **done**

Dependency: 5.3.

Execution:

- Restrict to Supplier Admin.
- Require reason minimum 10 characters.
- Persist failed checks and `startedWithOverride`.
- Start shift without deleting issues.
- Emit outbox event.
- Audit actor/reason/checks.

Verification:

- LL cannot override.
- Override still shows unresolved issues.
- Concurrent normal/override start leaves one active shift.

Data/migration impact:

- Override fields and optional reason/check snapshot.

Exit criteria:

- Emergency start is explicit, auditable, and visible to later notification/dashboard phases.

### 5.5 Assignment Issue Foundation

Status: **done**

Dependency: 5.2.

Execution:

- Add AssignmentIssue state/model.
- Support vacancy/conflict issue type.
- Link line/job/shift/origin reference.
- Implement create/list/detail/resolve primitives.
- Do not invent automatic resolution before Man Henkaten Phase 7.
- Add issue age and active indexes.

Verification:

- Duplicate active issue for same job prevented.
- Resolve requires valid resolution reference.
- Cross-tenant access denied.

Data/migration impact:

- AssignmentIssue table and unique/index constraints.

Exit criteria:

- Cascade vacancy Phase 7 has durable issue target.

### 5.6 Pre-start Resolution Contract

Status: **done**

Dependency: 5.3 dan 5.5.

Execution:

- Define API/read model listing pre-start blockers.
- Define command contract for proposed Man resolution.
- Add planned Shift Run reference.
- Keep execution hook pending Phase 7.
- Expose refreshable preflight.

Verification:

- Contract distinguishes current issue, proposed resolution, and latest preflight.
- Unauthorized LL cannot resolve another line.

Data/migration impact:

- No additional product data beyond planned shift/issue link.

Exit criteria:

- Phase 7 can add Man Henkaten without redesigning pre-start API.

### 5.7 Shift Query dan Permission Tests

Status: **done**

Dependency: 5.1-5.6.

Execution:

- Implement Shift Run list/detail/current queries.
- Apply role scope.
- Complete concurrency, permission, and snapshot tests.
- Add carry-over Henkaten hook placeholder only as interface, not fake behavior.

Verification:

- Supplier Admin/QC all-line view.
- Supervisor scoped lines.
- LL own line.
- TMMIN read according to PRD.

Data/migration impact:

- Query indexes only.

Exit criteria:

- Shift backend siap diintegrasikan dengan Henkaten.

Phase 5 exit criteria:

- Start Shift dan Working Assignment foundation complete.
- End Shift belum `done`; final implementation berada pada Phase 7.9.

---

## 14. Phase 6 - Henkaten Core Backend

Status: **done**

Goal: mengimplementasikan Henkaten record, checklist snapshot, seluruh 4M flow, MP reservation,
warning, query/history, dan Withdraw + Clone.

Depends on:

- Phase 5;
- Phase 4.6 checklist.

Unlocks:

- Phase 7-8.

### 6.1 Henkaten Schema, Identifier, dan Snapshot

Status: **done**

Dependency: Phase 5.

Execution:

- Add Henkaten aggregate fields.
- Add OPEN/APPROVED/REJECTED/CANCELLED enum.
- Add source mode/epoch.
- Generate human-readable Hosted identifier atomically.
- Snapshot shift, line, job, part number/name, creator, and occurred time.
- Store UTC and supplier timezone/business date.
- Add row version.

Verification:

- Identifier unique under concurrent submit.
- Snapshot remains unchanged after master update.
- Invalid source mode write rejected.

Data/migration impact:

- Henkaten table, sequence strategy, snapshot fields/indexes.

Exit criteria:

- Henkaten identity and immutable context stable.

### 6.2 Lifecycle dan Transition Guards

Status: **done**

Dependency: 6.1.

Execution:

- Implement allowed transition service.
- Derive `isClosed`.
- Prevent terminal mutation.
- Define cancellation reason enum.
- Emit transition domain events.
- Keep approval finalization hook for Phase 7.

Verification:

- State table tests.
- Terminal edits rejected.
- Duplicate command idempotency where applicable.

Data/migration impact:

- Status/cancellation/finalized metadata.

Exit criteria:

- Lifecycle cannot bypass canonical transition service.

### 6.3 Checklist Snapshot dan All-Yes Enforcement

Status: **done**

Dependency: 6.1 dan Phase 4.6.

Execution:

- Load current published checklist by 4M category.
- Require every item answered YES.
- Snapshot version, labels, order, and answers.
- Reject stale/missing/deactivated checklist.
- Store snapshot in submission transaction.

Verification:

- NO/unanswered submission rejected.
- New checklist version does not mutate old Henkaten.
- Category mismatch rejected.

Data/migration impact:

- ChecklistSnapshot and ChecklistAnswer.

Exit criteria:

- Every Open Henkaten has complete immutable quality evidence.

### 6.4 Machine, Material, dan Method Submission

Status: **done**

Dependency: 6.1-6.3.

Execution:

- Implement Hosted LL submission.
- Resolve line from authorized LL context.
- Validate active Shift Run, job, and part.
- Require affected/replacement/cause/detail.
- Enforce 2,000-character limits.
- Emit HenkatenOpened event.
- Audit submission.

Verification:

- LL cannot spoof line.
- Inactive/other-tenant resources rejected.
- Each non-Man category accepted with valid payload.

Data/migration impact:

- Category-specific generic change fields.

Exit criteria:

- Three non-Man categories can become Open safely.

### 6.5 Man Submission Contract tanpa Movement

Status: **done**

Dependency: 6.1-6.3 dan Working Assignment.

Execution:

- Validate target job/current or planned assignment.
- Accept replaced MP or VACANT resolution case.
- Validate replacement MP role/tenant/active.
- Reject same replaced/replacement.
- Store assignment versions and source-job reference.
- Create MP reservation atomically with submission and leave Working Assignment unchanged.
- Enforce active replacement-MP and target-Working-Assignment uniqueness.
- Define submission service extension point.

Verification:

- Invalid target/replacement rejected.
- Cross-supplier MP rejected.
- Stale assignment version rejected.
- Concurrent reservation race leaves one winner.

Data/migration impact:

- Man-specific Henkaten fields and references.

Exit criteria:

- Man payload/context and reservation are stable for Phase 7 approval/movement.

### 6.6 Warning Instance dan Affected-part Aggregation

Status: **done**

Dependency: 6.2.

Execution:

- Add warning instance for every Open Henkaten.
- Derive aggregate affected state by supplier + part number.
- Close instance on any terminal outcome.
- Prevent TMMIN manual close.
- Emit warning events.
- Implement list/detail queries.

Verification:

- Multiple Open same part keep aggregate affected.
- One terminal closes only its warning.
- Rejected and Cancelled close warning.

Data/migration impact:

- WarningInstance and supporting indexes/read model.

Exit criteria:

- Warning semantics match PRD deterministically.

### 6.7 List, Detail, Filter, dan History APIs

Status: **done**

Dependency: 6.1-6.6.

Execution:

- Implement cursor-paginated Henkaten list.
- Filters: date, status, 4M, line, part, shift, route state hook.
- Implement detail with snapshots/warning/history.
- Apply role scope.
- Add sort and search indexes.

Verification:

- Pagination stable under new inserts.
- Scope/filter combinations tested.
- No full-history unbounded response.

Data/migration impact:

- Additive query indexes.

Exit criteria:

- Future frontend can browse/trace Henkaten efficiently.

### 6.8 Withdraw + Clone

Status: **done**

Dependency: 6.2-6.7.

Execution:

- Restrict Withdraw to LL own line and Open record.
- Require reason.
- Transition to CANCELLED.
- Release only the withdrawn Henkaten's active reservation.
- Close warning and emit event.
- Define clone-prefill response.
- Revalidate latest checklist and assignment on new submit.
- Link `clonedFromHenkatenId`.

Verification:

- Terminal cannot withdraw.
- Clone does not reuse old checklist answers as accepted values.
- Old record remains immutable.

Data/migration impact:

- Clone relation and withdrawal metadata.

Exit criteria:

- Correction flow preserves complete history.

### 6.9 Terminal Immutability dan Henkaten Core Tests

Status: **done**

Dependency: 6.1-6.8.

Execution:

- Complete lifecycle, snapshot, warning, filter, Withdraw/Clone integration tests.
- Add concurrent withdraw/other mutation tests.
- Verify audit/outbox atomicity.
- Add role/tenant negative tests.

Verification:

- PRD Henkaten core acceptance checks pass except approval/Man movement.

Data/migration impact:

- Test DB only; indexes may be adjusted additively.

Exit criteria:

- Henkaten core stable dependency untuk Phase 7.

Phase 6 exit criteria:

- Semua category dapat disubmit dan ditelusuri.
- Warning, immutable snapshot, MP reservation, dan correction flow complete.
- Approval routes dan Man movement belum dinyatakan complete.

---

## 15. Phase 7 - Approval, Man Cascade, dan Shift Finalization Backend

Status: **done**

Goal: menyelesaikan high-risk transactional behavior: parallel approval, reject-fast, reservation
finalization/Man movement, cascade vacancy, pre-start resolution, dan End Shift.

Depends on:

- Phase 6;
- Phase 5 Working Assignment/Issue.

Unlocks:

- Phase 8 read models dan Phase 10 contract freeze.

### 7.1 Parallel Approval Routes

Status: **done**

Dependency: Phase 6.

Execution:

- Add SUPERVISOR and QC route states.
- Capture responsible Supervisor snapshot/routing.
- Allow any active QC, first decision wins.
- Implement approve/reject command with optional comment.
- Persist actor/role/time/comment/IP/correlation/version.
- Add unique route decision constraints.

Verification:

- Supervisor only own lines.
- QC tenant-wide.
- Duplicate route decision rejected/idempotent.
- Supplier Admin/TMMIN cannot decide.

Data/migration impact:

- ApprovalDecision and route state/indexes.

Exit criteria:

- Kedua route dapat diputuskan paralel dengan immutable evidence.

### 7.2 Reject-fast dan Approved Finalization

Status: **done**

Dependency: 7.1.

Execution:

- First Approve keeps Henkaten Open.
- Two Approves finalize APPROVED.
- First Reject finalizes REJECTED.
- Pending other route becomes NOT_REQUIRED.
- Close warning in same transaction.
- Emit domain events.
- Handle stale versions with 409.

Verification:

- Both decision orders tested.
- Both reject origins tested.
- Race approve/reject yields one valid terminal outcome.

Data/migration impact:

- Final decision metadata and route terminal state.

Exit criteria:

- Finalization semantics exactly match PRD.

### 7.3 Optimistic Concurrency dan Stale Decision Handling

Status: **done**

Dependency: 7.1-7.2.

Execution:

- Require expected Henkaten version.
- Lock relevant Henkaten/route rows.
- Return canonical 409 conflict.
- Ensure identical retry idempotency.
- Ensure different retry cannot overwrite.

Verification:

- Parallel QC users.
- Supervisor/QC simultaneous decisions.
- Withdraw vs decision.
- End Shift hook race prepared.

Data/migration impact:

- Unique/idempotency keys if required.

Exit criteria:

- No lost update atau double decision.

### 7.4 MP Reservation Finalization Integration

Status: **done**

Dependency: Phase 6.5 dan 7.3.

Execution:

- Reuse the Phase 6 reservation and source/target assignment versions.
- Release reservation on Rejected and End Shift cancellation.
- Integrate reservation verification/release with final approval and movement.
- Preserve Phase 6 release-on-Withdraw behavior.

Verification:

- Rejected and End Shift free the MP.
- Approval/reject/end races leave one valid reservation outcome.
- Stale assignment blocks approval finalization.

Data/migration impact:

- Approval/finalization references only; MPReservation table and partial indexes already exist.

Exit criteria:

- Open Man Henkaten cannot double-book replacement.

### 7.5 Atomic Approved Man Movement

Status: **done**

Dependency: 7.2 dan 7.4.

Execution:

- On final Approved, lock target/source jobs and MPs.
- Release replaced MP.
- Release replacement from source job if assigned.
- Assign replacement to target.
- Release reservation.
- Write immutable AssignmentMovement ledger.
- Keep Default Assignment unchanged.
- Handle no-source/VACANT cases.

Verification:

- Atomic success/rollback.
- Failure leaves original assignments and reservation consistent.
- Same-line/cross-line/unassigned replacement cases.

Data/migration impact:

- AssignmentMovement and WorkingAssignment mutation metadata.

Exit criteria:

- Approved Man change updates actual assignment exactly once.

### 7.6 Cross-line Cascade Vacancy

Status: **done**

Dependency: 7.5 dan Phase 5.5.

Execution:

- Create linked Assignment Issue for donor job.
- Prevent duplicate active issue.
- Persist origin Henkaten/movement.
- Emit notification event.
- Expose issue in donor preflight/current shift.
- Reject cycle/invalid source states.

Verification:

- Donor active/not-started shift cases.
- Issue survives restart.
- Source stakeholders resolved correctly.

Data/migration impact:

- Origin links and issue state extensions.

Exit criteria:

- Cross-line effect visible dan blocks next Start as required.

### 7.7 Assignment Issue Resolution

Status: **done**

Dependency: 7.6.

Execution:

- Resolve issue only through linked valid assignment resolution.
- Support active-shift and planned-shift paths.
- Preserve issue history.
- Prevent manual false resolve.
- Emit resolution event.

Verification:

- Wrong job/line/Henkaten cannot resolve.
- Repeated resolution idempotent.

Data/migration impact:

- Resolution links/timestamps.

Exit criteria:

- Vacancy lifecycle memiliki verifiable resolution.

### 7.8 Pre-start Man Resolution

Status: **done**

Dependency: 7.4-7.7 dan Phase 5.6.

Execution:

- Complete pre-start Man Henkaten flow.
- Link planned Shift Run and Assignment Issue.
- Route approvals before shift starts.
- Apply Approved movement to planned assignment.
- Refresh preflight.
- Prevent Start until valid or override.

Verification:

- Planned vacancy resolved then Start succeeds.
- Pending/rejected resolution keeps gate.
- Override remains available to Supplier Admin.

Data/migration impact:

- Planned assignment/resolution links finalized.

Exit criteria:

- LL can resolve pre-start vacancy without already-active shift.

### 7.9 End Shift Finalization

Status: **done**

Dependency: 7.2-7.8.

Execution:

- Lock Shift Run dan Open Henkaten.
- Cancel all Open with SHIFT_ENDED.
- Release reservations.
- Mark pending routes NOT_REQUIRED.
- Close warnings.
- Clear active change indicators.
- End Working Assignment state.
- Preserve movement/history.
- Reset next-shift behavior to Default Assignment.
- Emit summary/audit events.

Verification:

- End Shift vs approve race.
- End Shift vs withdraw race.
- Multiple Open categories.
- Cross-line issue/history preservation.
- Idempotent repeated End Shift.

Data/migration impact:

- Shift end summary/cancellation metadata.

Exit criteria:

- End Shift performs entire PRD transaction without partial state.

### 7.10 Race-condition Integration Suite

Status: **done**

Dependency: 7.1-7.9.

Execution:

- Test concurrent:
  - Supervisor/QC approve;
  - approve/reject;
  - two QC users;
  - two Man reservations;
  - Man finalization/withdraw;
  - End Shift/decision;
  - cross-line movements;
  - duplicate command retries.
- Verify database constraints and rollback state.

Verification:

- Exactly one legal outcome per race.
- No duplicate assignment/reservation/decision/warning.

Data/migration impact:

- Test database only.

Exit criteria:

- High-risk transactional domain proven on real PostgreSQL.

Phase 7 exit criteria:

- Hosted Henkaten, approval, Man cascade, pre-start resolution, and End Shift domain complete.

---

## 16. Phase 8 - Notification, Assignment Board, Dashboard, dan Audit Backend

Status: **done**

Goal: membangun durable notification, realtime board read model, supplier/TMMIN dashboard queries, warning explorer, dan audit read APIs.

Depends on:

- Phase 7;
- transactional outbox Phase 2.

Unlocks:

- frontend read experiences;
- TMMIN monitoring;
- External projection integration.

### 8.1 Transactional Notification Generation

Status: **done**

Dependency: outbox dan Phase 7 events.

Execution:

- Add Notification entity.
- Map domain events ke recipient roles/users.
- Implement idempotent notification handler.
- Include safe deep-link metadata.
- Generate notification events minimum sesuai PRD.
- Prevent duplicate notification on outbox retry.

Verification:

- Correct recipients for approval, reject, cancel, vacancy, override.
- Cross-tenant recipient impossible.
- Handler retry idempotent.

Data/migration impact:

- Notification table and recipient/event unique indexes.

Exit criteria:

- In-app notification persists independently from live connections.

### 8.2 Per-user Read/Unread State

Status: **done**

Dependency: 8.1.

Execution:

- Implement paginated notification list.
- Implement read/unread mutation.
- Add unread count.
- Preserve domain state independence.
- Apply user-specific authorization.

Verification:

- Read state only affects current user.
- Mark read does not close warning/Henkaten.
- Disabled user cannot access.

Data/migration impact:

- ReadAt/indexes.

Exit criteria:

- Notification center API complete.

### 8.3 Assignment Board Read Model

Status: **done**

Dependency: Phase 7.

Execution:

- Build query/read projection for current Shift Run.
- Include line, Supervisor, LL, ordered jobs, MP, photo/initials metadata, vacancy/reservation/conflict.
- Include Open and Approved active-shift 4M indicators.
- Distinguish Open vs Approved visual state contract.
- Exclude Rejected/Cancelled from active indicators.
- Add `lastUpdatedAt` and read-model version.
- Scope by role.

Verification:

- Board matches current assignment after Man movement/End Shift.
- Role scopes and inactive states.
- No unbounded N+1 query at Compact fixture size.

Data/migration impact:

- Add read indexes or projection table only if query measurement requires; decision recorded in ADR.

Exit criteria:

- One stable board payload supports supplier frontend without client-side joins.

### 8.4 SSE Realtime Stream dan Stale Fallback

Status: **done**

Dependency: 8.1-8.3.

Execution:

- Implement authenticated SSE endpoint.
- Scope subscription by tenant/role/line.
- Publish invalidation/version events, not sensitive full payload unless explicitly safe.
- Add heartbeat/reconnect semantics.
- Support `Last-Event-ID` or refresh-on-reconnect strategy.
- Keep REST read model as source of truth.
- Expose stale/disconnected metadata contract.

Verification:

- Unauthorized stream scope rejected.
- Reconnect refreshes missed state.
- Outbox retry does not cause invalid domain duplication.
- End Shift/approval/Man update propagates within target.

Data/migration impact:

- Optional SSE delivery cursor; durable domain state remains DB.

Exit criteria:

- Board/notification can update realtime without Redis.

### 8.5 Supplier Dashboard Aggregations

Status: **done**

Dependency: Phase 7.

Execution:

- Implement KPI counts by status.
- Approval route pending/aging.
- 4M trends.
- Line/part distributions.
- decision outcome trends.
- unresolved Assignment Issues.
- emergency overrides.
- recent activity.
- Server-side filters and role scope.

Verification:

- Aggregates reconcile with source records.
- Date/timezone filters correct.
- Role-scoped results exclude unauthorized lines.

Data/migration impact:

- Add dashboard query indexes; materialized views only if measurement requires and ADR approved.

Exit criteria:

- Supplier dashboard API meets PRD widget/filter needs.

### 8.6 TMMIN Warning dan Global Dashboard

Status: **done**

Dependency: 8.5 dan warning Phase 6.

Execution:

- Implement cross-supplier KPIs.
- Implement active warning explorer.
- Add supplier/source-mode/data-freshness views.
- Add affected part aggregation.
- Add Hosted/External source badge contract.
- Include emergency override visibility.
- Restrict mutation.

Verification:

- TMMIN Quality read-only.
- Warning aggregate reconciliation.
- Cross-tenant read requires explicit TMMIN guard/audit.

Data/migration impact:

- Global query indexes/read models.

Exit criteria:

- TMMIN monitoring backend complete untuk Hosted data dan siap menerima External projection.

### 8.7 Audit Timeline dan Read APIs

Status: **done**

Dependency: audit data dari Phase 2-7.

Execution:

- Implement resource timeline query.
- Implement tenant audit list with filters.
- Implement TMMIN privileged audit list.
- Redact sensitive before/after data.
- Audit access to audit where required.
- Add pagination.

Verification:

- Actor/action/resource timeline complete.
- Supplier cannot read other tenant.
- No password/token/freeform sensitive dump.

Data/migration impact:

- Audit query indexes.

Exit criteria:

- Authorized users can trace critical mutations end-to-end.

### 8.8 Backend Read-model Hardening

Status: **done**

Dependency: 8.1-8.7.

Execution:

- Run query plans with Compact dataset.
- Add required indexes.
- Test pagination/filter combinations.
- Test SSE authorization/reconnect.
- Test notification idempotency.
- Test aggregate correctness.

Verification:

- Read APIs remain within preliminary backend performance targets.
- No N+1 or unbounded list.

Data/migration impact:

- Additive indexes/projections only.

Exit criteria:

- Backend read models stable for frontend and External integration.

Phase 8 exit criteria:

- Notification, board, dashboard, warning explorer, realtime, and audit APIs complete for Hosted domain.

---

## 17. Phase 9 - External REST API Backend

Status: **done**

Goal: menyediakan external client lifecycle dan idempotent monitoring ingestion tanpa memberi supplier External akses ke Hosted workflow.

Depends on:

- Phase 8;
- source mode Phase 3.7.

Unlocks:

- complete TMMIN Hosted/External monitoring;
- backend contract freeze.

### 9.1 External API Client Lifecycle

Status: **done**

Dependency: Phase 3.7.

Execution:

- Add ExternalApiClient.
- Generate client ID dan secret.
- Store secret hash only.
- Display plaintext secret once.
- Support maximum two secrets during rotation window.
- Implement revoke/rotate.
- Bind supplier/source epoch/scopes/IP allowlist.
- Audit credential actions.

Verification:

- Revoked/old-epoch credential denied.
- Secret never readable after issue.
- Cross-supplier client access impossible.

Data/migration impact:

- ExternalApiClient, secret metadata, allowlist.

Exit criteria:

- TMMIN Admin dapat mengelola external credential safely.

### 9.2 Client-credentials Token Endpoint

Status: **done**

Dependency: 9.1.

Execution:

- Implement `/api/v1/external/auth/token`.
- Validate client ID/secret/IP/source mode/epoch.
- Issue 15-minute scoped bearer token.
- Add 10-attempt/minute client/IP rate limit.
- Return generic auth failure.
- Audit failures/success as safe metadata.

Verification:

- Valid/invalid/rotated/revoked/allowlist scenarios.
- Token scope and expiry.
- Secret redaction.

Data/migration impact:

- Optional token/jti revocation metadata; no plaintext tokens.

Exit criteria:

- External client obtains only scoped short-lived access.

### 9.3 OpenAPI dan Zod Event Contracts

Status: **done**

Dependency: shared contracts Phase 1 and PRD API v1.

Execution:

- Define event envelope and five event types.
- Define Hosted-independent line/shift/job/part snapshots.
- Define category-specific change payload.
- Define checklist and decision schemas.
- Define allowed/forbidden PII boundary.
- Define response/problem contracts.
- Generate/reconcile OpenAPI examples.

Verification:

- Contract fixtures for every valid event.
- Invalid timestamps/status/PII fields rejected.
- OpenAPI and runtime parser consistent.

Data/migration impact:

- Tidak ada product rows yet.

Exit criteria:

- Public external wire contract frozen before ingest implementation.

### 9.4 Single-event Ingestion

Status: **done**

Dependency: 9.2-9.3.

Execution:

- Implement `POST /api/v1/external/henkaten/events`.
- Bind supplier/source epoch from token.
- Validate schema and business transition.
- Store raw canonical event.
- Return ingestion ID/status/correlation.
- Process projection transactionally.
- Emit warning/projection events.

Verification:

- OPENED valid first event.
- Wrong source mode/tenant/epoch denied.
- Malformed/oversized event rejected.

Data/migration impact:

- ExternalIngestionEvent and ExternalHenkatenProjection.

Exit criteria:

- New external event safely creates monitoring projection.

### 9.5 Idempotency dan Source-version Ordering

Status: **done**

Dependency: 9.4.

Execution:

- Canonicalize payload and calculate hash.
- Unique eventId per supplier/epoch.
- Identical retry returns DUPLICATE.
- Same eventId/different hash returns 409.
- Enforce first sourceVersion=1.
- Enforce sequential increments/no gaps.
- Prevent terminal regression/update.
- Add ingestion status endpoint.

Verification:

- Duplicate/conflict/stale/gap/terminal cases.
- Concurrent identical submissions create one raw/projection side effect.

Data/migration impact:

- Unique/idempotency/version indexes.

Exit criteria:

- Supplier retries are safe and projection order deterministic.

### 9.6 Batch Ingestion

Status: **done**

Dependency: 9.5.

Execution:

- Implement batch endpoint max 500 events/5 MB.
- Validate envelope.
- Process per item, not all-or-nothing.
- Preserve sourceVersion order per source Henkaten.
- Return ACCEPTED/DUPLICATE/REJECTED per item.
- Bound transaction size and memory.

Verification:

- Mixed result batch.
- Multiple versions same source in order/out of order.
- One invalid item does not roll back unrelated valid event.

Data/migration impact:

- Batch correlation metadata if needed.

Exit criteria:

- External backfill/burst works within defined limits.

### 9.7 Projection dan TMMIN Warning Integration

Status: **done**

Dependency: 9.4-9.6 dan Phase 8.6.

Execution:

- Project current external Henkaten state.
- Create/close warning from external status.
- Reuse global dashboard source badge/data freshness.
- Keep raw event immutable.
- Do not expose assignment board.
- Track last successful ingestion.

Verification:

- External Open/terminal warning behavior.
- Hosted and External projections remain distinguishable.
- TMMIN cannot mutate external projection.

Data/migration impact:

- Projection/freshness indexes and warning source relation.

Exit criteria:

- TMMIN dashboard monitors External data consistently with PII boundary.

### 9.8 PII, Rate Limit, dan IP Allowlist Enforcement

Status: **done**

Dependency: 9.2-9.7.

Execution:

- Enforce forbidden schema fields.
- Sanitize/log only safe metadata.
- Apply 120 requests/minute, burst 300.
- Return Retry-After/rate headers.
- Enforce optional IP allowlist.
- Validate freeform length and document supplier responsibility.

Verification:

- Forbidden fields and disallowed IP rejected.
- Rate threshold/reset tests.
- Logs/raw audit do not expose secret.

Data/migration impact:

- Rate counters strategy per ADR; PostgreSQL/in-process limits must fit single-instance topology.

Exit criteria:

- External ingestion meets security/privacy contract.

### 9.9 External Contract dan Security Suite

Status: **done**

Dependency: 9.1-9.8.

Execution:

- Add unit, PostgreSQL integration, concurrency, and contract tests.
- Add token/client abuse cases.
- Add idempotency/out-of-order tests.
- Add batch partial result tests.
- Add TMMIN read-only tests.
- Add OpenAPI validation.

Verification:

- PRD External API acceptance checks complete.

Data/migration impact:

- Test DB only; indexes may be tuned additively.

Exit criteria:

- External API backend production-candidate contract.

Phase 9 exit criteria:

- External suppliers can securely push monitoring events; TMMIN receives unified warning/dashboard data without Hosted control or excess PII.

Implementation note:

- Migration 007 menambahkan credential, token digest, immutable raw ingestion, current projection,
  unified warning source, index, dan append-only trigger.
- Strict shared Zod schemas dan OpenAPI mencakup lima lifecycle event untuk keempat kategori 4M,
  single/batch/status endpoint, dan TMMIN client/projection reads.
- Serializable per-event transaction, canonical hash reconciliation, source-version ordering,
  terminal freeze, dan per-item batch isolation telah dibuktikan dengan real PostgreSQL.
- External Open/terminal state memperbarui warning dan mengirim durable notification ke active
  TMMIN Admin; Assignment Board tetap Hosted-only.
- Local single-instance rate limiter menerapkan token attempt limit serta ingestion token bucket;
  horizontal scaling memerlukan coordinated counter sesuai ADR 0018.

---

## 18. Phase 10 - Backend Contract Freeze dan Hardening

Status: **done**

Goal: menutup backend implementation gap, mengunci contracts, menguji concurrency/security/performance, dan memastikan frontend dapat dibangun tanpa backend redesign.

Depends on:

- Phase 3-9.

Unlocks:

- Phase 11-14 frontend.

### 10.1 Unit Coverage Completion

Status: **done**

Dependency: all backend phases.

Execution:

- Audit untested domain branches.
- Complete tests untuk state machines, parsers, validation, aggregation, permission helpers, and event handlers.
- Remove brittle implementation-detail assertions.

Verification:

- Critical domain branches covered.
- Tests deterministic.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Core policy memiliki direct unit evidence.

### 10.2 Full PostgreSQL Integration Suite

Status: **done**

Dependency: 10.1.

Execution:

- Run auth, tenancy, master, shift, Henkaten, approval, assignment, outbox, notification, dashboard, and external tests together.
- Verify fresh migration and seeded environment.
- Verify cleanup/no leaked connection.
- Test upgrade path from prior migration checkpoint.

Verification:

- Full suite lulus repeatedly on clean database.

Data/migration impact:

- Disposable test databases.

Exit criteria:

- Complete backend works as one persistence system.

### 10.3 Concurrency dan Failure-path Suite

Status: **done**

Dependency: 10.2.

Execution:

- Consolidate race tests.
- Test process interruption/outbox retry.
- Test DB constraint failures and transaction rollback.
- Test stale clients and idempotent retries.
- Verify no partial audit/warning/assignment state.

Verification:

- Exactly-one legal outcome for every critical race.

Data/migration impact:

- Tidak ada production data change.

Exit criteria:

- Failure paths are intentional and observable.

### 10.4 OpenAPI dan Shared-contract Reconciliation

Status: **done**

Dependency: 10.1-10.3.

Execution:

- Compare every implemented route with shared Zod contract.
- Generate/finalize OpenAPI.
- Freeze enum/error/status names.
- Add contract snapshots for critical responses.
- Mark intentionally deferred routes.

Verification:

- No undocumented route or divergent DTO.
- Contract package build/tests pass.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Frontend typed client dapat dikembangkan dari stable contracts.

### 10.5 Query dan Index Review

Status: **done**

Dependency: 10.2.

Execution:

- Seed Compact-scale representative dataset.
- Review query plans for list, board, dashboard, warning, audit, notification, and external status.
- Remove N+1 patterns.
- Add bounded indexes.
- Confirm pagination stability.

Verification:

- Preliminary API latency target met under local/staging-like test.

Data/migration impact:

- Additive index migration only.

Exit criteria:

- Query model supports frontend without client-side bulk loading.

### 10.6 Backend Performance Baseline

Status: **done**

Dependency: 10.5.

Execution:

- Run common read/write/approval/ingest workloads.
- Capture p50/p95/p99 and error rate.
- Identify slow transactions and lock contention.
- Tune application/database within PRD architecture.

Verification:

- Meets preliminary p95 targets or records explicit blocker before frontend.

Data/migration impact:

- Index/config adjustments only; no hidden cache service.

Exit criteria:

- Backend performance risk known and controlled.

### 10.7 Security Negative Tests dan Backend Freeze

Status: **done**

Dependency: 10.1-10.6.

Execution:

- Run cross-tenant/cross-role/IDOR/CSRF/CORS/over-posting/file-upload/token tests.
- Review secret and PII logs.
- Resolve Critical/High issues.
- Declare contract freeze.
- Document allowed post-freeze adjustment scope:
  - additive read fields;
  - pagination metadata;
  - sort/filter options;
  - safe error codes;
  - indexes.

Verification:

- No unresolved Critical/High backend security finding.

Data/migration impact:

- Additive hardening changes only.

Exit criteria:

- Frontend work may start.

Phase 10 exit criteria:

- Backend APIs, contracts, database behavior, security, and preliminary performance stable.

Implementation note:

- Controller metadata dan generated OpenAPI sekarang direkonsiliasi exactly: 124 paths dan 140 HTTP
  operations. Test ini menemukan dan menutup sebelas undocumented operations serta lima path
  parameter drift.
- Direct unit evidence mencakup canonical external hashing, source-version/terminal rules, IP
  allowlist, token fixed window, ingestion token bucket, dan Retry-After semantics.
- Full fresh PostgreSQL suite lulus 31 tests; prior concurrency/failure suite tetap aktif dan
  External coverage menambah allowlist, old epoch, immediate token revoke, dan concurrent identical
  ingestion.
- Migration 008 menambahkan deterministic pagination/cursor indexes dan lulus fresh serta 007→008
  upgrade-path verification.
- Dedicated `pnpm test:baseline` memakai empty disposable `_test` database dan seed 42 supplier ×
  20 line × 300 member × 500 job, ditambah 500 projection dan 1.000 audit rows per supplier.
- Seluruh measured dashboard/read/mutation/ingestion p95 lulus target dengan 0% unexpected error;
  high-cardinality plan memakai index-only scan.
- Backend v1 freeze mengizinkan additive read field, pagination/filter/sort, safe error code,
  read-only route, dan index; breaking change memerlukan migration plan atau version baru.

---

## 19. Phase 11 - Frontend dan Shared UI Foundation

Status: **done**

Goal: membuat dua React Vite applications, shared design primitives, typed API client, session handling, dan common UX states setelah backend contract freeze.

Frontend route, permission, page-state, dan cross-app behavior wajib mengikuti `.agent/PAGES.md`.
Contract gap di dokumen tersebut tidak boleh ditutup dengan client-only business policy.

Depends on:

- Phase 10.

Unlocks:

- Phase 12-14.

### 11.1 Frontend Workspace Scaffold

Status: **completed**

Dependency: Phase 10.

Execution:

- Tambahkan `apps/supplier-web`.
- Tambahkan `apps/tmmin-web`.
- Tambahkan `packages/ui`.
- Scaffold React + Vite + TypeScript.
- Configure pnpm workspace dependencies.
- Configure environment-safe API base URLs.
- Add per-app build/dev/test/typecheck scripts.
- Add root scripts.

Verification:

- Kedua app build/run independently.
- No backend/database direct dependency.
- Production build uses explicit API URL.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Dua frontend shells tersedia di workspace.

Completion evidence (2026-07-24):

- `apps/supplier-web` dan `apps/tmmin-web` tersedia sebagai React/Vite/TypeScript app terpisah.
- `packages/ui` menjadi shared package tanpa direct database/backend dependency.
- dev port `5173`/`5174` dan preview port `4173`/`4174` deterministic.
- root product routes menyatakan Phase 11 foundation; public `/design` dipasang sebelum future
  session/bootstrap boundary.

### 11.2 Shared Tailwind/shadcn UI Foundation

Status: **completed**

Dependency: 11.1.

Execution:

- Configure Tailwind dan shadcn/ui.
- Define typography, spacing, color, status, focus, and layout tokens.
- Implement reusable:
  - button/icon button;
  - input/select/textarea/checkbox/radio;
  - form field/error;
  - dialog/drawer;
  - table;
  - tabs;
  - badge/status;
  - toast;
  - skeleton;
  - pagination;
  - empty/error/forbidden states.
- Add 4M semantic visual tokens with icon/label, not color only.

Verification:

- Component unit/a11y tests.
- Both apps consume same package.
- Focus and keyboard behavior verified.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Feature pages dapat dibangun tanpa duplicated primitive components.

Completion evidence (2026-07-24):

- CSS-first Tailwind v4, shadcn-compatible workspace aliases, Radix behavior, Lucide, Inter Variable,
  TanStack Table, dan Recharts terpasang.
- `--hds-*` raw, semantic, state, domain, typography, spacing, shape, elevation, motion, density,
  layer, breakpoint, focus, chart, dan component tokens tersedia dalam CSS dan typed registry.
- shared catalog mencakup actions, inputs, navigation, feedback, overlays, data display, dan domain
  components dengan controlled/uncontrolled API yang relevan.
- `/design` pada kedua app merender token specimens, component state matrices, domain semantics,
  accessibility contract, guidelines, dan delapan product patterns berdasarkan reference images.
- unit/API, token contract, lint, typecheck, build, dan browser verification menjadi evidence
  completion; detail command/result dicatat pada session handoff.

### 11.3 Typed API Client

Status: **done**

Dependency: Phase 10 contracts and 11.1.

Execution:

- Build fetch client using shared contracts.
- Handle cookies/credentials, correlation ID, problem details, and 401/403/409/422/429.
- Add cursor pagination helpers.
- Add upload helper.
- Add typed SSE client.
- Prevent ad-hoc endpoint strings inside feature components.

Verification:

- Contract parsing success/failure tests.
- Conflict/error mapping tests.
- SSE reconnect helper tests.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Both frontends use one safe API boundary.

### 11.4 React Router dan Route Guards

Status: **done**

Dependency: 11.1 dan 11.3.

Execution:

- Configure route trees per app.
- Implement authenticated/anonymous/forced-reset guards.
- Implement role and capability route metadata.
- Preserve intended path after login where safe.
- Add not-found and forbidden pages.

Verification:

- Unauthorized routes redirect/deny correctly.
- Frontend guard never replaces backend authorization.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Application navigation respects session state and role.

### 11.5 TanStack Query dan Table Foundation

Status: **done**

Dependency: 11.3.

Execution:

- Configure query client/default retry.
- Avoid retries for authorization/validation conflicts.
- Define query key convention including tenant/scope.
- Implement cursor list hooks.
- Configure TanStack Table server pagination/filter/sort.
- Add cache invalidation helpers for domain events.

Verification:

- Tenant/session change clears sensitive cache.
- Pagination and filter state stable.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Feature lists/dashboard can use consistent server-state behavior.

### 11.6 React Hook Form dan Zod

Status: **done**

Dependency: shared contracts and UI foundation.

Execution:

- Configure form resolver.
- Map server field errors.
- Add dirty-state/leave protection.
- Handle optimistic version hidden fields safely.
- Add accessible form summary/focus-first-error behavior.

Verification:

- Client and server validation errors render correctly.
- Stale conflict does not silently overwrite.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Complex admin/Henkaten forms have one standard pattern.

### 11.7 Authentication dan Session Shells

Status: **done**

Dependency: 11.3-11.6.

Execution:

- Implement current-session bootstrap.
- Implement supplier and TMMIN logout.
- Implement forced password reset screen.
- Handle session expiry globally.
- Clear caches on logout/realm change.
- Add idle-session user warning if required by UX.

Verification:

- Expired/revoked session handling.
- Forced reset blocks application access.
- No sensitive cache after logout.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Both apps have secure session-aware shells.

### 11.8 Common Loading, Error, Conflict, dan Stale States

Status: **done**

Dependency: 11.2-11.7.

Execution:

- Implement page and component loading states.
- Implement retryable/non-retryable error panels.
- Implement stale version conflict dialog with refresh.
- Implement SSE disconnected/stale banner.
- Add `lastUpdatedAt` pattern.
- Add empty-state next actions.

Verification:

- Offline/API down/409/403/empty scenarios.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Feature teams do not invent inconsistent failure UX.

### 11.9 Accessibility Baseline

Status: **done**

Dependency: 11.2-11.8.

Execution:

- Keyboard navigation.
- Visible focus.
- Dialog focus trap/restore.
- Form label/error associations.
- Status accessible names.
- Minimum desktop viewport handling.
- Add automated accessibility smoke tests where practical.

Verification:

- Shared component accessibility suite.
- Manual keyboard pass.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Frontend feature implementation starts from accessible foundation.

Phase 11 exit criteria:

- Both frontend shells authenticate, call real API, and share stable contracts/UI primitives.

Completion evidence (2026-07-24):

- `packages/api-client` provides generated OpenAPI paths, runtime Zod validation, realm operation
  catalogs, typed problem/network/contract/uncertain errors, upload/blob/204 handling, correlation,
  CSRF, idempotency, abort, and Supplier EventSource lifecycle.
- Supplier and TMMIN foundations implement public `/design`, session bootstrap, forced reset,
  capability/purpose guards, safe intended paths, scoped QueryClient keys, cache clearing,
  unsupported viewport handling, and account/logout.
- Supplier production pages use URL-owned server query state, cursor history, expected versions,
  duplicate-submit locking, refresh-only conflict recovery, realtime invalidation, and shared
  polished loading/empty/error/stale states.
- ADR 0022–0024 record the browser boundary, session/cache boundary, and application composition.

---

## 20. Phase 12 - Supplier-facing Frontend

Status: **done**

Goal: mengimplementasikan seluruh Hosted supplier workflows untuk Supplier Admin, Supervisor, LL, dan QC.

Supplier route catalog, role visibility, page behavior, dan user-flow acceptance mengikuti
`.agent/PAGES.md`.

Depends on:

- Phase 11;
- backend contract freeze.

Unlocks:

- Phase 14 full integration.

### 12.1 Supplier Login dan Forced Reset

Status: **done**

Dependency: Phase 11.

Execution:

- Build Supplier Code + Username + Password form.
- Generic authentication failure.
- Lockout/rate-limit feedback tanpa enumeration.
- Forced temporary-password reset.
- Session restore/logout.

Verification:

- Success/failure/locked/expired/reset flows.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Supplier identities dapat masuk secara aman.

### 12.2 Supplier Admin Onboarding

Status: **done**

Dependency: 12.1.

Execution:

- Build setup overview/progress.
- Guide order: shift, members, lines/jobs, parts, checklists, defaults.
- Show configuration blockers.
- Do not add bulk import/export.
- Deep-link to relevant CRUD.

Verification:

- Empty/new tenant can reach valid configuration using individual forms.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Admin understands and can complete required setup.

### 12.3 Member, Photo, dan Account Management

Status: **done**

Dependency: 12.2.

Execution:

- Member list/filter/detail/create/edit/deactivate.
- Role-specific account credential fields.
- Photo upload/crop preview where supported.
- Initials fallback.
- Temporary password one-time display.
- Reset/deactivate account.
- Version conflict handling.

Verification:

- MP has no credential UI.
- Upload validation/error states.
- Referenced deactivation blocker.

Data/migration impact:

- Uses existing backend only.

Exit criteria:

- Supplier Admin can manage all member/account types.

### 12.4 Line, Job, Part, Shift, dan Checklist CRUD

Status: **done**

Dependency: 12.2.

Execution:

- Line/job nested management and ordering.
- Part search/list/forms.
- Shift Template and cross-midnight form.
- 4M checklist draft/publish/version history.
- Active/inactive state and referenced-data blockers.
- Optimistic conflict UX.

Verification:

- All individual CRUD flows against real API.
- No client-only state assumed saved.

Data/migration impact:

- Tidak ada.

Exit criteria:

- All supplier master data manageable from UI.

### 12.5 Default Assignment Management

Status: **done**

Dependency: 12.3-12.4.

Execution:

- Line-based Supervisor assign/change/remove.
- LL assign/change/remove with availability.
- Job-based MP assign/change/remove/move.
- Show conflicts and affected old assignment.
- Confirm atomic moves.
- Explain changes apply next shift when active.

Verification:

- Availability and atomic move flows.
- Active-shift defaults do not change board.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Admin can maintain valid defaults without accidental Henkaten.

### 12.6 Start Shift, Preflight, Resolution, dan Override

Status: **done**

Dependency: 12.5.

Execution:

- Current/planned shift view.
- Preflight checklist with blocking codes/resources.
- Pre-start resolution wizard.
- Pending approval visibility.
- Normal Start.
- Admin-only emergency override with reason and unresolved banner.
- End Shift confirmation showing auto-cancel consequences.

Verification:

- Valid/blocked/override/end scenarios.
- LL cannot use admin override.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Shift lifecycle usable and transparent.

### 12.7 Henkaten 4M Input

Status: **done**

Dependency: active/planned shift UI.

Execution:

- Category selection.
- Auto-resolved line and target job.
- Search part by number/name.
- Render versioned checklist.
- Enforce all Yes before submit.
- Man replaced/replacement selection and reservation feedback.
- Non-Man affected/replacement/cause/detail fields.
- Submit confirmation and Open state.

Verification:

- Four category flows.
- Checklist NO/unanswered blocked.
- Stale assignment/reservation conflict.

Data/migration impact:

- Tidak ada.

Exit criteria:

- LL can submit valid Henkaten without line spoofing.

### 12.8 Approval Queues dan Decision History

Status: **done**

Dependency: 12.7.

Execution:

- Supervisor scoped queue.
- QC tenant-wide queue.
- Pending/approved/rejected filters.
- Detail/checklist/history.
- Approve/reject with optional comment.
- Stale/route-already-decided behavior.
- Reject-fast terminal refresh.

Verification:

- Role/line scope.
- Both decision orders and stale race UX.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Approvers can decide safely and see immutable history.

### 12.9 Withdraw + Clone

Status: **done**

Dependency: 12.7-12.8.

Execution:

- LL Withdraw action with reason.
- Confirm reservation/warning consequences.
- Clone opens prefilled form.
- Force current checklist answers.
- Show source relationship.

Verification:

- Terminal record has no Withdraw.
- Clone validation uses current data.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Correction flow fully usable.

### 12.10 Assignment Board Realtime

Status: **done**

Dependency: 12.6-12.8 dan SSE foundation.

Execution:

- Render line/shift/Supervisor/LL/jobs/MP/photo/initials.
- Show vacancy/reserved/conflict.
- Show 4M icon+label indicators.
- Distinguish Open/Approved.
- SSE invalidation/refetch.
- Stale/disconnected/last-updated states.
- Role-scoped views.

Verification:

- Approval/Man/End Shift updates within target.
- Keyboard and accessible names.
- No process difficulty/skill/health UI.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Board is current, accessible, and role-scoped.

### 12.11 Supplier Dashboard

Status: **done**

Dependency: backend dashboard APIs.

Execution:

- KPI summary.
- Approval aging.
- 4M, line, part, outcome trends.
- Assignment Issues and override views.
- Filters and drill-down.
- Role scope.

Verification:

- Charts/tables reconcile with API.
- Empty/large/filter states.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Supplier roles can monitor allowed scope.

### 12.12 Notification Center dan Audit Views

Status: **done**

Dependency: backend notification/audit APIs.

Execution:

- Notification list/unread count/read action/deep links.
- Audit/history timeline.
- Permission-aware resource links.
- No domain mutation from read state.

Verification:

- Read/unread independence.
- Unauthorized deep links denied.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Supplier users can follow events and trace actions.

### 12.13 Supplier Role-scoped UX Tests

Status: **done**

Dependency: 12.1-12.12.

Execution:

- Component/integration tests for each role.
- Test forbidden controls and backend denial handling.
- Test loading/error/conflict/stale states.
- Test keyboard flow.

Verification:

- Supplier frontend root tests pass.

Data/migration impact:

- Test data only.

Exit criteria:

- Hosted supplier frontend feature-complete.

Phase 12 exit criteria:

- Supplier Admin, Supervisor, LL, and QC workflows complete against real backend.

Completion evidence (2026-07-24):

- Supplier session capability/context, setup readiness, dashboard aggregates/filters, board override
  context, Henkaten source traceability, and role-scoped audit contracts close
  GAP-01/02/03/04/13/15 additively.
- Migration `20260724000900_supplier_frontend_audit_scope` adds nullable line evidence, safe
  backfill, and cursor index without destructive data operations.
- Supplier UI implements authentication/setup, individual master-data lifecycle, versioned
  checklists, default assignment/atomic move, Shift preflight/start/override/end, four-category
  Henkaten/approval/withdraw/clone, realtime Board, dashboard, notifications, audit, and account.
- Production pages were implemented after visual inspection of the matching approved references;
  prohibited Save Draft, export, bulk, global search, dark/mobile, and non-PRD workflows are absent.
- Contract, policy, API client, frontend foundation, PostgreSQL integration, OpenAPI, build,
  formatting, lint, typecheck, secret, and diff checks are recorded in the session handoff.

---

## 21. Phase 13 - TMMIN-facing Frontend

Status: **done**

Goal: mengimplementasikan TMMIN tenant administration, warnings, global monitoring, External integration health, audit, dan system status.

TMMIN route catalog, Admin/Quality permission boundary, dan Hosted/External detail treatment
mengikuti `.agent/PAGES.md`.

Depends on:

- Phase 11;
- backend Phase 8-10.

Unlocks:

- Phase 14.

### 13.1 TMMIN Login dan App Shell

Status: **done**

Dependency: Phase 11.

Execution:

- TMMIN username/password login.
- Forced reset/session/logout.
- Role-aware navigation for Admin vs Quality.
- Global supplier/source filters.

Verification:

- Realm separation from supplier login.
- TMMIN Quality cannot reach admin mutations.

Data/migration impact:

- Tidak ada.

Exit criteria:

- TMMIN identities access correct shell.

### 13.2 Supplier dan Privileged-user Administration

Status: **done**

Dependency: 13.1.

Execution:

- Supplier list/create/detail/edit/activate/deactivate.
- Supplier code and mode visibility.
- Supplier Admin create/replace/reset.
- TMMIN Quality account management for TMMIN Admin.
- Confirm/audit-sensitive actions.

Verification:

- Exactly one active Supplier Admin UX.
- Read-only Quality behavior.

Data/migration impact:

- Tidak ada.

Exit criteria:

- TMMIN Admin can provision and support tenants.

### 13.3 Source Mode dan Cutover UI

Status: **done**

Dependency: 13.2.

Execution:

- Show current mode/epoch.
- Run/show cutover preflight.
- Display blockers.
- Require reason and confirmation.
- Preserve source history navigation.
- Refresh revoked session/credential state.

Verification:

- Blocked/successful cutover.
- TMMIN Quality view-only.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Source mode can be governed without hidden mixed writes.

### 13.4 External Credential Management

Status: **done**

Dependency: 13.3.

Execution:

- Issue client and one-time secret display.
- Rotate/revoke.
- Manage optional IP allowlist.
- Show scopes/epoch/last use.
- Prevent secret redisplay.

Verification:

- Copy/acknowledge one-time secret.
- Revoked/rotated visual state.

Data/migration impact:

- Tidak ada.

Exit criteria:

- External onboarding operational from TMMIN UI.

### 13.5 Global Dashboard

Status: **done**

Dependency: 13.1.

Execution:

- Supplier/source counts.
- Open/aging/affected parts.
- 4M/outcome trends.
- supplier/line/part ranking.
- Hosted/External freshness.
- override and recent activity.
- Server-side filters/drill-down.

Verification:

- Filters and aggregates reconcile.
- Quality remains read-only.

Data/migration impact:

- Tidak ada.

Exit criteria:

- TMMIN obtains comprehensive monitoring overview.

### 13.6 Warning Explorer

Status: **done**

Dependency: 13.5.

Execution:

- Active warning list grouped by supplier+part.
- Instance detail with approval states/aging.
- Hosted/External source badge.
- Drill-down to Henkaten.
- No manual close control.

Verification:

- Multiple Open aggregation.
- Terminal closure refresh.
- No mutation request emitted.

Data/migration impact:

- Tidak ada.

Exit criteria:

- TMMIN Quality can monitor affected parts accurately.

### 13.7 Henkaten Explorer dan Drill-down

Status: **done**

Dependency: 13.5.

Execution:

- Cross-supplier filtered list.
- Hosted detail with checklist/decision/assignment/audit.
- External detail with minimal PII/source events.
- Source-mode-specific field treatment.
- Immutable/read-only UX.

Verification:

- External view does not expect photo/registration/assignment board.
- Hosted PII shown only to allowed TMMIN role.

Data/migration impact:

- Tidak ada.

Exit criteria:

- TMMIN can trace both source modes without conflating data contracts.

### 13.8 External Ingestion Health

Status: **done**

Dependency: 13.4 dan 13.7.

Execution:

- Last successful ingestion/freshness.
- accepted/duplicate/rejected counts.
- recent validation errors without secret/forbidden PII.
- client/epoch/status.
- event correlation lookup.

Verification:

- No raw secret/token shown.
- Supplier filter and pagination.

Data/migration impact:

- Tidak ada.

Exit criteria:

- TMMIN can diagnose external data freshness and schema errors.

### 13.9 Audit dan System Status

Status: **done**

Dependency: backend audit/health.

Execution:

- Cross-supplier audit filters for Admin.
- Permitted monitoring audit for Quality.
- API health/readiness/release SHA display.
- No infrastructure secret/topology leak.

Verification:

- Role restrictions.
- Audit access recorded where required.

Data/migration impact:

- Tidak ada.

Exit criteria:

- TMMIN support/governance visibility complete.

### 13.10 TMMIN Read-only Enforcement Tests

Status: **done**

Dependency: 13.1-13.9.

Execution:

- Component/integration tests for Admin vs Quality.
- Assert no Quality mutation controls.
- Test backend 403 handling if a mutation is manually attempted.
- Test Hosted/External display differences.

Verification:

- TMMIN frontend tests pass.

Data/migration impact:

- Test data only.

Exit criteria:

- TMMIN frontend feature-complete and permission-safe.

Phase 13 exit criteria:

- TMMIN Admin dan Quality capabilities complete with explicit read-only Quality posture.

---

## 22. Phase 14 - Frontend/Backend Integration dan Full E2E

Status: **done**

Goal: menguji seluruh application sebagai satu local full stack dan melakukan hanya backend adjustments yang diizinkan setelah contract freeze.

Integration pass wajib merekonsiliasi seluruh `ADDITIVE API REQUIRED` dan `POLICY MISMATCH` pada
`.agent/PAGES.md`; unresolved release-critical gap tidak boleh disamarkan oleh frontend.

Depends on:

- Phase 12;
- Phase 13.

Unlocks:

- Phase 15 deployment;
- Phase 16 UAT.

### 14.1 Real API Integration Pass

Status: **done**

Dependency: Phase 12-13.

Execution:

- Jalankan kedua web apps terhadap local API/PostgreSQL.
- Exercise every route/form/list/filter/SSE flow.
- Verify cookies, CSRF, CORS, pagination, error codes, and cache invalidation.
- Remove fixture-only production paths.
- Verify no frontend policy workaround.

Verification:

- All main flows work manually and through integration tests.

Data/migration impact:

- Local/test data only.

Exit criteria:

- Frontends use real backend contracts end-to-end.

### 14.2 Constrained Backend Adjustments

Status: **done**

Dependency: 14.1.

Allowed:

- additive safe read-model fields;
- pagination metadata;
- sort/filter options;
- safe error codes;
- derived labels;
- indexes required by measured UI queries.

Disallowed:

- domain/state redesign;
- weakened tenant/role/PII controls;
- business policy moved to frontend;
- direct frontend database access;
- Redis/new infrastructure without PRD/ADR change.

Execution:

- Record every adjustment in contracts/tests/ADR if material.
- Re-run backend freeze checks.

Verification:

- Existing contract and security tests remain green.

Data/migration impact:

- Additive/backward-compatible only.

Exit criteria:

- UI needs no unsafe contract workaround.

### 14.3 Playwright/PostgreSQL E2E Harness

Status: **done**

Dependency: 14.1.

Execution:

- Add `apps/e2e`.
- Start API/two Vite apps on dynamic ports.
- Provision disposable PostgreSQL database.
- Run migrations and deterministic seed.
- Capture trace/screenshot on failure.
- Reset data between scenarios.
- Ensure process/container cleanup.

Verification:

- Harness repeatable locally and CI.
- Failure exits nonzero and cleans resources.

Data/migration impact:

- Disposable E2E database only.

Exit criteria:

- Full-stack browser tests have reliable infrastructure.

### 14.4 Tenant Onboarding E2E

Status: **done**

Dependency: 14.3.

Execution:

- TMMIN creates Hosted supplier/Admin.
- Supplier Admin first reset.
- Create shifts/members/accounts/lines/jobs/parts/checklists/defaults.
- Validate duplicate/deactivation/conflict flows.

Verification:

- New tenant reaches start-ready configuration.

Data/migration impact:

- E2E data only.

Exit criteria:

- Hosted onboarding works without direct DB seeding after initial bootstrap.

### 14.5 Shift, Henkaten, dan Approval E2E

Status: **done**

Dependency: 14.4.

Execution:

- Start Shift valid/blocked/override.
- Submit four 4M categories.
- Checklist failure.
- Supervisor-first and QC-first approve.
- Supervisor and QC reject-fast.
- Withdraw + Clone.
- End Shift auto-cancel/reset.
- TMMIN warning open/close.

Verification:

- PRD scenarios pass through browser/API.

Data/migration impact:

- E2E data only.

Exit criteria:

- Core Hosted lifecycle proven full-stack.

### 14.6 Man Cascade dan Concurrency E2E

Status: **done**

Dependency: 14.5.

Execution:

- Cross-line MP replacement.
- Reservation conflict.
- Donor vacancy and notifications.
- Pre-start resolution.
- Simulated stale decision/client conflicts.
- Validate board updates.

Verification:

- User-visible outcomes match backend transaction state.

Data/migration impact:

- E2E data only.

Exit criteria:

- High-risk Man flow proven across UI/API/DB.

### 14.7 TMMIN Monitoring E2E

Status: **done**

Dependency: 14.5-14.6.

Execution:

- Global dashboard/warning/explorer.
- TMMIN Quality read-only.
- Source cutover.
- Credential rotation.
- Audit/system status.

Verification:

- TMMIN roles see correct data and cannot approve/mutate.

Data/migration impact:

- E2E data only.

Exit criteria:

- TMMIN workflows proven full-stack.

### 14.8 External API E2E

Status: **done**

Dependency: 14.7.

Execution:

- Token issue.
- Open/Approved/Rejected/Cancelled events.
- duplicate/conflict/out-of-order/gap.
- batch mixed result.
- warning/dashboard projection.
- PII forbidden and IP/rate cases.

Verification:

- External monitoring contract works through deployed-like API.

Data/migration impact:

- E2E data only.

Exit criteria:

- External supplier journey proven.

### 14.9 Accessibility dan Desktop Browser Pass

Status: **done**

Dependency: 14.4-14.8.

Execution:

- Chrome/Edge target pass.
- 1280×720 layout.
- Keyboard navigation.
- focus management.
- label/error/status checks.
- SSE stale state.
- Automated a11y scan where practical.

Verification:

- No blocking accessibility defect pada critical flow.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Local full stack meets desktop UX acceptance.

### 14.10 TMMIN Visual Refinement

Status: **done**

Dependency: 14.4-14.9.

Execution:

- TMMIN shell/navigation dikelompokkan menjadi Monitoring, Tata Kelola, Dukungan, dan Sistem dengan
  collapse control yang mempertahankan capability filtering.
- Ringkasan Global disusun ulang mengikuti referensi visual dengan URL-authoritative filters,
  source-split metrics, server-bucketed trends, ranking tabs, freshness and ingestion summaries,
  activity panels, serta supplier-risk table.
- Dashboard read model diperluas secara additive dengan trend buckets, freshness summary, dan
  deterministic supplier-risk overview; OpenAPI dan typed client diregenerasi.
- Tata Kelola Sumber serta seluruh route TMMIN dipoles memakai hierarchy, density, Bahasa
  Indonesia, source-aware evidence, dan read-only Quality boundary yang konsisten.
- TMMIN-only composition tetap berada di `tmmin-web`; primitive generik dan visual Supplier Portal
  tidak diubah.

Verification:

- Unit/contract checks mencakup bucket granularity, zero-fill, source/outcome classification,
  filter apply/reset, URL persistence, dashboard composition, dan navigation collapse.
- Visual review memakai data deterministik pada 1672×941 dan 1280×720 serta membandingkan ulang
  `tmmin-global-overview.png` dan `source-governance.png`.
- PostgreSQL integration, Chromium/Edge E2E, dan containerized Gitleaks tetap harus dijalankan pada
  host dengan Docker daemon aktif.

Data/migration impact:

- Tidak ada schema database migration atau endpoint mutation baru.
- Contract dashboard hanya bertambah secara additive.

Exit criteria:

- TMMIN Admin dan Quality memakai shell/refinement baru tanpa memperluas mutation capability.
- Ringkasan Global dan Tata Kelola Sumber mempunyai fidelity visual tertinggi terhadap referensi.

### 14.11 Supplier Visual Refinement

Status: **done**

Dependency: 14.4-14.10.

Execution:

- Supplier shell/navigation dikelompokkan menjadi Operasional, Data & Konfigurasi, dan Sistem
  dengan collapse control accessible, supplier/source context, notification count, account
  identity, breadcrumbs, dan route-focus restoration.
- Overview, Assignment Board, Default Assignment, Create Henkaten, Henkaten Detail/Approval, dan
  Shift Detail/Blocked Preflight disusun ulang memakai summary strip, fact strip, filter strip,
  contextual rail, dense operational panels, dan sticky decision/action surfaces.
- Setup, Master Data, Shift/Henkaten list, Notifikasi, Audit, auth/account, dan route-state
  menggunakan hierarchy, loading/error/empty state, interaction feedback, dan Bahasa Indonesia
  yang konsisten.
- Composition baru tetap app-local di `supplier-web`; shared Henkaten Design System dan visual
  TMMIN tidak diubah.
- API, lifecycle, URL state, authority, field order, capability boundary, source epoch, dan
  optimistic-version behavior dipertahankan.
- Targeted evolution berikutnya memoles Create/Clone Henkaten menjadi operational workspace dengan
  semantic 4M selector, selected-part confirmation, Man movement preview, numbered checklist, dan
  readiness rail tanpa membuat client-side state menjadi authoritative.
- Henkaten Detail/Approval memakai change-evidence untuk penyebab/narasi dan before-to-after object
  atau reservation/completed Man movement. Approve, Reject, Reroute, dan Withdraw memakai shared
  `AlertDialog` dengan focus management, sementara visibility tetap capability/lifecycle gated.
- Presentational helper baru tetap lokal di samping `HenkatenPages.tsx`; public contract
  `packages/ui`, API, OpenAPI, Prisma, dan migration tidak berubah.
- Follow-up corrective pass meniadakan SVG auto-margin yang menggeser glyph 4M, menambahkan rhythm
  antar-field pada panel konteks/pergerakan, dan mempersempit legacy checklist selector agar hanya
  number marker yang menerima fixed square sizing.
- Supplier Overview refinement memperbaiki `ChartFrame` dengan definite plot height, explicit empty
  state, visible single-point marker, labelled tooltip, serta line dan grouped-bar rendering tanpa
  double-card.
- Overview memakai komposisi 12 kolom untuk approval aging, 4M trend, ranked line/part,
  outcome, assignment issue, emergency override, dan full-width activity. Breakpoint 1280
  mempertahankan Trend dan Activity full-width serta merapikan widget lain menjadi dua kolom.
- `recentActivity` tetap newest-first dan dibatasi 20, tetapi diperkaya secara additive dengan actor
  dan current Henkaten context melalui dua bounded batch query. Tenant dan line scope yang sama
  diterapkan pada enrichment; cause dan freeform detail tidak dipaparkan.
- Activity menampilkan lima event pertama, toggle inline seluruh batch, collapse ulang setelah
  filter diterapkan, detail line/job/part, localized actor/time, badge 4M/status, serta deep-link
  yang capability-aware.
- Shift Detail dan Assignment Resolution memakai CTA yang capability-aware: Line Leader mendapat
  primary resolve/create action, sedangkan role lain hanya mendapat read-only guidance. Resolution
  workspace menampilkan authoritative line, open/total issue count, job, origin, dan linked
  Henkaten tanpa menambah mutation, API contract, atau client-side resolution authority.

Verification:

- Unit coverage mencakup grouped capability navigation, collapse state, Hosted Preparation
  restriction, breadcrumb/focus restoration, filter apply/persistence, dan capability-aware quick
  links.
- Visual review test-only memakai fixture API deterministik dan lifecycle API nyata pada 1672×941
  serta 1280×720 untuk enam halaman prioritas.
- Visual journey memeriksa page-level overflow, reduced motion, dan axe; temuan accessible naming,
  prohibited ARIA, serta contrast diperbaiki pada source.
- Targeted component regression mencakup 4M radio state, checklist Yes/No/unanswered, readiness,
  reserved donor preview, object transition, parallel approval/Not Required, dan decision dialog.
- Create dan QC-pending detail ditangkap ulang pada 1672×941 serta 1280×720. Explicit 1280 fallback,
  keyboard semantics, reduced-motion capture, zero horizontal overflow, dan zero axe violations
  lulus; contrast microcopy serta badge 4M yang ditemukan pada iterasi awal diperbaiki.
- Follow-up Hosted lifecycle Chromium 1/1 dengan visual capture mengonfirmasi centering kategori dan
  spacing preview pada 1672×941 serta 1280×720; minimum viewport tetap tanpa page-level overflow dan
  zero axe violations. Supplier lint, typecheck, 20 unit tests, production build, CSS formatting,
  dan diff check juga lulus.
- Shift resolution action matrix mencakup create, wait, linked-Henkaten, dan closed states.
  Man-concurrency Chromium journey memverifikasi Board-to-resolution navigation, primary CTA,
  unchanged linked Man create URL, non-zero button geometry, visual capture 1672×941 dan 1280×720,
  zero page-level horizontal overflow, serta zero axe violations pada minimum viewport.
- Full repository parity checks selesai: clean install, format, lint, typecheck, 92 unit tests,
  OpenAPI drift, production build, PostgreSQL verification, 32 integration tests, empat Chromium
  dan dua Edge journeys, containerized Gitleaks, dan diff check lulus.
- Contract, UI, shared-chart, dan PostgreSQL integration regression untuk Overview mencakup complete
  atau null enrichment, unknown-field rejection, ordering/limit 20, actor fallback, tenant/line
  isolation, tepat lima initial activities, expand/collapse/filter reset, detail/fallback,
  capability-aware link, empty chart, serta single-point chart.
- Hosted lifecycle browser journey memvalidasi non-zero chart bounding box, visible single-point
  marker, activity width/count, visual capture 1672×941 dan 1280×720, reduced motion, zero
  page-level horizontal overflow, serta zero axe violations.

Data/migration impact:

- Tidak ada database migration, mutation endpoint, atau backend lifecycle change.
- Supplier dashboard response bertambah secara additive; OpenAPI dan typed API client diregenerasi.

Exit criteria:

- Seluruh Supplier role tetap melihat dan mengubah hanya capability/scope yang diizinkan.
- Keenam halaman prioritas mencapai fidelity enterprise yang padat dan stabil pada kedua viewport.
- Phase 15.1 kembali menjadi next recommended subphase setelah validation lengkap.

### 14.12 Comprehensive Local Seed Lifecycle

Status: **done**

Dependency: 14.4-14.11.

Execution:

- `local:start:clean` menghapus volume PostgreSQL/foto lalu menjalankan migration, protected
  bootstrap, comprehensive seed, verification, API, dan kedua frontend.
- `local:reseed` mereset hanya main database serta volume foto dan mempertahankan disposable test
  database.
- Seeder development-only membuat tepat dua supplier Hosted melalui production API, menormalisasi
  timeline historis setelah outbox drain, dan memverifikasi seluruh invariant akhir.
- Per supplier tersedia 3 line, 12 job, 22 member, 8 part, 3 Shift Template, 39 Shift Run, dan 120
  Henkaten dengan live warning/reservation/issue serta histori padat 30 hari yang berlanjut sampai
  sekitar satu tahun.
- Profil supplier sengaja berbeda: distribusi kategori/status, beban 1-6 Henkaten per historical
  shift, konsentrasi line/part, job, narasi operasional, waktu kejadian, dan durasi keputusan tidak
  seragam tetapi tetap deterministic.
- Credential acak disimpan atomik hanya pada `.local/seed-credentials.json` mode `0600`.

Verification:

- Seed planner/guard unit tests, API typecheck, clean-start Compose acceptance, serta reseed
  preservation/rotation acceptance lulus.
- Full parity lulus dengan Node.js 22.23.1: clean install, format, lint, typecheck, 97 unit tests,
  OpenAPI drift, build, PostgreSQL 18.4/pgvector 0.8.5, 32 integration tests, empat Chromium dan dua
  Edge journeys, Gitleaks, serta diff check.
- Tidak ada endpoint, OpenAPI, schema migration, External projection, tracked credential, atau
  production fixture fallback.
- QA seeded runtime 2026-07-27 dilakukan berurutan Supplier Admin → clean reseed → TMMIN Admin
  dengan triangulasi database/API/UI pada kedua viewport. Tidak ditemukan `SEED_DEFECT` atau
  `CONTRACT_DOC_MISMATCH`; tujuh `APP_DEFECT` pada presenter Shift, asset origin, UI Problem
  Details, TMMIN nested snapshot, request observability, dan freshness image lokal telah diperbaiki
  pada lapisan pemiliknya beserta regression test.
- Evidence akhir mencakup invariant 2 Hosted/240 Henkaten, credential rotation dan mode `0600`,
  preservasi test database, targeted regression, seluruh unit suite, 33 PostgreSQL integration test
  serial, empat Chromium journey, dua Edge smoke journey, OpenAPI/build, Gitleaks, dan diff check.
  Detail reproduksi dan root cause tersedia di `docs/audits/seededAppQaAudit.md`.

Data/migration impact:

- Tidak ada database schema migration.
- Operasi destruktif dibatasi pada command lokal eksplisit dan target Compose yang tervalidasi.

Exit criteria:

- Kedua command menghasilkan stack sehat dengan tepat dua supplier Hosted dan invariant seed yang
  dikunci.
- Phase 15 runtime/deployment implementation dapat dimulai dari baseline ini.

### 14.13 Seeded Supervisor dan Line Leader Henkaten QA

Status: **done**

Dependency: 14.12.

Execution:

- Clean deterministic seed diaudit pada role Supervisor multi-line/single-line dan tiga profil Line
  Leader per supplier, dengan tambahan explicit coverage seluruh Line Leader NPM khusus Henkaten.
- Decision Supervisor mencakup approve-first/final, reject-fast, comment, terminal immutability,
  stale version, exact idempotent retry, idempotency conflict, warning closure, notification,
  outbox, serta audit.
- Line Leader mencakup scope dashboard/board/Shift/Henkaten/audit/notification, empat kategori 4M,
  checklist, part/job, validation, realtime board, Withdraw + Clone, reservation/assignment, terminal
  immutability, End Shift cancellation, dan negative cross-line/cross-tenant checks.
- Audit menemukan nol `SEED_DEFECT`, enam `APP_DEFECT`, dan nol `CONTRACT_DOC_MISMATCH`. Defect
  berada pada local portal origin, dua API-client wire adapter, risk rail reservation,
  distinguishability badge 4M, dan navigation gap active assignment resolution.
- Fix ditempatkan pada layer pemilik tanpa public API, OpenAPI, Prisma schema, migration, production
  fallback, atau business rule React baru.

Verification:

- Targeted regression lulus: local planner 2/2, API client 10/10, Supplier web 16/16.
- Full parity lulus: format, lint, typecheck, 115 Vitest + 2 Node test, OpenAPI/client drift,
  production build, 33 PostgreSQL integration serial, empat Chromium journey, dua Edge journey,
  clean reseed, Gitleaks, dan diff check.
- Browser QA 1280×720 tidak menemukan horizontal overflow. Deep-link line/tenant lain tidak
  membocorkan resource.
- Detail reproduksi, evidence DB/API/UI, root cause, fix, dan risiko residual tersedia di
  `docs/audits/seededAppSupervisorLineLeaderQaAudit.md`.

Data/migration impact:

- Tidak ada perubahan public contract, schema, atau migration.
- Phase 15 tetap `in_progress`; evidence ini hanya melanjutkan penutupan QA Phase 14.

### 14.14 Comprehensive Seeded Role dan Client-surface QA

Status: **done**

Dependency: 14.12-14.13.

Execution:

- Matriks PRD ditutup untuk seluruh role bercredential: Supplier Admin, Supervisor, Line Leader, QC,
  TMMIN Admin, dan TMMIN Quality. MP tetap diverifikasi sebagai member/assignment actor tanpa akun.
- Kedua client surface diaudit interaktif pada 1280×720, termasuk capability navigation, seluruh
  route Quality/QC, scope line/tenant, protected route, Board, dashboard, Henkaten/approval,
  Hosted support, source governance, External health, notification, audit, system status,
  console, dan horizontal overflow.
- State mutatif yang dapat menghabiskan shared fixture tetap diverifikasi pada isolated
  Playwright/PostgreSQL epoch: onboarding, 4M lifecycle, parallel approval, reject-fast,
  Withdraw+Clone, Man cascade/concurrency, External ingestion, cutover, dan read-only Quality.
- Database, API, dan UI membuktikan seed tetap tepat dua Hosted/240 Henkaten, 16 Open/warning,
  dua active reservation, dan dua open assignment issue.
- Audit menemukan nol `SEED_DEFECT`, dua `APP_DEFECT`, dan nol `CONTRACT_DOC_MISMATCH`.
- Fix membersihkan Henkaten action error saat record direfresh serta menyembunyikan credential
  action dan privileged-admin false absence dari TMMIN Quality.

Verification:

- Regression frontend lulus: Supplier 17/17 dan TMMIN 11/11.
- Full parity lulus: format, lint, typecheck, 117 Vitest + 2 Node test, OpenAPI/client drift,
  production build dengan explicit API origin, 33 PostgreSQL integration serial, empat Chromium
  journey, dua Edge journey, clean reseed, dan live browser re-verification.
- Tidak ada public API, OpenAPI, Prisma schema, migration, production fallback, atau perubahan
  domain policy.
- Detail matriks, reproduksi, root cause, fix, evidence, dan risiko residual tersedia di
  `docs/audits/seededAppAllRolesQaAudit.md`.

Data/migration impact:

- Tidak ada perubahan database schema atau migration.
- Phase 15 tetap `in_progress`; audit ini tidak mengklaim staging VM, backup/recovery, atau
  production activation.

### 14.15 Cross-application 4M and Typography Refinement

Status: **done**

Dependency: 14.10-14.14.

Execution:

- Kontrak warna shared 4M dikunci menjadi Man merah, Machine biru, Material amber/kuning, dan
  Method hijau melalui typed registry, CSS custom properties, indicator tint, serta regression
  contract test.
- Shared `FourMLegend` ditambahkan dengan urutan tetap, nama kategori aksesibel, dot dekoratif,
  dan hanya huruf awal M yang bold; kedua halaman login memakainya tanpa mengubah behavior auth.
- Shared `FourMDot` menjadi primitive warna kategori untuk indicator Assignment Board dan category
  input Henkaten; pill singkatan serta ikon objek pada input diganti dot token-driven yang konsisten.
- Seluruh typography token dan literal font size Supplier/TMMIN dinaikkan secara adaptif, sementara
  layout desktop minimum 1280×720, control alignment, truncation, dan overflow tetap stabil.
- Public design-system showcase disinkronkan dengan resolved typography scale baru.

Verification:

- Unit/contract coverage membuktikan exact token mapping, tint, typed/CSS synchronization,
  typography scale, urutan legend, accessible names, dan markup bold M.
- Auth E2E Chromium dan Edge membuktikan computed dot colors, keyboard flow, zero Axe violation,
  serta screenshot pada 1280×720 dan 1672×941.
- Hosted lifecycle E2E membuktikan exact computed color keempat dot pada category input, dot Machine
  pada Assignment Board, target link 28 px, zero horizontal overflow/Axe violation, dan visual
  capture pada 1280×720 serta 1672×941.
- Browser QA mencakup kedua login, `/design`, Supplier Overview/Board/Create/Detail/Shift/dense
  master data, serta TMMIN Overview/Explorer/governance/monitoring tanpa page-level horizontal
  overflow, clipping, overlap, atau hidden action.
- Frozen install, format, lint, typecheck, seluruh unit test, OpenAPI drift, production build,
  Compose, disposable PostgreSQL migrations/integration, Chromium/Edge E2E, Gitleaks, dan diff
  check lulus pada Node.js 22.23.1 dan pnpm 11.16.0.

Data/migration impact:

- Tidak ada perubahan API, OpenAPI, Prisma schema, database migration, routing, atau lifecycle
  Henkaten.
- Phase 15.9 tetap `in_progress`; refinement ini tidak mengklaim staging deployment.

Phase 14 exit criteria:

- Seluruh major PRD acceptance flow berjalan pada local full stack tanpa fixture-only production behavior.

---

## 23. Phase 15 - Production Containers, CI/CD, dan Staging

Status: **in_progress**

Goal: membuat production-like containers, full CI/security workflows, release scripts, dan staging deployment setelah local E2E stabil.

Depends on:

- Phase 14.

Unlocks:

- Phase 16 UAT dan production release.

Sequencing decision:

- Staging deployment sengaja tidak dibangun pada walking skeleton.
- Root/local CI validation tetap tersedia sejak Phase 1.

### 15.1 Production Dockerfiles

Status: **done**

Dependency: Phase 14.

Execution:

- Multi-stage Dockerfile untuk API.
- Multi-stage static/runtime serving strategy untuk supplier web.
- Multi-stage static/runtime serving strategy untuk TMMIN web.
- Pin Node 22 base.
- Use pnpm lock/frozen install.
- Run as non-root where practical.
- Include health behavior.
- Exclude dev/test/secret files.

Verification:

- Images build reproducibly.
- Container vulnerability scan.
- Production startup smoke.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Three application images production-capable.

### 15.2 Remote Docker Compose Runtime

Status: **done**

Dependency: 15.1.

Execution:

- Services:
  - postgres;
  - api;
  - supplier-web;
  - tmmin-web;
  - caddy.
- Internal network for DB.
- Expose only Caddy.
- Persistent volumes for PostgreSQL/Caddy/photos/release state.
- Health dependencies.
- Distinct environment project names.

Verification:

- Compose config validates with example env.
- Full stack runs production-like locally.
- Restart preserves persistent data.

Data/migration impact:

- Hosted persistent volumes; no backup.

Exit criteria:

- Single-VM runtime matches PRD.

### 15.3 Caddy Three-domain Routing

Status: **done**

Dependency: 15.2.

Execution:

- Route supplier domain to supplier web.
- Route TMMIN domain to TMMIN web.
- Route API domain to API.
- Configure TLS email.
- Add compression/security headers/proxy headers.
- Keep PostgreSQL private.
- Validate CORS/CSRF origins.

Verification:

- Staging three domains route correctly.
- API health/readiness reachable only as intended.
- Security headers present.

Data/migration impact:

- Caddy certificate/config persistent volume.

Exit criteria:

- Public routing and TLS config production-like.

### 15.4 Runtime Environment dan Secret Validation

Status: **done**

Dependency: 15.2-15.3.

Execution:

- Add staging/production env examples without values.
- Define required secret names.
- Validate environment before deploy.
- Separate DB/session/bootstrap/Caddy/domain/upload variables.
- Prevent secret echo/log.

Verification:

- Missing secret fails preflight.
- Example env can validate Compose.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Runtime config explicit and safe.

### 15.5 Full GitHub CI dan Security Workflows

Status: **done**

Dependency: 15.1-15.4 dan baseline CI.

Execution:

- Upgrade CI to:
  - frozen pnpm install;
  - format/lint/typecheck;
  - unit/integration/E2E;
  - production builds;
  - Compose validation/build;
  - OpenAPI validation;
  - migration fresh/upgrade checks.
- Add Gitleaks, Dependency Review, CodeQL, and Trivy.
- Configure branch/path triggers.

Verification:

- Intentional failure blocks workflow.
- Security scan artifacts/action results visible.
- PR #7 release-gate regression memverifikasi bahwa custom Caddy builder memakai
  `golang.org/x/text` 0.39.0 untuk menutup CVE-2026-56852 dan Trivy filesystem scan memakai input
  `trivyignores` yang didukung action. Clean Caddy build dan Trivy 0.70.0 scan melaporkan zero
  High/Critical findings pada Debian runtime maupun Go binary; actionlint, Hadolint,
  env/Compose, deployment harness, dan exact security-exception validation lulus.

Data/migration impact:

- Disposable CI DB.

Exit criteria:

- Full release candidate checks automated.

### 15.6 Release-by-SHA Deploy Scripts

Status: **done**

Dependency: 15.2-15.5.

Execution:

- Adapt `loom` release structure for this project.
- Implement deploy lock.
- Upload exact git SHA archive.
- Render secure runtime env.
- Run preflight.
- Run forward migration.
- Start services in safe order.
- Update current release pointer.
- Retain latest five releases.
- Never delete shared PostgreSQL/photo volumes.

Verification:

- Exact SHA deploy.
- Concurrent deploy lock.
- Release retention.
- Failed preflight leaves current release.

Data/migration impact:

- Forward migration only; no backup.

Exit criteria:

- VM deploy repeatable and traceable.

### 15.7 Smoke dan Readiness Checks

Status: **done**

Dependency: 15.6.

Execution:

- Smoke supplier web.
- Smoke TMMIN web.
- Smoke API health/readiness.
- Semantically validate readiness.
- Capture release SHA.
- Retry bounded startup.

Verification:

- Broken service/readiness fails deploy validation.

Data/migration impact:

- Tidak ada.

Exit criteria:

- Deployment success requires working three-surface runtime.

### 15.8 Schema-compatible Automatic Rollback

Status: **done**

Dependency: 15.6-15.7.

Execution:

- Capture previous release.
- On failed validation, redeploy previous code release.
- Do not run destructive down migration.
- Surface when schema is not backward compatible.
- Log rollback result.

Verification:

- Rehearse rollback with compatible migration.
- Confirm database/photo volumes preserved.

Data/migration impact:

- Code rollback only; database not restored.

Exit criteria:

- Rollback behavior matches actual no-backup limitation.

### 15.9 Automatic Staging Deployment

Status: **in_progress**

Dependency: 15.5-15.8.

Execution:

- Trigger after successful CI on `staging`.
- Configure staging GitHub environment/secrets.
- Deploy to staging VM.
- Use locked staging domains.
- Run smoke/readiness.
- Rollback on failure where compatible.

Verification:

- Push staging produces exact release or explicit failure.
- Environment isolated from production.

Data/migration impact:

- Staging persistent DB/volume.

Exit criteria:

- Staging deploy is automatic and repeatable.

### 15.10 Automatic Production Workflow

Status: **implementation-ready, activation deferred**

Dependency: 15.5-15.8.

Execution:

- Reuse the exact-SHA hosted deployment workflow shared with staging.
- Keep production domain/secret/VM validation capability in the reusable contract.
- Do not configure `main`, `workflow_dispatch`, or any active production caller until production
  activation is explicitly authorized.
- Preserve smoke/readiness/rollback behavior for the future caller.

Verification:

- Reusable workflow syntax and staging caller validation.
- Repository search confirms that no production trigger or caller is active.
- Actual production deployment deferred until Phase 16 blockers resolved.

Data/migration impact:

- Production forward migration when activated.

Exit criteria:

- Production workflow ready but not prematurely deployed.

### 15.11 Staging Deployment Rehearsal

Status: **planned**

Dependency: 15.9.

Execution:

- Deploy fresh staging release.
- Test upgrade release.
- Test failed readiness and rollback.
- Verify persistent data/photo survival.
- Run core E2E/smoke against staging domains.
- Record diagnostics and gaps.

Verification:

- Rehearsal evidence complete.

Data/migration impact:

- Staging test data only.

Exit criteria:

- Staging is stable enough for UAT.

Phase 15 exit criteria:

- Automatic staging deploy works.
- Full CI/security checks work.
- Production workflow waits only on external production readiness.

Current implementation evidence (2026-07-27):

- 15.1-15.8 passed local CI parity: pinned multi-stage application images, hardened non-root
  PostgreSQL/Caddy runtime images, seven-service Compose, exact-SHA release identity, three-domain
  routing, fresh/upgrade migrations, security headers, private database exposure, persistence,
  scanner gates, and deployment-script failure/race/rollback/retention harnesses.
- 15.9 is implementation-complete in the repository but remains `in_progress` until an actual push
  to `staging` succeeds after the VM and GitHub Environment are provisioned.
- 15.10 is reusable and production-capable, but activation is deferred; no `main` or manual trigger
  exists.
- 15.11 remains planned until first deploy, second-release upgrade, close-candidate race, and
  controlled rollback evidence are captured on the staging VM.

---

## 24. Phase 16 - Hardening, UAT, dan Release

Status: **planned**

Goal: memenuhi performance/security/acceptance targets, memperoleh sign-off, dan merilis production secara terkontrol dalam constraint PRD.

Depends on:

- Phase 15.

Unlocks:

- production use dan post-release operations.

### 16.1 Performance dan Load Test Baseline Compact

Status: **planned**

Dependency: staging runtime.

Execution:

- Seed 42 suppliers × baseline Compact data profile.
- Exercise common reads/writes/approval/board/warning/dashboard/external ingest.
- Measure p50/p95/p99/error rate.
- Verify SSE propagation.
- Tune bounded indexes/queries/runtime.

Verification:

- PRD p95/error targets met.
- Results stored as release evidence.

Data/migration impact:

- Staging load data; no production data.

Exit criteria:

- Capacity acceptance met or blocker explicitly recorded.

### 16.2 Security Review dan Scan Closure

Status: **planned**

Dependency: 16.1 dan full CI.

Execution:

- Review tenant/auth/session/CSRF/CORS/upload/external credential.
- Run security workflows.
- Review logs for PII/secret.
- Resolve Critical/High findings.
- Re-run negative tests.

Verification:

- No unresolved Critical/High security finding.

Data/migration impact:

- Hardening migrations additive only.

Exit criteria:

- Security release gate passes.

### 16.3 Migration Fresh/Upgrade/Rollback Rehearsal

Status: **planned**

Dependency: Phase 15 scripts.

Execution:

- Fresh database migration.
- Upgrade from previous release checkpoint.
- Deploy code rollback with compatible schema.
- Verify readiness/indexes.
- Confirm no destructive/down migration.

Verification:

- All rehearsals pass and limitations documented.

Data/migration impact:

- Staging only.

Exit criteria:

- Production migration path proven as far as no-backup posture allows.

### 16.4 Hosted Supplier UAT

Status: **planned**

Dependency: 16.1-16.3.

Execution:

- Supplier Admin onboarding.
- Supervisor/LL/QC workflows.
- Shift, Henkaten, approval, Man cascade, board, dashboard, notifications, audit.
- Capture defects and acceptance sign-off.

Verification:

- PRD Hosted acceptance checklist signed.

Data/migration impact:

- Staging UAT data.

Exit criteria:

- Hosted users accept workflows.

### 16.5 External Supplier Contract UAT

Status: **planned**

Dependency: 16.1-16.3.

Execution:

- Provide OpenAPI/examples/credential.
- Test single/batch/retry/error/order.
- Validate PII minimization.
- Validate TMMIN projection/warning.
- Capture supplier integration feedback.

Verification:

- External contract UAT signed.

Data/migration impact:

- Staging external events.

Exit criteria:

- At least representative external integration validates contract.

### 16.6 TMMIN Admin dan Quality UAT

Status: **planned**

Dependency: 16.4-16.5.

Execution:

- Tenant/account/source/credential administration.
- Global dashboard/warnings/explorer/ingestion health/audit.
- Verify Quality read-only.
- Capture sign-off.

Verification:

- TMMIN acceptance checklist signed.

Data/migration impact:

- Staging UAT data.

Exit criteria:

- TMMIN operational roles accept application.

### 16.7 Production Environment Readiness

Status: **planned**

Dependency: 16.1-16.6.

Execution:

- Confirm three production domains.
- Confirm production VM/deploy user/SSH known hosts.
- Confirm DNS.
- Confirm GitHub secrets.
- Confirm runtime/bootstrap credentials.
- Confirm designated operational owners.
- Verify environment isolation.

Verification:

- Remote preflight passes.

Data/migration impact:

- No application data yet.

Exit criteria:

- All external production dependencies resolved.

### 16.8 Explicit Critical-risk Acceptance

Status: **planned**

Dependency: 16.7.

Execution:

- Obtain written acknowledgement:
  - no database/file backup;
  - no RPO/RTO/HA;
  - automatic production deployment;
  - permanent PII retention;
  - in-app-only notifications.
- Record approver/date/reference without secret.
- Surface risk in release readiness.

Verification:

- Required sign-off available.

Data/migration impact:

- Documentation/audit only.

Exit criteria:

- Production is not launched under hidden risk assumptions.

### 16.9 Production Deployment dan Smoke Validation

Status: **planned**

Dependency: 16.1-16.8.

Execution:

- Merge/push approved release to `main`.
- Observe automatic CI/deployment.
- Validate three production domains.
- Validate health/readiness/release SHA.
- Run bounded smoke flows.
- Roll back if validation fails and schema compatible.

Verification:

- Production release healthy dan traceable.

Data/migration impact:

- First production schema/data.

Exit criteria:

- Production application available.

### 16.10 Handoff dan Post-release Verification

Status: **planned**

Dependency: 16.9.

Execution:

- Update roadmap status.
- Update session handoff.
- Finalize operational/release docs.
- Record known limitations and incidents.
- Verify metrics/logs/notifications.
- Run short post-release acceptance.
- Confirm no agent-started processes/containers remain locally.

Verification:

- Future session can resume without rediscovery.
- Operational owner knows deploy/rollback/diagnostics limitations.

Data/migration impact:

- No planned mutation beyond normal production verification.

Exit criteria:

- v1 handoff complete.

Phase 16 exit criteria:

- All PRD acceptance gates pass.
- Required UAT and risk sign-offs exist.
- Production deployment and post-release checks pass.

---

## 25. Phase Dependency Matrix

| Phase | Status awal | Depends on | Unlocks |
|---|---|---|---|
| 0 Product/architecture baseline | in_progress | PRD | 1 |
| 1 Repository/local tooling | planned | 0 | 2 |
| 2 API/persistence foundation | planned | 1 | 3 |
| 3 Auth/tenancy/TMMIN admin backend | planned | 2 | 4 |
| 4 Supplier master data backend | planned | 3 | 5 |
| 5 Shift/Working Assignment backend | planned | 4 | 6 |
| 6 Henkaten core backend | planned | 5 | 7 |
| 7 Approval/Man/End Shift backend | planned | 6 | 8 |
| 8 Notification/board/dashboard/audit backend | planned | 7 | 9 |
| 9 External REST API backend | planned | 8 | 10 |
| 10 Backend freeze/hardening | planned | 3-9 | 11 |
| 11 Frontend/shared UI foundation | planned | 10 | 12, 13 |
| 12 Supplier frontend | planned | 11 | 14 |
| 13 TMMIN frontend | planned | 11 | 14 |
| 14 Integration/full E2E | planned | 12, 13 | 15 |
| 15 Containers/CI/CD/staging | planned | 14 | 16 |
| 16 Hardening/UAT/release | planned | 15 | Production |

Hard dependency rules:

- Phase 1 tidak dimulai sebelum architecture baseline cukup untuk scaffolding.
- Phase 4 tidak dimulai sebelum tenant/auth guards tersedia.
- Shift tidak dimulai sebelum master/default assignment valid.
- Henkaten tidak dimulai sebelum Shift Run dan checklist model tersedia.
- Approval/Man tidak dimulai sebelum Henkaten core stable.
- Frontend feature work tidak dimulai sebelum backend contract freeze.
- Staging deployment tidak dimulai sebelum local full-stack E2E.
- Production tidak dimulai sebelum staging rehearsal, UAT, security, migration, environment, dan risk gates.

## 26. Milestone Map

### Milestone A - Architecture-ready

Owning phases: 0
Outcome:

- PRD aligned;
- ADRs tersedia;
- state/security architecture decision-complete.

### Milestone B - Developer-ready

Owning phases: 1-2
Outcome:

- pnpm workspace;
- root quality commands;
- local PostgreSQL;
- NestJS/Prisma/audit/outbox/readiness foundation;
- database integration harness.

### Milestone C - Tenant-ready

Owning phases: 3-4
Outcome:

- secure login/session/RBAC;
- supplier provisioning;
- all master data/default assignments configurable through APIs.

### Milestone D - Hosted-domain backend complete

Owning phases: 5-8
Outcome:

- Shift Run;
- Henkaten 4M;
- approval/reject-fast;
- Man reservation/cascade;
- End Shift;
- notification;
- board/dashboard/audit APIs.

### Milestone E - External/backend contract complete

Owning phases: 9-10
Outcome:

- secure External API;
- unified TMMIN warning projection;
- stable, tested backend/OpenAPI contracts.

### Milestone F - Application feature-complete

Owning phases: 11-14
Outcome:

- supplier and TMMIN applications;
- complete real-API integration;
- local full-stack E2E.

### Milestone G - Staging release candidate

Owning phase: 15
Outcome:

- production containers;
- full CI/security;
- automatic staging deployment;
- rollback rehearsal.

### Milestone H - Production v1

Owning phase: 16
Outcome:

- capacity/security/migration gates;
- Hosted/External/TMMIN UAT;
- external dependencies and risk sign-off;
- production release/handoff.

## 27. Critical Path

Critical path:

```text
PRD/ADRs
  -> Workspace/PostgreSQL
  -> API/Tenancy/Auth
  -> Master Data/Defaults
  -> Shift/Working Assignment
  -> Henkaten
  -> Approval/Man Cascade/End Shift
  -> Board/Dashboard/Notification
  -> External API
  -> Backend Contract Freeze
  -> Shared Frontend Foundation
  -> Supplier + TMMIN Frontends
  -> Full E2E
  -> Containers/CI/CD/Staging
  -> Hardening/UAT/Production
```

Highest-risk items yang harus mendapat early design dan strongest tests:

1. tenant isolation;
2. session/account lifecycle;
3. Henkaten transition ownership;
4. parallel approval and reject-fast races;
5. MP reservation and cross-line cascade;
6. End Shift transaction;
7. warning aggregation;
8. external idempotency/source ordering;
9. no-backup migration/deploy risk.

## 28. Parallelization Guidance

Roadmap backend-first tidak berarti seluruh pekerjaan harus serial. Parallel work diperbolehkan setelah shared dependency stabil.

Safe parallel examples:

- Phase 1.3 contracts dan 1.5 local database setelah workspace/config stable.
- Phase 4.2 photo processing dapat paralel dengan 4.3-4.6 setelah Member contract stable.
- Phase 8 notification/read APIs dan dashboard queries dapat paralel setelah domain events stable.
- Phase 12 Supplier frontend dan Phase 13 TMMIN frontend dapat paralel setelah Phase 11.
- Phase 15 Dockerfiles, Caddy, and CI workflow authoring dapat paralel setelah local E2E contracts stable.

Unsafe parallel examples:

- frontend feature implementation sebelum Phase 10 contract freeze;
- Man movement sebelum Working Assignment and transaction model stable;
- dashboard read model sebelum state/warning semantics stable;
- External API projection sebelum warning/TMMIN read model stable;
- staging deployment before local E2E.

Parallel agents/engineers must not edit the same schema/contract surface without an explicit ownership boundary and merge order.

## 29. Required ADR Backlog

ADR minimum sebelum atau selama owning phase:

| ADR topic | Required by |
|---|---|
| pnpm workspace dan package boundaries | Phase 1 |
| NestJS modular monolith | Phase 2 |
| Prisma/PostgreSQL schema and migration strategy | Phase 2 |
| Tenant isolation without PostgreSQL RLS | Phase 2-3 |
| Opaque database-backed sessions | Phase 3 |
| Password/lockout/session revocation | Phase 3 |
| Optimistic concurrency and transaction locking | Phase 5-7 |
| Transactional outbox and SSE without Redis | Phase 2/8 |
| Member photo local-volume storage | Phase 4 |
| Henkaten aggregate and approval finalization | Phase 6-7 |
| Man reservation/cascade issue model | Phase 7 |
| External event idempotency and projection | Phase 9 |
| Backend contract/OpenAPI source strategy | Phase 10 |
| Two-frontend shared UI and API-client boundary | Phase 11 |
| Single-VM Compose/Caddy release topology | Phase 15 |
| Forward-only migration and code-only rollback | Phase 15 |

ADR harus dibuat ketika keputusan mulai diimplementasikan, bukan setelah implementation selesai.

## 30. PRD Acceptance Ownership

| PRD area | Primary owning phase | Final validation |
|---|---|---|
| Tenant/identity | 3 | 10, 14, 16 |
| Master data/defaults | 4 | 12, 14, 16 |
| Shift | 5, 7 | 12, 14, 16 |
| Henkaten 4M | 6 | 7, 12, 14, 16 |
| Approval | 7 | 12, 14, 16 |
| Man cascade | 7 | 12, 14, 16 |
| Board/realtime | 8 | 12, 14, 16 |
| Supplier dashboard | 8 | 12, 14, 16 |
| TMMIN dashboard/warnings | 8 | 13, 14, 16 |
| Notification | 8 | 12, 14, 16 |
| Audit | 2, 8 | 12, 13, 14, 16 |
| External API | 9 | 13, 14, 16 |
| Security/privacy | all backend phases | 10, 15, 16 |
| Performance | 10 | 16 |
| Deployment | 15 | 16 |

No acceptance criterion may remain without an owning phase.

## 31. Recommended Next Execution Batch

Current recommended batch:

1. Begin Phase 15 with separate production multi-stage images for the API and both web apps.
2. Add Caddy/TLS and remote Compose without reusing the development-only `Dockerfile.local`.
3. Extend release/security automation and validate the staging deployment only after production
   runtime gates pass.

Initial implementation order inside the next coding batch:

1. create pinned, non-root production image definitions with explicit health behavior;
2. add Caddy routing and environment separation for Supplier, TMMIN, API, and PostgreSQL;
3. preserve operator-driven credentials and production secret boundaries;
4. extend GitHub Actions image, security, release, and rollback gates;
5. deploy and verify staging only after the production Compose topology passes locally.

## 32. Deferred dan Explicitly Out-of-scope

Roadmap tidak mencakup:

- health monitoring;
- attendance/leave;
- employee schedule di luar Shift Run;
- skill matrix/level/license/recommendation;
- moral monitoring;
- task planning;
- process difficulty;
- Yamazumi/standardized work management;
- machine telemetry;
- material inventory/procurement;
- quality execution di luar Henkaten checklist;
- QC production integration;
- email/SMS/push/Slack/Teams/webhook notifications;
- bulk CSV/Excel import/export;
- Henkaten attachments selain member photo;
- native mobile;
- full tablet/mobile responsive;
- AI/ML/vector search;
- External supplier assignment board di TMMIN;
- Hosted approval untuk External supplier;
- MFA;
- SSO;
- backup/recovery/PITR;
- HA/multi-node/multi-region;
- managed database/object storage;
- production manual approval gate.

Jika item tersebut diminta, PRD dan roadmap harus diperbarui sebelum coding.

## 33. External Dependencies dan Known Blockers

Belum memblokir local implementation:

- production domains;
- production VM;
- SSH/deploy credentials;
- production DNS;
- GitHub production secrets;
- designated UAT users;
- representative External supplier;
- privacy/governance approval;
- accepted-risk written sign-off.

Menjadi blocker pada:

- Phase 15.10 production workflow live validation;
- Phase 16.4-16.9 UAT dan release.

Critical accepted constraints:

- tidak ada database/file backup;
- tidak ada RPO/RTO/HA;
- automatic production deployment;
- permanent Hosted PII retention;
- in-app-only critical notifications.

Dokumen tidak boleh mengubah constraints tersebut tanpa PRD decision change.

## 34. Phase Completion Template

Saat memperbarui progress, gunakan format:

```text
Phase/Subphase:
Previous status:
New status:
Completed implementation:
Files changed:
Migrations:
Contracts changed:
Tests/checks:
Decisions/ADR:
Blockers:
Next recommended subphase:
```

Evidence harus menyebut command/test aktual, bukan hanya “tested” atau “works”.

## 35. Final Handoff Requirement

Sebelum v1 dinyatakan complete:

- PRD dan implementation roadmap sesuai behavior aktual;
- semua phases required berstatus `done`;
- deferred work eksplisit;
- session handoff menunjuk current production state;
- ADR lengkap;
- API/OpenAPI tersedia;
- local development instructions tersedia;
- staging/production environment matrix tersedia;
- release/rollback limitations tersedia;
- UAT dan accepted-risk references tersedia;
- tidak ada unresolved Critical/High security issue;
- tidak ada agent-started local process/container yang dibiarkan berjalan.
