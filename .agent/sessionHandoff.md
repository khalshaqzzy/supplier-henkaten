# Session Handoff — External Ingestion and Unified Monitoring

Tanggal: 2026-07-23
Branch: `staging`
Status repository: Phase 0–9 selesai; Phase 10 `planned`

## 1. Outcome

Backend sekarang menerima External Henkaten monitoring dengan authorization, privacy, ordering, dan
traceability yang terikat ke supplier/source epoch:

- TMMIN-managed external client lifecycle dengan one-time Argon2id-hashed secret, rotation maksimal
  dua active secret, revoke, optional IP allowlist, dan optimistic version;
- opaque 15-minute bearer token dengan stored SHA-256 digest, fixed scope, epoch validation, immediate
  revocation, generic auth failure, dan `Cache-Control: no-store`;
- strict Zod/OpenAPI `1.0` event contract untuk MAN/MACHINE/MATERIAL/METHOD dan seluruh lifecycle;
- immutable raw event, canonical SHA-256 idempotency, contiguous source version, terminal freeze,
  current projection, freshness, warning, audit, dan outbox dalam satu serializable transaction;
- single, per-item batch, dan ingestion-status API dengan bounded 5 MiB/500-item input;
- TMMIN projection history, unified Hosted/External dashboard, external warning notification, dan
  source-mode badge tanpa External Assignment Board;
- token-attempt dan ingestion rate limit yang sesuai single-instance topology;
- PostgreSQL concurrency, partial-batch, contract, privacy, and revocation evidence.

## 2. Locked Decisions

- Authorization identity adalah tuple client + supplier + source epoch + scope + optional IP.
- Secret plaintext hanya dikembalikan sekali; bearer plaintext tidak pernah disimpan.
- Source cutover memerlukan active next-epoch credential untuk target External dan merevoke external
  client/token ketika kembali ke Hosted.
- Accepted raw event immutable; projection hanya current monitoring view dan dapat direkonstruksi
  dari history.
- Idempotency key dibatasi oleh supplier + epoch + opaque event ID. Canonical hash membedakan exact
  retry dari conflict.
- Batch memproses satu transaction per item dan mengembalikan result pada original input position.
- Unified warning menggunakan exactly-one Hosted Henkaten atau External projection relation.
- External projection/warning hanya read-only untuk TMMIN; supplier External tidak mendapat Hosted
  session, workflow, board, atau personnel model.
- In-process rate counter hanya valid untuk satu API instance; multiple replicas memerlukan
  coordinated counter lebih dahulu.

## 3. Persistence dan Migration

Migration baru:

- `apps/api/prisma/migrations/20260723000700_external_ingestion/migration.sql`

Entity baru:

- `ExternalApiClient`;
- `ExternalApiSecret`;
- `ExternalAccessToken`;
- `ExternalIngestionEvent`;
- `ExternalHenkatenProjection`.

`WarningInstance` sekarang menyimpan `sourceMode` dan exactly one of `henkatenId` atau
`externalProjectionId`. Database menegakkan credential/projection uniqueness, positive versions,
event/source-version uniqueness, dan raw-event update/delete prevention trigger.

Fresh disposable PostgreSQL migration 001→007 lulus.

## 4. API dan Contract Changes

TMMIN credential/projection:

- `GET|POST /api/v1/tmmin/suppliers/{supplierId}/external-clients`;
- `POST /api/v1/tmmin/suppliers/{supplierId}/external-clients/{id}/rotate-secret`;
- `POST /api/v1/tmmin/suppliers/{supplierId}/external-clients/{id}/revoke`;
- `GET /api/v1/tmmin/suppliers/{supplierId}/external-projections`;
- `GET /api/v1/tmmin/suppliers/{supplierId}/external-projections/{id}`.

External public boundary:

- `POST /api/v1/external/auth/token`;
- `POST /api/v1/external/henkaten/events`;
- `POST /api/v1/external/henkaten/events/batch`;
- `GET /api/v1/external/ingestions/{eventId}`.

TMMIN notifications:

- `GET /api/v1/tmmin/notifications`;
- `GET /api/v1/tmmin/notifications/unread-count`;
- `PATCH /api/v1/tmmin/notifications/{id}/read-state`.

## 5. Ingestion Behavior

