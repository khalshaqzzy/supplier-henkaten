# Rencana perbaikan temuan local browser QA — 24 September 2026

Status: **perbaikan kode diimplementasikan; regresi otomatis selesai, ulang browser per temuan belum dilakukan**. Dasar: `docs/audits/local-browser-qa-2026-09-24.md` pada baseline `cf53a62`, dibaca bersama PRD, amendment Line–Shift 22 September, ADR 0033/0035, aturan proyek, dan kode pada branch `fix/qa-verif-1`. QA mencatat 22 PASS, 15 FAIL, 10 BLOCKED/partial dari 47 skenario. Angka itu tetap merupakan hasil run asli; dokumen ini tidak mengubah status skenario.

## Hasil implementasi

F-01–F-09 dan F-11–F-12 telah diperbaiki dalam kode. F-10 ditutup sebagai koreksi ekspektasi produk sesuai ADR 0036, tanpa event notifikasi baru. ADR 0037 menjelaskan batas perubahan lintas API dan UI. Tes unit, integrasi API, build, dan perjalanan browser terisolasi yang sudah ada lulus; rinciannya ada pada handoff sesi. Tes browser tersebut merupakan regresi otomatis, **bukan** pengulangan observasi asli untuk setiap F. Baris FAIL/BLOCKED pada laporan QA tetap historis sampai observasi itu diuji ulang secara terpisah. Seluruh cabang “Remaining QA not executed” tetap di luar pekerjaan ini.

## Batas pekerjaan

Perbaiki atau tetapkan disposisi **F-01 sampai F-12** saja, kemudian ulangi langkah yang *sudah menghasilkan temuan* untuk membuktikan perbaikannya. Pemeriksaan regresi otomatis yang diperlukan pada boundary yang berubah boleh dilakukan. Jangan melanjutkan cabang pada “Remaining QA not executed”, mengisi matriks 47 skenario, atau mengklaim baris BLOCKED sebagai PASS. Khusus F-06, browser hanya perlu mengulang preflight eligible dan start Preparation yang dahulu 409; **cancel, operational gate, dan full reverse cutover tetap tidak diuji dalam QA ini**. Push/PWA push tetap di luar cakupan run ini.

Simpan hasil perbaikan sebagai addendum bertanggal pada audit asli atau laporan fix terpisah yang menautkan audit asli. Pertahankan bukti dan klasifikasi observasi awal. Gunakan fixture/database terisolasi; jangan mengubah bukti `.local/qa-evidence/` yang ada atau menaruh kredensial satu kali dalam laporan. `local:reseed` hanya jika diperlukan untuk reproduksi, lalu pulihkan baseline dan matikan runtime.

## Urutan eksekusi

1. **P0 — tata kelola sumber dan identitas:** F-06, lalu F-05. F-06 menutup jalur reverse cutover; F-05 memakai versi Supplier yang juga berubah sepanjang cutover. Verifikasi keduanya dalam satu epoch terisolasi.
2. **P1 — alur kerja Hosted yang gagal:** F-01, F-02, F-08, F-11. Jalankan tes komponen/integrasi sesuai perubahan, lalu satu browser journey pendek per temuan.
3. **P2 — ketepatan UI dan daftar:** F-04, F-07, F-09, F-12. Reuse pola query cache dan cursor yang ada; uji peralihan filter dan state segera setelah mutasi.
4. **Risiko auth dan disposisi produk:** F-03 memerlukan penyelarasan dua ketentuan PRD (lima *kegagalan* vs pembatasan per account/IP). F-10 sudah diputuskan: reroute tidak perlu notifikasi in-app; tutup sebagai ekspektasi QA yang dikoreksi, tanpa perubahan aplikasi. Jangan menyebut F-03 fixed sebelum diuji.
5. **Penutupan:** tes terarah dan regresi browser untuk F-01–F-12; jalankan quality gates repo yang relevan. Bila akan commit, jalankan parity CI lengkap menurut `.agent/rules.md`, catat perintah/hasil pada handoff, dan perbarui ADR/PRD hanya bila kontrak produk berubah. Tidak ada deployment atau perluasan QA pada pekerjaan ini.

## Rencana per temuan

### F-06 — Hosted Preparation gagal setelah cutover (High; T-04, S-01)

