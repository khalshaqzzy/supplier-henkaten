# Session Handoff — Phase 2–3

Tanggal: 2026-07-23
Branch: `staging`
Status repository: Phase 0, 1, 2, dan 3 selesai; Phase 4 `planned`
Commit/push: belum dilakukan pada session ini, sesuai instruksi

## 1. Outcome

Session ini mengubah API compile-only Phase 1 menjadi backend platform yang dapat dijalankan:

- NestJS 11 + Express 5 modular monolith;
- Prisma 7 dengan `@prisma/adapter-pg` dan PostgreSQL 18;
- initial forward-only migration untuk Supplier, User, session, password history, Hosted
  Preparation, immutable audit, dan transactional outbox;
- fail-fast runtime config, JSON body limit, CORS, Helmet, correlation ID, Problem Details, safe
  structured logging, health, readiness, dan graceful shutdown hooks;
- default-deny route policy, capability map, tenant-scope convention, dan explicit TMMIN
  cross-tenant administration paths;
- Argon2id password lifecycle, five-password history, temporary credential, forced reset, lockout,
  opaque database-backed sessions, realm cookies, HMAC CSRF, and global/IP throttling;
- operator-only protected bootstrap TMMIN Admin;
- TMMIN Quality administration;
- Hosted/External supplier provisioning dan Supplier Admin replacement/reset;
- controlled Hosted Preparation serta fail-closed source cutover contributor registry;
- committed OpenAPI 3.1 generated dari shared Zod contracts;
- PostgreSQL unit/integration/Supertest/concurrency/outbox tests dan CI database-integration job.

Tidak ada frontend, master data operational, shift, Henkaten, External ingestion, production
container, staging deployment, commit, atau push yang dibuat.

## 2. Keputusan Produk yang Dikunci

- Pure `EXTERNAL` dibuat inactive tanpa Supplier Admin, username, password, member name,
  registration number, atau foto pada platform TMMIN.
- `HOSTED` dibuat active secara atomik bersama tepat satu Supplier Admin dan temporary password
  sekali tampil.
- `HostedPreparation` bukan SourceMode ketiga. Mode tetap `EXTERNAL`; External tetap source of truth.
- Preparation memerlukan reason dan privacy acknowledgement, membuat preparation admin, dan memakai
  session purpose `HOSTED_PREPARATION`.
- Cancel preparation menonaktifkan admin, mencabut session, dan mengembalikan supplier inactive.
- Source cutover core tersedia tetapi sengaja gagal tertutup sampai contributor Phase 4 dan Phase 9
  tersedia. Tidak ada bypass untuk contributor yang belum diimplementasikan.
- Bootstrap `TMMIN_ADMIN` tidak dapat dibuat/reset/deactivate melalui API; hanya CLI operator.

PRD, state machine, privacy baseline, roadmap, dan ADR telah diselaraskan dengan keputusan tersebut.

## 3. Runtime dan Dependency

Pinned baseline:

- Node.js `22.23.1`;
- pnpm `11.16.0`;
- NestJS `11.1.28`, Express `5.2.1`;
- Prisma Client/CLI/adapter-pg `7.9.0`, pg `8.22.0`;
- Argon2 `0.45.1`;
- zod-openapi `6.0.0`;
- PostgreSQL `18.4`, pgvector `0.8.5`.

`pnpm-workspace.yaml` secara eksplisit mengizinkan build scripts hanya untuk:

- `@prisma/engines`;
- `@swc/core`;
- `argon2`;
- `prisma`.

Node 22 sementara yang dipakai verifikasi berada di
`/tmp/supplier-henkaten-node-v22.23.1`; lokasi ini bukan bagian repository.

## 4. Struktur Penting yang Ditambahkan

### API platform

- `apps/api/src/main.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/config/`
- `apps/api/src/common/`
- `apps/api/src/persistence/`
- `apps/api/src/health/`
- `apps/api/src/openapi/`

### Identity dan administration

- `apps/api/src/auth/`
- `apps/api/src/administration/`
- `apps/api/src/cli/admin.ts`

