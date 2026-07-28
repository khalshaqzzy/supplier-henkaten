# Audit QA Seeded App — Supervisor dan Line Leader Henkaten

Tanggal audit: 2026-07-27

Branch: `staging`

Baseline commit: `2d09543da180dc449266ede48bca6d1f1d3d9562`

Status: **lulus setelah enam APP_DEFECT diperbaiki**

Audit ini merupakan lanjutan dari
[`seededAppQaAudit.md`](./seededAppQaAudit.md). Audit sebelumnya mencakup Supplier Admin dan TMMIN
Admin; dokumen ini menutup cakupan operasional Supervisor dan Line Leader, termasuk permintaan
tambahan untuk memeriksa seluruh profil Line Leader NPM khusus workflow Henkaten.

## 1. Ruang Lingkup dan Metode

Audit dimulai dari `pnpm local:reseed` dan membandingkan empat sumber bukti:

1. invariant database sebagai state authoritative;
2. respons API, status HTTP, version, idempotency, dan Problem Details;
3. UI pada Chromium 1280×720, termasuk deep-link, loading/error state, accessible name, serta
   horizontal overflow;
4. regression unit/component, PostgreSQL integration, dan browser E2E.

Setiap skenario mutatif Supervisor dan Line Leader GKI dipisahkan dengan reseed. NPM dipakai sebagai
coverage tenant kedua khusus Line Leader: LL1 untuk assignment issue/form, LL2 untuk partial
approval, dan LL3 untuk active Man reservation. QC hanya menjadi supporting actor pada regression
parallel approval. Kredensial hanya dibaca dari manifest lokal mode `0600` dan tidak dicetak.

Temuan diklasifikasikan sebagai:

- `SEED_DEFECT`: fixture atau invariant seed salah;
- `APP_DEFECT`: seed/API authoritative benar tetapi runtime, adapter, authorization, atau UI salah;
- `CONTRACT_DOC_MISMATCH`: implementasi konsisten tetapi tidak sesuai kontrak produk.

## 2. Baseline Seed

| Invariant | NPM | GKI | Total |
| --- | ---: | ---: | ---: |
| Supplier Hosted | 1 | 1 | 2 |
| Line aktif | 3 | 3 | 6 |
| Supervisor | 2 | 2 | 4 |
| Line Leader | 3 | 3 | 6 |
| Henkaten | 120 | 120 | 240 |
| Henkaten Open | 8 | 8 | 16 |
| Active Shift Run | 3 | 3 | 6 |
| Active Man reservation | 1 | 1 | 2 |
| Assignment issue line 1 | 1 | 1 | 2 |

Per supplier, Supervisor 1 menangani line 1 dan 3; Supervisor 2 menangani line 2. Setiap Line Leader
hanya menangani satu line. Fixture Open memuat pending paralel, partial approval, reject-fast,
warning, notification, audit, assignment issue, dan active Man reservation. Database, API, dan
manifest membuktikan fixture ini valid; tidak ditemukan seed defect.

## 3. Hasil Audit Supervisor

### 3.1 Scope dan read model

| Skenario | Hasil | Evidence |
| --- | --- | --- |
| Overview Supervisor multi-line | Lulus | Hanya GKI-L1/L3; Open 6 dan pending Supervisor 4 cocok dengan DB |
| Overview Supervisor single-line | Lulus | Hanya line yang ditugaskan |
| Assignment Board | Lulus setelah F-04/F-05 | Hanya line scope; reservation dan 4M dapat dibedakan |
| Henkaten list/detail/history | Lulus | Filter dan deep-link tetap line-scoped |
| Approval queue | Lulus | Empat row pending sama dengan query DB |
| Notification dan audit | Lulus | Seluruh record hanya berasal dari line scope |
| Deep-link line lain | Lulus | UI menampilkan out-of-scope state; API 404 |
| Cross-tenant deep-link | Lulus | Tidak ada identifier tenant lain yang bocor |
| Route tanpa capability | Lulus | Mutation yang tidak dimiliki tidak muncul dan backend tetap menolak |

### 3.2 Decision lifecycle

