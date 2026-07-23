# Product Requirements Document (PRD): Enterprise Digital Henkaten Management untuk TMMIN Suppliers

| Atribut | Nilai |
|---|---|
| Status dokumen | **Approved product contract for v1 planning** |
| Status implementasi | **Phase 0-6 implemented; Phase 7+ planned** |
| Versi dokumen | 1.0 |
| Tanggal | 23 Juli 2026 |
| Product owner | TMMIN |
| Pengguna utama | TMMIN Quality, TMMIN Admin, dan supplier TMMIN |
| Target supplier | 20-42 supplier |
| Source of truth | Dokumen ini |

Dokumen ini adalah kontrak produk dan implementasi v1. Kata **MUST/wajib**, **MUST NOT/dilarang**, **SHOULD/sebaiknya**, dan **MAY/dapat** bersifat normatif. Bila source code, prototype, slide, atau asumsi implementasi berbeda dengan dokumen ini, tim wajib mengeskalasi perbedaan tersebut dan tidak boleh memilih perilaku secara diam-diam.

---

## 1. Ringkasan Eksekutif

Enterprise Digital Henkaten Management adalah platform multi-tenant untuk mendigitalkan pengelolaan change point 4M (**Man, Machine, Material, Method**) pada supplier TMMIN. Platform menggantikan board dan catatan manual dengan assignment board real-time, workflow Henkaten yang dapat diaudit, approval Supervisor dan QC, warning part kepada TMMIN Quality, serta dashboard lintas supplier.

TMMIN menyediakan dua pilihan kepada setiap supplier:

1. **HOSTED** - supplier memakai aplikasi web yang dikelola TMMIN.
2. **EXTERNAL** - supplier mengembangkan aplikasi sendiri dan mengirim event Henkaten yang telah diproses ke REST API TMMIN untuk kebutuhan monitoring.

Satu supplier hanya boleh memiliki satu source mode aktif. Data antar-supplier wajib terisolasi. TMMIN dapat memonitor seluruh supplier, tetapi tidak menjalankan approval supplier.

Scope produk dibatasi pada **Henkaten management**. Fitur health monitoring, attendance, skill matrix, skill recommendation, schedule, moral, task planning, process difficulty, machine telemetry, dan modul operasional non-Henkaten lainnya tidak termasuk v1.

---

## 2. Latar Belakang dan Sumber Requirement

### 2.1 Masalah yang Diselesaikan

Proses manual yang menjadi dasar kebutuhan memiliki masalah berikut:

- pembaruan assignment board memakan waktu;
- penggunaan dan penyimpanan kertas tinggi;
- data tidak diperbarui real-time;
- kalkulasi, rekap, dan traceability sulit;
- Henkaten dapat tidak tercatat karena human error;
- perubahan assignment Man dapat tidak terlihat oleh line terkait;
- approval dan penanggung jawab keputusan sulit ditelusuri;
- TMMIN Quality tidak memperoleh warning part affected secara cepat dan konsisten.

### 2.2 Prinsip Operasional dari Materi Henkaten

Materi operasional mendefinisikan change point sebagai perubahan 4M yang berpotensi menurunkan quality assurance. Alur operasional yang diterjemahkan ke aplikasi adalah:

1. keputusan bahwa change point perlu dikelola;
2. sharing informasi kepada pihak yang terdampak;
3. persiapan checklist dan tindakan;
4. konfirmasi, implementasi, dan follow-up;
5. pencatatan serta penyimpanan hasil.

Assignment Board dan Henkaten Record menjadi representasi digital utama dari alur tersebut.

### 2.3 Referensi yang Telah Dianalisis

- Seluruh 7 slide `Materi Johnny FMDS 1 - trimmed.pdf` diperiksa secara visual. Elemen yang diadopsi: assignment board, indikator 4M, real-time update, pencatatan otomatis, filter, summary, dan traceability.
- Seluruh 20 slide `102 Ensuring Precondition-trimmed.pdf` diperiksa secara visual. Bagian skill/attendance hanya dipakai untuk memahami konteks assignment dan tidak menjadi scope. Bagian change point management dipakai untuk lifecycle dan audit.
- `App.py` dan workbook `Henkaten.xlsx` dianalisis sebagai referensi awal field, dashboard, checklist, decision actor/date/comment, dan kategori 4M.
- Approval enam tingkat pada prototype, penyimpanan Excel, password plaintext, dan SMTP placeholder **tidak boleh** diwarisi.
- Pola deployment pada proyek `loom/deploy` menjadi referensi untuk release-by-SHA, health/readiness checks, deployment lock, release retention, smoke test, dan rollback.

---

## 3. Visi, Tujuan, dan Non-Tujuan

### 3.1 Visi

Menyediakan satu sistem Henkaten yang aman, traceable, dan konsisten bagi seluruh supplier TMMIN sehingga perubahan 4M dapat diketahui, dinilai, disetujui, divisualisasikan, dan dimonitor tanpa bergantung pada kertas atau rekap manual.

### 3.2 Tujuan Produk v1

- Mendigitalkan input dan approval Henkaten 4M.
- Memvisualisasikan current assignment dan change point pada Assignment Board.
- Menjamin satu MP tidak memiliki assignment/reservation yang bertentangan.
- Memberikan warning kepada TMMIN Quality selama Henkaten masih Open.
- Menyimpan decision history dan audit trail permanen.
- Memberikan isolasi data yang kuat untuk 20-42 supplier.
- Mendukung supplier yang memakai portal TMMIN maupun supplier yang mengirim data dari aplikasi eksternal.
- Menyediakan dashboard supplier dan TMMIN yang dapat difilter dan ditelusuri.
- Menyediakan deployment staging dan production yang repeatable pada arsitektur single-VM per environment.

### 3.3 Non-Tujuan

Produk ini bukan:

- HRIS, attendance system, atau employee scheduling system;
- skill management atau automatic replacement recommendation engine;
- production planning atau machine monitoring system;
- quality inspection execution system di luar checklist Henkaten;
- platform komunikasi email/chat;
- sistem approval TMMIN untuk keputusan internal supplier;
- high-availability atau disaster-recovery platform pada v1.

---

## 4. Glossary dan Terminologi

| Istilah | Definisi |
|---|---|
| Henkaten | Record perubahan 4M yang perlu dikelola dan ditelusuri. |
| 4M | Man, Machine, Material, Method. |
| Supplier | Tenant/organisasi pemasok TMMIN. |
| Supplier Admin | Satu akun administrator utama untuk tenant Hosted atau Hosted Preparation, dibuat oleh TMMIN; pure External tidak memiliki akun platform. |
| Supervisor / GL | Group Leader yang bertanggung jawab atas satu atau lebih line dan meng-approve Henkaten line tersebut. |
| Line Leader / TL / LL | Team Leader yang bertanggung jawab atas tepat satu line dan menginput Henkaten. |
| MP | Man Power/operator yang ditempatkan pada job. MP tidak memiliki akun aplikasi. |
| QC Team | Sekumpulan user supplier dengan permission yang sama; satu keputusan QC pertama mewakili jalur approval QC. |
| TMMIN Admin | Administrator platform dan tenant. |
| TMMIN Quality | User monitoring lintas supplier; read-only terhadap domain Henkaten. |
| Line | Unit line produksi milik supplier. |
| Job | Posisi/proses kerja di dalam satu line. |
| Default Assignment | Penempatan rutin Supervisor, LL, dan MP yang menjadi baseline shift. |
| Working Assignment | Penempatan aktual untuk satu Shift Run. |
| Assignment Issue | Masalah assignment, misalnya vacancy akibat MP ditarik line lain. |
| Shift Template | Definisi nama, urutan, waktu mulai/selesai, dan timezone shift. |
| Shift Run | Eksekusi satu Shift Template untuk line dan business date tertentu. |
| Open | Henkaten menunggu keputusan final dan memunculkan warning TMMIN. |
| Closed | Kondisi turunan untuk outcome Approved, Rejected, atau Cancelled. |
| Reservation | Lock sementara atas MP pengganti selama Man Henkaten Open. |
| Hosted | Source mode dengan seluruh workflow supplier dijalankan di platform TMMIN. |
| External | Source mode dengan aplikasi supplier sebagai source of truth dan TMMIN hanya menerima data monitoring. |
| Hosted Preparation | Akses konfigurasi terkontrol saat tenant masih `EXTERNAL`; bukan source mode ketiga dan tidak mengizinkan workflow operasional Hosted. |

---

## 5. Scope dan Kapasitas v1

### 5.1 Kapasitas Fungsional

Platform wajib mendukung:

- 20-42 supplier aktif;
- maksimum 20 line per supplier;
- maksimum 300 member per supplier;
- maksimum 500 job per supplier;
- maksimum 30 concurrent authenticated users per supplier;
- dua frontend terpisah: supplier-facing dan TMMIN-facing;
- satu API dan satu database PostgreSQL per environment.

Limit di atas adalah acceptance baseline, bukan license limit. Implementasi tidak boleh menggunakan hard-coded array atau desain yang mencegah peningkatan limit setelah capacity review.

### 5.2 Source Mode

`SourceMode` memiliki tepat dua nilai:

- `HOSTED`
- `EXTERNAL`

Aturan:

- hanya TMMIN Admin yang dapat menetapkan atau mengubah mode;
- initial source-mode assignment pada provisioning berbeda dari controlled cutover;
- supplier `EXTERNAL` baru dibuat inactive tanpa Supplier Admin platform sampai external credential tersedia atau Hosted Preparation dimulai;
- satu supplier hanya memiliki satu mode aktif;
- mixed writes HOSTED dan EXTERNAL pada supplier yang sama dilarang;
- source mode wajib disimpan pada setiap Henkaten projection untuk traceability;
- data historis dari source mode lama tetap read-only dan tidak dipindahkan atau dihapus.

Cutover mode wajib:

1. memblokir perubahan mode bila ada active shift atau Henkaten Open;
2. mencatat alasan, actor, waktu, source mode lama, dan source mode baru;
3. mencabut session/credential source lama;
4. menaikkan `sourceEpoch`;
5. membuat source baru aktif hanya setelah preflight berhasil;
6. tidak menggabungkan ID sequence dari dua source tanpa namespace.

