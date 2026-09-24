# Rencana QA end to end lokal berbasis browser

- Status: **rencana, belum dieksekusi**
- Tanggal: 2026-09-24
- Baseline yang dianalisis: `feat/qa-verif` pada `7ed8d8a` (`origin/staging` pada saat analisis)
- Surface: Supplier `http://localhost:5173`, TMMIN `http://localhost:5174`, API `http://localhost:3000`

## 1. Tujuan, batas, dan sumber kebenaran

Verifikasi seluruh fungsi aplikasi yang berlaku saat ini dari perspektif Supplier Admin, Supervisor, Line Leader, QC, TMMIN Admin, dan TMMIN Quality. Browser use melalui Playwright adalah jalur utama untuk kedua portal; Chromium menjalankan cakupan lengkap dan Edge menjalankan smoke kritis bila binary tersedia. Browser interaktif lain, termasuk Safari, boleh dipakai untuk inspeksi tambahan. Endpoint tanpa UI, khususnya External API, diperiksa melalui klien HTTP terhadap runtime yang sama; responsnya dicocokkan dengan tampilan browser. MP diverifikasi sebagai master member/assignment, karena tidak mempunyai login.

Urutan interpretasi: amendment Line–Shift pada awal PRD, amendment PCR pada akhir PRD, ADR 0033/0034, lalu kontrak dan source code berjalan. Klausul PRD lama tentang Shift Run operasional, preflight/Start/End/Emergency Start, MP reservation/exclusivity, donor vacancy/cascade, dan Assignment Issue akibat perpindahan MP **superseded**; jangan memberi status gagal karena alur lama tidak ada. Entitas/snapshot Shift Run historis dan halaman detail Shift TMMIN tetap diuji sebagai baca saja. Matriks permission PRD lama yang bertentangan harus diberi catatan `CONTRACT_DOC_MISMATCH`, bukan dipakai sebagai oracle tunggal. Angka seed yang pernah ditulis audit Juli 2026 untuk reservation/issue juga tidak berlaku sebagai ekspektasi sekarang.

QA ini mengamati dan melaporkan defect; **tidak memperbaiki bug, mengubah source code, memperbarui kontrak produk, atau menerapkan workaround yang menyamarkan hasil**. Mutasi data hanya dilakukan sebagai langkah pengujian pada database lokal yang dapat direseed. Produksi/staging, benchmark resmi, penilaian klinis/quality terhadap model PCR, dan UAT perangkat nyata berada di luar klaim QA lokal ini.

## 2. Inventaris fungsi dan jalur sumber