**Akar terkonfirmasi:** `SourceGovernanceService.cutover` mencabut sesi namun membiarkan User Supplier Admin ACTIVE. `SupplierAdminService.startPreparation` langsung membuat User ACTIVE baru; indeks parsial `User_one_active_supplier_admin_key` menolaknya. Preflight saat ini tetap menyatakan eligible. PRD §9.4 mensyaratkan satu Admin aktif; pure External tidak memiliki Admin platform aktif, dan Preparation membuat akun baru.

**Perubahan:** dalam transaksi cutover Hosted→External yang sama, nonaktifkan Admin lama, naikkan authorization/version epoch, cabut sesi; audit perubahan identitas tanpa merekam secret. Pada `startPreparation`, tangani secara defensif tenant External lama yang masih memiliki Admin aktif: nonaktifkan akun lama secara transaksional sebelum membuat akun baru, atau beri blocker preflight yang dapat ditindaklanjuti jika data tidak aman untuk ditransisikan. Pilih kebijakan username secara eksplisit: indeks username supplier berlaku juga untuk akun nonaktif, sehingga username lama tidak dapat dipakai ulang tanpa mekanisme reuse yang disetujui. Rencana default: minta username baru dan kembalikan validasi field yang jelas bila bentrok; jangan mengubah constraint secara diam-diam. Selaraskan `collectBlockers`, activation/preparation state, cancel, dan cutover balik agar tepat satu Admin aktif pada Hosted/Preparation dan nol pada External di luar Preparation. Jangan nonaktifkan akun Preparation saat menyelesaikan cutover balik.

**Bukti selesai:** tes integrasi pada invariant yang berubah: cutover Hosted→External membuat Admin lama INACTIVE dan sesi lama tidak berlaku; preflight eligible dan start Preparation membuat tepat satu Admin aktif; transaksi gagal harus rollback; username duplikat dan versi basi memberi error terkontrol. Browser ulangi rangkaian asli sampai start Preparation berhasil, tanpa melanjutkan cancel, operational gate, atau reverse cutover yang tercatat belum dieksekusi. Alur penuh itu tetap pekerjaan QA terpisah.

### F-05 — reset/replace Supplier Admin mengirim versi entitas salah (Medium; T-02)

**Akar terkonfirmasi:** `AdminPages.tsx` mengirim `current.version` (User) pada reset dan replace; kedua endpoint di `SupplierAdminService` memeriksa `supplier.version`.

**Perubahan:** kirim versi Supplier dari hasil detail ke `SupplierAdminPanel` dan gunakan untuk kedua mutasi. Setelah sukses, refetch detail sebelum aksi lain; pertahankan credential satu kali hanya di memori UI. Pertahankan kontrak endpoint yang memang melakukan optimistic concurrency pada Supplier; jangan mengganti pemeriksaan API menjadi User.version hanya untuk menutupi mismatch.

**Bukti selesai:** setelah edit/status mengubah Supplier.version tetapi User.version tidak sama, reset dan replace masing-masing sukses; credential muncul sekali, sesi Admin lama dicabut, hanya satu Admin aktif. Permintaan dengan versi Supplier basi tetap 409. Uji rendering tombol dan argumen API, lalu browser ulangi dua aksi asli.

### F-01 — foto Default Board diblokir CORP (Medium; A-06, S-03)

**Akar terkonfirmasi:** API memasang `helmet()` sehingga image response berisi `Cross-Origin-Resource-Policy: same-origin`; `<img>` Default Board memakai origin API yang berbeda port dari Supplier web. Permintaan 200 tetapi Chromium menolaknya. Canvas memakai pemuat gambar berbeda.

**Perubahan:** pada endpoint foto terautentikasi Supplier dan TMMIN yang diperlukan, tetapkan CORP `same-site` bila seluruh origin web/API yang didukung memang satu site; jika topologi resmi lintas site, gunakan proxy same-origin atau kebijakan origin spesifik yang ditinjau, bukan membuka CORP global. Pertahankan auth/tenant authorization, `Cache-Control: private`, ETag, `nosniff`, dan larangan cache PWA untuk foto. Jangan mengubah URL menjadi publik.

**Bukti selesai:** Chromium Default Board menampilkan foto yang sama dengan Canvas tanpa `ERR_BLOCKED_BY_RESPONSE`; akun tenant lain masih 404; upload/remove/refetch mengganti foto dengan tepat; header foto tetap private dan halaman offline tidak menampilkan foto terlindungi. Cek produksi-lokal/topologi staging yang sudah dikonfigurasi, bukan mengklaim semua deployment dari port lokal saja.