Untuk cutover ke EXTERNAL, client credential wajib tersedia sebelum aktivasi. Untuk cutover ke HOSTED, minimum master data, Supplier Admin, shift, line, job, checklist, dan default assignment wajib lulus validasi.

### 5.3 Hosted Preparation

- Hosted Preparation hanya dapat dimulai oleh TMMIN Admin pada supplier `EXTERNAL`, dengan alasan dan privacy acknowledgement.
- `SourceMode` tetap `EXTERNAL`, source epoch tidak berubah, dan External tetap source of truth selama preparation.
- TMMIN membuat Supplier Admin khusus preparation. Session-nya bertujuan `HOSTED_PREPARATION`.
- Preparation hanya mengizinkan konfigurasi master data, checklist, dan default assignment setelah capability tersebut tersedia pada Phase 4.
- Start/End Shift, input/approval Henkaten, dan seluruh Hosted operational write tetap dilarang.
- Cancel preparation menonaktifkan preparation admin dan mencabut seluruh session preparation.
- Completion hanya terjadi dalam transaksi cutover `EXTERNAL` ke `HOSTED` setelah seluruh contributor preflight tersedia dan lulus.

---

## 6. Persona dan Role

### 6.1 TMMIN Admin

Tujuan:

- mengelola tenant supplier dan akun privileged;
- menetapkan source mode;
- melihat seluruh data untuk support dan governance;
- tidak mengambil keputusan approval supplier.

Kemampuan:

- membuat, melihat, mengubah, mengaktifkan, dan menonaktifkan supplier;
- membuat atau mengganti satu Supplier Admin aktif;
- membuat dan menonaktifkan akun TMMIN Quality;
- menetapkan supplier code dan source mode;
- menerbitkan, merotasi, dan mencabut external API client credential;
- mengatur optional IP allowlist;
- melihat audit lintas supplier;
- melakukan cutover source mode;
- melakukan support reset password;
- melihat deployment/health information yang diekspos aplikasi.

### 6.2 TMMIN Quality

Tujuan:

- memonitor seluruh Henkaten dan warning part lintas supplier;
- melakukan drill-down tanpa mengubah status bisnis.

Kemampuan:

- melihat dashboard komprehensif seluruh supplier;
- melihat warning aktif, history, approval aging, dan detail Henkaten;
- memfilter berdasarkan supplier, source mode, date range, status, 4M, line, part number, dan part name;
- melihat hosted audit detail sesuai permission;
- menandai notification miliknya sebagai read/unread.

Larangan:

- tidak dapat approve, reject, cancel, edit, atau menghapus Henkaten supplier;
- tidak dapat mengubah assignment supplier;
- read/unread notification tidak boleh mengubah warning atau lifecycle Henkaten.

### 6.3 Supplier Admin

Tujuan:

- menyiapkan dan mengelola master data supplier;
- memonitor semua line dan Henkaten;
- menjaga default assignment valid.

Kemampuan:

- CRUD individual member, akun, shift, line, job, part, checklist, dan default assignment;
- melihat seluruh board, dashboard, Henkaten, approval, notification, dan audit supplier;
- memindahkan Supervisor, LL, atau MP pada default assignment;
- melakukan emergency override Start Shift dengan alasan;
- mereset password user supplier;
- menonaktifkan member atau akun.

Larangan:

- tidak dapat approve sebagai Supervisor/QC kecuali terdapat akun member terpisah; satu akun hanya memiliki satu role;
- tidak dapat mengedit record terminal;
- tidak dapat hard-delete data yang pernah direferensikan;
- tidak dapat mengubah source mode.

### 6.4 Supervisor / GL

Tujuan:

- menilai dan memutuskan Henkaten pada line yang disupervisi;
- memonitor Assignment Board line yang disupervisi.

Kemampuan:

- meng-approve atau reject Henkaten Open pada line tanggung jawab;
- menambahkan optional comment;
- melihat board, dashboard, Henkaten, notification, dan history untuk line tanggung jawab;
- menerima notification bila line menjadi donor/affected akibat Man Henkaten.

Seorang Supervisor dapat memiliki banyak line. Satu line hanya dapat memiliki maksimum satu Supervisor default aktif.

### 6.5 Line Leader / TL / LL

Tujuan:

- menjalankan shift dan mencatat Henkaten pada line sendiri;
- memastikan assignment issue terselesaikan.

Kemampuan:

- Start Shift dan End Shift line sendiri;
- menjalankan pre-start resolution wizard;
- menginput Henkaten 4M;
- melihat board dan dashboard line sendiri;
- melihat approval history;
- Withdraw + Clone Henkaten Open yang dibuat untuk line sendiri;
- menerima notification vacancy atau change lintas-line.

Satu LL hanya boleh memiliki maksimum satu default line aktif. Satu line hanya boleh memiliki maksimum satu LL default aktif.

### 6.6 QC Team

Tujuan:

- menjadi jalur approval QC supplier;
- memonitor seluruh line supplier.

Kemampuan:

- setiap akun QC melihat antrean Henkaten Open seluruh supplier tenant-nya;
- anggota QC pertama yang memutuskan mengunci keputusan jalur QC;
- melihat seluruh board, dashboard, history, dan notification supplier;
- approve/reject dengan optional comment.

Semua akun QC memiliki permission yang sama. Perbedaan akun dipakai untuk mencatat siapa yang mengambil keputusan.

### 6.7 MP

- MP adalah master member tanpa credential/login.
- MP dapat memiliki maksimum satu default job aktif.
- MP dapat tidak memiliki default job.
- MP dapat menjadi replacement lintas-line pada Man Henkaten.
- Nomor registrasi wajib unik di dalam supplier.

---

## 7. Matriks Permission

Legenda: `M` manage, `A` approve/reject, `V` view, `O` operate, `-` tidak memiliki akses.

| Capability | TMMIN Admin | TMMIN Quality | Supplier Admin | Supervisor | LL | QC | MP |
|---|---:|---:|---:|---:|---:|---:|---:|
| Manage supplier | M | V | - | - | - | - | - |
| Manage source mode/API credential | M | - | - | - | - | - | - |
| Manage Supplier Admin | M | - | - | - | - | - | - |
| Manage supplier master data | V read-only | V read-only Hosted | M | V scoped | V scoped | V | - |
| Manage default assignment | V read-only | V read-only Hosted | M | V scoped | V scoped | V | - |
| Start/End Shift | - | - | Override only | V | O own line | V | - |
| Input Henkaten | - | - | - | - | O own line | - | - |
| Withdraw + Clone | - | - | - | - | O own line | - | - |
| Supervisor decision | - | - | - | A scoped | - | - | - |
| QC decision | - | - | - | - | - | A tenant-wide | - |
| View supplier board | V support | Hosted only, read-only | V all | V scoped | V own line | V all | - |
| View supplier dashboard | V | V monitoring | V all | V scoped | V own line | V all | - |
| View cross-supplier dashboard | V | V | - | - | - | - | - |
| Change Henkaten terminal state | - | - | - | Decision only | Decision/withdraw only | Decision only | - |
| View immutable audit | V all | V permitted | V tenant | V scoped | V scoped | V tenant | - |

Semua permission wajib divalidasi oleh backend. Menyembunyikan control di frontend tidak dianggap sebagai access control.

---

## 8. Tenant Isolation

### 8.1 Aturan Umum

- Setiap entitas tenant wajib memiliki `supplierId` langsung atau melalui relasi yang tidak ambigu.
- `supplierId` tidak boleh diterima bebas dari body untuk endpoint supplier-facing; nilai diambil dari authenticated session.
- Query, mutation, cache key, notification, audit, dan background job wajib tenant-scoped.
- TMMIN role memakai explicit cross-tenant permission dan tidak boleh menggunakan bypass tersembunyi.
- Object identifier berupa UUID/opaque ID; sequential database ID tidak boleh diekspos sebagai authorization boundary.
- Backend wajib menolak resource yang bukan tenant user dengan `404` atau `403` sesuai security policy yang konsisten.

### 8.2 Unique Constraints Minimum

- `Supplier.code` unik global, case-insensitive.
- `User.username` unik per supplier, case-insensitive.
- Username TMMIN unik pada TMMIN identity realm.
- `Member.registrationNumber` unik per supplier.
- `Line.lineCode` unik per supplier.
- `Job.name` unik per line, case-insensitive.
- `Part.partNumber` unik per supplier, case-insensitive.
- satu default Supervisor per line;
- satu default LL per line;
- satu default line per LL;
- satu default job per MP;
- satu active Shift Run per line;
- satu active reservation per MP;
- satu Supervisor decision dan satu QC decision per Henkaten.

---

## 9. Authentication dan Account Lifecycle

### 9.1 Supplier Login

Supplier-facing login wajib meminta:

- Supplier Code
- Username
- Password

Username hanya unik di dalam supplier. Authentication tidak boleh mengungkap apakah supplier code atau username yang salah.

### 9.2 TMMIN Login

TMMIN-facing login memakai:

- Username
- Password

TMMIN user berada pada identity realm terpisah dan tidak memasukkan Supplier Code.

### 9.3 Password dan Session

- Password wajib di-hash dengan Argon2id.
- Password plaintext tidak boleh disimpan, dicatat di log, audit, analytics, atau error.
- Password minimum 12 karakter dan maksimum 128 karakter.
- Temporary password wajib diganti saat first login atau setelah admin reset.
- Lima password terakhir tidak boleh digunakan ulang.
- Lima kegagalan login dalam 15 menit memicu lockout 15 menit.
- Rate limit login berlaku per account key dan IP.
- Session menggunakan secure, HttpOnly, SameSite cookie.
- Idle timeout: 30 menit.
- Absolute session timeout: 12 jam.
- Password reset, deactivation, role change, atau source cutover mencabut seluruh session terkait.
- MFA dan SSO tidak termasuk v1.

### 9.4 Provisioning dan Reset