| ID | Fungsi yang harus diverifikasi | Surface/role | Sumber implementasi utama |
| --- | --- | --- | --- |
| I-01 | Login dua realm, Supplier Code, session, forced password change, logout, akun sendiri, invalid login/lockout, CSRF/origin | Kedua portal; semua akun | `apps/*-web/src/pages/AuthPages.tsx`, `apps/api/src/auth/` |
| I-02 | RBAC, scope tenant/line, deep link, active/inactive, HOSTED_PREPARATION, satu role per akun, MP tanpa credential | Semua role | `apps/api/src/common/policy.ts`, `apps/*-web/src/App.tsx` |
| I-03 | Supplier registry: create HOSTED/EXTERNAL, edit, activate/deactivate, filter/sort, timezone, Supplier Admin replace/reset | TMMIN Admin; Quality baca | `apps/tmmin-web/src/pages/AdminPages.tsx`, `apps/api/src/administration/` |
| I-04 | Quality user create, deactivate/reactivate, reset password dan one-time credential | TMMIN Admin | `AdminPages.tsx`, `administration.controller.ts` |
| I-05 | Source governance: preflight, Hosted preparation/cancel, cutover, epoch, revokasi session/source, riwayat | TMMIN Admin; Quality baca | `AdminPages.tsx`, `source-governance.service.ts` |
| I-06 | External client issue/rotate/revoke, IP allowlist, token, single/batch ingest, status, idempotency, ordering, PII, rate limits | TMMIN Admin + HTTP client; Quality monitoring | `external.controller.ts`, `external.service.ts`, `AdminPages.tsx` |
| I-07 | Supplier setup/readiness dan persiapan Hosted | Supplier Admin | `SetupPage.tsx`, `hosted-readiness.service.ts` |
| I-08 | Member, account, photo upload/remove/fallback, active state, line/job/part/shift template CRUD, ordering, referenced-data protection | Supplier Admin; read scope lain | `MasterDataPages.tsx`, `master-data.controller.ts` |
| I-09 | Checklist 4M draft/publish/version/activate/deactivate dan snapshot saat submit | Supplier Admin; LL submit | `MasterDataPages.tsx`, `checklist.service.ts` |
| I-10 | Tanoko matrix, search/filter/paging, level 1–4/unassessed, history/audit, edit oleh Admin/GL, eligibility level >=3 | Supplier Admin/GL edit; role lain baca | `TanokoPage.tsx`, `tanoko.controller.ts` |
| I-11 | Line Setup per Line–Shift: create/copy, assign Supervisor/LL/MP per job, activate/deactivate, no overlap, cross-midnight, version conflict | Supplier Admin | `DefaultAssignmentsPage.tsx`, `line-shift.service.ts` |
| I-12 | Clock-derived current/next occurrence, board default/override per occurrence, shared MP allowed, recurrence resets default | Supplier semua role sesuai scope | `BoardPage.tsx`, `read-model.service.ts`, `henkaten.service.ts` |
| I-13 | Board default dan Canvas: line selection, job/MP portrait, initials, 4M/open outline/+N, pan/zoom/fit/fullscreen, edit/save/reset/reconcile, dirty/conflict, responsive | Admin/LL edit Canvas; lainnya baca | `BoardPage.tsx`, `BoardCanvas.tsx`, `board-layout.service.ts` |
| I-14 | Supplier overview: KPIs, filters, trend, rankings, approval aging, recent activity, last update, deep links | Supplier role scoped | `OverviewPage.tsx`, `read-model.service.ts` |
| I-15 | Henkaten list/search/filter/cursor/PCR tab, create/clone empat kategori, part search, before/after, all-Yes checklist, idempotency, validation | LL submit; role lain baca | `HenkatenCreatePage.tsx`, `HenkatenPages.tsx`, `henkaten.service.ts` |
| I-16 | Man replacement langsung, Tanoko gate, duplicate MP, reject/withdraw restore prior effective/default, next occurrence default | LL; Supervisor/QC decisions | `henkaten.service.ts`, `man-movement.service.ts` |
| I-17 | Dua jalur approval paralel, route owner, QC first-lock, reject-fast, final Approved, reroute Supervisor oleh Admin, stale/double decision, terminal immutability | Supervisor, QC, Admin reroute | `HenkatenPages.tsx`, `approval.service.ts` |
| I-18 | Withdraw + Clone, hubungan asal, detail/history/audit, Open warning dan closure | LL withdraw; semua reader scoped | `HenkatenPages.tsx`, `henkaten.service.ts` |
| I-19 | PCR Pending/PCR/No-PCR/Review, wait page reload resume, priority order, notification, assessment current, manual correction version+reason, audit | Supplier baca; TMMIN Admin/Quality koreksi | `PcrWaitPage.tsx`, `MonitoringPages.tsx`, `pcr.service.ts` |
| I-20 | Notification center, unread/read toggle, badge, deep link, transactional outbox, realtime/stale fallback | Kedua portal | `ActivityPages.tsx`, `MonitoringPages.tsx`, `notification.service.ts`, `realtime.service.ts` |
| I-21 | Supplier PWA manifest/worker/update/offline fallback/network-only data, push opt-in/gate/session-device revocation | Supplier | `app/pwa.tsx`, `app/push.tsx`, `sw.ts`, `push/` |
| I-22 | TMMIN overview/trends/freshness, warnings per part, Hosted/External Henkaten explorer/detail, PCR tab, External health, notifications, audit/system status | TMMIN Admin/Quality | `MonitoringPages.tsx`, `read-model.controller.ts` |
| I-23 | Hosted support master data/board/historical shift read-only; foto/tenant scope | TMMIN Admin/Quality | `SupportPages.tsx`, `tmmin-master-data.controller.ts`, `shift.controller.ts` |
| I-24 | Accessibility, responsive, loading/empty/error/stale, private cache/PII, health/readiness | Kedua portal/API | PRD §22/24/26/32, route/state pages, API headers |