### F-02 — clone menilai Job menurut ShiftRun lama (Low; H-09)

**Akar terkonfirmasi:** `HenkatenService.clonePrefill` mensyaratkan `row.shiftRunId` berstatus ACTIVE sebelum `jobStillValid=true`, padahal amendment Line–Shift memakai `lineShiftId`; form tidak memakai `shiftStillValid` dan mengosongkan Job ketika flag salah.

**Perubahan:** hitung validitas dari Line–Shift sumber yang masih aktif/diizinkan dan konteks occurrence *saat clone*, termasuk line, Job aktif dan assignment Job pada Line–Shift yang dipilih. Untuk record historis tanpa `lineShiftId`, beri fallback yang jelas ke Line–Shift aktif pada line yang sama; jangan menganggap ShiftRun NOT_STARTED sebagai ketidakvalidan Job. Kembalikan ID Line–Shift yang dapat dipilih/flag semantik baru pada kontrak `clone-prefill`; perbarui generated client dan form agar prefill shift lebih dahulu lalu Job bila keduanya valid. Bila sumber tidak lagi cocok, kosongkan pilihan dan minta seleksi manual. Checklist tetap versi aktif terbaru dan jawabannya tidak disalin.

**Bukti selesai:** clone record QA yang dahulu kehilangan Job kini menampilkan Job aktif yang sama dan dapat disubmit setelah jawaban checklist baru; Job/Line–Shift yang benar-benar nonaktif atau tak terkait tetap kosong; relasi `clonedFromHenkatenId`, status record lama, dan validasi Man tidak berubah. Uji layanan + form dan browser ulangi clone asli.

### F-03 — login sukses menghabiskan kuota lima percobaan (Product risk; A-03)

**Akar terkonfirmasi:** `AuthService.login` memanggil `RateLimiterService.consume('login-account', ...)` sebelum verifikasi sandi; bucket lima hitungan memasukkan sukses. DB `failedLoginCount` sendiri direset pada sukses. PRD §9.3 menyatakan lima *kegagalan* memicu lockout, dan rate limit berlaku per account key/IP.

**Perubahan yang diusulkan:** pisahkan pemeriksaan dan pencatatan bucket account sehingga login sukses tidak menambah kuota kegagalan; tetap batasi *semua* request per IP dan catat kegagalan untuk account key termasuk username tidak dikenal secara seragam agar tidak membuat oracle keberadaan akun. Pertahankan lockout DB lima kegagalan/15 menit, audit aman, dummy hash, dan respons generik. Tetapkan angka/window rate limit per account yang konsisten dengan aturan keamanan sebelum mengubahnya; bila kebijakan menghendaki all-attempt throttle, naikkan ambang terpisah agar lima login sukses tidak mengunci akun dan dokumentasikan batasnya.

**Bukti selesai:** ulangi enam login sukses berurutan dari akun yang sama dan pastikan limit lima-kegagalan tidak memblokirnya. Tes unit/integrasi pada komponen limiter memastikan kegagalan, unknown username, IP limit, dan concurrency tidak dilemahkan oleh perubahan; jangan menjalankan browser QA incorrect-password lockout/recovery A-03 yang tercatat belum selesai.

### F-04 — notifikasi Supplier QC stale sesudah read/unread (Low; H-11)

**Akar kuat dari kode:** `scopedKey(scope, 'notifications')` selalu memiliki elemen keenam `undefined`, sehingga tidak menjadi prefix dari query list dengan elemen keenam `{ unreadOnly, cursor }`. Invalidation di `ActivityPages.tsx` tidak menyegarkan daftar; TMMIN memakai prefix key yang benar.

**Perubahan:** invalidasi prefix `scopedKey(...).slice(0, -1)` untuk semua filter/page notifikasi dan count; boleh update cache respons mutasi secara optimistis asalkan rollback/error dan version baru benar. Setelah toggle, tampilan baris, label, badge, dan filter unread harus konsisten tanpa reload.

**Bukti selesai:** read→unread pada baris sama masing-masing memperbarui UI dan version segera; filter unread menghapus/memunculkan baris; refetch dan tab lain konsisten; API 409 masih ditangani. Uji key matching dan browser ulangi observasi QC.

