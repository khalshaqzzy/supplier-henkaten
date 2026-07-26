# Session Handoff — Comprehensive Local Seed Lifecycle

Tanggal: 2026-07-26

Branch: `staging`

Status: Phase 14.12 `done`; Phase 15.1 adalah next

## 1. Objective dan Outcome

Local pnpm full stack sekarang memiliki dua lifecycle command:

- `pnpm local:start:clean` menghapus volume PostgreSQL dan foto, menjalankan migration, bootstrap,
  comprehensive seed, verification, lalu kedua frontend;
- `pnpm local:reseed` mereset main database dan volume foto tanpa mengubah disposable test database.

Kedua command berakhir dengan tepat dua supplier aktif Hosted dan stack sehat. Tidak ada endpoint,
OpenAPI, schema migration, production fallback, atau tracked credential baru.

## 2. Seed Dataset

Setiap supplier memiliki:

- 3 line, 12 job, 22 member, 8 part, 3 Shift Template, dan empat published 4M checklist;
- 36 Shift Run historis dan 3 Shift Run aktif;
- 120 Henkaten dengan profil berbeda: NPM memiliki 36 Man, 34 Machine, 27 Material, 23 Method;
  GKI memiliki 28 Man, 26 Machine, 38 Material, 28 Method;
- outcome NPM adalah 66 Approved, 20 Rejected, 26 Cancelled, dan 8 Open; outcome GKI adalah 58
  Approved, 29 Rejected, 25 Cancelled, dan 8 Open;
- beban historical shift bervariasi 1-6 record dengan histogram berbeda per supplier, seluruh job
  dan part digunakan, serta line/part memiliki konsentrasi demand yang tidak rata;
- 21 variasi cause/detail per supplier, master data otomotif yang plausible, 77+ variasi waktu
  kejadian, dan 78+ variasi durasi penyelesaian;
- histori padat pada 30 hari terakhir, dilanjutkan titik tren mingguan/periodik sampai sekitar satu
  tahun;
- normal/emergency start, dual-route approval order, reject-fast, withdraw/clone, end-shift
  cancellation, Man reservation/movement, resolved dan unresolved issue, warning, notification,
  audit, outbox, foto, serta initials fallback.

Seluruh domain state dibuat melalui API nyata. Prisma hanya dipakai untuk empty-target guard,
historical timestamp normalization setelah outbox drain, dan post-seed invariant verification.

## 3. Security dan Destructive Boundary

- Seeder menolak non-development, CI, non-loopback API, nonlocal/main database mismatch, missing
  confirmation marker, dan database yang bukan bootstrap-only.
- `local:start:clean` menampilkan dua named volume sebelum menghapusnya.
- `local:reseed` menghentikan writer, mempertahankan PostgreSQL/test database, membuat ulang main
  database, serta menghapus hanya photo volume dengan Compose ownership-label validation.
- Password dibuat acak per akun dan hanya ditulis atomik ke ignored
  `.local/seed-credentials.json` mode `0600`; value tidak dicetak atau dilog.

## 4. Files Changed

- lifecycle/config: `package.json`, `compose.yaml`, `scripts/local-stack.mjs`,
  `scripts/database.mjs`, dan `apps/api/package.json`;
- seed implementation/tests: `apps/api/src/cli/local-seed.ts`,
  `local-seed-plan.ts`, dan `local-seed-plan.spec.ts`;
- records: `README.md`, local architecture, ADR 0026, roadmap, dan handoff ini.

User-owned `.DS_Store` tetap tidak disentuh.

## 5. Validation

Completed:

- clean install, format, lint, typecheck, 96 unit tests, OpenAPI drift check, dan production build;
- Compose default/fullstack config;
- PostgreSQL 18.4, pgvector 0.8.5, sembilan fresh migrations, dan 32 integration tests;
- empat Chromium dan dua Microsoft Edge isolated full-stack journeys;
- containerized Gitleaks v8.24.3 memindai 64.94 MB tanpa finding;
- `git diff --check`;
- `pnpm local:start:clean`;
- `pnpm local:reseed`;
- exactly-two Hosted supplier, 240-Henkaten, supplier-specific category/status, shift-load,
  line/part, narrative, dan timing-variance SQL checks;
- credential manifest mode/shape, new-login, ID/password rotation, photo repopulation;
- `_test` database sentinel preservation through reseed.

Seluruh validation memakai runtime Node.js 22.23.1 dan pnpm 11.16.0 yang dipin repository. Stack
acceptance, database integration, E2E container/network/volume, dan credential manifest yang dibuat
untuk test telah dibersihkan. Volume lokal yang dibuat selama acceptance juga dihapus agar tidak
meninggalkan database tanpa manifest credential; tidak ada agent-started process atau container
berjalan.

## 6. Next Action

Phase 15.1 Production Dockerfiles tetap menjadi next recommended work.