## 3. Fixture, prasyarat, dan bukti dasar

1. Catat SHA, branch, `git status --short`, tanggal/waktu/zona host, browser/versi dan OS, Node/pnpm, Docker, konfigurasi port, dan apakah ada data lokal yang akan diganti. Jangan mengira data main database kosong; `local:reseed` memang menghapus main database dan volume foto lokal. Jika data lokal perlu dipertahankan, arsipkan di luar alur QA sebelum reseed. Jangan menggunakan database staging/production.
2. Pastikan `.env` lokal, Docker Compose, browser Playwright, dan port loopback tersedia. Jalankan `pnpm local:reseed` dari root; bila volume awal belum ada, `pnpm local:start:clean` hanya pada stack lokal yang terkonfirmasi. Jalankan `pnpm local:wait`, `GET /health`, `GET /ready`, dan periksa `docker compose --profile fullstack ps` serta error log API. Jangan mencetak password/token pada log, screenshot, atau laporan.
3. Baca credential terbaru hanya dari `.local/seed-credentials.json` (gitignored, mode `0600`). Setiap reseed merotasi semua password; tutup browser context lama dan gunakan credential epoch terbaru. Buat context Playwright terpisah untuk tiap aktor/tenant agar cookie, cache, dan CSRF tidak tercampur.
4. Catat baseline sebelum mutasi: tepat 2 supplier Hosted (NPM dan GKI), 120 Henkaten per supplier/240 total, 16 Open warning, 18 Line–Shift, 72 assignment, 6 Canvas layout, dan 0 outbox pending sebagaimana handoff terkini. Seed PCR ditargetkan 6 PCR, 230 No-PCR, 4 Review; periksa angka aktual via API/DB karena laporan handoff tidak menggantikan observasi. Baseline tidak mengandung supplier External. Jangan mengharapkan reservation/donor vacancy dari model lama.
5. Buat ledger evidence per skenario: ID, SHA, epoch/reseed nomor, actor/tenant, URL, input sintetis nonrahasia, langkah, expected, actual, status, waktu, screenshot/trace/video Playwright yang disensor, request ID/correlation ID dan respons API yang disensor, serta perubahan DB/read model bila relevan. Capture state sebelum dan sesudah untuk mutation. Rekam console error, page error, dan failed network request; bedakan kegagalan app dari koneksi lingkungan.
6. Jalankan suite browser yang sudah ada dengan `pnpm test:e2e:chromium`, kemudian `pnpm test:e2e:edge` jika Edge tersedia. Suite itu memakai database disposable tersendiri; hasilnya adalah regression evidence, bukan pengganti inspeksi runtime `local:reseed`. Untuk setiap epoch seed, jalankan skenario browser via Playwright pada kedua URL loopback dengan context per role dan artefak evidence. Script eksplorasi sementara boleh dipakai tanpa mengubah source produk; cantumkan langkah manual yang tidak dapat diautomasi. Untuk skenario waktu, ukur berdasarkan `Asia/Jakarta` dan buat Shift Template/Line–Shift yang mencakup saat uji dan yang mulai kemudian; jangan mengubah jam sistem. Untuk API-only, gunakan Playwright request/`curl`, lalu periksa proyeksi di browser.

## 4. Urutan epoch agar hasil dapat diulang