- Tenant `HOSTED` dibuat active beserta satu Supplier Admin.
- Tenant `EXTERNAL` dibuat inactive tanpa akun/PII Supplier Admin platform; akun baru dibuat bila Hosted Preparation dimulai.
- Hanya satu Supplier Admin boleh aktif. Replacement wajib menonaktifkan admin lama secara transaksional.
- Supplier Admin membuat akun Supervisor, LL, dan QC ketika member dengan role tersebut diregistrasikan.
- Username dan temporary password diberikan melalui proses operasional aman di luar notification aplikasi; aplikasi hanya menampilkan temporary password satu kali.
- TMMIN Admin dapat mereset Supplier Admin.
- Supplier Admin dapat mereset akun Supervisor, LL, dan QC.
- Deactivation tidak menghapus decision history atau actor snapshot.

---

## 10. Master Data Supplier

### 10.1 Member

Field minimum:

- internal ID;
- `supplierId`;
- nama lengkap;
- nomor registrasi;
- role: `SUPERVISOR`, `LINE_LEADER`, `MP`, atau `QC`;
- status aktif/nonaktif;
- foto opsional;
- created/updated metadata;
- version untuk optimistic concurrency.

Aturan:

- satu member hanya memiliki satu role aktif;
- role member immutable setelah dibuat; koreksi role dilakukan dengan menonaktifkan member lama dan
  membuat member baru;
- approval history menyimpan role snapshot saat keputusan;
- foto menerima JPG, PNG, atau WebP maksimum 2 MB;
- server wajib memvalidasi MIME dan signature, menghapus metadata, serta membuat thumbnail;
- jika foto tidak tersedia, UI memakai initials avatar;
- foto/nomor registrasi tidak pernah dikirim melalui External API.

### 10.2 Line

Field minimum:

- line code/ID yang diinput admin;
- line name;
- urutan tampilan;
- status aktif;
- default Supervisor;
- default LL.

Line tanpa Supervisor atau LL dapat disimpan sebagai incomplete configuration, tetapi tidak dapat Start Shift tanpa emergency override.

### 10.3 Job

- Job berada pada tepat satu line.
- Field minimum: generated ID, name, display order, status aktif.
- Satu job memiliki maksimum satu default MP.
- Job yang sudah direferensikan tidak dapat hard-delete.
- Reorder job tidak mengubah history.

### 10.4 Part

Field minimum:

- part number;
- part name;
- status aktif;
- created/updated metadata.

Part number dan part name wajib diisi. Pada input Henkaten, user dapat mencari menggunakan salah satunya dan UI selalu menampilkan keduanya setelah dipilih.

### 10.5 Shift Template

Field minimum:

- name;
- display order;
- start local time;
- end local time;
- timezone IANA;
- active flag.

Shift yang melewati tengah malam wajib didukung. Business date mengikuti tanggal waktu mulai di timezone supplier.

### 10.6 Quality Checklist

- Checklist dipisahkan per `MAN`, `MACHINE`, `MATERIAL`, dan `METHOD`.
- Setiap kategori memiliki template dan version.
- Version terdiri dari ordered yes/no items.
- Publish membuat immutable version baru.
- Version yang pernah dipakai tidak dapat diedit atau dihapus.
- Item dapat dinonaktifkan hanya melalui version baru.
- Minimum satu active checklist item per kategori diperlukan sebelum kategori dapat dipakai.
- Henkaten menyimpan snapshot label, urutan, version, dan jawaban.
- Semua jawaban wajib `YES` saat submit; `NO` atau unanswered menolak submission.
- Admin-defined checklist boleh berisi pertanyaan terkait tindakan operasional, tetapi tidak mengaktifkan skill-management feature.

### 10.7 CRUD dan Deactivation

- v1 hanya menyediakan individual CRUD form.
- Bulk CSV import/export tidak termasuk v1.
- Seluruh master data permanen sejak dibuat dan tidak memiliki hard-delete API.
- Koreksi dilakukan melalui update atau deactivation; reactivation tetap mempertahankan identity
  dan history yang sama.
- Deactivation wajib ditolak bila resource masih diperlukan active shift, Open Henkaten, reservation, atau active default assignment.

---

## 11. Default Assignment

### 11.1 Invariant

- Satu line memiliki maksimum satu default Supervisor.
- Supervisor dapat bertanggung jawab atas banyak line.
- Satu line memiliki maksimum satu default LL.
- Satu LL memiliki maksimum satu default line.
- Satu job memiliki maksimum satu default MP.
- Satu MP memiliki maksimum satu default job.
- Semua relasi default harus berada pada supplier yang sama.

### 11.2 Admin Workflow

Untuk Supervisor:

1. Admin membuka line.
2. Admin memilih Supervisor.
3. Admin dapat assign, change, atau remove.
4. Availability tidak dibatasi oleh jumlah line karena Supervisor boleh memiliki banyak line.

Untuk LL:

1. Admin membuka line.
2. Admin memilih bagian LL.
3. Admin dapat assign, change, atau remove.
4. LL yang sudah memiliki default line lain tidak dapat dipilih sampai assignment lama dilepas atau operation dilakukan sebagai atomic move.

Untuk MP:

1. Admin memilih line.
2. Admin memilih job.
3. Admin dapat assign, change, atau remove MP.
4. MP baru harus tidak memiliki default job lain, kecuali admin memilih explicit atomic move.
5. Atomic move mengosongkan job lama dan mengisi job baru dalam satu transaksi.

### 11.3 Efektivitas Perubahan

- Perubahan default tidak membuat Henkaten.
- Perubahan default wajib diaudit.
- Bila line tidak memiliki active Shift Run, perubahan berlaku pada Start Shift berikutnya.
- Bila line memiliki active Shift Run, Working Assignment tidak berubah.
- Perubahan Working Assignment saat shift aktif hanya terjadi melalui final Approved Man Henkaten.

---

## 12. Shift Management

### 12.1 Shift Run State

State:

- `NOT_STARTED` - representasi jadwal/preflight, belum active;
- `ACTIVE`;
- `ENDED`.

Transition yang diperbolehkan:

| Dari | Aksi | Ke | Actor |
|---|---|---|---|
| NOT_STARTED | Start Shift | ACTIVE | LL own line |
| NOT_STARTED | Emergency Start | ACTIVE | Supplier Admin |
| ACTIVE | End Shift | ENDED | LL own line |

State `ENDED` bersifat terminal.

### 12.2 Start Shift

Start Shift wajib:

1. menentukan line, Shift Template, business date, dan LL;
2. mengambil snapshot Default Assignment;
3. membangun Working Assignment;
4. memastikan tidak ada Shift Run lain yang Active pada line;
5. memastikan Supervisor dan LL tersedia;
6. memastikan tidak ada duplicate MP;
7. memastikan setiap default MP tidak sedang digunakan/reserved oleh shift lain secara konflik;
8. memeriksa open Assignment Issue;
9. memeriksa carry-over Open Henkaten;
10. memeriksa checklist version aktif;
11. menampilkan preflight result sebelum commit.

Hard gate memblokir Start Shift bila:

- Supervisor/LL wajib tidak tersedia;
- job yang diwajibkan assignment-nya vacant;
- MP conflicted atau reserved;
- terdapat unresolved Assignment Issue;
- terdapat Open Henkaten carry-over;
- checklist configuration tidak valid;
- Shift Run line masih Active.

### 12.3 Pre-start Resolution Wizard

LL dapat membuka wizard sebelum shift Active untuk:

- melihat vacancy dan conflict;
- memilih replacement MP;
- membuat pre-start Man Henkaten;
- memonitor approval;
- refresh preflight setelah Henkaten terminal.

Pre-start Man Henkaten memiliki target planned Shift Run. Shift baru dapat dimulai setelah Henkaten Approved dan assignment plan valid, kecuali emergency override.

### 12.4 Emergency Override

- Hanya Supplier Admin yang dapat melakukan emergency override.
- Alasan minimum 10 karakter wajib diisi.
- Bila default LL tidak tersedia, Supplier Admin wajib memilih satu substitute LL aktif; pilihan
  tersebut hanya menjadi snapshot Shift Run dan tidak mengubah Default Assignment.
- Override tidak menghapus issue atau memalsukan preflight menjadi valid.
- Shift menjadi Active dengan `startedWithOverride=true`.
- Assignment Board wajib menampilkan critical unresolved banner.
- LL, Supervisor, QC, Supplier Admin, dan TMMIN Quality mendapat in-app notification/visibility.
- Audit menyimpan failed checks, actor, alasan, dan timestamp.

### 12.5 End Shift

End Shift adalah transaksi tunggal yang:

1. lock Shift Run dan seluruh Henkaten Open terkait;
2. mengubah seluruh Henkaten Open menjadi `CANCELLED`;
3. menetapkan cancellation reason `SHIFT_ENDED`;
4. melepas seluruh MP Reservation;
5. menandai pending approval route sebagai `NOT_REQUIRED`;
6. menutup warning TMMIN;
7. mengakhiri indikator Henkaten aktif pada board;
8. menghapus Working Assignment aktif;
9. menandai Shift Run `ENDED`;
10. menyimpan summary dan audit.

Approved/Rejected/Canceled history tidak dihapus. Default Assignment tidak berubah. Bila approval dan End Shift terjadi bersamaan, database transaction/row lock menentukan satu pemenang; request yang kalah menerima `409 Conflict` dan wajib refresh.

---

## 13. Henkaten Lifecycle

### 13.1 Status

| Status | Terminal | Warning TMMIN | Assignment Effect |
|---|---:|---:|---|
| OPEN | Tidak | Aktif | Reservation saja untuk Man |
| APPROVED | Ya | Selesai | Man move diterapkan atomik |
| REJECTED | Ya | Selesai | Tidak ada move |
| CANCELLED | Ya | Selesai | Tidak ada move |

`isClosed` adalah nilai turunan: `status != OPEN`.

### 13.2 Transition

| Dari | Trigger | Ke |
|---|---|---|
| New valid submission | Submit | OPEN |
| OPEN | Supervisor APPROVE + QC APPROVE | APPROVED |
| OPEN | Supervisor REJECT | REJECTED |
| OPEN | QC REJECT | REJECTED |
| OPEN | LL Withdraw | CANCELLED |
| OPEN | End Shift | CANCELLED |

Transition lain dilarang. Terminal record immutable.

### 13.3 General Submission Data

Field wajib:

