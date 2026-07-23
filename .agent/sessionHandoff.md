# Session Handoff — Backend Contract Freeze and Hardening

Tanggal: 2026-07-23
Branch: `staging`
Status repository: Phase 0–10 selesai; Phase 11 `planned`

## 1. Outcome

Backend v1 sekarang memiliki executable contract freeze, direct policy evidence, upgrade-safe query
hardening, dan repeatable Compact baseline:

- NestJS controller metadata direkonsiliasi exactly dengan generated OpenAPI;
- 124 paths/140 HTTP operations terdokumentasi dan byte-drift checked;
- sebelas undocumented operations serta lima assignment path-parameter drift telah diperbaiki;
- canonical external hash, ordering/terminal state, IP allowlist, token window, ingestion bucket, dan
  Retry-After memiliki direct unit evidence;
- External security-negative suite mencakup forbidden field, allowlist, source epoch, revoked
  client/token, scope, conflict, out-of-order, partial batch, dan concurrent identical delivery;
- deterministic cursor/list indexes tersedia untuk job, member, audit, outbox, dan External
  projection;
- fresh migration 001→008 dan upgrade checkpoint 001→007 kemudian 008 keduanya lulus;
- Compact HTTP baseline pada maximum supplier/master-data profile lulus seluruh preliminary p95 dan
  error targets.

Backend contract siap menjadi dependency frontend tanpa backend redesign.

## 2. Frozen Contract

Frozen:

- OpenAPI `3.1.0`, API `1.0.0`, External schema `1.0`;
- public route method/path/parameter identity;
- request requiredness dan validation semantics;
- enum, lifecycle status, result, dan problem-code names;
- idempotency, source-version, approval, warning, assignment, dan source-epoch semantics.

Allowed within v1:

- optional read fields;
- pagination metadata;
- backward-compatible filter/sort;
- new safe error code untuk previously unspecified failure;
- additive read-only endpoint;
- additive index/internal query improvement.

Breaking removal/rename/required-field/semantic/authorization/enum change memerlukan explicit
contract migration atau version baru.

## 3. Contract Reconciliation

`apps/api/src/openapi/contract-freeze.spec.ts` walks `AppModule`, controller, dan handler metadata,
normalizes Nest `:parameter` ke OpenAPI `{parameter}`, lalu membandingkan exact operation sets.

Gap yang ditutup:

- supplier job detail, activate, deactivate, dan reorder docs;
- TMMIN job list dan checklist-version list docs;
- line/job assignment parameter names;
- generated OpenAPI artifact diregenerasi.

Route baru tanpa OpenAPI atau obsolete OpenAPI tanpa controller sekarang menggagalkan unit suite.

## 4. Unit, Concurrency, dan Security Evidence

Direct unit policy:

- canonical JSON key ordering dan array-order preservation;
- first/sequential/terminal External source versions;
- allowlist fail-closed;
- token 10/minute client/IP fixed window dan reset;
- ingestion 300 burst/120 per minute refill;
- `Retry-After` hanya pada denied request.

Full integration suite tetap mencakup auth, cross-realm/tenant/role, CSRF/CORS, administration,
master data/photo, shift, assignment, Henkaten 4M, approval, Man movement, finalization, notification,
dashboard/audit/SSE, outbox retry/poison, dan External flows. Critical races memiliki exactly-one
legal outcome. No test-detected Critical/High backend security gap remains.

## 5. Migration dan Query Review

Migration baru:

- `apps/api/prisma/migrations/20260723000800_backend_read_indexes/migration.sql`

Index baru:

- audit `(supplierId, occurredAt DESC, id DESC)`;
- outbox/SSE `(supplierId, occurredAt, id)`;
- External projection `(supplierId, updatedAt DESC, id DESC)`;
- member `(supplierId, active, fullName, id)`;
- job `(supplierId, lineId, active, displayOrder, id)`.

Compact `EXPLAIN (ANALYZE, BUFFERS)` menggunakan index-only scan untuk job, member, External
projection, dan audit bounded reads. No cache/materialized view diperlukan.

## 6. Compact Baseline

Dedicated command: `pnpm test:baseline`.