| Epoch | Kondisi awal dan langkah | Tujuan/akhir |
| --- | --- | --- |
| E0 Baseline | Reseed; ukur invariant; login semua role satu per satu; **read-only smoke** dua portal | Memastikan seed/runtime dan scope; simpan baseline UI/API/DB |
| E1 Administrasi | Reseed; TMMIN Admin buat tenant Hosted dan akun Quality; Supplier Admin onboarding, master data, Tanoko, Line Setup | Jalur provisioning dari kosong; data percobaan terisolasi dari baseline NPM/GKI |
| E2 Hosted workflow | Reseed; gunakan NPM/GKI untuk LL submit, Supervisor/QC decision, Man/4M, board, notification, PCR seeded; tambah fixture khusus jika dibutuhkan | Uji state dan lintas role; satu record per cabang terminal/negative; hindari mengonsumsi record seed yang sama berulang |
| E3 Source/External | Reseed; buat tenant External terpisah lewat TMMIN; client/token/ingest; Hosted↔External governance pada tenant percobaan | Uji API dan tampilan TMMIN tanpa mencemari baseline dua Hosted |
| E4 Resilience | Reseed atau gunakan tenant percobaan; pengujian logout/session, version conflict, offline/error, PWA/push yang mungkin diuji lokal | Pisahkan kegagalan dari efek mutation E2/E3 |
| E5 Restore | Reseed akhir; ulangi invariant E0 dan smoke login/health | Baseline bersih dua Hosted/240 record, credential terbaru, tidak ada test tenant External |

Setiap epoch diberi kode dan manifest identitas fixture. Jika reseed gagal, berhenti; catat `BLOCKED_ENV` dan jangan lanjut dengan data campuran. Jangan memakai `local:destroy` untuk reset rutin karena menghapus volume database dan foto seluruhnya. Akhiri runtime yang dimulai untuk QA dengan `pnpm local:down` setelah evidence selesai, kecuali ada instruksi eksplisit untuk membiarkannya hidup; perintah ini mempertahankan volume seeded terakhir.

## 5. Matriks eksekusi fungsional

Setiap baris harus dinilai `PASS`, `FAIL`, `BLOCKED`, atau `NOT_APPLICABLE` dengan evidence terikat ID. Untuk peran tanpa write permission, periksa **dua hal**: control UI tersembunyi/disabled dan endpoint/deep link ditolak tanpa kebocoran data. Cek di dua supplier untuk isolasi, dan satu line di luar scope actor untuk scope line.

### 5.1 Identitas, security, dan izin (A)

| ID | Langkah inti di browser / API pendamping | Oracle |
| --- | --- | --- |
| A-01 | Login TMMIN Admin/Quality dan Supplier Admin/Supervisor/LL/QC; refresh, buka tab baru, logout, Back/deep link | Realm dan session benar; tidak ada akses setelah logout; kedua cookie realm dapat coexist tanpa saling menimpa |
| A-02 | Akun baru/direset: temporary password, forced change, password salah/ulang, credential sekali tampil | Harus change dahulu; session lama revoked pada reset; password tidak muncul lagi di list/log |
| A-03 | Salah supplier code, username/password, akun nonaktif, lockout/throttle | Error aman dan konsisten; tidak ada informasi tenant/akun sensitif |
| A-04 | URL semua route yang tidak berizin serta request langsung sebagai role lain, line lain, tenant lain, source mode lain | 403/404/401 yang sesuai; tidak ada mutation atau data bocor |
| A-05 | Kirim mutation tanpa CSRF, origin salah, stale `expectedVersion`, duplicate idempotency key | Ditolak; retry identik tidak menggandakan state |
| A-06 | Foto API dan URL member tenant lain; browser cache/session pada pergantian akun | Hanya scope berizin; tidak menampilkan foto/data pengguna sebelumnya |

### 5.2 TMMIN Admin dan Quality (T)