- generated Henkaten ID;
- source mode dan source epoch;
- supplier;
- Shift Run atau planned Shift Run;
- occurred-at timestamp;
- line snapshot;
- job snapshot;
- part number dan part name snapshot;
- change point `MAN|MACHINE|MATERIAL|METHOD`;
- cause;
- detail change;
- checklist version dan answers snapshot;
- created by/created at;
- row version.

Aturan:

- Hosted LL hanya dapat memilih line sendiri.
- Line tidak diinput manual; diambil dari current assignment LL.
- Hosted submission wajib membawa `Idempotency-Key` yang unik per supplier + creator; exact retry
  mengembalikan record yang sama dan reuse dengan payload berbeda menghasilkan `409 Conflict`.
- Job harus aktif pada line tersebut.
- Part harus aktif pada supplier tersebut.
- Cause dan detail change wajib, masing-masing maksimum 2.000 karakter.
- Semua checklist answer wajib Yes.
- Server menggunakan timestamp authoritative; client timestamp hanya menjadi context bila diperlukan.
- Semua waktu disimpan UTC dan ditampilkan pada timezone supplier.

### 13.4 Category-specific Data

#### Man

- target job;
- replaced MP, atau `VACANT` untuk resolution issue;
- replacement MP;
- target Working Assignment/planned assignment;
- source assignment replacement MP bila sedang assigned.

Validasi:

- replaced dan replacement tidak boleh orang yang sama;
- replacement aktif dan role MP;
- replacement berada pada supplier yang sama;
- replacement tidak memiliki active reservation lain;
- target job belum menjadi target Man Henkaten Open lain;
- source/target assignment version masih sama saat submit.

#### Machine, Material, Method

Field wajib:

- affected object/freeform;
- replacement/new condition/freeform;
- cause;
- detail change.

Masing-masing freeform maksimum 2.000 karakter. V1 tidak mengelola machine/material catalog terpisah.

### 13.5 Henkaten ID

Hosted Henkaten memiliki human-readable identifier:

`HEN-{SUPPLIER_CODE}-{YYYYMMDD}-{SEQUENCE}`

Identifier bersifat unik, immutable, dan bukan authorization boundary. Internal API menggunakan UUID.

### 13.6 Withdraw + Clone

- Hanya LL line terkait yang dapat Withdraw.
- Hanya record Open yang dapat di-Withdraw.
- Withdrawal reason wajib dan maksimum 1.000 karakter.
- Withdraw mengubah status menjadi Cancelled, melepas reservation, menutup warning, dan menginvalidasi pending decision.
- Clone membuka form baru dengan data yang masih relevan.
- Checklist menggunakan active version terbaru dan wajib dijawab ulang.
- Assignment reference wajib divalidasi ulang.
- Record baru menyimpan `clonedFromHenkatenId`.
- Record lama tetap immutable dan dapat ditelusuri.

---

## 14. Approval Workflow

### 14.1 Approval Routes

Setiap Hosted Henkaten memiliki dua route:

- `SUPERVISOR`
- `QC`

Initial route state adalah `PENDING`.

### 14.2 Supervisor Route

- Approver adalah Supervisor default/working responsibility untuk line saat Henkaten dibuat.
- Supervisor line lain tidak dapat mengambil keputusan.
- Bila Supervisor account dinonaktifkan setelah submission, responsibility tetap terlihat tetapi Supplier Admin wajib menunjuk Supervisor baru; re-routing dicatat dalam audit.

### 14.3 QC Route

- Semua active QC user supplier melihat pending queue yang sama.
- Keputusan valid pertama mengunci route.
- QC user lain yang membuka data stale menerima status terbaru dan tidak dapat overwrite.

### 14.4 Finalization Rules

- Kedua route dapat diputuskan paralel.
- Satu Approve membuat route `APPROVED`, sedangkan Henkaten tetap Open menunggu route lain.
- Dua route Approved membuat Henkaten Approved.
- Reject pertama membuat Henkaten langsung Rejected.
- Route yang masih Pending setelah reject menjadi `NOT_REQUIRED`.
- Comment optional untuk Approve maupun Reject, maksimum 2.000 karakter.
- Actor, member snapshot, role, decision, comment, timestamp, IP context, correlation ID, dan decision version wajib disimpan.
- Decision tidak dapat diubah atau dicabut.

### 14.5 Concurrency

Decision harus diproses dalam database transaction dengan:

- row lock atau equivalent optimistic check pada Henkaten;
- unique constraint per route;
- expected row version;
- atomic final status calculation;
- atomic warning update;
- atomic reservation/assignment handling.

Duplicate retry dari request yang sama harus idempotent. Keputusan berbeda terhadap route yang sudah dikunci menghasilkan `409 Conflict`.

---

## 15. Man Henkaten dan Assignment Cascade

### 15.1 Reservation Saat Open

Saat valid Man Henkaten disubmit:

- replacement MP dibuatkan `MPReservation`;
- reservation mengacu pada Henkaten, MP, target job, source assignment, dan expiry boundary Shift Run;
- reservation mencegah MP menjadi replacement pada Henkaten Open lain;
- current Working Assignment belum berubah;
- Assignment Board menampilkan prospective Man change.

### 15.2 Apply Saat Approved

Final Approved menjalankan satu transaksi:

1. verifikasi Henkaten dan reservation masih valid;
2. lock target job, replacement MP, replaced MP, dan source job;
3. lepaskan replaced MP dari target job;
4. lepaskan replacement MP dari source job bila ada;
5. assign replacement MP ke target job;
6. tandai replaced MP unassigned;
7. release reservation;
8. simpan assignment movement ledger;
9. buat Assignment Issue untuk source job yang menjadi vacant;
10. kirim in-app notification ke LL dan Supervisor line donor;
11. update Assignment Board.

Default Assignment tidak berubah.

### 15.3 Cascade Vacancy

- Replacement MP boleh berasal dari job/line lain dalam supplier yang sama.
- Source job menjadi vacancy saat move Approved.
- Vacancy tidak secara otomatis dianggap Approved Henkaten baru.
- Sistem membuat linked Assignment Issue berisi origin Henkaten, source line/job, MP yang dipindahkan, dan waktu.
- LL donor menyelesaikan issue melalui pre-start atau active-shift Man Henkaten.
- Issue tetap terlihat sampai job terisi atau Shift Run berakhir.
- Cycle dan duplicate reservation dilarang.
- Jika donor line sedang Active, board menampilkan critical vacancy segera.
- Jika donor line belum Start Shift, preflight memblokir Start sampai issue selesai atau di-override.

### 15.4 Reject/Cancel

Rejected, Withdraw, atau End Shift:

- melepas reservation;
- tidak mengubah Working Assignment;
- tidak membuat vacancy baru;
- menghapus prospective change indicator;
- mempertahankan history dan reason.

---

## 16. Assignment Board

### 16.1 Tujuan

Memberikan satu visual state untuk:

- Supervisor dan LL line;
- job pada line;
- MP yang sedang assigned;
- vacancy/conflict;
- change point 4M;
- status Open vs Approved dalam shift;
- last updated time.

### 16.2 Konten Board

Setiap line section menampilkan:

- line code dan line name;
- Shift Template dan business date;
- Supervisor;
- LL;
- job secara display order;
- MP name, registration number, dan photo/avatar untuk Hosted;
- status assigned, vacant, reserved, atau conflicted;
- indikator Man, Machine, Material, Method;
- status warning/approval;
- last update timestamp.

### 16.3 Indikator

- Man: biru;
- Machine: hijau;
- Material: kuning;
- Method: merah.

Warna selalu disertai label/icon/accessible text. Open menggunakan visual state berbeda dari Approved, misalnya pulsing/outlined vs solid. Rejected dan Cancelled tidak ditampilkan sebagai active change, tetapi tetap tersedia pada history.

Approved Henkaten pada Shift Run aktif tetap terlihat sebagai active change sampai End Shift. Warning TMMIN hanya untuk Open.

### 16.4 Scope View

- Supplier Admin: seluruh line supplier.
- QC: seluruh line supplier.
- Supervisor: line yang disupervisi.
- LL: line sendiri.
- TMMIN Admin/Quality: hosted board read-only bila diperlukan untuk support/monitoring.
- External supplier tidak memiliki TMMIN assignment board karena payload meminimalkan PII dan TMMIN tidak menjadi source of truth assignment.

### 16.5 Real-time Behavior

- Board harus menerima update tanpa full-page reload.
- Implementasi dapat memakai WebSocket/SSE atau short polling, tetapi observable behavior wajib memenuhi performance target.
- Bila realtime channel gagal, UI menampilkan disconnected/stale state dan menyediakan retry.
- UI wajib menampilkan `lastUpdatedAt`.

Process difficulty, skill level, health, attendance, dan schedule tidak boleh muncul.

---

## 17. Dashboard dan Reporting

### 17.1 Supplier Dashboard

Widget minimum:

- total Henkaten;
- Open, Approved, Rejected, Cancelled;
- warning aktif;
- approval aging;
- pending Supervisor;
- pending QC;
- tren 4M per hari/minggu/bulan;
- Henkaten per line;
- Henkaten per part;
- decision outcome trend;
- recent activity;
- unresolved Assignment Issue;
- emergency Start Shift overrides.

Filter minimum:

- date/time range;
- status;
- category 4M;
- line;
- part number/name;
- Shift Template;
- approver route/status.

Scope mengikuti role.

### 17.2 TMMIN Dashboard

Widget minimum:

- jumlah supplier aktif per source mode;
- supplier dengan warning aktif;
- total Open dan aging bucket;
- affected parts;
- tren 4M lintas supplier;
- outcome Approved/Rejected/Cancelled;
- supplier/line/part ranking berdasarkan volume;
- ingestion health untuk External supplier;
- Hosted vs External data freshness;
- emergency override visibility;
- recent external validation errors.

Filter minimum:

- supplier;
- source mode;
- date/time range;
- status;
- 4M;
- line snapshot;
- part number/name;
- aging bucket;
- data freshness.

### 17.3 Warning Part

