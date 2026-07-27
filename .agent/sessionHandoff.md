# Session Handoff — Seeded App QA Supervisor/Line Leader dan Staging Runtime

Tanggal: 2026-07-27

Branch: `staging`

Baseline SHA audit lanjutan: `2d09543da180dc449266ede48bca6d1f1d3d9562`

Status: seeded app QA Supplier Admin → TMMIN Admin dan Supervisor → Line Leader **done**, termasuk
seluruh profil Line Leader NPM khusus Henkaten. Phase 15 tetap `in_progress`; 15.1-15.8 `done`,
15.9 menunggu evidence VM, 15.10 implementation-ready/activation deferred, dan 15.11 menunggu
rehearsal staging.

## 1. Outcome QA

Clean seeded runtime telah diaudit pada database, API, dan UI, dimulai dari Supplier Admin lalu
di-reset sebelum TMMIN Admin. Baseline menghasilkan tepat dua supplier Hosted, 240 Henkaten, foto,
warning, reservation, issue, audit, dan histori sesuai invariant.

Audit awal tidak menemukan seed defect atau contract/document mismatch. Tujuh app defect ditemukan
dan diperbaiki:

1. thumbnail member Supplier Board memakai frontend origin;
2. error mutation master data Supplier ditelan;
3. Shift list API gagal jika mempunyai lebih dari satu row;
4. clean/reseed memakai frontend image yang berpotensi stale;
5. request log API tidak mempunyai resolved route template;
6. TMMIN Hosted Support salah membaca nested line/shift snapshot;
7. error mutation administrasi TMMIN ditelan.

Semua fix mempunyai regression test pada lapisan terdekat. Laporan lengkap berada di
`.agent/seededAppQaAudit.md`.

Audit lanjutan memakai Supervisor GKI multi-line/single-line, LL GKI untuk mutation lifecycle, serta
LL1/LL2/LL3 NPM untuk assignment issue, partial approval, dan active Man reservation. Tidak
ditemukan seed defect atau contract/document mismatch. Enam app defect tambahan diperbaiki:

1. local stack mencetak origin portal 127.0.0.1 yang ditolak canonical CORS/cookie realm;
2. API client memvalidasi current Shift detail memakai summary schema;
3. API client mengharapkan working assignment array langsung, bukan `{ items }`;
4. board mengabaikan Open Man reservation dan salah menyatakan assignment stabil;
5. semua badge MAN/MACHINE/MATERIAL/METHOD tampak sebagai `M`.
6. active assignment issue tidak mempunyai deep-link ke resolution wizard yang membawa
   `resolutionIssueId`.

Laporan lengkap audit lanjutan berada di
`.agent/seededAppSupervisorLineLeaderQaAudit.md`.

## 2. Runtime dan Contract Decisions

- `local:start:clean` dan `local:reseed` sekarang membangun ulang API serta kedua frontend dari
  working tree saat ini.
- Kedua command melaporkan portal canonical `localhost`; 127.0.0.1 hanya dipakai untuk readiness
  probe API.
- Baseline seed tetap tepat dua supplier Hosted.
- State External untuk QA dibuat sementara lewat UI/API produksi. Audit membuktikan issue, rotate,
  revoke, preparation, dan preflight/cutover blocker, lalu state dibersihkan lewat reseed.
- Tidak ada public API, OpenAPI, Prisma schema, migration, production fallback, atau credential tetap
  baru.
- Structured request log sekarang memuat low-cardinality `routeTemplate` setelah route resolution
  tanpa mencetak query/path values atau credential.
- `.DS_Store` adalah perubahan milik pengguna dan tetap tidak disentuh.
- Tidak ada public API, OpenAPI, Prisma schema, migration, atau production fallback baru dari audit
  Supervisor/Line Leader.

## 3. Main Files QA

- API: `apps/api/src/shifts/shift.service.ts`,
  `apps/api/src/common/request-logging.ts`,
  `apps/api/src/common/request-route.interceptor.ts`;