| ID | Langkah inti | Oracle |
| --- | --- | --- |
| T-01 | Registry search/status/source/sort/pagination; buat Hosted dan External dengan validasi code/timezone | Identitas unik, mode benar, create Hosted menghasilkan temporary Supplier Admin credential; Quality baca saja |
| T-02 | Edit, deactivate/reactivate supplier; replace/reset Supplier Admin; login credential baru/lama | Version/confirmation benar, account/session lama dicabut, tenant state tercermin di portal |
| T-03 | Buat/nonaktifkan/aktifkan/reset Quality; login Quality; cek halaman/aksi terlarang | Credential sekali tampil; Quality hanya monitoring dan PCR correction |
| T-04 | Source summary, preflight belum siap/siap, mulai/batal Hosted preparation, setup pada preparation, cutover dua arah, riwayat epoch | Satu sumber aktif; persiapan hanya membuka area setup; cutover mencabut akses/credential lama sesuai kontrak; Quality tidak mutasi |
| T-05 | Issue/rotate/revoke External client, IP allowlist, one-time secret, stale version | Secret lama tidak berlaku setelah rotasi/revoke; list tidak menampilkan secret |
| T-06 | Global dashboard: range/granularity/filter supplier/source/status/4M/line/part; KPI, trend, ranking, freshness dan last updated | Angka cocok dengan API/DB epoch; filter dan URL stabil; Hosted/External terpisah lalu agregat benar |
| T-07 | Active warnings per affected part, drill-down record, closure setelah terminal, dua Open untuk part sama | Warning tetap aktif selama masih satu Open; hitungan berubah setelah keduanya terminal |
| T-08 | Henkaten Explorer All/PCR/Review, Open-first PCR ordering, filter/cursor, Hosted dan External detail/approval/evidence | Data dan sumber jelas; no cross-record confusion; TMMIN tidak bisa approve/withdraw Hosted |
| T-09 | PCR correction oleh Admin dan Quality pada Open/Closed, first manual decision `expectedVersion: 0`, reason wajib, stale version/race | Keputusan UI terbarui; original AI tetap di audit; notifikasi sesuai scope; invalid/stale ditolak |
| T-10 | External health: accepted/duplicate/rejected, client/source freshness, ingestion detail | Angka dan status cocok respons ingest/API; stale/no-data jelas |
| T-11 | Hosted support master data, photo, board, layout dan shift historis; audit, notification read/unread, system status | Semua read-only; Quality tidak melihat credential/admin detail privileged; status sistem cocok `/health`/`/ready` |

### 5.3 Supplier Admin dan master data (S)

| ID | Langkah inti | Oracle |
| --- | --- | --- |
| S-01 | Setup readiness sebelum/sesudah master data lengkap; preparation vs operational | Blocker/next action akurat; operasi diblokir sampai cutover saat preparation |
| S-02 | Member Supervisor/LL/QC/MP: create/edit/deactivate/reactivate/remove, account activate/deactivate/reset, duplicate registration/username, referenced data | Validasi dan version benar; MP tidak mendapat login; referenced entity tidak hard-delete |
| S-03 | Upload foto valid, format/ukuran tidak valid, remove, thumbnail/full, initials fallback, refresh Board/Canvas | Image private WebP dan akses scoped; tampilan memperbarui tanpa broken image |
| S-04 | Line/job/part/shift template create/edit/activate/deactivate/reorder/remove; duplicate & referenced constraints; cross-midnight | List/detail/selector konsisten; data deactivated tidak dipilih untuk input baru |
| S-05 | Checklist tiap 4M: edit draft, publish, version history, activate/deactivate; submit lalu ubah checklist | Record lama mempertahankan snapshot; LL wajib semua Yes dan versi aktif |
| S-06 | Tanoko: search/filter/sort, sticky axes, inspector, level 1–4/unassessed, history dan audit; Admin/GL edit, LL/QC read | Mapping tersimpan/versioned; level <3 dan unassessed tidak eligible untuk Man/default MP; >=3 eligible |
| S-07 | Line Setup: tambah shift, copy assignment, ubah Supervisor/LL/MP per job, activate/deactivate, konflik overlap/time/version, duplikasi MP | Hanya Admin bisa edit; overlap aktif ditolak; MP sama dapat dipilih pada beberapa job; next occurrence memakai default baru |
| S-08 | Default assignment legacy read/redirect dan Admin reroute Supervisor pada Henkaten Open | Redirect ke Line Setup; reroute audit/notification dan owner approval sesuai hasil API |

### 5.4 Hosted LL, Supervisor, QC dan board (H)