- Setiap Henkaten Open membuat warning instance.
- TMMIN part view mengagregasi warning berdasarkan supplier + part number.
- Part tetap `AFFECTED` selama minimal satu Henkaten untuk supplier/part tersebut Open.
- Approved, Rejected, atau Cancelled menutup warning instance terkait.
- Bila warning lain untuk part yang sama masih Open, aggregate part tetap affected.
- Warning menampilkan Henkaten ID, supplier, source mode, line, part, 4M, opened time, aging, Supervisor state, dan QC state.
- TMMIN tidak dapat menutup warning secara manual.

### 17.4 Traceability

User yang berhak dapat menelusuri:

- submission snapshot;
- checklist snapshot;
- setiap decision;
- assignment movement;
- source/donor job;
- linked Assignment Issue;
- notification;
- Withdraw/Clone relationship;
- source-mode metadata;
- full audit timeline.

Dashboard v1 tidak menyediakan bulk export.

---

## 18. In-App Notification

### 18.1 Channel

V1 hanya menyediakan notification center/in-app. Tidak ada email, SMS, mobile push, atau outbound webhook.

### 18.2 Event Minimum

- Henkaten baru menunggu Supervisor;
- Henkaten baru menunggu QC;
- Henkaten Approved;
- Henkaten Rejected;
- Henkaten Cancelled/Withdrawn;
- MP reservation conflict;
- MP pindah lintas-line;
- donor job menjadi vacant;
- Assignment Issue unresolved;
- Start Shift blocked;
- emergency override;
- external warning opened/closed;
- external ingestion invalid/stale untuk TMMIN Admin;
- account/security event yang relevan.

### 18.3 Behavior

- Notification bersifat persistent sampai dibaca.
- Read/unread disimpan per user.
- Read/unread tidak mengubah domain state.
- Notification deep-link ke resource bila user memiliki permission.
- Unauthorized deep-link tetap ditolak backend.
- Duplicate domain event tidak boleh membuat duplicate notification.

### 18.4 Accepted Limitation

Pengguna yang offline tidak menerima critical warning sampai membuka aplikasi. Ini adalah accepted operational risk v1.

---

## 19. Data Model Konseptual

### 19.1 Core Entities

| Entitas | Tujuan dan relasi utama |
|---|---|
| Supplier | Tenant, code, source mode, source epoch, timezone/default settings, active status. |
| User | Credential principal; TMMIN realm atau supplier realm; role dan account state. |
| Member | Person supplier; role operasional, nomor registrasi, foto opsional. |
| ShiftTemplate | Definisi shift supplier. |
| ShiftRun | Eksekusi shift per line/business date; snapshot dan lifecycle. |
| Line | Master line supplier. |
| Job | Posisi kerja di line. |
| Part | Master part supplier. |
| DefaultAssignment | Baseline Supervisor/LL/MP placement. |
| WorkingAssignment | Assignment aktual pada Shift Run. |
| AssignmentMovement | Ledger immutable perpindahan MP. |
| AssignmentIssue | Vacancy/conflict yang harus diresolve. |
| ChecklistTemplate | Template per 4M. |
| ChecklistVersion | Immutable published version. |
| ChecklistItem | Ordered yes/no question. |
| Henkaten | Aggregate lifecycle 4M. |
| ChecklistSnapshot | Version/labels yang melekat pada Henkaten. |
| ChecklistAnswer | Jawaban immutable per item. |
| ApprovalDecision | Decision route Supervisor atau QC. |
| MPReservation | Lock replacement MP saat Man Henkaten Open. |
| Notification | Per-user in-app notification. |
| ExternalApiClient | Hashed credential metadata, scopes, rotation state, IP allowlist. |
| ExternalIngestionEvent | Raw immutable external request/event dan processing result. |
| ExternalHenkatenProjection | Current monitoring projection data eksternal. |
| AuditEvent | Append-only security/domain audit record. |

### 19.2 Common Fields

Mutable entity minimum:

- `id` UUID;
- `supplierId` bila tenant-scoped;
- `createdAt`, `createdBy`;
- `updatedAt`, `updatedBy`;
- `version`;
- `active` atau state yang sesuai.

Snapshot/immutable entity minimum:

- occurred timestamp;
- actor snapshot;
- correlation ID;
- source metadata;
- payload version.

### 19.3 Optimistic Concurrency

- Mutable API menerima expected `version`.
- Mismatch menghasilkan `409 Conflict`.
- Frontend wajib refresh dan tidak overwrite silently.
- Approval, End Shift, source mode cutover, dan assignment movement juga menggunakan transaction locking.

### 19.4 Data Retention

- Henkaten, approval, shift summary, assignment movement, external ingestion, dan audit disimpan permanen.
- Tidak ada scheduled deletion.
- Deactivation dan revocation tidak menghapus history.
- Hard delete historis dilarang melalui aplikasi.
- Permanent retention atas PII hosted memerlukan governance/legal review TMMIN sebelum production.

---

## 20. External REST API v1

### 20.1 Tujuan dan Boundary

External API hanya untuk supplier dengan `SourceMode=EXTERNAL`. Supplier tetap menjalankan input, checklist, approval, assignment, dan lifecycle pada aplikasinya sendiri. TMMIN menerima monitoring snapshot/event dan tidak mengirim keputusan workflow kembali.

API tidak boleh dipakai untuk:

- membuat hosted user/member;
- menjalankan approval TMMIN;
- mengubah hosted assignment;
- mengakses supplier lain;
- membaca dashboard TMMIN.

### 20.2 Authentication

Model: OAuth 2.0-style Client Credentials yang dikelola platform.

Endpoint:

`POST /api/v1/external/auth/token`

Input:

- `client_id`
- `client_secret`

Output:

- bearer access token;
- `token_type=Bearer`;
- `expires_in=900`;
- scopes.

Aturan:

- client terikat tepat satu supplier dan satu source epoch;
- secret disimpan hashed;
- secret plaintext hanya ditampilkan saat issue/rotation;
- maksimum dua secret valid selama controlled rotation window;
- credential dapat dicabut segera;
- token scope minimum `henkaten:ingest`;
- optional IP allowlist diterapkan sebelum token/ingest;
- token dari source epoch lama tidak berlaku;
- failed authentication di-rate-limit dan diaudit.

### 20.3 Endpoints

#### Single Event

`POST /api/v1/external/henkaten/events`

#### Batch Event

`POST /api/v1/external/henkaten/events/batch`

#### Ingestion Status

`GET /api/v1/external/ingestions/{eventId}`

Status endpoint hanya mengembalikan acknowledgement/validation milik client tersebut, bukan approval atau instruction TMMIN.

### 20.4 Event Types

- `HENKATEN_OPENED`
- `HENKATEN_OPEN_UPDATED`
- `HENKATEN_APPROVED`
- `HENKATEN_REJECTED`
- `HENKATEN_CANCELLED`

Aturan:

- first event untuk satu `sourceHenkatenId` harus `HENKATEN_OPENED` dan `sourceVersion=1`;
- update berikutnya harus menaikkan version secara berurutan;
- terminal event tidak dapat diikuti update lain;
- status tidak dapat diregresikan;
- Approved wajib memiliki Supervisor dan QC Approved;
- Rejected wajib memiliki minimal satu Reject;
- Cancelled wajib memiliki cancellation reason;
- terminal event menutup warning projection.

### 20.5 Request Contract

Setiap event wajib self-contained dan berisi:

```json
{
  "schemaVersion": "1.0",
  "eventId": "opaque-unique-event-id",
  "sourceHenkatenId": "supplier-local-id",
  "sourceVersion": 1,
  "eventType": "HENKATEN_OPENED",
  "status": "OPEN",
  "occurredAt": "2026-07-23T02:00:00.000Z",
  "line": {
    "externalId": "LINE-01",
    "name": "Main Assembly"
  },
  "shift": {
    "externalId": "SHIFT-1",
    "name": "Shift 1",
    "businessDate": "2026-07-23",
    "timezone": "Asia/Jakarta"
  },
  "job": {
    "externalId": "JOB-01",
    "name": "Torque Check"
  },
  "part": {
    "number": "61023-0K100-A1",
    "name": "Example Part"
  },
  "changePoint": "MACHINE",
  "change": {
    "affectedObject": "Impact wrench A",
    "replacementObject": "Impact wrench B",
    "cause": "Maintenance replacement",
    "detail": "Controlled temporary replacement"
  },
  "checklist": {
    "templateVersion": "machine-v3",
    "allPassed": true,
    "items": [
      {
        "externalId": "QC-01",
        "label": "Parameter verified",
        "answer": "YES"
      }
    ]
  },
  "decisions": [],
  "metadata": {
    "sourceSystem": "supplier-app",
    "sourceCorrelationId": "supplier-correlation-id"
  }
}
```

Untuk Man, `change` menggunakan:

- opaque `replacedMpRef`;
- optional `replacedMpDisplayName`;
- opaque `replacementMpRef`;
- optional `replacementMpDisplayName`;
- affected/replacement job snapshot bila relevan.

### 20.6 PII Policy External

Allowed:

- supplier-local opaque person ID;
- role;
- optional display name;
- timestamps;
- optional sanitized approval comment.

Forbidden:

- nomor registrasi;
- foto;
- username;
- password/credential;
- email/phone;
- health/attendance/skill data.

Cause, detail, dan comment adalah freeform; API documentation wajib memperingatkan supplier agar tidak memasukkan PII atau secret. TMMIN dapat menolak payload yang melanggar schema atau safety filters yang ditetapkan.

### 20.7 Decision Contract

Decision object:

```json
{
  "route": "SUPERVISOR",
  "decision": "APPROVED",
  "actorRef": "opaque-local-person-id",
  "actorDisplayName": "optional",
  "decidedAt": "2026-07-23T02:05:00.000Z",
  "comment": "optional sanitized comment"
}
```

QC decision menggunakan `route=QC`. TMMIN tidak memverifikasi internal authorization supplier, tetapi menyimpan data sebagai supplier-attested event dan menampilkan source badge `EXTERNAL`.

### 20.8 Idempotency dan Ordering

