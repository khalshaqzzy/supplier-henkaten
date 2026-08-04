# Session Handoff — Cross-application 4M and Typography Refinement

Tanggal: 2026-08-04

Branch: `feat/typography-elements`

Status: implementasi, regression coverage, visual QA, dan local parity **done**. Phase 15.9 tetap
`in_progress`; sesi ini menutup refinement lintas aplikasi sebagai evidence Phase 14.15 tanpa
melakukan deployment atau mengubah staging.

## 1. Objective dan Outcome

Objective sesi ini adalah menyatukan kembali kontrak visual 4M, menambahkan legend 4M pada login
Supplier dan TMMIN, serta menaikkan typography secara adaptif tanpa mengubah behavior auth, API,
database, routing, atau lifecycle Henkaten.

Outcome:

- shared 4M contract sekarang Man `#DC2626`, Machine `#2F6FED`, Material `#D97706`, dan Method
  `#16A34A`;
- `FourMIndicator`, badge, chart, form, feed, dashboard, Henkaten surface, dan showcase tetap
  mengonsumsi shared token; tidak ada kontrak warna kategori app-local;
- public `FourMLegend` merender Man, Machine, Material, Method dalam urutan tetap dengan dot,
  accessible category name, dan hanya huruf awal **M** yang bold;
- login Supplier dan TMMIN menampilkan legend di panel kiri setelah eyebrow; deskripsi Supplier
  dipertahankan, placeholder heading TMMIN dihapus, dan heading form menjadi semantic `h1`;
- typography token mempertahankan identifier lama dengan resolved scale 12, 13, 14, 15, 17, 19,
  22, 26, dan 32 px; literal CSS Supplier/TMMIN dinaikkan mengikuti mapping yang disetujui;
- layout desktop 1280×720 dan 1672×941 tetap stabil tanpa page-level horizontal overflow,
  clipping, overlap, atau action tersembunyi;
- halaman change-password tetap memakai compact layout yang sudah ada.

## 2. Files Changed

- `.agent/PRD.md`
- `.agent/implementationPhases.md`
- `.agent/sessionHandoff.md`
- `docs/adr/0021-shared-enterprise-design-system-and-public-showcase.md`
- `packages/ui/src/tokens.ts`
- `packages/ui/src/styles.css`
- `packages/ui/src/components/domain.tsx`
- `packages/ui/src/components/components.test.tsx`
- `packages/ui/src/token-contract.test.ts`
- `packages/ui/src/showcase/DesignSystemShowcase.tsx`
- `apps/supplier-web/src/pages/AuthPages.tsx`
- `apps/supplier-web/src/app.css`
- `apps/supplier-web/src/App.test.tsx`
- `apps/tmmin-web/src/pages/AuthPages.tsx`
- `apps/tmmin-web/src/app.css`
- `apps/tmmin-web/src/App.test.tsx`
- `apps/e2e/tests/onboarding.spec.ts`

Tidak ada Prisma schema, migration, OpenAPI, generated client, backend, atau production deployment
change.

## 3. Locked Decisions

- Urutan legend dikunci Man, Machine, Material, Method.
- Material menggunakan amber accessible `#D97706`; teks kategori selalu menyertai warna.
- Identifier typed token dan CSS custom property lama dipertahankan untuk kompatibilitas consumer.
- Indicator tint mengikuti semantic state: Man danger, Machine info, Material warning, Method
  success.
- Dot bersifat dekoratif; nama group/item membuat informasi 4M tidak bergantung pada warna.
- Pembesaran typography bersifat adaptive-light dan desktop-first; tablet/mobile tetap di luar
  scope.
- Tidak dibuat ADR baru. ADR 0021 yang sudah ada disinkronkan agar mapping historis tidak
  bertentangan.
- Phase 15.9 tetap `in_progress`; next subphase tetap 15.11 setelah staging deployment eksternal
  tersedia.

## 4. Visual Evidence

Browser QA dilakukan pada 1280×720 dan 1672×941 untuk:

- login Supplier dan login TMMIN;
- public `/design` typography dan 4M specimen;
- Supplier Overview, Assignment Board, Create/Detail Henkaten, Shift, dan Default Assignments;
- TMMIN Global Overview, Henkaten Explorer, governance, dan monitoring.

Playwright menyimpan auth artifacts pada ignored test output, termasuk:

- `test-results/e2e/onboarding-chromium-11623-3/.../supplier-login-1280x720.png`;
- `test-results/e2e/onboarding-chromium-11623-3/.../tmmin-login-1672x941.png`;
- `test-results/e2e/onboarding-msedge-11623-5/.../supplier-login-1672x941.png`;
- `test-results/e2e/onboarding-msedge-11623-5/.../tmmin-login-1280x720.png`.