| ID | Langkah inti | Oracle |
| --- | --- | --- |
| H-01 | Login masing-masing role; Overview/Board/Henkaten/Audit/notification sesuai tenant/line; QC tenant-wide, Supervisor assigned line, LL own line | Navigation, list, counts, detail, deep link dan API scope identik |
| H-02 | Board default per line dan Canvas pada 390×844, 768×1024, 1024×768, 1280×720, wide; portrait, vacancy, indikator 4M termasuk Open outline dan `+N` | Semua job/MP/status terbaca; tidak clipped/overflow dokumen; non-color cue dan accessible name ada |
| H-03 | Canvas zoom in/out, wheel/pan, auto-fit, fullscreen enter/exit/resize, line switch; Admin/LL edit node/text/machine, save/reload, dirty cancel, reset, version conflict, new-job reconcile | Camera/layout stabil; perubahan tersimpan hanya bila save; reader tidak dapat edit; Board default tetap lengkap |
| H-04 | Buat MACHINE, MATERIAL, METHOD saat current shift dan di luar jadwal; part search number/name, before/after, cause/detail, checklist No/missing, double submit | Shift otomatis saat current, pilihan LL di luar jadwal dan berlaku pada next start; validasi jelas; satu record per intent |
| H-05 | Buat MAN pada current occurrence; replacement inactive/level 0–2 vs 3–4, MP sama di dua job, current board sebelum approval | Hanya active qualified MP diterima; replacement langsung terlihat di occurrence; duplikasi MP tidak diblokir |
| H-06 | Submit Man di luar jadwal; lihat effective start berikutnya, refresh tepat sebelum/sesudah batas jadwal dan recurrence berikutnya | Tidak berlaku sebelum start berikutnya; occurrence baru kembali ke default; jangan ubah jam host |
| H-07 | Supervisor approve lalu QC approve; QC approve dulu lalu Supervisor; QC first-lock; reject dari masing-masing route; comment/history | Final Approved hanya setelah dua approve; reject pertama terminal; actor/time/comment dan version akurat |
| H-08 | Stale/double/unauthorized decision, terminal edit/withdraw, Admin approval attempt | Tidak overwrite; error conflict dan refresh benar; role salah ditolak |
| H-09 | LL withdraw Open Man/non-Man, clone dengan prefill, clone asal, restore assignment setelah reject/withdraw dengan lebih dari satu effective override | Original terminal dan audit tetap; clone record baru; latest other effective override/default dipulihkan |
| H-10 | Henkaten list All/PCR, approval queue, filters/category/date/line/part/status, paging, detail evidence/checklist/history | Prioritas Open PCR benar; cursor stabil; scope role konsisten dan record tidak hilang |
| H-11 | Open warning → notification/outbox/realtime pada Supplier/TMMIN; read/unread, deep links, offline/reconnect/stale | Badge dan counts sinkron; notifikasi tidak mengganti workflow; link menguji auth/scope kembali |
| H-12 | PCR seeded Open/Closed untuk PCR, No-PCR, Review, manual correction; submit baru → assessment wait → reload | Status PCR independen dari lifecycle; assessment hanya bila current; wait resume. Tanpa kredensial inferensi, live submit boleh menuju Review, bukan otomatis No-PCR |

### 5.5 External API dan observasi browser (X)

| ID | Langkah HTTP yang dijalankan pada tenant percobaan | Oracle di respons/API dan browser TMMIN |
| --- | --- | --- |
| X-01 | Token valid/invalid/rotated/revoked, tenant-source epoch dan IP allowlist | Hanya current client mendapat token yang berlaku; status 401/403/429 sesuai kasus |
| X-02 | Single Open; identical replay; same event ID changed payload; source version gap/out-of-order; invalid transition/PII | 202 accepted, 200 duplicate, 409 conflict, 422 invalid; tidak ada duplicate projection/warning |
| X-03 | Batch valid dan campuran invalid; ingestion status per event; reject reason | Semantik per item sesuai kontrak; accepted/rejected totals dan audit konsisten |
| X-04 | Open→Approved, Open→Rejected, Open→Cancelled; status-only vs changed evidence | Warning buka/tutup benar; PCR tetap saat status-only dan requeue hanya bila evidence berubah |
| X-05 | Source cutover setelah ingest; token lama, data historis, source epoch, dashboard/Explorer/External health | Token epoch lama gagal, riwayat tetap baca, proyeksi source saat ini tidak tercampur |

### 5.6 Nonfungsional yang teramati lokal (N)