- `eventId` unik per supplier/source epoch.
- Duplicate event dengan canonical payload hash sama mengembalikan sukses tanpa record/projection/notification ganda.
- Duplicate `eventId` dengan payload berbeda menghasilkan `409`.
- `sourceVersion` lebih kecil/sama yang bukan identical retry menghasilkan `422`.
- Version gap menghasilkan `422` agar supplier mengirim event yang hilang.
- Terminal transition invalid menghasilkan `422`.
- Raw event disimpan sebelum projection update dalam transaksi yang sama atau reliable transactional-outbox flow.

### 20.9 Batch Semantics

- maksimum 500 event per batch;
- maksimum payload 5 MB;
- envelope invalid menghasilkan `400`;
- event diproses per item, bukan all-or-nothing;
- response `200` berisi result per event: `ACCEPTED`, `DUPLICATE`, atau `REJECTED`;
- ordering untuk `sourceHenkatenId` yang sama mengikuti urutan `sourceVersion`;
- event berbeda boleh berhasil walau satu item gagal.

### 20.10 Response dan Error

Single new event:

- `202 Accepted`
- `ingestionId`
- `eventId`
- `status=ACCEPTED`
- correlation ID

Identical retry:

- `200 OK`
- `status=DUPLICATE`

Error menggunakan `application/problem+json` dan minimum:

- `type`
- `title`
- `status`
- `detail`
- `code`
- `correlationId`
- optional field errors.

Status:

- `400` malformed request;
- `401` invalid/missing credential;
- `403` source mode/scope/IP denied;
- `409` idempotency conflict;
- `413` payload too large;
- `422` schema/business transition/version invalid;
- `429` rate limited;
- `500/503` server/not-ready.

### 20.11 Rate Limit

- token endpoint: 10 attempts per minute per client/IP;
- ingest: 120 requests per minute per client dengan burst 300;
- limits dikirim melalui standard rate-limit headers;
- `Retry-After` wajib pada `429`.

### 20.12 Pagination dan Time

- List/internal API memakai cursor pagination;
- default page 25, maksimum 100;
- seluruh API timestamp memakai ISO 8601 UTC;
- business date dan timezone dikirim terpisah;
- server menolak timestamp yang tidak memiliki offset/Z.

### 20.13 Contract Documentation

- OpenAPI 3.x menjadi source of truth wire contract.
- Schema version ada pada payload.
- Breaking change memerlukan `/v2`.
- Additive optional field dapat ditambahkan pada v1.
- Example request/response dan error wajib tersedia.
- Contract test wajib dijalankan di CI.

---

## 21. Internal API Standards

- Base path `/api/v1`.
- JSON request/response.
- Generated/shared TypeScript contracts untuk kedua frontend.
- Correlation ID diterima dari `X-Correlation-ID` bila valid atau dibuat server.
- Mutation yang sensitif menggunakan expected version/idempotency key.
- Semua validation error bersifat field-addressable.
- List endpoint memakai cursor pagination.
- Search part mendukung part number dan part name.
- Server-side filtering, sorting, dan pagination wajib digunakan untuk dashboard/detail list.
- Health endpoints tidak memerlukan authentication tetapi tidak mengekspos secret.

Endpoints operasional minimum secara capability:

- authentication/session;
- tenant/user/member;
- line/job/part/shift/checklist;
- default/working assignment;
- shift preflight/start/end;
- Henkaten create/detail/list/withdraw/clone;
- approval decision;
- Assignment Board;
- dashboard queries;
- notification read/unread;
- audit timeline;
- external credential management;
- external ingestion.

---

## 22. UX dan Information Architecture

### 22.1 Supplier-facing

Navigasi berdasarkan permission:

- Overview
- Assignment Board
- Henkaten
- Approval Queue
- Shift
- Notifications
- Master Data
- Audit/History
- Account

Supplier Admin melihat seluruh item. Role lain hanya melihat item yang relevan.

### 22.2 TMMIN-facing

- Global Overview
- Active Warnings
- Henkaten Explorer
- Suppliers
- External Ingestion Health
- Audit
- Users/Administration
- System Status

### 22.3 Desktop Scope

- Acceptance target minimum viewport 1280×720.
- Workflow penuh tidak wajib usable pada tablet atau mobile.
- Mobile/tablet dapat menampilkan unsupported viewport message.
- Supported browser: current dan previous major release Chrome dan Edge.
- Internet Explorer tidak didukung.

### 22.4 Accessibility

- Semua fungsi dapat dijalankan dengan keyboard pada desktop.
- Visible focus wajib.
- Form memiliki programmatic labels dan error association.
- Status tidak hanya bergantung pada warna.
- Dialog menjaga focus trap dan restore.
- Kontras mengikuti WCAG 2.1 AA untuk text dan control utama.
- Board item memiliki accessible name yang merangkum line/job/MP/change state.

### 22.5 Empty, Loading, Error, dan Stale States

Setiap screen wajib memiliki:

- loading state;
- empty state dengan next action;
- permission-denied behavior;
- retryable error;
- stale data/conflict message;
- last-updated indication untuk monitoring view.

---

## 23. Arsitektur Teknis

### 23.1 Stack yang Dikunci

- Language: TypeScript.
- Supplier frontend: React + Vite + Tailwind CSS + shadcn/ui.
- TMMIN frontend: React + Vite + Tailwind CSS + shadcn/ui.
- Backend: NestJS.
- ORM/migrations: Prisma.
- Database: PostgreSQL.
- Containers: Docker dan Docker Compose.
- Reverse proxy/TLS: Caddy.
- Unit/integration tests: Vitest.
- E2E: Playwright.

### 23.2 Monorepo

Logical workspace minimum:

- supplier web application;
- TMMIN web application;
- API;
- shared API/domain contracts;
- shared UI primitives bila relevan;
- deployment configuration.

Package manager dan workspace tooling harus menghasilkan reproducible lockfile serta satu perintah root untuk format, lint, typecheck, test, build, dan e2e.

### 23.3 Backend Modules

NestJS module boundary minimum:

- Auth
- Tenancy
- Users/Members
- Master Data
- Shifts
- Assignments
- Checklists
- Henkaten
- Approvals
- Notifications
- Dashboards
- External Ingestion
- Audit
- Health/Readiness

Domain mutation yang menyentuh Henkaten, approval, reservation, warning, dan assignment wajib berada dalam transaction boundary yang jelas.

### 23.4 PostgreSQL

- Semua persistent business data disimpan PostgreSQL.
- Frontend tidak boleh terhubung langsung ke database.
- Local development dan database tests menggunakan Docker-managed PostgreSQL.
- Image local/test dapat pgvector-enabled sesuai repository rule, tetapi vector extension tidak digunakan oleh fitur v1.
- Migration menggunakan Prisma dan expand/contract strategy.
- Referential integrity, unique constraints, dan transaction isolation digunakan sebagai defense-in-depth, bukan hanya validation aplikasi.

### 23.5 File Storage

Foto hosted member disimpan pada persistent application volume di VM atau storage adapter dengan path/metadata di database. V1 tidak memakai external object storage. File tidak boleh disimpan dalam container ephemeral layer.

Accepted limitation: volume foto tidak memiliki backup.

---

## 24. Security Requirements

### 24.1 Application Security

- TLS wajib untuk semua non-local traffic.
- Caddy menambahkan HSTS, X-Content-Type-Options, Referrer-Policy, frame protection/CSP yang sesuai, dan Permissions-Policy.
- CORS allowlist hanya dua frontend environment terkait.
- Cookie authentication dilindungi CSRF.
- Input divalidasi server-side dengan allowlist schema.
- Output encoding mencegah stored/reflected XSS.
- Raw SQL hanya bila parameterized dan direview.
- Rate limit untuk login, external API, dan mutation sensitif.
- File upload divalidasi dan metadata dibersihkan.
- Error response tidak mengekspos stack trace atau secret.

### 24.2 Authorization

- Default deny.
- Role dan tenant authorization dilakukan backend.
- Object-level authorization wajib.
- TMMIN cross-tenant access menggunakan explicit role guard.
- External token hanya dapat ingest ke supplier/source epoch yang terikat.
- Support action TMMIN Admin dicatat secara eksplisit.

### 24.3 Secret Management

- Secret tidak disimpan di repository.
- Environment secret disediakan melalui protected runtime environment/GitHub secrets.
- External API secret disimpan hashed.
- Session secret, DB password, Caddy email, deployment SSH material, dan bootstrap credential dapat dirotasi.
- Log scrubbing wajib untuk password, token, secret, cookie, dan authorization header.

### 24.4 Security Scanning

CI wajib menjalankan:

- Gitleaks;
- dependency review;
- CodeQL JavaScript/TypeScript;
- Trivy filesystem/container scan untuk High/Critical;
- lockfile integrity melalui clean install.

### 24.5 Privacy

- Hosted data mencakup nama, nomor registrasi, dan optional photo.
- External payload meminimalkan PII.
- UI dan API menerapkan least privilege.
- Audit before/after tidak boleh menyimpan password/token.
- Permanent PII retention adalah policy yang memerlukan persetujuan governance TMMIN sebelum go-live.

### 24.6 Explicitly Deferred

- MFA;
- SSO/SAML/OIDC enterprise identity;
- automated data deletion;
- DLP;
- external SIEM integration;
- penetration test automation.

---

## 25. Audit Trail

AuditEvent bersifat append-only dan minimum menyimpan:

- event ID;
- occurred-at UTC;
- actor user/client ID;
- actor role dan supplier scope;
- action;
- resource type dan ID;
- supplier ID;
- sanitized before/after atau change summary;
- reason/comment bila relevan;
- correlation ID;
- source IP;
- user agent/client metadata;
- result success/failure;
- source mode/source epoch.

Event wajib:

- login success/failure/lockout/logout;
- account create/reset/deactivate/role change;
- supplier/source mode/credential change;
- master data mutation;
- default assignment mutation;
- shift preflight/start/override/end;
- Henkaten submit/withdraw/clone/transition;
- approval decision/stale conflict;
- reservation create/release/conflict;
- working assignment movement;
- Assignment Issue create/resolve;
- notification generation;
- external ingest accepted/duplicate/rejected;
- security-sensitive read/export bila fitur kemudian ditambahkan.

Audit tidak dapat diedit atau dihapus melalui aplikasi. Access ke audit juga dicatat.

---

## 26. Observability dan Operability

