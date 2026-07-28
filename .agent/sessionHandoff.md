# Session Handoff — Comprehensive Seeded App QA

Tanggal: 2026-07-28

Branch: `staging`

Status: QA seeded app untuk seluruh role bercredential dan kedua client surface **done**. Phase 15
tetap `in_progress`; 15.9/15.11 masih memerlukan evidence VM/rehearsal staging.

## 1. Objective dan Outcome

Audit menutup matriks PRD untuk Supplier Admin, Supervisor, Line Leader, QC, TMMIN Admin, dan TMMIN
Quality pada `supplier-web` serta `tmmin-web`. MP tetap role tanpa credential sesuai PRD.

Clean start/reseed membuktikan baseline:

- tepat dua supplier Hosted;
- 240 Henkaten, 16 Open, 16 warning aktif;
- dua reservation aktif dan dua open Assignment Issue;
- approval route, notification, audit, history, foto, shift, dan Board konsisten.

Tidak ditemukan `SEED_DEFECT` atau `CONTRACT_DOC_MISMATCH`. Dua `APP_DEFECT` ditemukan dan
diperbaiki:

1. Henkaten action error tidak hilang setelah `Refresh record`;
2. TMMIN Quality melihat link External credential yang selalu 403 dan mendapat copy palsu bahwa
   Supplier Admin aktif tidak ada ketika identity sebenarnya disensor.

Laporan lengkap: `docs/audits/seededAppAllRolesQaAudit.md`.

## 2. Implementation

- `apps/supplier-web/src/pages/HenkatenPages.tsx`
  - refresh authoritative sekarang membersihkan local problem state.
- `apps/tmmin-web/src/pages/AdminPages.tsx`
  - External credential link hanya untuk TMMIN Admin;
  - null privileged admin untuk Quality dijelaskan sebagai permission boundary.
- `apps/supplier-web/src/App.test.tsx`
  - regression failed decision → refresh → alert hilang/refetch.
- `apps/tmmin-web/src/App.test.tsx`
  - regression Quality supplier detail tanpa credential action/false absence.
- `docs/audits/seededAppAllRolesQaAudit.md`
  - matriks lengkap, evidence, root cause, fix, validation, dan residual risk.
- `.agent/implementationPhases.md`
  - subphase 14.14 `done`.
- `docs/adr/0026-isolated-local-full-stack-and-browser-e2e-runtimes.md`
  - primary QC/Quality completion rule dan evidence diperbarui.

Tidak ada perubahan public API, OpenAPI, Prisma schema, migration, seed contract, production
fallback, atau domain policy.

## 3. Validation

- targeted frontend regression: Supplier 17/17, TMMIN 11/11;
- root format, lint, typecheck: lulus;
- root unit: 117 Vitest + 2 Node tests lulus;
- OpenAPI/generated client drift: lulus;
- production build: lulus dengan explicit `VITE_API_ORIGIN`;
- PostgreSQL integration serial: 33/33 lulus;
- browser E2E: Chromium 4/4 dan Edge 2/2 lulus;
- `local:start:clean` dan `local:reseed`: lulus memakai Node.js 22.23.1 container;
- Gitleaks source-tree directory scan: lulus; operator key gitignored dikembalikan utuh;
- live browser re-verification 1280×720: kedua fix tampil benar, tidak ada horizontal overflow atau
  Quality route console warning/error.

Browser tabs difinalisasi, viewport override direset, dan seluruh local/E2E process/container
dihentikan. Durable local database/photo volumes dipertahankan oleh `local:down`.

Host Node.js 26.3.1 tetap di luar supported range. Runtime container yang menjadi acceptance
evidence memakai exact Node.js 22.23.1.

## 4. Decisions

- Seed dua Hosted supplier tidak diubah. External source/notification evidence tetap dibuat melalui
  production path pada isolated E2E dan dibersihkan otomatis.
- Null privileged identity untuk read-only Quality bukan bukti absence dan tidak boleh dipresentasi
  sebagai absence.
- Frontend tidak boleh menampilkan action yang diketahui berakhir pada capability guard.
- Error recovery harus membersihkan presentation state sekaligus mengambil ulang resource/version.

## 5. Residual Risk dan Next Action

- Vite masih memberi chunk-size warning non-blocking.
- PostgreSQL driver memberi deprecation warning pada overlapping `client.query()` dalam concurrency
  tests; suite tetap lulus. Refactor async query ownership disarankan sebelum pg 9.
- Host `.env` adalah dotenv input dan tidak aman untuk `source` bila value berisi spasi tanpa shell
  quoting; gunakan loader/tooling repository, bukan shell sourcing.
- Backup, PITR, replica, DR, failover, RPO/RTO, dan HA tidak tersedia pada v1.
- Next external action tetap bootstrap/configure staging VM, merge ke `staging`, first/second
  release evidence, race rehearsal, dan controlled rollback untuk menutup 15.9/15.11.