### Persistence

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma.config.ts`
- `apps/api/prisma/migrations/20260723000100_platform_foundation/migration.sql`
- `apps/api/prisma/migrations/migration_lock.toml`

### Public contracts

- `packages/contracts/src/administration.ts`
- extensions pada `auth.ts`, `common.ts`, dan `enums.ts`
- `apps/api/openapi/openapi.json`

### Documentation

- ADR 0002, 0003, 0004, dan 0006 diperinci;
- ADR 0009: identity/password/session/bootstrap security;
- ADR 0010: controlled Hosted Preparation dan source cutover;
- PRD, state machine, security/privacy baseline, roadmap, README, dan handoff diperbarui.

## 5. HTTP Surface

Public:

- `GET /health`
- `GET /ready`
- `GET /api/v1/openapi.json`

Authentication, masing-masing pada `/api/v1/auth/supplier/*` dan `/api/v1/auth/tmmin/*`:

- `POST login`
- `GET session`
- `POST change-password`
- `POST logout`

TMMIN administration:

- `/api/v1/tmmin/quality-users`
- `/api/v1/tmmin/suppliers`
- supplier activation/deactivation;
- Supplier Admin replace/reset;
- source preparation start/cancel;
- source preflight/cutover.

Seluruh mutation browser authenticated memerlukan exact Origin dan `X-CSRF-Token`.

## 6. Security Baseline Aktual

- Argon2id minimum `m=19456 KiB`, `t=2`, `p=1`, output 32 byte.
- Password 12–128 karakter; current + empat previous hash dipertahankan.
- Temporary password menggunakan 24 random byte base64url dan hanya dikembalikan dengan
  `Cache-Control: no-store`.
- Raw session token 32 byte hanya berada di cookie; database menyimpan SHA-256.
- Idle 30 menit, absolute 12 jam, touch maksimal sekali per 60 detik.
- Hosted cookie memakai `__Host-`, Secure, HttpOnly, SameSite Strict, Path `/`; local HTTP memakai
  nama non-`__Host-`.
- CSRF token adalah HMAC dari raw session token, session UUID, realm, dan runtime secret.
- Known account: lima failure/15 menit menghasilkan lock 15 menit.
- Unknown account/IP limiter memakai bounded in-memory HMAC key; global default 300 request/menit/IP.
- Request body/query/cookie/Authorization/password/token/secret tidak dicatat. Response logger hanya
  menyimpan status code, sehingga `Set-Cookie` tidak masuk log.
- AuditEvent menolak UPDATE dan DELETE melalui trigger PostgreSQL.
- Route tanpa `@Public`, `@Authenticated`, atau `@RequireCapabilities` ditolak default.

## 7. Migration dan Database

Initial migration berhasil diterapkan pada database main dan disposable test.

Main database:

- deploy pertama menerapkan `20260723000100_platform_foundation`;
- deploy kedua menghasilkan `No pending migrations to apply`.

Test database selalu:

1. `pnpm db:test:reset`;
2. `pnpm db:test:migrate`;
3. `pnpm test:integration`.

`db:down` tidak menghapus main volume. Tidak ada backup/recovery/HA; accepted Critical risk tetap
berlaku.

## 8. Test Evidence

Unit:

- contracts: 11 passed;
- deterministic fixtures: 6 passed;
- API unit: 3 passed.

PostgreSQL integration/Supertest:

- 7 tests passed;
- realm/supplier DB constraints;
- immutable audit trigger;
- transaction/outbox rollback;
- tenant A/B isolation;
- forced password change dan relogin;
- TMMIN Quality create dan capability denial;
- Hosted supplier + one-time Supplier Admin credential;
- pure External tanpa platform account/PII;
- External over-posting ditolak;
- Hosted Preparation login purpose, preflight blockers, dan cancellation;
- cross-realm cookie ditolak;
- concurrent Supplier Admin replacement menghasilkan tepat satu success dan satu `409`;
- two-worker outbox claim tepat sekali dan poison event menjadi failed setelah attempt ke-10.

Runtime smoke:

- `/health` 200;
- `/ready` 200 dengan database dan migration checks `ready`;
- response memiliki `X-Correlation-ID`;
- OpenAPI `3.1.0` terbaca dengan 26 paths;
- API dihentikan setelah smoke test.

Root `pnpm validate` lulus setelah Node runtime, format, lint, typecheck, seluruh unit tests, OpenAPI
drift check, dan production build.

## 9. CI

`.github/workflows/ci.yml` sekarang memiliki:

- `quality`: frozen install, format, lint, typecheck, unit, OpenAPI drift, build;
- `database-integration`: Compose PostgreSQL, verify, test reset, migrate, integration tests, cleanup
  always;
- `secret-scan`: Gitleaks full checkout.

Tidak ada deployment workflow pada Phase 2–3.

## 10. Known Intentional Deferrals

- Phase 4: Member, Supervisor/LL/QC linked account, photo, line/job/part/shift/checklist/default
  assignment, preparation-scoped master writes, minimum Hosted configuration contributor.
- Phase 5–7: active shift/Open Hosted Henkaten cutover contributor.
- Phase 8–9: External projection/credential contributors, External credential issuance/activation,
  External raw ingestion.
- Phase 8: SSE browser endpoint dan notification/read model handlers.
- Phase 10: broader performance and adversarial security hardening.
- Phase 15: production containers/deployment.

Outbox has no silent unknown-event success: an unregistered handler retries and becomes observable
failed. Current Phase 3 source-cutover event cannot be produced in production until contributors
are complete.

## 11. Next Recommended Batch

Mulai Phase 4.1:

1. expand-only Prisma migration untuk `Member` dan role-account linkage;
2. scoped member repositories dan CRUD;
3. Supervisor/LL/QC credential lifecycle; MP tetap tanpa account;
4. Hosted-only secure photo pipeline;
5. line/job/part/ShiftTemplate/checklist/default assignment;
6. enforce `HOSTED_PREPARATION` hanya pada configuration capability;
7. register minimum Hosted configuration cutover contributor.

Jangan memulai Shift Run, Henkaten, frontend, External ingestion, atau deployment sebelum dependency
phase masing-masing terpenuhi.