### 26.1 Structured Logging

Semua service log ke stdout/stderr dalam structured JSON yang memuat:

- timestamp;
- severity;
- service;
- environment;
- release SHA;
- correlation ID;
- request method/path template;
- status/duration;
- actor/client ID yang aman;
- supplier ID bila relevan;
- error code.

PII dan secret tidak boleh muncul.

### 26.2 Metrics

Minimum:

- HTTP request count/error/latency;
- active sessions;
- DB pool/latency/error;
- Henkaten created/finalized by status/4M/source;
- approval aging;
- warning open/close;
- reservation conflict;
- Assignment Issue aging;
- external ingest accepted/duplicate/rejected/lag;
- notification delivery;
- shift override;
- container health/restart.

### 26.3 Health dan Readiness

- `GET /health`: process alive.
- `GET /ready`: database reachable, required migration state valid, critical initialization/index check complete.
- Health response tidak mengekspos credentials atau internal topology.
- Caddy dan Compose healthchecks menggunakan endpoint ini.

### 26.4 Deployment Diagnostics

Deployment log wajib menunjukkan:

- release SHA;
- image/service build result;
- migration result;
- service health;
- smoke-test result;
- rollback result.

External log/metric platform ditentukan TMMIN kemudian; absence of sink tidak menghapus kewajiban structured logs dan metrics.

---

## 27. Performance dan Reliability Targets

Targets diuji pada baseline:

- 42 supplier;
- 20 line per supplier;
- 300 member per supplier;
- 500 job per supplier;
- 30 concurrent user per supplier;
- representative permanent Henkaten history.

| Operation | Target |
|---|---|
| Common authenticated page/API read | p95 ≤ 2 detik |
| Standard mutation termasuk submit/decision | p95 ≤ 3 detik |
| Assignment Board update propagation | p95 ≤ 5 detik |
| TMMIN warning dari Hosted Open | p95 ≤ 5 detik |
| External single ingest acknowledgement | p95 ≤ 2 detik |
| External event sampai projection/warning | p95 ≤ 10 detik |
| Dashboard initial query, filter umum | p95 ≤ 3 detik |
| Server error rate saat load test | < 1% di luar expected 4xx |

Targets diukur dari server/API boundary pada staging-like resources. Frontend wajib memakai pagination/aggregation endpoint dan tidak menarik seluruh history ke browser.

### 27.1 Availability Boundary

Tidak ada formal availability SLA, RPO, atau RTO pada v1. Single VM merupakan single point of failure.

---

## 28. Deployment Topology

### 28.1 Environment Isolation

Staging dan production masing-masing memakai VM terpisah. Setiap VM menjalankan monolithic Compose stack:

- Caddy;
- supplier web;
- TMMIN web;
- API;
- PostgreSQL.

Volume:

- PostgreSQL data;
- Caddy data/config;
- member photo data;
- deployment shared/release state.

### 28.2 Staging Domains

- Supplier: `https://supplier-henkaten.qd-tmmin.site`
- TMMIN: `https://henkaten.qd-tmmin.site`
- API: `https://supplier-henkaten-api.qd-tmmin.site`

### 28.3 Production Domains

Production domain names adalah external dependency dan tetap placeholder sampai diberikan TMMIN:

- `PRODUCTION_SUPPLIER_DOMAIN`
- `PRODUCTION_TMMIN_DOMAIN`
- `PRODUCTION_API_DOMAIN`

Production deployment tidak boleh diaktifkan sebelum ketiga DNS record, TLS reachability, dan runtime env tervalidasi.

### 28.4 Compose Project

Setiap environment memiliki:

- project name berbeda;
- runtime env berbeda;
- volume/path berbeda;
- secret berbeda;
- database berbeda;
- Caddy certificate state berbeda.

Tidak ada shared database atau volume antara staging dan production.

---

## 29. CI/CD dan Release

### 29.1 Branch Behavior

Push ke `staging`:

1. menjalankan seluruh CI/security checks;
2. bila sukses, otomatis deploy ke staging VM;
3. menjalankan smoke/readiness checks;
4. rollback code bila validation gagal dan release sebelumnya tersedia.

Push ke `main`:

1. menjalankan seluruh CI/security checks;
2. bila sukses, otomatis deploy ke production VM;
3. tidak ada manual approval gate;
4. menjalankan smoke/readiness checks;
5. rollback code bila validation gagal dan release sebelumnya tersedia.

### 29.2 Required CI Checks

- clean dependency install;
- format check;
- lint;
- TypeScript typecheck;
- Vitest unit tests;
- PostgreSQL integration tests;
- Playwright E2E;
- production build kedua frontend dan API;
- Compose config validation;
- Docker image build;
- contract/OpenAPI validation;
- Gitleaks;
- dependency review;
- CodeQL;
- Trivy.

### 29.3 Release Mechanics

Adaptasi pola `loom`:

- release directory by Git SHA;
- remote deploy lock;
- runtime env rendered securely;
- preflight Docker/Compose/DNS/path;
- service startup berurutan dengan health check;
- database migration sebelum API readiness;
- Caddy terakhir;
- atomic `current` symlink/release pointer;
- retain lima release terakhir;
- smoke check supplier web, TMMIN web, API health, dan API readiness;
- automatic code rollback pada failed validation.

### 29.4 Migration dan Rollback

- Migration production wajib forward-only dan expand/contract.
- Destructive column/table removal tidak boleh berada pada release yang sama dengan code transition.
- Code rollback hanya dijamin bila database schema backward compatible.
- `prisma migrate reset`, down migration destructive, atau reset database dilarang di staging/production.
- Karena tidak ada backup, migration destructive merupakan accepted critical risk dan harus dicegah melalui CI/review, bukan dipulihkan.

---

## 30. Backup, Recovery, dan High Availability

Keputusan v1:

- tidak ada database backup;
- tidak ada file/photo backup;
- tidak ada WAL archive/PITR;
- tidak ada restore procedure;
- tidak ada RPO;
- tidak ada RTO;
- tidak ada database replica;
- tidak ada failover;
- tidak ada multi-node/high availability.

Konsekuensi:

- kerusakan disk, VM, volume, operator error, atau destructive migration dapat menghilangkan seluruh data permanen;
- release rollback tidak memulihkan database;
- klaim permanent retention hanya berlaku selama storage tidak hilang;
- posture ini bertentangan dengan traceability dan definisi umum enterprise-grade durability.

Risiko ini telah diterima sebagai keputusan v1 dan wajib tetap terlihat sebagai **Critical Accepted Risk** sampai kebijakan berubah. Tim implementasi tidak boleh menyatakan sistem memiliki disaster recovery.

---

## 31. Testing Strategy

### 31.1 Unit Tests - Vitest

Wajib mencakup:

- Henkaten state transitions;
- derived Closed/warning state;
- Supervisor/QC parallel decision;
- reject-fast behavior;
- duplicate/stale decision;
- checklist version/snapshot/all-Yes validation;
- MP reservation uniqueness;
- Man assignment apply/release;
- cascade vacancy;
- Assignment Issue lifecycle;
- default vs Working Assignment;
- Start Shift gates;
- emergency override;
- End Shift auto-cancel/reset;
- Withdraw + Clone;
- source mode cutover;
- permission matrix;
- warning aggregation per supplier/part;
- external version/idempotency rules.

### 31.2 Integration Tests - Real PostgreSQL Container

Wajib menggunakan Docker PostgreSQL, bukan host database, dan mencakup:

- Prisma schema/migrations;
- unique constraints;
- referential integrity;
- transaction rollback;
- row/optimistic locking;
- concurrent approval race;
- concurrent End Shift vs approval;
- concurrent MP reservations;
- tenant scoping;
- audit append-only behavior;
- external event raw+projection consistency;
- out-of-order event rejection;
- source epoch credential invalidation;
- pagination/filtering;
- readiness behavior.

### 31.3 E2E - Playwright

Scenario minimum:

1. TMMIN Admin membuat Hosted supplier dan Supplier Admin.
2. Supplier Admin first-login reset.
3. Admin membuat shift, member, akun, line, job, part, checklist, dan default assignment.
4. LL login dan Start Shift valid.
5. LL menginput setiap kategori 4M.
6. Submission gagal bila satu checklist bukan Yes.
7. Supervisor approve lalu QC approve.
8. QC approve lalu Supervisor approve.
9. Supervisor reject cepat.
10. QC reject cepat.
11. LL Withdraw + Clone.
12. Man Henkaten memindahkan MP lintas-line.
13. Donor line memperoleh vacancy/notification.
14. Duplicate reservation ditolak.
15. Start Shift blocked dan Admin override.
16. End Shift auto-cancel Open dan reset assignment.
17. TMMIN warning muncul selama Open dan hilang saat terminal.
18. Role hanya melihat scope yang diizinkan.
19. External client token/ingest/duplicate/conflict/out-of-order.
20. TMMIN dashboard menampilkan Hosted dan External source badge.

### 31.4 Security Negative Tests

- Supplier A tidak dapat membaca/mengubah Supplier B.
- LL tidak dapat spoof line ID.
- Supervisor tidak dapat approve line lain.
- QC tidak dapat mengubah decision yang sudah dikunci.
- Supplier Admin tidak dapat approve.
- TMMIN Quality tidak dapat mutate.
- External client tidak dapat ingest supplier/source epoch lain.
- Terminal Henkaten tidak dapat diedit.
- Disabled user/session ditolak.
- CSRF, CORS, IDOR, over-posting, dan mass-assignment probes ditolak.
- Photo upload berbahaya/invalid ditolak.

### 31.5 Performance Tests

- Load profile menggunakan baseline Compact.
- Test read, mutation, dashboard, board update, warning creation, dan external ingest.
- Test concurrent approval dan MP selection.
- Test permanent-history query dengan dataset representatif.
- Hasil p95/p99 dan error rate dicatat sebagai release evidence.

### 31.6 Deployment Tests

- Compose config valid dengan example env.
- Semua image build.
- Health/readiness lulus.
- Fresh database migration lulus.
- Upgrade dari release sebelumnya lulus.
- Smoke test tiga domain lulus.
- Code rollback rehearsal lulus pada backward-compatible schema.

---

