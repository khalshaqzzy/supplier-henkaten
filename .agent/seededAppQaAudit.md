# Audit QA Seeded App — Supplier Admin → TMMIN Admin

Tanggal audit: 2026-07-27

Branch: `feat/staging-deployment`

Baseline commit: `67cb4491eaad69af6242a6bb8a0fed7bb58ef8f2`

Status: **lulus dengan risiko residual non-blocking**

## 1. Tujuan dan Ruang Lingkup

Audit ini memverifikasi clean seeded runtime secara berurutan:

1. Supplier Admin pada supplier Hosted;
2. clean reseed;
3. TMMIN Admin pada dua supplier Hosted;
4. state External sementara yang dibuat lewat UI/API produksi, lalu dihapus lewat reseed.

Setiap anomali ditriangulasi pada database, API, dan UI sebelum diklasifikasikan sebagai:

- `SEED_DEFECT`: fixture atau invariant seed salah;
- `APP_DEFECT`: seed benar, tetapi API, authorization, logging, cache, atau UI salah;
- `CONTRACT_DOC_MISMATCH`: implementasi konsisten tetapi berbeda dari kontrak produk.

Audit tidak mencakup QA penuh role LL/QC. Role lain hanya dipakai bila diperlukan untuk membuktikan
state pendukung. Tidak ada kredensial, secret, atau nilai one-time credential yang disalin ke laporan.

## 2. Environment dan Baseline

| Area | Evidence |
| --- | --- |
| Host | macOS, timezone Asia/Jakarta |
| Host runtime | Node.js 26.3.1, pnpm 11.16.0 |
| Runtime repository | container development memakai Node.js 22.23.1 sesuai `packageManager`/`engines` |
| Database | PostgreSQL 18.4 dengan pgvector 0.8.5 |
| Browser | Chromium untuk audit interaktif dan empat E2E journey; Edge project untuk dua smoke journey |
| Viewport | 1280×720 dan desktop lebar |
| API baseline | `/health` dan `/ready` sehat |
| Seed command | `pnpm local:start:clean`, kemudian `pnpm local:reseed` |
| Credential manifest | ada, gitignored, mode `0600`; isi tidak dicetak |
| Working tree | perubahan `.DS_Store` milik pengguna sudah ada dan tidak disentuh |

Host Node.js 26 bukan runtime yang didukung repository. Seluruh build container yang menjadi bukti
runtime menggunakan exact Node.js 22.23.1. Quality gate host tetap lulus; perbedaan host dicatat
sebagai risiko workstation, bukan defect aplikasi.

## 3. Baseline Seed dan Invariant

Clean start dan reseed akhir menghasilkan state deterministik berikut:

| Invariant | NPM | GKI | Total |
| --- | ---: | ---: | ---: |
| Supplier Hosted | 1 | 1 | 2 |
| Line | 3 | 3 | 6 |
| Job | 12 | 12 | 24 |
| Member | 22 | 22 | 44 |
| Part | 8 | 8 | 16 |
| Shift Template | 3 | 3 | 6 |
| Henkaten | 120 | 120 | 240 |
| Warning aktif | 8 | 8 | 16 |
| Reservation aktif | 1 | 1 | 2 |

Distribusi Henkaten:

- NPM: OPEN 8, APPROVED 66, REJECTED 20, CANCELLED 26; MAN 36, MACHINE 34, MATERIAL
  27, METHOD 23.
- GKI: OPEN 8, APPROVED 58, REJECTED 29, CANCELLED 25; MAN 28, MACHINE 26, MATERIAL
  38, METHOD 28.

Kedua tenant mempunyai issue `OPEN`, `RESOLVED`, dan `CLOSED_SHIFT_ENDED`. Outbox tidak menyisakan
pesan pending atau failed. Foto member, warning, affected part, assignment, audit, dan histori
sekitar satu tahun tersedia. Angka database, respons API, Ringkasan/Overview, board, warning, dan
detail record konsisten setelah defect aplikasi di bawah diperbaiki.

`local:reseed` mempertahankan disposable test database, merotasi credential manifest, mengganti
state main database/foto, dan kembali memenuhi seluruh invariant. Seed awal tetap tepat dua Hosted;
tenant External tidak ditambahkan ke fixture.

## 4. Metode Audit

Untuk setiap workflow digunakan empat sumber bukti:

1. query database untuk invariant dan state authoritative;
2. request/response API, termasuk status HTTP dan Problem Details;
3. UI browser untuk route, capability, loading/error/empty state, deep-link, filter, dan layout;
4. automated regression pada lapisan terdekat dengan akar masalah.