Guard:

- database name wajib berakhir `_test`;
- Supplier table wajib kosong;
- baseline terpisah dari functional integration suite.

Profile:

- 42 suppliers;
- 20 lines, 300 members, 500 jobs per supplier;
- 500 current External projections per supplier;
- 1,000 permanent audit rows per supplier.

Measured local HTTP results:

| Workload | p50 | p95 | p99 | Error |
|---|---:|---:|---:|---:|
| TMMIN dashboard | 19.59 ms | 22.16 ms | 36.29 ms | 0% |
| External projection list | 2.16 ms | 2.81 ms | 2.91 ms | 0% |
| TMMIN audit | 9.21 ms | 11.74 ms | 12.00 ms | 0% |
| Notification list | 1.08 ms | 1.87 ms | 2.12 ms | 0% |
| Standard audited mutation | 2.51 ms | 3.36 ms | 4.89 ms | 0% |
| External single ingest | 4.44 ms | 5.42 ms | 6.04 ms | 0% |

Ini preliminary sequential latency evidence untuk frontend readiness. 30-concurrent-user staging load,
approval saturation, dan board/warning propagation tetap release gate kemudian.

## 7. Documentation

- ADR 0019 mendefinisikan executable contract freeze, allowed post-freeze changes, explicit
  baseline project, dan evidence-based query evolution.
- `docs/architecture/backend-contract-freeze.md` mendokumentasikan contract chain, version rules,
  test layers, security boundary, dan change review.
- `docs/architecture/backend-performance-baseline.md` mencatat repeatable profile, metrics,
  query-plan evidence, serta interpretation boundary.
- PRD implementation status dan roadmap diperbarui menjadi Phase 0–10.

## 8. Validation Selesai

Development validation:

- Prisma generate — passed;
- formatter — passed;
- lint — passed;
- typecheck — passed;
- unit — contracts 23, fixtures 6, API 14; 43 passed;
- OpenAPI generation/reconciliation — 124 paths, 140 operations passed;
- fresh migration 001→008 — passed;
- upgrade migration 001→007 then 008 — passed, five new indexes verified;
- full PostgreSQL integration — 5 files, 31 tests passed;
- Compact baseline — 2 tests passed, all p95/error gates passed.

## 9. Final Local CI Parity

Clean-artifact parity dijalankan dengan official Darwin arm64 Node.js `22.23.1` dan pnpm `11.16.0`.
Existing build output, generated Prisma client, dan local baseline/upgrade output dipindahkan ke
isolated temporary artifact hold sebelum checks:

- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test:unit` — contracts 23, fixtures 6, API 14; 43 passed;
- `pnpm openapi:check` — exact 140-operation reconciliation passed;
- `pnpm build`;
- `docker compose config --quiet`;
- `pnpm db:up`, `pnpm db:wait`, dan `pnpm db:verify` — PostgreSQL 18.4, pgvector 0.8.5;
- `pnpm db:test:reset` dan `pnpm db:test:migrate` — fresh migration 001→008 passed;
- CI environment `pnpm test:integration` — 5 files, 31 tests passed;
- second fresh reset/migrate dan `pnpm test:baseline` — 2 tests, all p95/error/index-plan gates
  passed;
- `pnpm db:down`;
- Gitleaks 8.24.3 directory scan — no leaks;
- `git diff --check` — passed.

Compose down dan tidak ada dev server, watcher, test process, atau agent-started container.

## 10. Delivery

Target commit:

- `test: freeze and baseline backend contracts`

Setelah commit: Gitleaks commit scan, push `staging`, dan inspect GitHub Actions `quality`,
`database-integration`, serta `secret-scan` sampai green.

## 11. Next Recommended Batch

Mulai frontend/shared UI foundation:

1. scaffold supplier/TMMIN Vite workspaces dan shared UI package;
2. generate typed API client dari frozen OpenAPI/shared Zod contract;
3. implement session bootstrap, CSRF-aware mutation client, global problem mapping;
4. establish accessible desktop tokens, loading/empty/error/forbidden/conflict/stale states;
5. add frontend unit, build, and initial Playwright harness without changing frozen backend semantics.