- First event harus `HENKATEN_OPENED`, status `OPEN`, source version 1.
- Subsequent event harus exactly current + 1; gap/stale/terminal update ditolak.
- Approved memerlukan Supervisor dan QC Approved; Rejected memerlukan reject evidence; Cancelled
  memerlukan reason.
- Semua checklist item harus `YES`, category payload harus match discriminator, dan unknown field
  ditolak.
- Exact retry mengembalikan `DUPLICATE`; same event ID/different canonical hash mengembalikan 409.
- Concurrent identical first delivery menghasilkan exactly one raw event/projection side effect,
  dengan outcome `ACCEPTED` + `DUPLICATE`.
- Batch mixed result tidak me-rollback unrelated valid event.

## 6. Monitoring, Notification, dan Privacy

Global dashboard menggabungkan Hosted dan External category/outcome/open-warning counts serta
accepted/rejected ingestion dan last-successful freshness. Open External projection membuka warning;
terminal projection menutup warning. Outbox-derived notification dikirim idempotently ke active
TMMIN Admin dan menggunakan TMMIN user-scoped notification endpoint.

External event contract tidak memiliki Hosted member/registration/photo/account/contact/attendance/
health/skill fields. Audit/log hanya menyimpan safe identity, result code, correlation, epoch, dan
source IP; tidak ada secret, bearer, atau Authorization value.

## 7. Documentation

- ADR 0018 mendefinisikan epoch-bound client/token, immutable ordered ingestion, projection, batch,
  dan single-instance rate-limit decisions.
- `docs/architecture/external-ingestion.md` mendokumentasikan authorization, event contract,
  transaction/idempotency flow, batch, monitoring, abuse, dan privacy boundary.
- Read-model architecture, PRD implementation status, dan roadmap diperbarui menjadi Phase 0–9.

## 8. Validation Selesai

Development validation:

- Prisma generate — passed;
- formatter — passed;
- lint — passed;
- typecheck — passed;
- unit — contracts 23, fixtures 6, API 7; 36 passed;
- OpenAPI generation — passed;
- disposable database reset + fresh migration 001→007 — passed;
- full PostgreSQL integration — 5 files, 30 tests passed.

Integration evidence mencakup seluruh prior auth/master/shift/Henkaten/approval/read-model behavior
serta External secret storage, token, exact/conflicting retry, version gap, terminal projection,
immutable evidence, partial batch, unified dashboard/warning, notification, concurrent identical
delivery, dan immediate revocation.

## 9. Final Local CI Parity

Clean-artifact parity dijalankan dengan official Darwin arm64 Node.js `22.23.1` dan pnpm `11.16.0`.
Existing build output, generated Prisma client, dan test-photo output dipindahkan ke isolated
temporary artifact hold sebelum checks:

- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test:unit` — contracts 23, fixtures 6, API 7; 36 passed;
- `pnpm openapi:check`;
- `pnpm build`;
- `docker compose config --quiet`;
- `pnpm db:up`, `pnpm db:wait`, dan `pnpm db:verify` — PostgreSQL 18.4, pgvector 0.8.5;
- `pnpm db:test:reset` dan `pnpm db:test:migrate` — fresh migration 001→007 passed;
- CI environment `pnpm test:integration` — 5 files, 30 tests passed;
- `pnpm db:down`;
- Gitleaks 8.24.3 directory scan — no leaks;
- `git diff --check` — passed.

Satu initial parity attempt mengalami transport-only `socket hang up` pada existing Hosted test tanpa
application/database error. Fresh full-database rerun lulus 30/30. Compose down dan tidak ada dev
server, watcher, test process, atau agent-started container.

## 10. Delivery

Target commit:

- `feat: add secure external henkaten ingestion`

Setelah commit: Gitleaks commit scan, push `staging`, dan inspect GitHub Actions `quality`,
`database-integration`, serta `secret-scan` sampai green.

## 11. Next Recommended Batch

Mulai backend contract freeze dan hardening:

1. audit critical policy unit coverage dan consolidate race/failure evidence;
2. reconcile implemented route inventory, Zod schemas, generated OpenAPI, enum/error names;
3. review Compact-scale list/board/dashboard/warning/audit/notification/external query plans;
4. capture repeatable p50/p95/p99 baseline and error rate;
5. run security-negative matrix, resolve Critical/High gaps, and publish freeze boundary.