Artifact tidak di-commit. Inspection membuktikan legend muat pada tinggi 720 px, dot mempunyai
computed RGB yang tepat, M berbobot 700 sementara sisa kata 400, keyboard flow tetap menuju form,
dan Axe melaporkan zero violation. Temuan awal Axe atas heading dan kontras eyebrow TMMIN diperbaiki
dengan semantic login `h1` dan orange-300 pada panel gelap, lalu seluruh E2E diulang sampai lulus.

## 5. QA Commands dan Results

Runtime parity memakai Node.js `22.23.1` dan pnpm `11.16.0` melalui wrapper
`npx -y node@22.23.1 /opt/homebrew/bin/pnpm`.

Semua gate berikut lulus:

- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`: 2 Node tests dan 130 Vitest tests;
- `pnpm openapi:check`;
- `pnpm build`, dengan existing non-blocking Vite large-chunk warning;
- `docker compose -f compose.yml -f compose.local.yml config`;
- `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:reset`, dan `pnpm db:migrate`: PostgreSQL
  18 + pgvector dan 9 migrations;
- `pnpm test:integration`: 33/33;
- `E2E_EDGE_EXECUTABLE_PATH=<temporary-edge> pnpm test:e2e`: Chromium 4/4 dan Edge 2/2;
- Gitleaks directory scan terhadap clean source copy: no leaks found;
- `git diff --check`.

Edge parity memakai official Microsoft Edge 151.0.4129.59 dari Homebrew cask cache yang diekstrak
ke temporary directory karena installer channel Playwright meminta privilege host. Temporary app
dipindahkan ke Trash setelah QA; tidak ada system-wide installation. Scan awal atas seluruh
workspace menemukan existing ignored `.local/.ssh` credential milik environment. Credential tidak
dibaca atau dimutasi; clean-source rerun mengecualikan `.git`, `.local`, dependency, build, dan test
artifact lalu melaporkan no leaks.

## 6. Cleanup

- Seluruh disposable PostgreSQL container, volume, dan network dari integration/E2E sudah dihapus
  oleh harness.
- Dua Vite server yang dimulai khusus visual QA dihentikan.
- Temporary Edge app dan clean-source scan copy dipindahkan ke Trash setelah QA selesai.
- Browser QA viewport di-reset dan tab sesi ditutup.
- Existing local full-stack Supplier/TMMIN/API yang sudah berjalan sebelum task tidak dimutasi atau
  dihentikan.
- Screenshot dan Playwright output tetap ignored dan tidak di-stage.

## 7. Residual Risk dan Next Action

- Vite tetap memberi existing large-chunk warning non-blocking.
- PostgreSQL integration/E2E tetap memberi existing `client.query()` pg@9 deprecation warning;
  seluruh test lulus.
- Existing local API container yang bukan milik sesi ini terdeteksi `unhealthy`; Supplier dan TMMIN
  web container tetap healthy. Sesi ini tidak merestart stack milik user.
- Mobile/tablet, staging VM, backup/PITR/DR, failover, RPO/RTO, dan production activation tetap di
  luar scope.
- Setelah commit, lakukan Gitleaks commit scan, push exact commit ke
  `origin/feat/typography-elements`, dan verifikasi remote SHA.
- Feature-branch push tidak memicu workflow repository saat ini. CI baru berjalan pada PR menuju
  `staging` atau push ke `staging`; next product action adalah membuka/menjalankan jalur tersebut,
  kemudian menyelesaikan external evidence Phase 15.9 dan rehearsal 15.11.

## 8. Follow-up — Assignment Board dan Henkaten Input Dots

Follow-up 2026-08-04 menyatukan representasi kategori pada dua surface operasional:

- public shared `FourMDot` ditambahkan dan memakai exact `--hds-4m-*` category tokens;
- Assignment Board mengganti pill singkatan Man/Mac/Mat/Met dengan dot pada target link 28 px;
- Open indicator mempertahankan ring visual tanpa mengubah link, identifier, status, realtime, atau
  Board read model;
- category input Henkaten mengganti ikon person/gear/package/wrench dengan dot merah, biru, amber,
  dan hijau; label radio tetap eksplisit dan selection check tetap tersedia;
- login legend memakai primitive dot yang sama sehingga seluruh dot 4M mempunyai satu owner.

Regression yang lulus:

- shared UI unit 19/19;
- Supplier unit 23/23;
- scoped UI/Supplier/E2E typecheck dan E2E lint;
- Hosted lifecycle Chromium dengan disposable PostgreSQL dan 9 migrations;
- exact computed colors, Board dot/link geometry, zero Axe violation, serta visual capture Board dan
  Create Henkaten pada 1280×720 dan 1672×941;
- formatting, scoped production build, Gitleaks diff scan, dan `git diff --check`.

Tidak ada perubahan API, database, migration, routing, auth, atau lifecycle Henkaten. Screenshot
tetap ignored dan disposable E2E infrastructure dibersihkan oleh harness.