### F-07 — warning detail memakai UUID sebagai label (Low; T-07)

**Akar terkonfirmasi:** `affectedPart` mengembalikan `warnings: rows.map(presentWarning)`; `warningInstanceSchema` hanya memiliki `henkatenId` UUID, dan `MonitoringPages.tsx` memakai itu sebagai teks link. PRD §17.3 meminta Henkaten ID yang terbaca manusia.

**Perubahan:** tambahkan `henkatenIdentifier` atau `displayIdentifier` pada DTO warning dari relasi Hosted Henkaten dan External projection, tanpa mengganti UUID untuk routing/authorization. Tentukan label External dari external record identifier yang tersedia; bila belum ada identifier manusia, tampilkan source record ID yang bermakna dengan fallback terdefinisi, jangan UUID internal sebagai label utama. Perbarui Zod/OpenAPI/generated client/UI. Hindari N+1 dengan join/batch read.

**Bukti selesai:** dua warning Hosted QA menampilkan `HEN-NPM-...-0121/0122`, link tetap menuju UUID yang benar; aggregate 3→2→1 dan closure tidak berubah. Validasi kontrak External secara terarah pada presenter/unit test tanpa membuka matriks External QA lain. Uji browser warning detail Hosted yang sama.

### F-08 — versi Member/Part lama setelah edit (Medium; S-02, S-04)

**Akar kuat dari kode:** `MasterDataPages.tsx` setelah save hanya invalidasi `master-${kind}`; detail memakai `master-${kind}-detail` sehingga komponen lifecycle tetap menerima version lama. `MemberLifecycle` dan `ResourceLifecycle` kemudian mengirim versi itu.

**Perubahan:** setelah save edit, tulis respons resource ke key detail yang tepat dan invalidasi daftar terkait, atau invalidasi/refetch detail dengan `await` sebelum mengaktifkan tindakan berikutnya. Terapkan untuk Member dan Part; karena pola form sama, pastikan Line/Shift Template tidak menyimpan versi usang. Gunakan version server sebagai sumber tunggal, bukan increment lokal. Hapus error lama setelah refetch sukses.

**Bukti selesai:** edit Member atau Part lalu langsung deactivate/reactivate tanpa reload sukses dengan versi terbaru; stale external version yang sungguh-sungguh tetap 409; daftar dan detail menampilkan nilai baru. Uji cache key dan browser langkah berurutan asli.

### F-09 — copy Line–Shift kembali memilih shift lama (Low; S-07)

**Akar yang perlu dibuktikan:** `DefaultAssignmentsPage` sudah memanggil `setSelectedShiftId(created.id)`, tetapi effect fallback memilih item pertama saat query lama belum memuat ID baru, sehingga menimpa pilihan baru sebelum invalidasi selesai.

**Perubahan:** simpan target seleksi baru sampai hasil refetch memuat ID tersebut; effect fallback hanya ketika data sudah definitif dan tidak ada intent seleksi yang sedang menunggu. Alternatif: sisipkan respons `created` ke cache list sebelum memilihnya. Reset intent secara eksplisit saat line berubah/gagal, dan jangan membiarkan status action menarget shift lama setelah copy.

**Bukti selesai:** setelah copy, tab baru, assignment form dan status action semuanya menunjuk ID baru sebelum user mengklik tab; refresh tetap memilih pilihan yang tepat menurut aturan halaman. Uji render dengan cache lama selama refetch dan browser copy asli; overlap dan shared-MP behavior tetap sama.

### F-10 — owner baru tidak menerima notifikasi reroute (Product risk; S-08)

**Fakta dan keputusan:** `ApprovalService.rerouteSupervisor` menulis route dan audit dalam transaksi, tetapi tidak membuat outbox event. S-08 semula mengharapkan notifikasi, sedangkan PRD §18.2 tidak menetapkan trigger reroute. Product owner memutuskan **tidak perlu notifikasi in-app pada reroute**. F-10 adalah perbedaan ekspektasi QA, bukan bug yang perlu perubahan aplikasi. ADR 0036 mencatat keputusan tersebut.