- Supplier: `apps/supplier-web/src/app/api.ts`,
  `apps/supplier-web/src/pages/BoardPage.tsx`,
  `apps/supplier-web/src/pages/MasterDataPages.tsx`;
- API client: `packages/api-client/src/supplier.ts`;
- TMMIN: `apps/tmmin-web/src/pages/AdminPages.tsx`,
  `apps/tmmin-web/src/pages/SupportPages.tsx`;
- local runtime: `scripts/local-stack.mjs`, `scripts/local-stack-plan.mjs`;
- regression: colocated `*.test.ts`, `*.spec.ts`, dan `scripts/local-stack-plan.test.mjs`;
- architecture/evidence: ADR 0026, Phase 14.12-14.13, `.agent/seededAppQaAudit.md`, dan
  `.agent/seededAppSupervisorLineLeaderQaAudit.md`.

## 4. Validation Evidence

- clean start dan reseed akhir lulus dengan exact Node.js 22.23.1 container;
- manifest credential berotasi, mode `0600`, dan disposable test database dipertahankan;
- format, lint, typecheck, 115 Vitest unit test plus dua Node script test, OpenAPI/client drift, dan
  production build lulus;
- targeted PostgreSQL integration 15/15 dan full serial integration 33/33 lulus;
- Chromium 4/4 journey dan Edge 2/2 smoke journey lulus;
- Gitleaks tidak menemukan leak dan `git diff --check` lulus.

Regression browser sekarang secara eksplisit memastikan form LL mendapat current Shift/target job
dan board menampilkan active Man reservation. Audit interaktif GKI/NPM pada 1280×720 tidak
menemukan horizontal overflow atau cross-line/cross-tenant leakage.

Satu full integration run paralel sempat gagal pada notification count akibat lima file berbagi
disposable database. Reset dan run serial lulus 33/33. Follow-up yang disarankan adalah database
isolation per file/worker; ini bukan seeded app defect.

## 5. Staging Runtime yang Tetap Berlaku

Staging release pipeline untuk satu VM Ubuntu 22.04 tetap utuh:

- hanya pull request/push ke `staging` menjalankan staging CI;
- push `staging` memanggil reusable exact-SHA deployment;
- runtime memakai non-root production images, private PostgreSQL, Caddy sebagai satu-satunya service
  yang publish 80/443, forward-only migration, atomic pointer, rollback code/env, race guard, dan
  five-release retention;
- release gate mencakup quality/contracts, PostgreSQL integration, migration, browser E2E,
  deployment tooling, production container acceptance, Gitleaks, dependency security, dan CodeQL;
- production activation tetap dilarang sampai diotorisasi dan diprovision terpisah.

## 6. External Blockers dan Next Action

Tidak ada pertanyaan repository yang terbuka. Pekerjaan eksternal tetap:

1. operator menjalankan `bootstrap-vm.sh` melalui akses VM langsung;
2. DNS, verified SSH keyscan, dan GitHub Environment `staging` dikonfigurasi sesuai
   `.agent/deploymentGuide.md`;
3. feature branch di-squash-merge ke `staging`;
4. evidence first deploy, second-release upgrade, close-candidate race, dan controlled rollback
   rehearsal diambil.

Hanya setelah evidence tersebut 15.9 dan 15.11 boleh menjadi `done`. Phase 15 harus tetap
`in_progress`.

## 7. Accepted Risks

- Belum ada backup, PITR, replica, disaster recovery, failover, RPO/RTO, atau HA.
- Kehilangan VM/disk/volume dapat menghapus database dan foto.
- Code rollback tidak mengembalikan schema atau data.
- PostgreSQL password rotation memerlukan perubahan database role terkoordinasi.
- Host audit memakai Node.js 26.3.1, sedangkan runtime repository yang didukung dan container
  acceptance memakai Node.js 22.23.1.
- Vite masih memberi warning chunk besar non-blocking.
- Integration suite harus tetap serial selama lima file memakai satu disposable test database.