| Skenario | Hasil | State akhir |
| --- | --- | --- |
| Approve-first | Lulus | Henkaten tetap Open; Supervisor Approved, QC Pending |
| Approve-final | Lulus oleh E2E supporting QC | Henkaten Approved, warning ditutup, assignment diterapkan |
| Reject-fast | Lulus | Henkaten Rejected, route lain Not Required, warning Closed |
| Comment/evidence actor | Lulus | Decision dan audit menyimpan actor/waktu/comment |
| Exact idempotent retry | Lulus | HTTP 201 dan resource/version yang sama |
| Idempotency key dengan payload berbeda | Lulus | HTTP 409 `IDEMPOTENCY_CONFLICT` |
| Stale/correct version | Lulus | Optimistic concurrency ditegakkan |
| Immutable decision | Lulus | Route yang sudah terminal tidak dapat diputus ulang |
| Supervisor line lain | Lulus | HTTP 403 pada correct-version decision |
| Line Leader mengambil keputusan | Lulus | HTTP 403 |

Setelah setiap transition, status resource, approval route, warning, outbox/notification, audit
event, serta reservation/assignment dibandingkan dengan database. Tidak ditemukan divergensi
backend lifecycle.

## 4. Hasil Audit Line Leader GKI

### 4.1 Scope dan capability

- LL1 hanya melihat GKI-L1 pada overview, board, Shift, Henkaten, audit, dan notification. Board
  memperlihatkan vacancy/assignment issue seeded. Approval Queue tidak ada.
- LL2 hanya melihat GKI-L2 dan fixture partial approval.
- LL3 hanya melihat GKI-L3 dan active Open Man reservation.
- GET/mutation line lain menghasilkan 404; decision menghasilkan 403; tenant lain tidak bocor.
- Layout 1280×720 tidak mempunyai horizontal overflow.

### 4.2 Form dan lifecycle Henkaten

| Skenario | Hasil |
| --- | --- |
| Current active Shift context | Lulus setelah F-02 |
| Working assignment/target job | Lulus setelah F-03 |
| MAN/MACHINE/MATERIAL/METHOD options | Lulus |
| Part/job/checklist aktif terbaru | Lulus |
| Checklist belum lengkap/No | Submission terblokir sesuai kontrak |
| Idempotent submission | Lulus melalui API/E2E |
| Realtime board setelah create | Lulus |
| Withdraw | Lulus; status Cancelled dan route Not Required |
| Clone prefill | Lulus; source, shift, job, part, checklist benar |
| Clone submit | Lulus; `clonedFromHenkatenId` dan checklist snapshot tersimpan |
| Warning/reservation release | Lulus |
| Terminal immutability | Lulus |
| End Shift cancellation semantics | Lulus dalam Chromium lifecycle E2E |
| Blocked operation/line lain | Lulus |

Pada audit mutatif LL1, Withdraw menghasilkan `CANCELLED`; clone berikutnya menghasilkan resource
`OPEN` baru yang mempunyai hubungan sumber dan empat jawaban checklist immutable. API, database,
warning, route, audit, dan notification konsisten.

## 5. Hasil Tambahan Line Leader NPM

Audit NPM sengaja hanya menggunakan role Line Leader.

| Profil | Coverage | Hasil |
| --- | --- | --- |
| LINE LEADER NPM 1 | NPM-L1, assignment issue, form Henkaten | Hanya NPM-L1; Shift Pagi aktif, empat target job, part, MAN target/replacement, dan checklist tampil |
| LINE LEADER NPM 2 | NPM-L2, partial approval | Hanya NPM-L2; Material Open menampilkan Supervisor Approved/QC Pending dan route immutable |
| LINE LEADER NPM 3 | NPM-L3, Man reservation | Hanya NPM-L3; risk rail menampilkan `Reservation aktif` dan deep-link Henkaten |

LL NPM tidak melihat Approval Queue. Board LL1 mempunyai `clientWidth = scrollWidth = 1280`.
Deep-link LL NPM ke Henkaten GKI menampilkan state “record mungkin tidak tersedia atau di luar scope
line” tanpa identifier GKI. Tidak ditemukan defect yang khusus tenant NPM; empat defect UI/adapter
yang ditemukan bersifat lintas tenant dan diverifikasi ulang pada NPM.

## 6. Temuan, Akar Masalah, dan Perbaikan

### F-01 — Local stack mencetak portal origin yang ditolak API

- Severity: **Medium**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: jalankan reseed lalu buka URL Supplier/TMMIN yang dicetak command.
- Expected: URL laporan sama dengan canonical origin yang diizinkan API.
- Actual: command mencetak `127.0.0.1:5173/5174`, sedangkan CORS, cookie realm, dan manifest memakai
  `localhost`; login dari origin tercetak ditolak.