**Disposisi:** koreksi oracle S-08 menjadi audit, owner approval, dan API access sesuai hasil reroute; tandai F-10 `closed — no defect / expectation corrected` pada addendum tanpa menghapus observasi awal. Tidak perlu menambah event, notification, atau tes delivery. F-11 tetap diperbaiki karena tombol mantan owner salah secara mandiri.

### F-11 — mantan owner melihat tombol Approve (Low; S-08, H-08)

**Akar terkonfirmasi:** `HenkatenPages.tsx` menghitung `canDecide` dari capability, status Henkaten, dan status route saja. API `ApprovalService.decide` juga membandingkan `currentResponsibleMemberId` dengan principal.memberId, sehingga UI menampilkan aksi yang pasti 403.

**Perubahan:** untuk Supervisor, tambahkan kesamaan `item.routes.supervisor.currentResponsibleMemberId === session.principal.memberId` pada eligibility UI; QC tetap memakai aturan route QC bersama. Revalidate/refetch detail saat reroute/realtime invalidation dan tepat sebelum membuka/menegaskan keputusan bila cache mungkin stale. API 403 tetap wajib sebagai boundary; jangan mengandalkan tombol tersembunyi untuk keamanan.

**Bukti selesai:** browser mantan Supervisor tidak melihat enabled Approve/Reject setelah reroute; Supervisor baru melihatnya dan berhasil; QC tidak kehilangan aksinya; direct request mantan owner tetap 403. Uji reroute ketika kedua detail sudah terbuka dan refresh invalidation.

### F-12 — registry berhenti pada 25 supplier (Low; T-01)

**Akar terkonfirmasi:** `SuppliersPage` meminta `limit: 25` tetapi tidak membaca/menulis `cursor` dan tidak merender pager, walau `SupplierAdminService.list` mengembalikan `pageInfo.nextCursor`.

**Perubahan:** tambahkan cursor URL/filter seperti daftar TMMIN lain, dengan Next dan riwayat Previous yang dapat dinavigasi; reset cursor saat search/status/source/sort berubah. Gunakan pageInfo API, disabled/loading state, dan urutan stabil. Hindari menggabungkan seluruh page ke satu daftar atau memindahkan pagination ke client.

**Bukti selesai:** fixture >25 supplier: baris ke-26 dapat dicapai tanpa search; tidak ada duplikat/hilang antarhalaman; Previous dan browser Back berfungsi; perubahan filter kembali ke page 1; keadaan kosong/pager terakhir benar. Uji query params + browser registry asli.

## Peta perubahan dan gate akhir

| Lapisan | Berkas utama yang diperkirakan | Gate |
| --- | --- | --- |
| Source governance/identity | `apps/api/src/administration/source-governance.service.ts`, `supplier-admin.service.ts`, `apps/tmmin-web/src/pages/AdminPages.tsx` | Integrasi cutover/preparation/reset/replace + browser T-02/T-04/S-01 failure path |
| Hosted core/auth | `apps/api/src/henkaten/henkaten.service.ts`, `approval.service.ts`, `apps/api/src/auth/auth.service.ts`, `rate-limiter.service.ts` | Tes state, concurrency, auth; browser clone/reroute/login sesuai temuan |
| Read models/contracts | `apps/api/src/henkaten/henkaten.service.ts`, `packages/contracts/src/henkaten.ts`, `apps/api/src/openapi/document.ts`, generated client | `pnpm openapi:check`, presenter/schema test, warning detail |
| Supplier UI | `BoardPage.tsx`, `ActivityPages.tsx`, `MasterDataPages.tsx`, `DefaultAssignmentsPage.tsx`, `HenkatenCreatePage.tsx`, `HenkatenPages.tsx` | Tes cache/selection/action dan browser regresi |
| TMMIN UI | `AdminPages.tsx`, `MonitoringPages.tsx` | Tes versi/pager/link dan browser regresi |

Sebelum menutup setiap F: (1) catat SHA/fixture dan expected-vs-actual baru; (2) bukti UI dan respons API untuk langkah asli; (3) satu tes regresi pada boundary yang gagal bila relevan; (4) periksa tenant isolation, version conflict, audit/outbox sesuai perubahan; (5) perbarui ledger temuan tanpa menghapus status QA awal. Status penutupan yang sah: fixed+verified, accepted risk dengan alasan/owner, atau open/blocker. Jangan memakai PASS pada skenario lengkap jika cabang lain di audit masih unverified.