Audit browser juga memeriksa console/page/network error, accessible name, focus/keyboard surface,
overflow, serta tampilan 1280×720 dan desktop lebar. Mutation negatif sengaja dilakukan pada data
yang direferensikan, duplicate/invalid input, dan tenant External sementara.

## 5. Matriks Route dan Capability

### 5.1 Supplier Admin

| Surface | Hasil | Catatan |
| --- | --- | --- |
| Login, session, account | Lulus | Tenant dan role terisolasi |
| Overview | Lulus | Angka open/warning/assignment konsisten |
| Setup | Lulus | Readiness dan navigasi sesuai capability |
| Assignment Board | Lulus setelah F-01 | Foto member berasal dari API origin |
| Henkaten list/detail | Lulus | Filter OPEN persisten di URL; 8/8 row berstatus Open |
| Shift list/detail | Lulus setelah F-03 | Lebih dari satu shift dapat dipresentasikan |
| Notifications dan Audit | Lulus | Deep-link dan state terbaca |
| Member/account/photo | Lulus setelah F-02 | Mutation gagal sekarang menampilkan Problem Details |
| Line/job, part, shift template | Lulus setelah F-02 | Referenced-data blocker terlihat |
| Checklist/version | Lulus setelah F-02 | Validation/conflict tidak lagi diam |
| Default assignment | Lulus | Board dan detail konsisten |
| Approval | Ditolak | Route `/approvals` menghasilkan forbidden |
| Create Henkaten | Ditolak | Route `/henkatens/new` menghasilkan forbidden |
| Hosted preparation | Ditolak | Route `/shifts/prepare` menghasilkan forbidden |
| LL/QC operations | Tidak terlihat | Capability tidak diberikan |

### 5.2 TMMIN Admin

| Surface | Hasil | Catatan |
| --- | --- | --- |
| Login dan account | Lulus | Session TMMIN terisolasi |
| Ringkasan Global | Lulus | Hosted 2, External 0 pada clean baseline |
| Warning/affected-part detail | Lulus | Detail part seeded dapat dibuka |
| Henkaten Explorer/Hosted detail | Lulus | Read-only, menampilkan source Hosted dan Epoch 1 |
| Supplier list/detail | Lulus | Lifecycle error terlihat setelah F-07 |
| Hosted master/shift/board support | Lulus setelah F-06 | Snapshot line/shift tampil |
| Notifications dan Audit | Lulus | Filter/deep-link bekerja |
| System status/external health | Lulus | Freshness dan empty state benar |
| Supplier administration | Lulus setelah F-07 | External sementara dibuat lewat UI |
| Admin replacement/reset | Lulus | Capability tersedia pada scope yang benar |
| Hosted Preparation | Lulus setelah F-07 | One-time credential tampil sekali; preparation dibatalkan |
| Source preflight/cutover | Lulus | Empty External tenant menghasilkan 12 blocker dan target Epoch 2 |
| External issue/rotate/revoke | Lulus setelah F-07 | Setelah revoke: status REVOKED, valid secret 0 |
| Approval | Tidak tersedia | Detail tidak mempunyai approve/reject |
| Operational mutation | Read-only | Boundary monitoring terjaga |

## 6. Temuan dan Perbaikan

### F-01 — Foto member pada Assignment Board gagal dimuat

- Severity: **Medium**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: login Supplier Admin, buka Assignment Board, periksa avatar member yang mempunyai
  foto.
- Expected: thumbnail dimuat dari API.
- Actual: URL relatif diselesaikan browser ke origin Vite `:5173`; gambar mempunyai natural width
  nol.
- Bukti DB: metadata foto dan blob seeded tersedia.
- Bukti API: endpoint thumbnail mengembalikan gambar ketika dipanggil pada API origin `:3000`.
- Bukti UI: `img.src` mengarah ke frontend origin sebelum perbaikan.
- Akar masalah: `BoardPage` memakai URL asset relatif tanpa normalisasi origin.
- Lapisan/file: `apps/supplier-web/src/app/api.ts`,
  `apps/supplier-web/src/pages/BoardPage.tsx`.
- Perbaikan: tambahkan helper `supplierAssetUrl()` dan gunakan untuk thumbnail.
- Regression: `apps/supplier-web/src/app/api.test.ts`.
- Status: **fixed dan verified**.

### F-02 — Error mutation master data Supplier ditelan

- Severity: **High**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: nonaktifkan part yang masih direferensikan Henkaten aktif, atau kirim mutation
  member/photo/job/checklist yang invalid.
- Expected: UI menampilkan Problem Details authoritative atau pesan aman.
- Actual: API mengembalikan 409/validation error, tetapi handler UI hanya menghentikan mutation tanpa
  feedback.