- Bukti seed: credential dan akun valid; login dari canonical `localhost` berhasil.
- Akar masalah: readiness endpoint dan browser portal origin disusun dalam array 127.0.0.1 yang
  sama.
- Pemilik: `scripts/local-stack.mjs`, `scripts/local-stack-plan.mjs`.
- Perbaikan: API readiness tetap loopback 127.0.0.1, tetapi kedua portal dilaporkan sebagai
  canonical `localhost`.
- Regression: `scripts/local-stack-plan.test.mjs`.
- Status: **fixed dan verified** pada reseed.

### F-02 — Current Shift form Henkaten dianggap tidak tersedia

- Severity: **Critical**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: login Line Leader dengan Shift aktif dan buka `/henkatens/new`.
- Expected: context Shift Run aktif tampil.
- Actual: UI menampilkan “Shift Run belum tersedia” meskipun endpoint mengembalikan 200.
- Bukti DB/API: Shift aktif dan respons detail, termasuk working assignments, valid.
- Akar masalah: API client memvalidasi respons detail memakai `shiftRunSchema`, bukan
  `shiftRunDetailSchema`; field detail ditolak strict parser.
- Pemilik: `packages/api-client/src/supplier.ts`.
- Perbaikan: `currentShift()` memakai detail schema nullable.
- Regression: `packages/api-client/src/supplier.test.ts` dan
  `apps/e2e/tests/hosted-lifecycle.spec.ts`.
- Status: **fixed dan verified** pada GKI serta NPM.

### F-03 — Target job form Henkaten selalu kosong

- Severity: **Critical**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: setelah Shift context tampil, buka target job Line Leader.
- Expected: job dari working assignment aktif tersedia.
- Actual: combobox hanya mempunyai placeholder walaupun endpoint 200 mengirim empat assignment.
- Bukti DB/API: `/working-assignments` mengembalikan `{ items: [...] }`.
- Akar masalah: API client mengharapkan array langsung dan tidak mengadaptasi collection envelope.
- Pemilik: `packages/api-client/src/supplier.ts`.
- Perbaikan: schema wire memvalidasi strict `{ items }` lalu mengubahnya menjadi array domain.
- Regression: `packages/api-client/src/supplier.test.ts` dan
  `apps/e2e/tests/hosted-lifecycle.spec.ts`.
- Status: **fixed dan verified**; LL GKI/NPM melihat empat job.

### F-04 — Active Man reservation dilaporkan stabil

- Severity: **High**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: buka board LL line 3 yang mempunyai Open MAN reservation seeded.
- Expected: risk rail memperlihatkan reservation aktif dan resource sumber.
- Actual: rail menyatakan “Assignment stabil” karena working assignment masih `ASSIGNED`.
- Bukti DB/API: `MPReservation.active = true`; board indicator MAN berstatus Open.
- Akar masalah: presenter React hanya menganggap state assignment
  `VACANT/CONFLICTED/RESERVED` sebagai risiko dan mengabaikan MAN Open indicator authoritative.
- Pemilik: `apps/supplier-web/src/pages/BoardPage.tsx`.
- Perbaikan: risk model menggabungkan state assignment dan MAN Open indicator, menampilkan
  identifier, serta menyediakan deep-link.
- Regression: `apps/supplier-web/src/pages/BoardPage.test.ts` dan
  `apps/e2e/tests/man-concurrency.spec.ts`.
- Status: **fixed dan verified** pada GKI-L3 dan NPM-L3.

### F-05 — Semua badge 4M board terlihat sebagai “M”

- Severity: **Medium**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: lihat job yang mempunyai MAN, MACHINE, MATERIAL, dan METHOD indicator.
- Expected: kategori dapat dibedakan secara visual dan oleh accessible name.
- Actual: seluruh badge memakai karakter pertama kategori, yaitu `M`.
- Bukti API: kategori lengkap tersedia dan benar.
- Akar masalah: label UI memakai `category[0]`.
- Pemilik: `apps/supplier-web/src/pages/BoardPage.tsx`, `apps/supplier-web/src/app.css`.
- Perbaikan: label visual `Man/Mac/Mat/Met`, full accessible name berisi category/status/identifier,
  dan ukuran badge disesuaikan tanpa overflow.
- Regression: `apps/supplier-web/src/pages/BoardPage.test.ts`.
- Status: **fixed dan verified**.

### F-06 — Active assignment issue tidak mempunyai jalur resolution yang discoverable

