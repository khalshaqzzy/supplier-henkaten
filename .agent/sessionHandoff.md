# Session Handoff — Durable Read Models and Realtime Invalidation

Tanggal: 2026-07-23
Branch: `staging`
Status repository: Phase 0–8 selesai; Phase 9 `planned`

## 1. Outcome

Hosted backend sekarang menyediakan seluruh read experience yang diperlukan sebelum External
ingestion dan frontend:

- idempotent outbox-driven notification persistence per user;
- paginated notification center, unread count, dan optimistic read/unread mutation;
- role-scoped Assignment Board untuk active Shift Run dengan ordered job/MP, initials/photo,
  vacancy/reservation/conflict, dan explicit Open/Approved 4M indicators;
- supplier dashboard aggregation dan bounded recent activity;
- TMMIN global dashboard untuk Hosted state, affected warning, source-mode count, override, dan
  freshness;
- supplier/TMMIN audit read API dengan cursor pagination dan sensitive-key redaction;
- authenticated tenant/line-scoped SSE invalidation dengan heartbeat dan `Last-Event-ID` resume;
- shared Zod/OpenAPI contracts, migration, ADR, architecture note, dan integration evidence.

External credential, token, ingestion, projection, dan unified Hosted/External freshness tetap
dimiliki Phase 9.

## 2. Locked Decisions

- PostgreSQL domain tables tetap source of truth read model.
- Notification unik per `(sourceEventId, recipientUserId)` dan aman terhadap outbox retry.
- Outbox mendukung zero-or-more handler per event; domain event tanpa side-effect handler tetap valid.
- SSE hanya mengirim invalidation metadata, bukan full domain payload atau PII.
- REST board/dashboard/audit adalah recovery path dan authority setelah reconnect.
- Direct bounded queries digunakan; projection/materialized view hanya dapat ditambah berdasarkan
  query-plan dan latency evidence.
- Notification read state tidak mengubah warning, Henkaten, approval, atau assignment.
- Supplier audit list hanya Supplier Admin; TMMIN audit memerlukan explicit cross-tenant capability.

## 3. Persistence dan Migration

Migration baru:

- `apps/api/prisma/migrations/20260723000600_notification_read_models/migration.sql`

Entity baru:

- `Notification`.

Constraint/index:

- unique source outbox event + recipient;
- recipient unread/reverse-time index;
- supplier reverse-time index;
- positive optimistic version.

Fresh disposable PostgreSQL migration 001→006 lulus.

## 4. API dan Contract Changes

Endpoint baru:

- `GET /api/v1/supplier/notifications`;
- `GET /api/v1/supplier/notifications/unread-count`;
- `PATCH /api/v1/supplier/notifications/{id}/read-state`;
- `GET /api/v1/supplier/assignment-board`;
- `GET /api/v1/supplier/dashboard`;
- `GET /api/v1/supplier/audit`;
- `GET /api/v1/supplier/realtime` (`text/event-stream`);
- `GET /api/v1/tmmin/dashboard`;
- `GET /api/v1/tmmin/audit`.

Capability baru memisahkan notification, board, dashboard, audit, dan future external credential
management.

## 5. Recipient dan Scope Behavior

- Henkaten Open: current persisted Supervisor responsibility dan seluruh active QC.
- Henkaten terminal: creator dan active Supplier Admin.
- vacancy/assignment issue/override: Supplier Admin dan affected line ownership bila tersedia.
- Notification endpoint selalu terkunci ke current user ID.
- Board/dashboard scope:
  - Supplier Admin/QC: seluruh tenant;
  - Supervisor: owned supervised Shift Run;
  - Line Leader: owned led Shift Run.
- TMMIN dashboard/audit memerlukan TMMIN realm capability dan tidak memiliki mutation.

## 6. Realtime dan Recovery

SSE memakai retained outbox event ID sebagai cursor. Message berisi event/aggregate identity,
aggregate version, occurrence time, dan refresh topics. Heartbeat dikirim ketika tidak ada perubahan.
`Last-Event-ID` digunakan untuk mencari event berikutnya; REST refresh tetap wajib setelah reconnect.

## 7. Documentation

- ADR 0017 mendefinisikan durable notification dan authoritative read-model boundary.
- `docs/architecture/read-models-and-realtime.md` mendokumentasikan write-to-read flow, scoping,
  redaction, SSE, dan query-evolution rules.
- PRD implementation status dan roadmap diperbarui menjadi Phase 0–8.

## 8. Validation Selesai

Development validation:

- Prisma generate — passed;
- formatter — passed;
- lint — passed;
- typecheck — passed;
- unit — contracts 21, fixtures 6, API 7; 34 passed;
- OpenAPI generation — passed;
- Docker PostgreSQL 18.4 + pgvector 0.8.5 verification — passed;
- disposable database reset + fresh migration 001→006 — passed;
- full PostgreSQL integration — 4 files, 24 tests passed.

Integration evidence mencakup durable recipients, notification read state, board content,
supplier/TMMIN dashboard, audit redaction, dan seluruh prior auth/master/shift/Henkaten/approval/
movement races.

## 9. Final Local CI Parity

Clean-artifact parity dijalankan dengan official Darwin arm64 Node.js `22.23.1` dan pnpm `11.16.0`.
Existing build output, generated Prisma client, dan test-photo output dipindahkan ke isolated temporary
artifact hold sebelum checks:

- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test:unit` — contracts 21, fixtures 6, API 7; 34 passed;
- `pnpm openapi:check`;
- `pnpm build`;
- `docker compose config --quiet`;
- `pnpm db:up`;
- `pnpm db:wait`;
- `pnpm db:verify` — PostgreSQL 18.4, pgvector 0.8.5;
- `pnpm db:test:reset`;
- `pnpm db:test:migrate` — fresh migration 001→006 passed;
- CI environment `pnpm test:integration` — 24 passed;
- `pnpm db:down`;
- Gitleaks 8.24.3 directory scan — no leaks;
- `git diff --check` — passed.

Compose is down dan tidak ada dev server, watcher, test process, atau agent-started container.

## 10. Delivery

Setelah commit:

- Gitleaks commit scan;
- push `staging`;
- inspect GitHub Actions `quality`, `database-integration`, dan `secret-scan`;
- delivery belum dianggap selesai sampai seluruh required jobs green.

Target commit:

- `feat: add durable operational read models`

## 11. Next Recommended Batch

Mulai External REST API:

1. external client/secret lifecycle dan source-governance contributor;
2. opaque 15-minute bearer token dengan epoch/scope/IP binding;
3. strict v1 Zod/OpenAPI event contract dan PII boundary;
4. immutable single/batch ingestion dengan canonical hash dan sequential source version;
5. current external projection, warning, freshness, dan TMMIN dashboard integration;
6. rate-limit, abuse, concurrency, contract, dan security-negative suite.