## 32. Acceptance Criteria v1

### 32.1 Tenancy dan Identity

- [ ] TMMIN Admin dapat membuat supplier HOSTED/EXTERNAL.
- [ ] Supplier login menggunakan Supplier Code + Username + Password.
- [ ] Username supplier hanya perlu unik di tenant.
- [ ] Cross-tenant access gagal pada UI dan API.
- [ ] Hanya satu Supplier Admin aktif.
- [ ] MP tidak dapat login.
- [ ] Password tidak pernah disimpan plaintext.

### 32.2 Master Data dan Assignment

- [ ] Admin dapat CRUD individual seluruh master data in-scope.
- [ ] Data referenced hanya dapat dinonaktifkan.
- [ ] Default uniqueness Supervisor/LL/MP terjaga.
- [ ] Perubahan default saat shift aktif tidak mengubah Working Assignment.
- [ ] Foto opsional dan initials fallback bekerja.

### 32.3 Shift

- [ ] Shift configurable dan mendukung cross-midnight.
- [ ] Satu line tidak memiliki dua active Shift Run.
- [ ] Preflight mendeteksi seluruh hard gate.
- [ ] Pre-start Man resolution tersedia.
- [ ] Emergency override hanya Supplier Admin dan selalu diaudit.
- [ ] End Shift auto-cancel Open, release reservation, close warning, dan reset assignment.

### 32.4 Henkaten

- [ ] LL hanya dapat input untuk line sendiri.
- [ ] Part dapat dicari dengan number/name.
- [ ] Keempat kategori 4M didukung.
- [ ] Semua checklist wajib Yes.
- [ ] Snapshot checklist immutable.
- [ ] Status hanya mengikuti transition yang diizinkan.
- [ ] Withdraw + Clone menjaga relationship dan audit.

### 32.5 Approval

- [ ] Supervisor dan QC dapat memutuskan paralel.
- [ ] Dua Approve menghasilkan Approved.
- [ ] Reject pertama langsung menghasilkan Rejected.
- [ ] Decision actor/time/comment tersimpan.
- [ ] Double/stale decision tidak overwrite.
- [ ] TMMIN role tidak dapat approve.

### 32.6 Man Change

- [ ] Replacement MP di-reserve saat Open.
- [ ] MP tidak dapat memiliki dua reservation.
- [ ] Assignment baru berlaku hanya setelah final Approved.
- [ ] Cross-line move membuat donor vacancy/Assignment Issue.
- [ ] Rejected/Cancelled tidak mengubah assignment.
- [ ] End Shift mengembalikan assignment ke default.

### 32.7 Board, Dashboard, Warning

- [ ] Assignment Board menampilkan line/job/MP/vacancy dan indikator 4M.
- [ ] Indikator tidak hanya bergantung pada warna.
- [ ] Scope board/dashboard sesuai role.
- [ ] Open membuat warning TMMIN.
- [ ] Terminal status menutup warning instance.
- [ ] Aggregate part tetap affected bila masih ada Open lain.
- [ ] TMMIN dashboard mendukung Hosted dan External.

### 32.8 External API

- [ ] Credential hanya dapat ingest tenant/source epoch sendiri.
- [ ] Single/batch ingest tervalidasi.
- [ ] Identical retry idempotent.
- [ ] Conflicting duplicate menghasilkan 409.
- [ ] Out-of-order/invalid transition menghasilkan 422.
- [ ] PII forbidden tidak menjadi bagian contract.
- [ ] Raw event dan current projection dapat ditelusuri.
- [ ] TMMIN tidak mengubah workflow external supplier.

### 32.9 Non-Functional

- [ ] Performance target dipenuhi pada baseline Compact.
- [ ] Unit, integration, E2E, security, build, dan scan CI lulus.
- [ ] Staging deploy otomatis dari `staging`.
- [ ] Production deploy otomatis dari `main`.
- [ ] Three-domain smoke/readiness checks lulus.
- [ ] Accepted critical risks ditampilkan di release readiness.

---

## 33. Success Metrics

Setelah go-live, produk dianggap memenuhi outcome bila:

- 100% Hosted Henkaten terminal memiliki actor dan timestamp decision yang lengkap;
- 100% Man Henkaten Approved memiliki assignment movement ledger;
- 0 valid duplicate active MP assignment/reservation;
- 100% Henkaten Open menghasilkan warning TMMIN;
- 100% warning ditutup secara deterministik pada terminal transition;
- 0 cross-tenant data exposure;
- seluruh audit event kritis tersedia;
- performance target p95 terpenuhi pada baseline;
- external duplicate events tidak menggandakan projection/warning;
- paper/manual board bukan lagi source of truth untuk supplier Hosted yang sudah cutover.

Metrik adoption, cycle time approval, reject rate, dan aging dipantau melalui dashboard tetapi target bisnis numeriknya ditetapkan TMMIN setelah baseline awal tersedia.

---

## 34. Explicit Out-of-Scope v1

- health monitoring;
- attendance/leave management;
- shift employee scheduling di luar Shift Run Henkaten;
- skill matrix, skill level, license, dan replacement recommendation;
- moral monitoring;
- task planning/result record;
- process difficulty/hard-medium-easy;
- Yamazumi/standardized work management;
- machine telemetry dan automatic machine event;
- material inventory/procurement;
- quality inspection execution di luar Henkaten checklist;
- TMMIN QC × production integration;
- email, SMS, push, Slack, Teams, atau webhook notification;
- bulk CSV/Excel import/export;
- document/photo attachment pada Henkaten selain member photo;
- native mobile app;
- full tablet/mobile responsive workflow;
- AI/ML/vector search;
- supplier external assignment board di TMMIN;
- hosted approval bagi supplier External;
- MFA;
- SSO;
- backup/recovery/PITR;
- HA/multi-node/multi-region;
- managed database/object storage;
- production manual approval gate.

---

## 35. Risiko dan Mitigasi

| Risiko | Severity | Status | Mitigasi v1 |
|---|---|---|---|
| Tidak ada backup/recovery; seluruh data dapat hilang | Critical | Accepted | Tidak ada recovery mitigation; cegah destructive operation, surface risk. |
| Single VM adalah single point of failure | Critical | Accepted | Health/readiness, restart policy, observability; bukan HA. |
| Auto production deploy tanpa approval | High | Accepted | Mandatory CI/security/smoke checks dan code rollback. |
| DB migration gagal tanpa backup | Critical | Accepted | Expand/contract, forward-only, CI migration tests; recovery tidak tersedia. |
| In-app-only alert tidak menjangkau user offline | High | Accepted | Persistent notification, dashboard aging; external channels deferred. |
| Permanent PII retention | High | Open governance dependency | Least privilege, no hard delete, legal/privacy approval sebelum go-live. |
| Satu Supplier Admin menjadi operational bottleneck | Medium | Accepted | TMMIN reset/replacement capability; multi-admin deferred. |
| CRUD-only onboarding lambat untuk 300 member/500 job | Medium | Accepted | Clear forms, validation, progressive setup; bulk import deferred. |
| Desktop-only membatasi shop-floor device | Medium | Accepted | Minimum desktop viewport; tablet/mobile deferred. |
| Cross-line Man cascade menciptakan vacancy baru | High | Mitigated | Reservation, Assignment Issue, hard gate, notification, transaction. |
| External supplier mengirim data tidak lengkap/tidak benar | High | Mitigated | Schema, versioning, validation, attestation/source badge, ingestion health. |
| Freeform field mengandung PII/secret | Medium | Partially mitigated | Documentation, length/schema validation, access control, no secret logging. |

---

## 36. External Dependencies dan Launch Blockers

Production launch membutuhkan:

- production supplier/TMMIN/API domains;
- production VM dan SSH/deploy user;
- DNS mengarah ke production VM;
- GitHub Actions secrets;
- Caddy email;
- database/runtime secrets;
- TMMIN account bootstrap;
- security/privacy approval untuk permanent hosted PII retention;
- acceptance bahwa tidak ada backup/recovery;
- acceptance bahwa deployment production otomatis;
- representative supplier master data untuk UAT;
- designated TMMIN Admin dan Quality users.

Production domain, credential value, IP, dan secret tidak boleh ditulis di repository.

---

## 37. Release Readiness Checklist

V1 siap dirilis bila:

1. seluruh acceptance criteria wajib lulus;
2. role/tenant security tests lulus;
3. PostgreSQL migration fresh dan upgrade lulus;
4. load test baseline Compact memenuhi target;
5. external OpenAPI dan contract tests lulus;
6. staging UAT mencakup Hosted dan External supplier;
7. staging three-domain smoke/readiness lulus;
8. production DNS/runtime dependency tersedia;
9. critical accepted risks telah disetujui TMMIN secara tertulis;
10. operational owner untuk incident/deployment tersedia;
11. tidak ada unresolved Critical/High security finding;
12. production deployment dan rollback procedure telah direhearsal pada staging.

---

## 38. Keputusan Produk yang Dikunci

Ringkasan keputusan yang tidak boleh ditafsirkan ulang saat implementasi:

- approval paralel, reject pertama langsung terminal;
- warning TMMIN hanya selama Open dan selesai juga saat Rejected;
- external supplier hanya mengirim data monitoring; TMMIN read-only;
- Man move diterapkan setelah final Approved, bukan saat submit;
- replacement MP di-reserve saat Open;
- replacement boleh berasal dari line/job lain dan membuat cascade vacancy;
- Start Shift hard gate dengan Supplier Admin emergency override;
- End Shift auto-cancel seluruh Open;
- shift configurable per supplier;
- checklist per kategori 4M dan berversi;
- external PII diminimalkan;
- satu source mode aktif per supplier;
- notification in-app saja;
- tidak ada MFA;
- permanent logical retention;
- tidak ada backup/recovery/RPO/RTO/HA;
- staging dan production memakai VM terpisah;
- baseline kapasitas Compact;
- master data CRUD individual tanpa bulk import/export;
- desktop-only;
- production deploy otomatis dari `main`;
- supplier login memakai Supplier Code + Username;
- correction memakai Withdraw + Clone;
- foto member opsional dengan initials fallback;
- process difficulty dan seluruh fitur non-Henkaten tidak masuk scope.