- Bukti DB: part tetap aktif dan referensinya valid.
- Bukti API: lifecycle request mengembalikan 409.
- Bukti UI: tidak ada alert/error sebelum perbaikan.
- Akar masalah: beberapa `catch` mutation master-data tidak menyimpan error ke state presentasi.
- Lapisan/file: `apps/supplier-web/src/pages/MasterDataPages.tsx`.
- Perbaikan: state error per workflow, ekstraksi Problem Details, fallback aman, dan error ukuran
  foto lebih dari 2 MB yang terlihat.
- Regression: `apps/supplier-web/src/pages/MasterDataPages.test.ts`.
- Status: **fixed dan verified**; blocker tampil sebagai “Perubahan lifecycle gagal”.

### F-03 — Shift list Supplier mengembalikan HTTP 500 jika terdapat lebih dari satu row

- Severity: **Critical**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: seed atau buat minimal dua shift plan, lalu `GET` shift list.
- Expected: seluruh shift dipresentasikan.
- Actual: row kedua memicu `.map is not a function`.
- Bukti DB: kedua shift plan valid.
- Bukti API: list mengembalikan 500 sebelum perbaikan.
- Bukti UI: halaman Shift menampilkan error.
- Akar masalah: `items.map(presenter)` meneruskan index sebagai argumen kedua ke
  `presentShift(row, workingAssignments?)`; index row kedua (`1`) diperlakukan sebagai array.
- Lapisan/file: `apps/api/src/shifts/shift.service.ts`.
- Perbaikan: presentasi eksplisit `items.map((item) => presenter(item))`.
- Regression: PostgreSQL integration di
  `apps/api/src/henkaten/operational.integration.spec.ts` membuat shift kedua dan memastikan list
  berisi dua item.
- Status: **fixed dan verified**.

### F-04 — Clean start/reseed dapat memakai frontend image yang stale

- Severity: **High**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: ubah frontend, jalankan `local:start:clean` atau reseed pada host yang sudah mempunyai
  image lama.
- Expected: runtime QA merepresentasikan working tree saat ini.
- Actual: API dibangun ulang, tetapi kedua frontend dijalankan tanpa `--build`.
- Bukti DB/API: seed baru dan API baru aktif.
- Bukti UI: bundle frontend dapat berasal dari image sebelumnya.
- Akar masalah: `startFrontends()` tidak menambahkan build flag.
- Lapisan/file: `scripts/local-stack.mjs`, `scripts/local-stack-plan.mjs`.
- Perbaikan: central helper Compose argument selalu menambahkan `--build` untuk API dan kedua
  frontend.
- Regression: `scripts/local-stack-plan.test.mjs`, dipanggil root `test:unit`.
- Status: **fixed dan verified** melalui clean build exact Node.js 22.23.1.

### F-05 — Request log API tidak memuat route template

- Severity: **Medium**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: panggil endpoint lalu inspeksi structured request completion log.
- Expected: method dan low-cardinality route template tersedia untuk diagnosis tanpa membocorkan
  query/path value.
- Actual: serializer request berjalan sebelum Express menyelesaikan route sehingga template tidak
  ada; diagnosis error F-03 menjadi tidak cukup informatif.
- Bukti API/log: request selesai tanpa route template sebelum perbaikan.
- Akar masalah: lifecycle logging lebih awal daripada route resolution.
- Lapisan/file: `apps/api/src/common/request-logging.ts`,
  `apps/api/src/common/request-route.interceptor.ts`, `apps/api/src/app.module.ts`.
- Perbaikan: interceptor setelah route resolution menulis field top-level `routeTemplate`; serializer
  request/response tetap membatasi data sensitif.
- Regression: `apps/api/src/common/request-logging.spec.ts`.
- Status: **fixed dan verified**; live `/ready` log memuat `routeTemplate: "/ready"` dan method GET.

### F-06 — Hosted Support Shift TMMIN menampilkan line/shift sebagai em dash

- Severity: **High**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: login TMMIN, buka Hosted Support, pilih supplier, buka Shift.
- Expected: nama line dan Shift Template dari snapshot tampil.
- Actual: row aktif menampilkan `—` untuk keduanya.
- Bukti DB: relasi line dan template seeded ada.
- Bukti API: shared contract mengirim snapshot nested `line.name` dan `shift.name`.
- Bukti UI: tabel meminta field flat `lineName` dan `shiftTemplateName` yang tidak ada.
- Akar masalah: ketidaksesuaian pemetaan UI terhadap shared nested contract.
- Lapisan/file: `apps/tmmin-web/src/pages/SupportPages.tsx`.
- Perbaikan: `ResourceTable` mendukung nested accessor dan label kolom yang sesuai.
- Regression: `apps/tmmin-web/src/pages/SupportPages.test.ts`.
- Status: **fixed dan verified**; “Press & Stamping” dan “Shift Pagi” tampil.