- Severity: **High**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: login LINE LEADER NPM 1 setelah seed, buka vacancy pada Board/Shift, lalu gunakan
  generic “Buat Henkaten”.
- Expected: vacancy mengarah ke resolution wizard yang membawa `shiftRunId`, `jobId`, dan
  `resolutionIssueId` authoritative.
- Actual: Board mengarah ke daftar Shift dan active Shift Detail tidak menampilkan CTA resolution.
  MAN biasa tanpa matching `resolutionIssueId` ditolak backend sebagai assignment conflict.
- Bukti seed/API: NPM-L1 mempunyai active Shift, Press Forming vacant, dan satu open
  `AssignmentIssue`; backend sengaja mewajibkan issue link agar issue tidak dapat ditutup palsu.
- Akar masalah: navigasi resolution hanya didesain untuk preflight `NOT_STARTED`, sedangkan
  cascade vacancy juga dapat muncul setelah Shift menjadi `ACTIVE`.
- Pemilik: `apps/supplier-web/src/pages/BoardPage.tsx`,
  `apps/supplier-web/src/pages/ShiftPages.tsx`.
- Perbaikan: setiap vacancy/conflict Board mengarah langsung ke Shift resolution; Shift Detail
  mengambil resolution context dan menampilkan CTA untuk open issue; hanya Line Leader mendapat
  aksi “Buat Man Henkaten”.
- Regression: `apps/supplier-web/src/pages/BoardPage.test.ts`,
  `apps/supplier-web/src/pages/ShiftPages.test.ts`, dan
  `apps/e2e/tests/man-concurrency.spec.ts`.
- Status: **fixed dan verified**; E2E membuktikan deep-link membawa ketiga identifier yang tepat.

## 7. Ringkasan Klasifikasi

| Klasifikasi | Jumlah | Kesimpulan |
| --- | ---: | --- |
| `SEED_DEFECT` | 0 | Fixture scope, approval, warning, reservation, issue, notification, audit, dan history valid |
| `APP_DEFECT` | 6 | 1 local runtime origin, 2 API-client mapping, dan 3 presentation/navigation |
| `CONTRACT_DOC_MISMATCH` | 0 | Public contract dan PRD tidak perlu diubah |

Tidak ada Prisma schema, migration, OpenAPI, public API, atau production fallback baru. Business rule
tetap di backend; React hanya mempresentasikan read model authoritative.

## 8. Regression dan Validation Evidence

| Gate | Hasil |
| --- | --- |
| Local stack planner | 2/2 Node test lulus |
| API client | 10/10 test lulus |
| Supplier web | 16/16 test lulus |
| Seluruh unit suite | 115 Vitest test + 2 Node test lulus |
| Format, ESLint, TypeScript | Lulus |
| OpenAPI/generated client drift | Lulus; tidak ada drift |
| Production build | Lulus dengan explicit `VITE_API_ORIGIN` |
| PostgreSQL integration serial | 33/33 lulus |
| Chromium E2E | 4/4 journey lulus |
| Edge E2E | 2/2 smoke journey lulus |
| Seed/reseed | Lulus dengan exact Node.js 22.23.1 container |
| Credential manifest | Mode `0600`; nilai tidak dicetak |

Host memakai Node.js 26.3.1 sehingga command agregat `pnpm validate` berhenti pada
`runtime:check`. Seluruh sub-gate dijalankan individual dan lulus; runtime Compose/reseed tetap
memakai exact Node.js 22.23.1. Warning Vite tentang chunk lebih dari 500 kB tetap non-blocking dan
tidak diperkenalkan perubahan ini.

## 9. Acceptance dan Risiko Residual

Acceptance terpenuhi:

- capability Supervisor dan Line Leader sesuai PRD;
- tidak ada cross-line atau cross-tenant leakage;
- DB, API, dan UI konsisten pada seluruh transition;
- keenam defect mempunyai regression test;
- GKI dan seluruh tiga profil Line Leader NPM telah diverifikasi;
- baseline dikembalikan melalui reseed dan runtime QA dihentikan setelah verifikasi.

Risiko residual non-blocking:

- isolasi database integration tetap serial karena lima file berbagi disposable test database;
- host Node.js berbeda dari runtime repository yang didukung;
- Vite masih melaporkan chunk besar;
- dialog konfirmasi browser automation dapat membatalkan POST jika handler dialog tidak dipasang;
  mutation authoritative telah diverifikasi melalui API dan E2E, sehingga ini bukan app defect.