| ID | Pemeriksaan | Batas klaim |
| --- | --- |
| N-01 | Keyboard tab order, visible focus, label/error association, dialog trap/restore, skip link, status non-color, zoom teks, kontras spot-check; jalankan Axe pada critical paths | Axe dan keyboard browser tidak menggantikan screen reader/device pass |
| N-02 | Viewport supplier PRD 390×844, 768×1024, 1024×768, 1280×720, wide; TMMIN desktop dan sempit; portrait/landscape, no document overflow, action reachable | Emulasi viewport browser tidak membuktikan perilaku iPhone Home Screen |
| N-03 | Loading, empty, 403/404, retryable API error, stale/conflict, last-updated; offline navigation fallback dan no cached protected data setelah logout/switch user | Gunakan gangguan lokal terkontrol; pulihkan API/network sebelum skenario berikutnya |
| N-04 | Manifest/service worker/update prompt, API/photo/session network-only, push permission only after gesture, optional roles vs LL gate, subscribe/revoke bila konfigurasi lokal mendukung | Seed mematikan push selama provisioning dan runtime mungkin tidak punya VAPID; jika disabled, catat `BLOCKED_CONFIG`, bukan PASS. iOS/iPadOS Home Screen push perlu device UAT terpisah |
| N-05 | API health/readiness, server errors/outbox lag, audit coverage, photo/credential cache headers, baseline response latency kasar | Bukan bukti target performance/load, security scan, HA, backup/recovery, atau staging deploy |

## 6. Cross-check, klasifikasi, dan aturan keputusan

- Untuk setiap alur stateful, bandingkan empat lapisan: UI browser, respons API/status/version, PostgreSQL/read model yang berwenang, dan audit/notification. Gunakan query baca saja terhadap DB bila UI/API tidak memperlihatkan invariant. Catat perbedaan angka/waktu setelah outbox settle; jangan menebak eventual consistency sebagai bug sebelum timeout yang ditentukan dicatat.
- `PASS` memerlukan hasil expected dan bukti cukup. `FAIL` bila reproducible mismatch; `BLOCKED` bila environment/credential/device/fixture menghalangi; `NOT_APPLICABLE` bila benar-benar di luar surface/role. Jangan menandai item yang hanya dicek sekilas sebagai PASS.
- Klasifikasi temuan: `APP_DEFECT`, `SEED_DEFECT`, `CONTRACT_DOC_MISMATCH`, `ENVIRONMENT_BLOCKER`, `PRODUCT_RISK`. Severity `Critical/High/Medium/Low` berdasar dampak business, security, data integrity, dan reproducibility. Setiap temuan memuat steps, expected/actual, scope, screenshot/response tanpa secret, first seen SHA/epoch, dan owner area. **Tidak ada fixing bug dalam QA ini.**
- Ketika PRD lama bertentangan dengan amendment, catat klausul lama dan amendment penentu. Ketika code/PRD terbaru bertentangan, catat mismatch sebagai temuan terbuka. Jangan ubah PRD untuk meluluskan implementasi.
- Tahan klaim `complete` bila ada ID tanpa status/evidence. `PASS WITH OPEN FINDINGS` hanya bila seluruh skenario terjalankan dan temuan didaftar; `INCOMPLETE/BLOCKED` bila ada cakupan tak terlaksana. Chromium/Edge desktop dan viewport emulation tidak memenuhi acceptance Android/iOS Home Screen PRD.

## 7. Deliverable akhir setelah seluruh verifikasi

**Setelah seluruh QA verification selesai, buat laporan lengkap dalam Markdown** di `docs/audits/` yang memuat: objective/scope/baseline SHA; browser/versi dan environment/perintah reseed; seed invariant awal/akhir; matriks semua ID dan status/evidence; hasil per role serta kedua surface; alur Hosted dan External; hasil negatif RBAC/security; responsif/accessibility/PWA/push beserta batas emulasi browser; rekonsiliasi UI–API–DB–audit; seluruh defect dan blocker tanpa fix; perbedaan PRD/source; risiko tersisa; ringkasan pass/fail/blocked; dan rekomendasi prioritas tindak lanjut. Sertakan path evidence, tanggal/waktu, serta pernyataan eksplisit bahwa QA tidak memperbaiki bug. Laporkan bahwa `pnpm local:reseed` akhir telah mengembalikan baseline atau alasan bila tidak berhasil, dan kondisi cleanup runtime.