### F-07 — Error mutation administrasi TMMIN ditelan

- Severity: **High**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: buat tenant External kosong lalu coba aktivasi; ulangi pada lifecycle supplier,
  preparation/cancel, source governance, serta credential issue/rotate/revoke yang gagal.
- Expected: UI menampilkan Problem Details authoritative.
- Actual: API mengembalikan 409 tetapi UI tidak memberi feedback.
- Bukti DB: tenant tetap pada lifecycle yang benar.
- Bukti API: activation tenant kosong mengembalikan 409.
- Bukti UI: tidak ada error sebelum perbaikan.
- Akar masalah: mutation handler administrasi TMMIN menelan exception.
- Lapisan/file: `apps/tmmin-web/src/pages/AdminPages.tsx`.
- Perbaikan: error state dan Problem Details/fallback aman pada seluruh mutation terkait.
- Regression: `apps/tmmin-web/src/pages/AdminPages.test.ts`.
- Status: **fixed dan verified**.

## 7. Ringkasan Root Cause

| Klasifikasi | Jumlah | Kesimpulan |
| --- | ---: | --- |
| `SEED_DEFECT` | 0 | Planner, seeder, foto, histori, warning, issue, reservation, dan outbox memenuhi invariant |
| `APP_DEFECT` | 7 | 1 API presenter, 1 request observability, 1 local-runtime freshness, dan 4 frontend mapping/error defects |
| `CONTRACT_DOC_MISMATCH` | 0 | Tidak ditemukan perbedaan produk yang memerlukan perubahan PRD |

Tidak ada production fallback, credential tetap, schema migration, breaking API, atau pemindahan
business rule ke React. Seluruh fix ditempatkan pada lapisan pemilik masalah.

## 8. Validasi Akhir

| Gate | Hasil |
| --- | --- |
| Targeted Supplier frontend regression | Lulus, 12 test |
| Targeted TMMIN frontend regression | Lulus, 10 test |
| API unit regression | Lulus, 31 test |
| Shared contracts/client/fixtures/UI unit | Lulus |
| Seluruh Vitest unit suite | Lulus, 109 test |
| Local stack planner Node test | Lulus, 1 test |
| Format | Lulus |
| ESLint | Lulus |
| TypeScript | Lulus |
| OpenAPI/generated client drift | Lulus, tidak ada drift |
| Production build | Lulus dengan explicit production `VITE_API_ORIGIN` |
| PostgreSQL targeted integration | Lulus, 15/15 |
| PostgreSQL full integration serial | Lulus, 33/33 |
| Chromium E2E | Lulus, 4/4 journey |
| Edge smoke | Lulus, 2/2 journey |
| Gitleaks | Lulus, tidak ada leak |
| `git diff --check` | Lulus |
| `local:start:clean` | Lulus; API dan kedua frontend dibangun ulang |
| `local:reseed` | Lulus; credential berotasi, test database terjaga, manifest `0600` |

Satu eksekusi full integration paralel menghasilkan satu kegagalan transient pada notification count
karena lima file memakai disposable database yang sama. Reset lalu eksekusi serial lulus 33/33.
Kegagalan ini diklasifikasikan sebagai risiko isolation pada test harness, bukan defect seeded app.

## 9. Risiko Residual dan Rekomendasi

1. Full integration sebaiknya mengisolasi database per file/worker atau tetap dijalankan serial agar
   tidak terjadi kontaminasi lintas file.
2. Host developer sebaiknya memakai Node.js 22.23.1 agar sama dengan engine repository; container
   saat ini sudah mengunci versi tersebut.
3. Build Vite masih memberi warning ukuran chunk besar. Ini tidak menghambat workflow, tetapi dapat
   ditangani dengan route-level code splitting pada phase optimasi.
4. Pertahankan regression test untuk setiap Problem Details mutation baru; jangan menambahkan
   `catch` kosong pada UI.
5. Pertahankan urutan seeded QA Supplier → reseed → TMMIN dan larangan menambah tenant External ke
   fixture awal hanya demi audit.

## 10. Kesimpulan

Seeded app memenuhi invariant yang dijanjikan. Seluruh tujuh malfunction yang ditemukan berasal dari
aplikasi atau tooling runtime lokal, bukan seeding, dan telah diperbaiki pada lapisan pemiliknya
dengan regression test. Supplier Admin dan TMMIN Admin sekarang menyelesaikan route dan capability
yang diaudit tanpa blocking console/network error, authorization leak, atau inconsistency DB/API/UI.
