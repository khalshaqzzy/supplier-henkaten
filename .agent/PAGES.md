# Frontend Page and User-flow Specification

| Atribut | Nilai |
|---|---|
| Status | Approved frontend implementation specification |
| Tanggal | 24 Juli 2026 |
| Aplikasi | `supplier-web`, `tmmin-web` |
| Product contract | `.agent/PRD.md` |
| Executable backend contract | `apps/api/openapi/openapi.json` dan `packages/contracts` |
| Target | Desktop Chrome/Edge current dan previous major, minimum 1280×720 |

Dokumen ini mendefinisikan halaman, informasi, input, action, state, permission, dan alur pengguna
untuk dua frontend Enterprise Digital Henkaten Management. PRD tetap menjadi authority perilaku
produk. Kontrak API yang tersedia menentukan apa yang dapat langsung diimplementasikan. Perbedaan
antara keduanya dicatat eksplisit dan tidak boleh ditutup dengan business rule buatan frontend.

Dokumen ini tidak mendefinisikan visual design, component library, CSS, warna, typography, spacing,
layout, atau responsive styling. Kata **element** di dokumen ini hanya berarti informasi, input,
action, status, atau behavior yang dibutuhkan pengguna.

---

## 1. Cara Membaca Dokumen

### 1.1 Status Dependency

Setiap halaman memakai salah satu status berikut:

| Status | Arti |
|---|---|
| `AVAILABLE` | Endpoint, schema, dan capability minimum sudah tersedia. |
| `ADDITIVE API REQUIRED` | PRD membutuhkan data atau query tambahan yang belum ada; perubahan harus backward-compatible. |
| `POLICY MISMATCH` | Permission PRD dan capability backend saat ini berbeda dan harus direkonsiliasi sebelum implementasi final. |

Status berlaku per dependency, bukan selalu untuk seluruh halaman. Halaman boleh dibangun sebagian
dengan dependency `AVAILABLE`, tetapi requirement bertanda gap tidak boleh dihapus atau digantikan
dengan kalkulasi client yang menjadi business authority.

### 1.2 Format Spesifikasi Halaman

Setiap halaman atau kelompok halaman menjelaskan:

- **Route**: URL frontend yang stabil dan dapat menjadi deep link.
- **Pengguna**: role atau session purpose yang boleh masuk.
- **Tujuan**: outcome pengguna, bukan deskripsi tampilan.
- **Entry point**: asal navigasi atau domain event yang membawa pengguna.
- **Elements**: informasi, filter, input, status, dan action.
- **Validasi dan rules**: constraint yang perlu dipahami pengguna.
- **States**: loading, empty, error, conflict, stale, atau terminal behavior khusus.
- **Alur keluar**: tujuan setelah action berhasil atau dibatalkan.
- **Dependency**: endpoint/capability yang tersedia atau gap kontrak.

### 1.3 Route dan Query-state Convention

- Route ID memakai opaque UUID dari API; human-readable Henkaten identifier hanya untuk display dan
  pencarian.
- List filter, sort, cursor direction yang aman, dan tab bermakna disimpan pada query string agar
  refresh, bookmark, dan back/forward browser tidak menghilangkan konteks.
- Cursor opaque tidak diedit pengguna. Pindah filter menghapus cursor lama.
- Return path setelah login hanya boleh berupa route internal untuk realm yang sama. URL eksternal,
  login route, forbidden route, dan route realm lain diabaikan.
- Detail route yang dibuka dari notification atau dashboard harus tetap memvalidasi permission
  melalui API. Frontend tidak menganggap kepemilikan deep link sebagai authorization.
- Route yang tidak dikenal menghasilkan Not Found. Route valid tanpa capability menghasilkan
  Forbidden, bukan dialihkan diam-diam ke halaman lain.

---

## 2. Fondasi UX Lintas Aplikasi

### 2.1 Identity Realm dan Session Bootstrap

Supplier dan TMMIN adalah identity realm terpisah:

- `supplier-web` hanya memakai `/api/v1/auth/supplier/*`;
- `tmmin-web` hanya memakai `/api/v1/auth/tmmin/*`;
- session dari realm yang salah diperlakukan sebagai unauthenticated pada aplikasi yang sedang
  dibuka;
- logout membersihkan seluruh query cache, data form sementara, idempotency key yang belum dipakai,
  dan informasi sensitif one-time;
- pergantian user, supplier, role, session purpose, atau realm tidak boleh menggunakan cache session
  sebelumnya;
- bootstrap memeriksa session sebelum merender route terlindungi;
- `mustChangePassword=true` hanya mengizinkan session check, password change, dan logout;
- `purpose=HOSTED_PREPARATION` menggunakan navigation terbatas dan tidak mengizinkan operational
  Hosted routes.

Session expiry saat pengguna sedang bekerja:

1. mutation dihentikan dan input yang tidak sensitif dipertahankan sementara;
2. pengguna diarahkan ke login realm yang benar dengan safe intended path;
3. setelah login, form tidak otomatis dikirim ulang;
4. pengguna meninjau ulang data dan mengirim manual;
5. cache lama tetap dibuang walaupun user yang login kembali memiliki username sama.

Dependency:

- `AVAILABLE`: supplier/TMMIN login, session, change-password, dan logout.
- `ADDITIVE API REQUIRED`: Supplier session belum memuat nama/code/timezone/source mode tenant untuk
  application context yang authoritative.

### 2.2 Navigation dan Permission

- Navigation disusun dari capability yang dipetakan terhadap role dan session purpose.
- Menyembunyikan navigation/action hanya mengurangi kebingungan; backend tetap authority.
- Response `403` selalu dapat ditangani walaupun control seharusnya tidak terlihat.
- Supplier Admin dengan session normal melihat seluruh administration dan monitoring supplier,
  tetapi tidak melihat action approve/reject atau normal Start/End Shift.
- Supervisor hanya melihat data line yang menjadi responsibility-nya.
- Line Leader hanya mengoperasikan line sendiri.
- QC melihat seluruh line tenant dan satu shared QC approval queue.
- TMMIN Quality tidak pernah memperoleh action yang mengubah supplier, credential, source mode,
  user, Henkaten, assignment, atau warning.
- TMMIN Admin dapat melakukan administration tetapi tidak pernah approve/reject Henkaten supplier.

### 2.3 Form, Validation, dan Submission

- Client validation membantu sebelum request; server validation tetap final.
- `fieldErrors.path` dipetakan ke field yang sesuai. Error non-field masuk ke form summary.
- Setelah gagal validasi, fokus berpindah ke error pertama dan seluruh input valid tetap tersimpan.
- Form edit membawa `expectedVersion` dari resource terakhir yang berhasil dibaca.
- `409 VERSION_CONFLICT` atau `STATE_CONFLICT` tidak boleh melakukan overwrite atau automatic merge.
  Pengguna harus refresh, membandingkan state terbaru, lalu mengulangi perubahan.
- Mutation dengan `Idempotency-Key` membuat satu key per user intent. Retry exact request memakai key
  yang sama; perubahan payload membuat key baru.
- Submit dinonaktifkan secara behavior selama request identik masih berlangsung. Double click,
  Enter berulang, atau reconnect tidak boleh membuat intent kedua.
- Meninggalkan form kotor membutuhkan konfirmasi. Setelah sukses atau explicit discard, guard
  dilepas.
- Value rahasia, password, secret, CSRF token, dan Authorization data tidak pernah dimasukkan ke URL,
  client log, analytics, atau persistent browser storage.

### 2.4 Lists, Search, Filter, dan Pagination

- Semua production list memakai server-side pagination dan filter.
- Default page size 25; pilihan tidak boleh melebihi API maximum 100.
- Search hanya dijalankan setelah input bermakna dan dapat dibersihkan dalam satu action.
- Empty dataset menjelaskan prerequisite atau action pertama.
- Empty filtered result membedakan “belum ada data” dari “tidak ada hasil filter” dan menawarkan
  reset filter.
- Filter yang tidak didukung API tidak boleh disimulasikan dengan memfilter satu halaman cursor di
  client.
- Pindah ke detail lalu kembali mempertahankan filter dan posisi list sejauh cursor masih valid.
- Resource yang berubah/deactivated saat list terbuka memicu invalidation dan refetch.

### 2.5 One-time Credential dan High-impact Action

Temporary password dan external client secret:

- hanya ditampilkan dari response create/reset/rotate yang baru berhasil;
- response diperlakukan `no-store`;
- pengguna harus mengakui bahwa value telah disalin/disalurkan melalui proses aman;
- menutup halaman menghapus value dari memory;
- value tidak dapat ditampilkan ulang;
- kehilangan value diselesaikan melalui reset atau rotation, bukan recovery plaintext.

Action berikut selalu membutuhkan consequence review dan explicit confirmation:

- deactivate supplier/member/account/master data;
- replace Supplier Admin;
- reset password;
- publish/activate/deactivate checklist;
- atomic move LL/MP;
- emergency Start Shift;
- End Shift;
- Withdraw Henkaten;
- approve/reject;
- source preparation start/cancel;
- source cutover;
- external client rotate/revoke.

Konfirmasi tidak meminta user mengetik ulang identifier kecuali PRD/API kemudian mewajibkannya.
Alasan wajib divalidasi sesuai contract, termasuk minimum 10 karakter untuk emergency override,
Hosted Preparation, cancellation preparation, dan source cutover.

### 2.6 Error dan Recovery Contract

| HTTP/problem | Behavior frontend |
|---|---|
| `400 VALIDATION_FAILED` | Tampilkan field/non-field errors; pertahankan input. |
| `401 AUTHENTICATION_FAILED` | Login memakai pesan generik tanpa supplier/account enumeration. |
| `401 SESSION_EXPIRED` | Bersihkan cache, simpan safe intended path, kembali ke login. |
| `403 FORBIDDEN` | Tampilkan Forbidden dan jalan kembali yang aman; jangan retry otomatis. |
| `404 RESOURCE_NOT_FOUND` | Tampilkan Not Found atau removed/unavailable state tanpa membocorkan tenant lain. |
| `409 VERSION_CONFLICT` | Tawarkan refresh; jangan overwrite atau auto-submit ulang. |
| `409 STATE_CONFLICT` | Jelaskan state terbaru dan action recovery yang berasal dari server. |
| `409 IDEMPOTENCY_CONFLICT` | Hentikan retry dan minta pengguna memulai intent baru setelah refresh. |
| `409 RESERVATION_CONFLICT` | Refresh assignment/replacement availability dan minta pilihan baru. |
| `422` | Tampilkan business/transition error dan link ke resource/prerequisite bila tersedia. |
| `429 RATE_LIMITED` | Hormati `Retry-After`; tampilkan kapan action dapat dicoba kembali. |
| `500/503` | Tampilkan retryable service state dan correlation ID untuk support. |

Correlation ID selalu tersedia untuk disalin pada error, tetapi tidak dianggap sebagai informasi
domain. Retry otomatis hanya untuk read yang aman dan tidak dilakukan untuk authorization,
validation, conflict, atau mutation yang status commit-nya tidak pasti.

### 2.7 Loading, Empty, Partial, Stale, dan Realtime

Setiap page memiliki:

- initial loading tanpa menampilkan data user sebelumnya;
- section-level loading untuk refetch yang tidak menghilangkan data valid saat ini;
- empty state dengan next action sesuai permission;
- retryable error dengan correlation ID;
- forbidden dan not-found state;
- stale/conflict state;
- last successful update untuk monitoring data.

Assignment Board:

- SSE hanya menginvalidasi/refetch authoritative read model;
- disconnect menandai data stale dan mempertahankan `lastUpdatedAt`;
- reconnect melanjutkan event ID bila tersedia lalu melakukan refetch;
- user dapat retry manual;
- data stale tidak boleh dipresentasikan sebagai current tanpa warning.

Partial failure pada dashboard tidak mengubah data lama menjadi nol. Section gagal ditandai tidak
tersedia dan section lain tetap dapat digunakan.

### 2.8 Time, Business Date, dan Freshness

- Semua timestamp API diperlakukan sebagai ISO 8601 UTC.
- Waktu Hosted ditampilkan dalam timezone supplier; TMMIN cross-supplier view selalu menyertakan
  timezone/context supplier bila makna business date dapat ambigu.
- Business date adalah tanggal mulai Shift Template pada timezone supplier, termasuk shift
  cross-midnight.
- Relative aging tidak menggantikan timestamp absolut.
- Monitoring view menampilkan generated/last-updated/freshness time dari server.
- Client clock tidak menjadi authority lifecycle, ordering, aging bucket, atau cutover.

### 2.9 Accessibility dan Desktop Boundary

- Seluruh input/action dapat dijangkau dan dijalankan dengan keyboard.
- Setiap input memiliki programmatic label, description bila diperlukan, dan association ke error.
- Setelah navigation, fokus berada pada page heading; setelah dialog/confirmation ditutup, fokus
  kembali ke pemicu yang masih valid.
- Status menyertakan text yang dapat dipahami tanpa warna.
- Board job memiliki accessible name yang merangkum line, job, MP, assignment state, 4M, dan approval
  state.
- Di bawah viewport minimum, aplikasi memberi unsupported viewport message, mempertahankan akses ke
  logout, dan tidak mengklaim workflow penuh didukung.

---

## 3. Supplier-facing Information Architecture

### 3.1 Route Visibility Matrix

Legenda: `V` view, `O` operate, `M` manage, `D` decide, `-` tidak tersedia.

| Area | Supplier Admin | Supervisor | Line Leader | QC | Hosted Preparation |
|---|---:|---:|---:|---:|---:|
| Overview | V seluruh tenant | V scoped line | V own line | V seluruh tenant | Setup progress |
| Assignment Board | V seluruh tenant | V scoped line | V own line | V seluruh tenant | - |
| Henkaten list/detail | V seluruh tenant | V scoped line | V own line | V seluruh tenant | - |
| Create/Withdraw/Clone | - | - | O own line | - | - |
| Approval Queue | - | D scoped line | - | D seluruh tenant | - |
| Shift | Override/read | V scoped line | O own line | V seluruh tenant | - |
| Notifications | V | V | V | V | - |
| Master Data | M | - | - | - | M |
| Default Assignment | M | - | - | - | M |
| Audit | V | PRD scoped | PRD scoped | PRD tenant | - |
| Account | O | O | O | O | O |

Catatan:

- API saat ini hanya memberikan `SUPPLIER_AUDIT_READ` kepada Supplier Admin. Akses audit
  Supervisor, Line Leader, dan QC pada PRD adalah `POLICY MISMATCH`.
- Hosted Preparation hanya boleh membuka setup/master-data, default assignment, account, dan logout.
  Semua operational route ditolak sebelum request bila purpose session masih preparation.

### 3.2 Supplier Route Catalog

| Route | Page | Pengguna |
|---|---|---|
| `/login` | Supplier Login | Anonymous |
| `/change-password` | Forced/Voluntary Password Change | Authenticated supplier |
| `/unsupported-viewport` | Unsupported Viewport | Semua |
| `/` | Supplier Overview | Normal session semua role |
| `/setup` | Supplier Setup Progress | Supplier Admin/preparation |
| `/board` | Assignment Board | Semua normal supplier role |
| `/henkatens` | Henkaten List | Semua normal supplier role |
| `/henkatens/new` | Create Henkaten | Line Leader |
| `/henkatens/:henkatenId` | Henkaten Detail | Scope-permitted roles |
| `/henkatens/:henkatenId/clone` | Clone Henkaten | Line Leader |
| `/approvals` | Approval Queue | Supervisor, QC |
| `/shifts` | Shift List and Current Shift | Normal session semua role |
| `/shifts/prepare` | Prepare Shift | Line Leader |
| `/shifts/:shiftRunId` | Shift Detail | Scope-permitted roles |
| `/shifts/:shiftRunId/resolve` | Pre-start/Assignment Resolution | Line Leader |
| `/notifications` | Notification Center | Normal session semua role |
| `/master-data` | Master Data Overview | Supplier Admin/preparation |
| `/master-data/members` | Members | Supplier Admin/preparation |
| `/master-data/members/new` | Create Member | Supplier Admin/preparation |
| `/master-data/members/:memberId` | Member Detail/Edit | Supplier Admin/preparation |
| `/master-data/lines` | Lines and Jobs | Supplier Admin/preparation |
| `/master-data/lines/new` | Create Line | Supplier Admin/preparation |
| `/master-data/lines/:lineId` | Line and Job Detail | Supplier Admin/preparation |
| `/master-data/parts` | Parts | Supplier Admin/preparation |
| `/master-data/parts/new` | Create Part | Supplier Admin/preparation |
| `/master-data/parts/:partId` | Part Detail/Edit | Supplier Admin/preparation |
| `/master-data/shifts` | Shift Templates | Supplier Admin/preparation |
| `/master-data/shifts/new` | Create Shift Template | Supplier Admin/preparation |
| `/master-data/shifts/:templateId` | Shift Template Detail/Edit | Supplier Admin/preparation |
| `/master-data/checklists` | Checklist Overview | Supplier Admin/preparation |
| `/master-data/checklists/:category` | Checklist Draft/Versions | Supplier Admin/preparation |
| `/master-data/default-assignments` | Default Assignments | Supplier Admin/preparation |
| `/audit` | Supplier Audit | Supplier Admin; other roles after policy resolution |
| `/account` | Account and Session | Authenticated supplier |

### 3.3 Authentication Pages

#### Supplier Login

- **Route:** `/login`
- **Pengguna:** anonymous supplier user.
- **Tujuan:** membuat session Supplier tanpa mengungkap apakah supplier code atau username valid.
- **Entry point:** direct access, expired session, logout, atau protected route.
- **Elements:** Supplier Code, Username, Password, submit, generic failure, lockout/rate-limit
  feedback, dan safe return-path context.
- **Validasi dan rules:** ketiga field wajib; trim code/username; password tidak diubah; semua
  credential failure memakai pesan generik.
- **States:** initial, submitting, invalid, rate-limited dengan retry time, API unavailable, dan
  already-authenticated redirect.
- **Alur keluar:** forced reset bila `mustChangePassword`; selain itu safe intended path atau `/`.
- **Dependency:** `AVAILABLE` melalui supplier login/session.

#### Password Change

- **Route:** `/change-password`
- **Pengguna:** authenticated supplier, wajib bila temporary password.
- **Tujuan:** mengganti temporary/current password sebelum capability lain digunakan.
- **Elements:** current password, new password, confirmation client-side, password rules, submit,
  logout.
- **Validasi dan rules:** 12–128 karakter; berbeda dari current; confirmation cocok; reuse lima
  password terakhir ditolak server.
- **States:** forced mode tanpa application escape, voluntary mode, validation, conflict/session
  expiry, success.
- **Alur keluar:** bootstrap session ulang lalu intended path atau `/`.
- **Dependency:** `AVAILABLE`.

#### Account and Session

- **Route:** `/account`
- **Pengguna:** seluruh authenticated supplier sessions.
- **Tujuan:** melihat identity/session context, mengganti password, dan logout.
- **Elements:** display name, role, session purpose, idle/absolute expiry, password-change link,
  logout.
- **Validasi dan rules:** tidak menyediakan role/profile editing.
- **States:** session loading, expiry warning, logout failure/retry.
- **Dependency:** `AVAILABLE`; supplier identity metadata tambahan adalah `ADDITIVE API REQUIRED`.

### 3.4 Overview dan Setup

#### Supplier Overview

- **Route:** `/`
- **Pengguna:** seluruh normal supplier roles; scope data mengikuti role.
- **Tujuan:** mengetahui workload/current risk dan menuju action terpenting.
- **Entry point:** post-login, main navigation, atau dashboard notification.
- **Elements:** totals per lifecycle, active warnings, pending Supervisor/QC, approval aging, 4M
  trend, Henkaten per line/part, outcome trend, recent activity, unresolved Assignment Issues,
  emergency overrides, date/status/category/line/part/shift/approval filters, generated time, dan
  drill-down.
- **Validasi dan rules:** angka tidak dihitung dari current cursor page; role scope berasal dari
  backend; date range valid dan timezone-aware.
- **States:** new tenant mengarah ke setup untuk Admin; role tanpa activity mendapat scope-specific
  empty state; section errors tidak menjadi angka nol.
- **Alur keluar:** filtered Henkaten, approval queue, shift issue, board line, atau setup.
- **Dependency:** basic totals/category/line/part/outcome/recent activity `AVAILABLE`.
  Approval aging, time-series trend, Shift Template/approval filters, dan detailed issue/override
  drill-down adalah `ADDITIVE API REQUIRED`.

#### Supplier Setup Progress

- **Route:** `/setup`
- **Pengguna:** Supplier Admin normal dan Hosted Preparation.
- **Tujuan:** membawa tenant kosong menuju konfigurasi yang lulus Hosted readiness.
- **Elements:** session purpose/source context; status Shift Templates, members/accounts, lines/jobs,
  parts, empat published active checklists, Supervisor/LL/MP defaults; blockers; ordered next action;
  refresh readiness.
- **Validasi dan rules:** urutan yang disarankan adalah shift, members, lines/jobs, parts,
  checklists, defaults. Individual form saja; tidak ada bulk import/export.
- **States:** empty tenant, partially configured, ready, preparation mode, stale after another admin
  change.
- **Alur keluar:** deep link ke prerequisite berikutnya; normal Hosted Admin kembali ke overview
  saat ready; preparation Admin tetap tidak dapat masuk operational pages.
- **Dependency:** individual master-data reads `AVAILABLE`; authoritative consolidated readiness dan
  normal Hosted readiness endpoint `ADDITIVE API REQUIRED`. TMMIN cutover preflight tidak boleh
  dipakai sebagai supplier self-service authority.

### 3.5 Assignment Board

- **Route:** `/board?lineId=...`
- **Pengguna:** Supplier Admin/QC seluruh tenant; Supervisor scoped line; Line Leader own line.
- **Tujuan:** melihat Working Assignment dan active change state tanpa full-page reload.
- **Entry point:** navigation, overview line drill-down, shift detail, notification, Henkaten detail.
- **Elements:** last updated/realtime state; line, Shift Template, business date, Supervisor, LL;
  ordered jobs; MP name/registration/photo-or-initials; assigned/vacant/reserved/conflicted state;
  Open/Approved 4M indicators; Supervisor/QC route state; critical unresolved override context;
  line filter yang hanya menawarkan allowed scope.
- **Validasi dan rules:** Rejected/Cancelled tidak menjadi active indicator; Approved tetap active
  sampai End Shift; Open Man hanya prospective/reserved dan belum mengubah effective assignment.
- **States:** no active shift, active shift empty jobs, disconnected/stale, line removed from scope,
  retry failure, and realtime refetch.
- **Alur keluar:** Henkaten detail, shift detail, Assignment Issue resolution bila role berhak.
- **Dependency:** board read model dan SSE `AVAILABLE`. Explicit critical override banner detail di
  board response mungkin membutuhkan additive read field: `ADDITIVE API REQUIRED`.

### 3.6 Henkaten Pages

#### Henkaten List

- **Route:** `/henkatens`
- **Pengguna:** seluruh normal supplier roles dengan backend-scoped result.
- **Tujuan:** mencari, memfilter, dan menelusuri record current maupun terminal.
- **Elements:** identifier, status, 4M, business date/occurred time, line/job, part number/name,
  Supervisor/QC state; status/category/line/shift/part/date/approval route/status filters; cursor
  pagination; create action hanya LL.
- **Validasi dan rules:** filter server-side; terminal record immutable; scope line tidak dapat
  diperluas dari URL.
- **States:** no records, no filtered results, stale cursor, forbidden detail after responsibility
  changes.
- **Alur keluar:** detail, new Henkaten, approval queue with matching filter.
- **Dependency:** `AVAILABLE`.

#### Create Henkaten

- **Route:** `/henkatens/new?shiftRunId=...&jobId=...&resolutionIssueId=...`
- **Pengguna:** Line Leader normal session untuk own line.
- **Tujuan:** membuat satu valid Henkaten 4M pada active atau planned Shift Run.
- **Entry point:** Henkaten list, active shift, board job, atau resolution wizard.
- **Elements umum:** resolved line/shift; category; target job; part search by number/name; current
  checklist version dan ordered answers; cause; detail; submission review.
- **Elements Man:** target assignment; replaced MP atau VACANT; replacement MP; source
  line/job/assignment bila replacement currently assigned; linked issue.
- **Elements non-Man:** affected object dan replacement/new condition.
- **Validasi dan rules:** line tidak editable; active job/part; seluruh checklist Yes; cause/detail
  dan freeform maksimum 2.000; replacement valid, different, unreserved; assignment versions current.
- **States:** no active/planned shift, missing checklist, part search empty, checklist No/unanswered,
  reservation conflict, stale assignment, submitting/retry with same idempotency key.
- **Alur keluar:** successful Open detail; cancel kembali ke entry point; conflict refreshes all
  assignment-dependent input before resubmit.
- **Dependency:** create Henkaten, current shift/working assignments, checklist/master data reads
  `AVAILABLE`.

#### Henkaten Detail

- **Route:** `/henkatens/:henkatenId`
- **Pengguna:** scope-permitted supplier roles.
- **Tujuan:** menjadi immutable traceability view dan action context yang sah.
- **Elements:** identifier/status/category; source mode; shift/business date/timezone; line/job/part
  snapshots; creator/time; cause/detail; affected/replacement object; checklist snapshot/version;
  route responsibility/decisions; lifecycle history; Man reservation/movement/source/donor details;
  cancellation/withdrawal reason; clone relationship.
- **Actions:** LL Withdraw bila own line dan Open; LL Clone; Supervisor/QC decision bila route
  permitted; Supplier Admin reroute inactive Supervisor; links ke shift/board/linked issue.
- **Validasi dan rules:** terminal immutable; decision/withdraw actions use latest version; source
  snapshots are not replaced by current master-data labels.
- **States:** Open awaiting both, Open awaiting one, terminal outcomes, route already decided,
  resource unavailable, stale action.
- **Alur keluar:** remain on refreshed detail after action; Clone opens clone route.
- **Dependency:** detail/history/withdraw/clone-prefill/decision/reroute `AVAILABLE`; Hosted
  `sourceMode/sourceEpoch` traceability fields are `ADDITIVE API REQUIRED`.

#### Clone Henkaten

- **Route:** `/henkatens/:henkatenId/clone`
- **Pengguna:** Line Leader yang masih memiliki permitted line context.
- **Tujuan:** membuat correction sebagai record baru tanpa mengubah record lama.
- **Elements:** source relationship; prefilled still-relevant category/shift/job/part/cause/detail;
  validity checks; current checklist with blank answers; assignment re-selection for Man.
- **Validasi dan rules:** checklist selalu dijawab ulang; invalid shift/job/part/assignment wajib
  diperbaiki sebelum submit; new idempotency intent.
- **States:** source unavailable, prefill partially invalid, no current checklist, successful new
  Open record.
- **Alur keluar:** new detail; cancel returns to immutable source detail.
- **Dependency:** `AVAILABLE`.

### 3.7 Approval Queue

- **Route:** `/approvals?route=SUPERVISOR|QC&status=PENDING`
- **Pengguna:** Supervisor dan QC.
- **Tujuan:** menyelesaikan route approval yang menjadi responsibility user tanpa mengubah keputusan
  route lain.
- **Entry point:** navigation, notification, overview pending metric, Henkaten detail.
- **Elements:** identifier/category/line/job/part/opened time/aging; both route states; scoped
  pending/approved/rejected filters; record detail/checklist/history; Approve/Reject; optional
  comment maksimum 2.000.
- **Validasi dan rules:** Supervisor hanya responsibility line-nya; QC shared tenant queue;
  keputusan pertama mengunci route; Reject pertama membuat record terminal dan route lain
  `NOT_REQUIRED`; decision tidak dapat dicabut.
- **States:** empty queue, another approver already decided, Henkaten became terminal, stale version,
  successful decision.
- **Alur keluar:** refresh detail and queue; next pending item hanya dibuka atas user action.
- **Dependency:** Henkaten list filter/detail/decision `AVAILABLE`. Approval aging bucket filter
  beyond timestamps is `ADDITIVE API REQUIRED`.

### 3.8 Shift Pages

#### Shift List and Current Shift

- **Route:** `/shifts`
- **Pengguna:** seluruh normal supplier roles dengan scope masing-masing.
- **Tujuan:** mengetahui current/planned/history Shift Run dan assignment issues.
- **Elements:** status, line, template, business date, scheduled/actual time, eligibility, override
  marker, issue count, ended summary; status/line/business-date filters; prepare action untuk LL.
- **Validasi dan rules:** satu active Shift Run per line; ended terminal.
- **States:** no shifts, no current shift, filtered empty, active override, stale status.
- **Alur keluar:** shift detail atau prepare.
- **Dependency:** shift list/current/issues `AVAILABLE`.

#### Prepare Shift

- **Route:** `/shifts/prepare`
- **Pengguna:** Line Leader normal session.
- **Tujuan:** membuat planned Shift Run dan melihat preflight sebelum commit Start.
- **Elements:** own line, Shift Template, business date, preflight checks grouped by blocking
  outcome, resource links, latest preflight time, normal Start action.
- **Validasi dan rules:** line scope server-resolved; duplicate active shift/checklist/default
  problems are hard gates; prepare itself does not make shift Active.
- **States:** eligible, blocked with resolvable issues, blocked with admin configuration issue,
  stale preflight.
- **Alur keluar:** eligible shift detail/start; resolution route; Master Data link only visible to
  Admin through shared/delegated workflow.
- **Dependency:** prepare/preflight `AVAILABLE`.

#### Shift Detail and Actions

- **Route:** `/shifts/:shiftRunId`
- **Pengguna:** scope-permitted supplier roles.
- **Tujuan:** melihat authoritative lifecycle, preflight, Working Assignments, issues, dan final
  summary.
- **Elements:** shift/line/business date/timezone/status; Supervisor/LL snapshot; checks;
  assignments; issues; override actor reason/context if exposed; Start for LL; emergency Start for
  Admin; End for LL; links to board/Henkaten/resolution.
- **Validasi dan rules:** normal Start only eligible; emergency reason min 10 and substitute LL when
  required; End uses latest version and lists consequences before confirmation.
- **States:** NOT_STARTED eligible/blocked, ACTIVE normal/override, ENDED summary, concurrent state
  conflict.
- **Alur keluar:** started shift to board; ended shift remains on summary/history.
- **Dependency:** shift detail/start/end/emergency-start `AVAILABLE`.

#### Assignment Resolution

- **Route:** `/shifts/:shiftRunId/resolve`
- **Pengguna:** Line Leader of target/donor line; Admin read/support as allowed.
- **Tujuan:** menyelesaikan vacancy/conflict menggunakan pre-start atau active-shift Man Henkaten.
- **Elements:** open issues, origin Henkaten/movement, target job, working assignment, replacement
  candidates, pending resolution Henkaten, approval state, refresh preflight.
- **Validasi dan rules:** issue tidak dapat dianggap resolved dari client; hanya approved movement
  atau End Shift menjadi authority.
- **States:** no issues, replacement reserved, pending approval, approved/resolved, shift ended.
- **Alur keluar:** Create Man Henkaten with resolution context; approval/detail; refreshed shift.
- **Dependency:** resolution context/issues/create Henkaten `AVAILABLE`.

### 3.9 Notification Center

- **Route:** `/notifications?unreadOnly=true|false`
- **Pengguna:** seluruh normal supplier roles.
- **Tujuan:** menemukan event yang memerlukan perhatian dan menuju resource yang masih permitted.
- **Elements:** unread count, unread filter, kind/title/body/time, read/unread action, deep link.
- **Validasi dan rules:** read state tidak mengubah domain; duplicate event tidak boleh dibuat ulang
  oleh UI; mark action membawa expected version.
- **States:** no notifications, no unread, resource no longer permitted, version conflict, offline.
- **Alur keluar:** permission-safe deep link atau tetap pada list.
- **Dependency:** `AVAILABLE`.

### 3.10 Master Data Pages

#### Master Data Overview

- **Route:** `/master-data`
- **Pengguna:** Supplier Admin normal/preparation.
- **Tujuan:** melihat status masing-masing configuration area dan next prerequisite.
- **Elements:** counts/active state/readiness untuk member, line/job, part, Shift Template, checklist,
  dan defaults; links ke tiap area; Hosted Preparation context.
- **States:** empty/partial/ready and read failures per area.
- **Dependency:** individual reads `AVAILABLE`; consolidated status `ADDITIVE API REQUIRED`.

#### Members, Accounts, and Photos

- **Routes:** `/master-data/members`, `/new`, `/:memberId`.
- **Pengguna:** Supplier Admin normal/preparation.
- **Tujuan:** individual lifecycle management member dan login account.
- **Elements list:** name, registration number, role, active, account status; search/active filter;
  create.
- **Elements create/edit:** full name, registration number, immutable role; username only
  Supervisor/LL/QC; optional JPG/PNG/WebP photo max 2 MB; current photo/initials; account username
  and status; activate/deactivate/reset actions.
- **Validasi dan rules:** MP has no credential; role immutable; registration unique; deactivation
  blocker; temporary password one-time; photo server validation remains authority.
- **States:** invalid image, referenced resource in use, optimistic conflict, inactive member/account,
  one-time credential acknowledgement.
- **Alur keluar:** detail after create/update; reset remains on detail until credential acknowledged.
- **Dependency:** `AVAILABLE`.

#### Lines and Jobs

- **Routes:** `/master-data/lines`, `/new`, `/:lineId`.
- **Pengguna:** Supplier Admin normal/preparation.
- **Tujuan:** mengelola line dan ordered jobs secara individual.
- **Elements:** line code/name/order/active; nested jobs name/order/active; create/edit,
  activate/deactivate, reorder, and links to defaults.
- **Validasi dan rules:** line code tenant-unique; job name unique per line; referenced data cannot
  hard-delete; reorder preserves identity/history.
- **States:** incomplete line, no jobs, resource in use, version/reorder conflict.
- **Alur keluar:** line detail, default assignment, setup.
- **Dependency:** `AVAILABLE`.

#### Parts

- **Routes:** `/master-data/parts`, `/new`, `/:partId`.
- **Pengguna:** Supplier Admin normal/preparation.
- **Tujuan:** mengelola searchable part master.
- **Elements:** number, name, active, search, active filter, create/edit/activate/deactivate.
- **Validasi dan rules:** both fields required; part number tenant-unique case-insensitive;
  referenced data permanent.
- **States:** duplicate, in use, inactive, conflict.
- **Dependency:** `AVAILABLE`.

#### Shift Templates

- **Routes:** `/master-data/shifts`, `/new`, `/:templateId`.
- **Pengguna:** Supplier Admin normal/preparation.
- **Tujuan:** mengelola configurable shift definitions.
- **Elements:** name, order, start/end local time, IANA timezone, cross-midnight derived state,
  active, create/edit/reorder/activate/deactivate.
- **Validasi dan rules:** `HH:mm`; business date follows start; cross-midnight derived by server.
- **States:** invalid timezone/time, in use, conflict.
- **Dependency:** `AVAILABLE`.

#### Versioned 4M Checklists

- **Routes:** `/master-data/checklists`, `/:category`.
- **Pengguna:** Supplier Admin normal/preparation.
- **Tujuan:** menjaga satu active published checklist per category melalui immutable versions.
- **Elements:** category status; current draft ordered items; add/edit/remove/reorder draft items;
  expected version; publish consequence; version history and item snapshots; activate/deactivate.
- **Validasi dan rules:** category fixed to MAN/MACHINE/MATERIAL/METHOD; publish needs minimum one item;
  published version immutable; deactivate affects future submissions only and cannot alter snapshots.
- **States:** no draft, empty draft, unpublished category blocker, publish conflict, historical version.
- **Dependency:** `AVAILABLE`.

#### Default Assignments

- **Route:** `/master-data/default-assignments?lineId=...`
- **Pengguna:** Supplier Admin normal/preparation.
- **Tujuan:** menjaga default Supervisor, LL, dan MP uniqueness tanpa membuat Henkaten.
- **Elements:** line/job hierarchy; assigned member; availability; assign/change/remove; explicit
  atomic move with old and new assignment; active-shift effectiveness explanation.
- **Validasi dan rules:** one Supervisor/LL per line, one line per LL, one MP per job, one job per MP;
  Supervisor may own many lines; changes during active shift do not change Working Assignment.
- **States:** unassigned/incomplete, member already assigned, atomic move confirmation, version
  conflict, active shift notice.
- **Dependency:** `AVAILABLE`.

### 3.11 Supplier Audit

- **Route:** `/audit`
- **Pengguna:** Supplier Admin sekarang; scoped Supervisor/LL/QC setelah policy resolution.
- **Tujuan:** menelusuri immutable domain/security actions tanpa mutation.
- **Elements:** occurred time, actor kind/role, action, resource, change summary, result, correlation
  ID; action/resource/resource ID filters; cursor pagination; resource deep link.
- **States:** empty history, forbidden, referenced resource unavailable.
- **Dependency:** Supplier Admin `AVAILABLE`; Supervisor/LL/QC `POLICY MISMATCH`.

---

## 4. TMMIN-facing Information Architecture

### 4.1 Route Visibility Matrix

| Area | TMMIN Admin | TMMIN Quality |
|---|---:|---:|
| Global Overview | View | View |
| Active Warnings | View | View |
| Henkaten Explorer | View | View |
| Suppliers | Manage | View |
| Source/Preparation/Cutover | Manage | View summary only |
| External Credentials | Manage | No credential access |
| External Ingestion Health | Manage/diagnose | View monitoring health |
| Hosted Master/Shift/Board | Read support | Read permitted monitoring |
| Notifications | Operate own read state | Operate own read state |
| TMMIN Quality Users | Manage | - |
| Audit | Global | Permitted monitoring |
| System Status | View | View |
| Account | Operate own | Operate own |

TMMIN Quality read/unread notification adalah satu-satunya mutation yang mengubah user-local state.
Mutation tersebut tidak mengubah supplier domain, warning, atau Henkaten.

### 4.2 TMMIN Route Catalog

| Route | Page | Pengguna |
|---|---|---|
| `/login` | TMMIN Login | Anonymous |
| `/change-password` | Password Change | Authenticated TMMIN |
| `/unsupported-viewport` | Unsupported Viewport | Semua |
| `/` | Global Overview | Admin, Quality |
| `/warnings` | Active Warnings | Admin, Quality |
| `/warnings/:supplierId/:partNumber` | Affected Part Detail | Admin, Quality |
| `/henkatens` | Global Henkaten Explorer | Admin, Quality |
| `/suppliers` | Supplier List | Admin manage, Quality view |
| `/suppliers/new` | Create Supplier | Admin |
| `/suppliers/:supplierId` | Supplier Detail | Admin, Quality |
| `/suppliers/:supplierId/source` | Source Governance | Admin; Quality summary |
| `/suppliers/:supplierId/external-clients` | External Credentials | Admin |
| `/suppliers/:supplierId/henkatens/:henkatenId` | Hosted Henkaten Detail | Admin, Quality |
| `/suppliers/:supplierId/external/:projectionId` | External Projection Detail | Admin, Quality |
| `/suppliers/:supplierId/master-data` | Hosted Master Data | Admin, permitted Quality |
| `/suppliers/:supplierId/shifts` | Hosted Shifts | Admin, Quality |
| `/suppliers/:supplierId/board` | Hosted Assignment Board | Admin, Quality |
| `/external-health` | External Ingestion Health | Admin, Quality |
| `/notifications` | TMMIN Notifications | Admin, Quality |
| `/administration/quality-users` | TMMIN Quality Users | Admin |
| `/administration/quality-users/new` | Create Quality User | Admin |
| `/administration/quality-users/:userId` | Quality User Detail | Admin |
| `/audit` | TMMIN Audit | Admin, Quality permitted |
| `/system-status` | System Status | Admin, Quality |
| `/account` | Account and Session | Authenticated TMMIN |

### 4.3 Authentication and Account

TMMIN Login, Password Change, Account, session expiry, and unsupported viewport mengikuti behavior
Supplier equivalent dengan perbedaan berikut:

- login hanya meminta Username dan Password;
- tidak pernah menerima Supplier Code;
- safe return path hanya route `tmmin-web`;
- navigation setelah login dibedakan antara Admin dan Quality;
- dependency auth/session/change-password/logout adalah `AVAILABLE`.

### 4.4 Global Overview

- **Route:** `/`
- **Pengguna:** TMMIN Admin dan Quality.
- **Tujuan:** memonitor risk/freshness lintas seluruh supplier tanpa mengubah workflow supplier.
- **Elements:** active supplier totals per source; suppliers with warnings; Open/aging; affected
  parts; 4M/outcome trends; supplier/line/part rankings; Hosted/External freshness; emergency
  overrides; external accepted/rejected activity; supplier/source/date/status/category/line/part/
  aging/freshness filters; generated time; drill-down.
- **Validasi dan rules:** all aggregation server-authoritative; Hosted dan External source selalu
  ditandai; Quality read-only.
- **States:** no suppliers, no matching filter, partial freshness, stale data.
- **Alur keluar:** warning, Henkaten, supplier, external health.
- **Dependency:** basic totals/source/category/outcome/freshness `AVAILABLE`; filters, aging buckets,
  rankings, time-series, override detail, and richer ingestion aggregates
  `ADDITIVE API REQUIRED`.

### 4.5 Active Warnings

#### Affected Parts

- **Route:** `/warnings`
- **Pengguna:** TMMIN Admin dan Quality.
- **Tujuan:** menemukan supplier+part yang masih affected oleh minimal satu Open Henkaten.
- **Elements:** supplier, part number/name, Open warning count, oldest opened time, aging; supplier,
  source, 4M, line, part, aging, freshness filters; cursor pagination.
- **Validasi dan rules:** no manual close; aggregate remains affected until all instances terminal.
- **States:** no active warnings, no filtered result, data changed while paging.
- **Alur keluar:** affected part detail, Henkaten detail, supplier.
- **Dependency:** affected-parts read `AVAILABLE`; required filters and explicit query/pagination
  contract `ADDITIVE API REQUIRED`.

#### Affected Part Detail

- **Route:** `/warnings/:supplierId/:partNumber`
- **Pengguna:** TMMIN Admin dan Quality.
- **Tujuan:** memahami seluruh Open warning instances yang menjaga part affected.
- **Elements:** supplier/part aggregate; each warning ID, source, Henkaten reference, opened/closed
  time, aging, line/category/approval states when available; links to source-specific detail.
- **Validasi dan rules:** closed instance is history only; no close action.
- **States:** aggregate closed between navigation, part not found, mixed Hosted/External history.
- **Dependency:** warning instances `AVAILABLE`; approval/line/category fields in aggregate detail
  may need `ADDITIVE API REQUIRED`.

### 4.6 Henkaten Explorer

- **Route:** `/henkatens`
- **Pengguna:** TMMIN Admin dan Quality.
- **Tujuan:** mencari Hosted dan External records lintas supplier dengan source-correct semantics.
- **Elements:** supplier/source, source-specific ID, status/category, occurred/updated time, line/job/
  shift/part snapshots, approval summary where supplied; supplier/source/date/status/category/line/
  part filters; cursor pagination.
- **Validasi dan rules:** no mutation; External record does not require Hosted UUID/assignment/photo/
  registration fields; result links to source-specific detail.
- **States:** no data, no filtered results, one source stale, supplier inaccessible.
- **Alur keluar:** Hosted Henkaten detail or External projection detail.
- **Dependency:** per-supplier Hosted list and External projection list `AVAILABLE`; unified
  cross-supplier filtered query `ADDITIVE API REQUIRED`.

#### Hosted Detail

- **Route:** `/suppliers/:supplierId/henkatens/:henkatenId`
- **Tujuan:** read-only Hosted traceability.
- **Elements:** same snapshots/checklist/routes/history/movement as Supplier detail, source metadata,
  supplier context, links to Hosted shift/master data/audit.
- **Rules:** no approve/reject/withdraw/reroute.
- **Dependency:** `AVAILABLE`.

#### External Projection Detail

- **Route:** `/suppliers/:supplierId/external/:projectionId`
- **Tujuan:** read-only current projection and accepted event lineage.
- **Elements:** source Henkaten ID/version, lifecycle/category, line/shift/job/part snapshots,
  occurred/updated/freshness, accepted event IDs/types/versions/correlation IDs.
- **Rules:** never expect or infer Hosted member registration/photo/assignment; no source correction.
- **Dependency:** projection detail/events `AVAILABLE`; complete decisions/checklist/change detail and
  rejected-event context plus source epoch, where required by PRD traceability,
  `ADDITIVE API REQUIRED`.

### 4.7 Supplier Administration

#### Supplier List

- **Route:** `/suppliers`
- **Pengguna:** Admin manage, Quality view.
- **Tujuan:** menemukan tenant dan memahami active/source state.
- **Elements:** code, name, timezone, source mode/epoch, active, updated time; search/status/source
  filters; cursor pagination; create action Admin only.
- **States:** no suppliers, filtered empty, stale cursor.
- **Dependency:** basic cursor list `AVAILABLE`; search/status/source filters
  `ADDITIVE API REQUIRED`.

#### Create Supplier

- **Route:** `/suppliers/new`
- **Pengguna:** TMMIN Admin.
- **Tujuan:** provision HOSTED or EXTERNAL tenant using mode-specific contract.
- **Elements common:** code, name, IANA timezone, source mode, consequence review.
- **Hosted elements:** Supplier Admin username/display name and one-time temporary credential.
- **External behavior:** created inactive without Supplier Admin; next action issue client credential
  then activate.
- **Validasi dan rules:** code global unique; mode cannot be silently changed during create;
  credentials one-time.
- **States:** duplicate/validation, submitting, created with credential acknowledgement.
- **Alur keluar:** supplier detail; Hosted onboarding handoff or External client issuance.
- **Dependency:** `AVAILABLE`.

#### Supplier Detail

- **Route:** `/suppliers/:supplierId`
- **Pengguna:** Admin and Quality.
- **Tujuan:** supplier context hub for administration and monitoring.
- **Elements:** code/name/timezone/source/epoch/active/version/timestamps; warning/freshness summary;
  current Supplier Admin identity/status; Hosted Preparation state; edit/activate/deactivate;
  Admin replacement/reset; links to source, credentials, Henkaten, shift, master data, board, audit.
- **Validasi dan rules:** Quality read-only; deactivation consequences; EXTERNAL activation requires
  active current-epoch credential.
- **States:** inactive, Hosted, External unready/ready, active preparation, stale version.
- **Dependency:** core supplier fields/actions `AVAILABLE`; current Supplier Admin and recoverable
  Hosted Preparation state `ADDITIVE API REQUIRED`.

### 4.8 Source Governance

- **Route:** `/suppliers/:supplierId/source`
- **Pengguna:** TMMIN Admin; Quality may see non-sensitive summary only.
- **Tujuan:** govern preparation and single-source cutover without mixed writes.
- **Elements:** current mode/epoch/active; preparation state; target mode; preflight eligibility and
  blocker contributor/code/detail; reason; privacy acknowledgement; start/cancel preparation;
  cutover; audit history; revoked old-source consequence.
- **Validasi dan rules:** target differs; supplier active; reason 10–1.000; privacy acknowledgement
  per operation; to EXTERNAL requires next-epoch credential and no active shift/Open Henkaten/
  reservation; to HOSTED requires complete configuration and active Supplier Admin.
- **States:** no preparation, active preparation, blocked preflight, eligible, concurrent version
  conflict, successful cutover with old sessions/credentials revoked.
- **Alur keluar:** setup handoff, external clients, supplier detail, audit.
- **Dependency:** start/cancel/preflight/cutover `AVAILABLE`; reloadable preparation state and
  dedicated source history summary `ADDITIVE API REQUIRED` (audit can provide partial history).

### 4.9 External Credentials

- **Route:** `/suppliers/:supplierId/external-clients`
- **Pengguna:** TMMIN Admin only.
- **Tujuan:** issue, rotate, and revoke epoch-bound ingestion credentials.
- **Elements:** client name/ID, source epoch, scope, IP allowlist, active/revoked, valid secret count,
  last successful ingestion, version; create, rotate, revoke; one-time secret.
- **Validasi dan rules:** IP list max 50 valid IPv4/IPv6; scope fixed; maximum two valid secrets;
  secret never redisplayed; revoke invalidates tokens.
- **States:** no clients, next-epoch client, current client, rotation capacity conflict, revoked,
  one-time secret acknowledgement.
- **Alur keluar:** supplier activation/source preflight/external health.
- **Dependency:** `AVAILABLE`.

### 4.10 TMMIN Read-only Supplier Operations

#### Hosted Master Data

- **Route:** `/suppliers/:supplierId/master-data`
- **Pengguna:** TMMIN Admin; Quality only when permitted by Hosted visibility policy.
- **Tujuan:** support/read-only inspection of members, lines/jobs, parts, shifts, checklists,
  defaults.
- **Rules:** no mutation; External supplier returns unavailable unless active Hosted Preparation is
  visible to Admin; private photos only through authorized endpoint.
- **Dependency:** `AVAILABLE`.

#### Hosted Shifts

- **Route:** `/suppliers/:supplierId/shifts`
- **Pengguna:** Admin, Quality.
- **Tujuan:** read-only Shift Run/detail investigation.
- **Elements:** same shift snapshots/checks/assignments/issues/end summary without action.
- **Dependency:** `AVAILABLE`.

#### Hosted Assignment Board

- **Route:** `/suppliers/:supplierId/board`
- **Pengguna:** Admin and Quality when support/monitoring requires.
- **Tujuan:** read-only current Hosted assignment/change view.
- **Rules:** unavailable for External suppliers; no supplier operation.
- **Dependency:** `ADDITIVE API REQUIRED`; current board endpoint is supplier-session scoped only.

### 4.11 External Ingestion Health

- **Route:** `/external-health?supplierId=...`
- **Pengguna:** TMMIN Admin and Quality.
- **Tujuan:** diagnose freshness and schema/ordering failures without exposing secret/token/PII.
- **Elements:** supplier/source epoch/current client health; last success; accepted/duplicate/rejected
  counts; freshness; recent validation/transition/version errors; event/correlation lookup;
  projection link; server-side supplier/status/date/error filters and pagination.
- **Validasi dan rules:** Quality receives monitoring metadata only, not client secrets or mutation;
  raw secret/token/Authorization never shown; rejected payload must not expose forbidden data.
- **States:** never ingested, fresh, stale, rejected spike, revoked/epoch mismatch, no filtered event.
- **Alur keluar:** supplier, projection/event detail, audit; credential action only for Admin.
- **Dependency:** dashboard freshness, clients for Admin, and accepted projection events partially
  `AVAILABLE`. Rejected-event list/detail, duplicate/error aggregates, correlation lookup, and
  Quality-safe health endpoint are `ADDITIVE API REQUIRED`.

### 4.12 TMMIN Notifications

- **Route:** `/notifications`
- **Pengguna:** Admin and Quality.
- **Tujuan:** consume user-local external warnings, ingestion errors, and security events.
- **Elements/rules/states:** same notification contract as Supplier; deep links resolve within
  `tmmin-web`; read state has no warning lifecycle effect.
- **Dependency:** `AVAILABLE`.

### 4.13 TMMIN Quality User Administration

- **Routes:** `/administration/quality-users`, `/new`, `/:userId`.
- **Pengguna:** TMMIN Admin only.
- **Tujuan:** manage privileged monitoring accounts.
- **Elements:** username/display name/status/must-change-password/version; create, deactivate,
  reactivate, reset password; one-time credential.
- **Validasi dan rules:** TMMIN realm only; protected bootstrap account restrictions respected;
  version on mutations.
- **States:** no users, inactive, conflict, credential acknowledgement.
- **Dependency:** basic list/detail/actions `AVAILABLE`; search/status filters
  `ADDITIVE API REQUIRED`.

### 4.14 TMMIN Audit

- **Route:** `/audit`
- **Pengguna:** Admin global; Quality permitted monitoring.
- **Tujuan:** trace cross-supplier administration/domain/security activity.
- **Elements:** supplier context when available, actor/action/resource/result/change summary/time/
  correlation ID; action/resource/resource ID filters; cursor pagination; deep links.
- **Rules:** no mutation; Quality data must follow permitted scope.
- **Dependency:** `AVAILABLE`; supplier-specific and date filters may require
  `ADDITIVE API REQUIRED`.

### 4.15 System Status

- **Route:** `/system-status`
- **Pengguna:** Admin and Quality.
- **Tujuan:** inspect API liveness/readiness and release identity without infrastructure secrets.
- **Elements:** service, health/readiness, database/migrations/photo-storage checks, release SHA,
  checked time, retry.
- **States:** healthy, not ready, endpoint unreachable, stale last check.
- **Dependency:** `/health` and `/ready` `AVAILABLE`.

---

## 5. End-to-end User Flows

### 5.1 Login, Forced Reset, dan Intended Destination

1. User opens a protected route.
2. Session bootstrap returns unauthenticated and records a safe same-realm path.
3. User submits realm-specific login.
4. Generic failure does not distinguish account/supplier.
5. If `mustChangePassword`, only password-change/logout is accessible.
6. Successful change triggers new session bootstrap and cache reset.
7. User returns to the safe path if still permitted; otherwise realm home.
8. Session expiry later repeats the flow without automatically resubmitting old mutations.

### 5.2 Provision HOSTED Supplier

1. TMMIN Admin creates supplier with HOSTED mode and Supplier Admin identity.
2. Server creates active tenant and returns temporary credential once.
3. Admin acknowledges secure handoff and closes secret state.
4. Supplier Admin logs in, changes password, and reaches `/setup`.
5. Setup guides Shift Template → members/accounts → lines/jobs → parts → four checklists → defaults.
6. Readiness is refreshed after each saved resource.
7. When complete, normal Hosted operations become understandable and Start Shift can pass preflight.
8. Missing credential is recovered through reset, never secret redisplay.

### 5.3 Provision EXTERNAL Supplier

1. TMMIN Admin creates EXTERNAL supplier; tenant remains inactive and has no Supplier Admin.
2. Admin opens External Credentials and creates current-epoch client.
3. Secret is shown once and handed off securely.
4. Admin activates supplier only after current-epoch active credential exists.
5. External system gets token and begins ingestion.
6. TMMIN monitors first success/freshness; no Hosted operational UI is enabled.

### 5.4 Hosted Preparation to HOSTED Cutover

1. On an EXTERNAL supplier, Admin starts preparation with reason, privacy acknowledgement, and
   preparation Supplier Admin identity.
2. One-time credential is handed off; source remains EXTERNAL and epoch unchanged.
3. Preparation Admin logs in with reduced session and configures master data/checklists/defaults.
4. Operational routes remain unavailable.
5. TMMIN Admin runs target HOSTED preflight and follows blocker links.
6. When eligible, Admin confirms cutover reason/privacy acknowledgement using latest version.
7. Transaction changes source/epoch, revokes old sessions/credentials, and completes preparation.
8. Preparation Admin session is revoked and logs in again as normal Hosted source.
9. Audit preserves previous source and preparation/cutover events.

Cancellation path:

1. Admin provides cancellation reason.
2. Preparation is cancelled, preparation Admin/session is disabled/revoked.
3. External remains source of truth and configured Hosted data remains non-operational history.

### 5.5 HOSTED to EXTERNAL Cutover

1. Admin creates next-epoch External credential while supplier is still HOSTED.
2. Admin runs EXTERNAL preflight.
3. Active shift, Open Henkaten, active reservation, inactive supplier, or missing next-epoch
   credential blocks cutover.
4. Supplier users resolve blockers; End Shift may cancel Open records according to normal rules.
5. Admin reruns preflight and confirms cutover.
6. Source epoch increments and all Hosted sessions are revoked.
7. Historical Hosted records remain read-only; External projection becomes current monitoring
   source after valid ingestion.

### 5.6 Individual Master-data Lifecycle

1. Admin opens list with server filter/pagination.
2. Create/edit validates locally and then server-side.
3. Response replaces cached item and invalidates readiness/default selections as needed.
4. Deactivation consequence review is shown.
5. `RESOURCE_IN_USE` keeps resource active and links to blocking context when API exposes it.
6. Reactivation retains identity/history.
7. `VERSION_CONFLICT` refreshes detail; user manually reapplies intended changes.
8. No flow offers hard delete or bulk import/export.

### 5.7 Default Assignment dan Atomic Move

Supervisor:

1. Admin chooses line and assign/change/remove Supervisor.
2. Supervisor already supervising other lines remains eligible.

Line Leader/MP:

1. Admin selects target line/job and member.
2. If member is unassigned, normal assign is confirmed.
3. If assigned elsewhere, UI shows source and target and requires explicit atomic move.
4. API applies release+assign in one transaction or returns conflict.
5. If a shift is active, UI states that Working Assignment does not change.
6. Board changes only on next Start Shift or Approved Man Henkaten.

### 5.8 Normal Start Shift

1. LL opens Prepare Shift, selects allowed template and business date.
2. API creates/refreshes planned Shift Run and returns authoritative checks.
3. If eligible, LL reviews snapshot and starts with expected version.
4. Server atomically activates shift and Working Assignments.
5. UI invalidates current shift, board, dashboard, and notification queries.
6. User lands on active Shift detail or board.

### 5.9 Blocked Start and Pre-start Resolution

1. Preflight lists blocking codes and affected resources.
2. Configuration blockers direct the workflow to Supplier Admin.
3. Vacancy/conflict opens resolution context.
4. LL creates pre-start Man Henkaten with issue/assignment context.
5. Replacement is reserved while record Open.
6. Supervisor and QC decide independently.
7. Approved movement updates planned assignment and resolves issue; rejection/cancellation releases
   reservation.
8. LL refreshes preflight and starts only when eligible.
9. Client never marks a check resolved by itself.

### 5.10 Emergency Start

1. Blocked Shift detail offers emergency action only to Supplier Admin.
2. Admin reviews every failed check, enters reason 10–1.000 characters, and selects substitute LL
   when required.
3. API activates with override while preserving issues/checks.
4. UI shows critical unresolved state and refreshes board/dashboard/notifications.
5. Override never updates Default Assignment or reports preflight as passed.

### 5.11 End Shift

1. LL opens End Shift consequence review.
2. UI identifies that all Open Henkaten will be Cancelled, reservations released, pending routes
   made Not Required, warnings closed, issues closed, and Working Assignments deactivated.
3. LL confirms with latest version and one idempotency intent.
4. API completes one transaction and returns end summary.
5. Board/current shift/Henkaten/approval/notification/dashboard queries refresh.
6. Concurrent approval loser receives `409`, refreshes, and sees the one legal terminal outcome.

### 5.12 Submit Henkaten 4M

1. LL starts from own active/planned shift or issue.
2. Line is server-scoped; LL selects job and active part.
3. LL selects category and answers current version checklist.
4. Any No/unanswered blocks submit.
5. Man requires replaced/VACANT and replacement assignment context; other categories require affected
   and replacement objects.
6. Review summarizes snapshots and consequences.
7. Submit uses new idempotency key.
8. Success creates Open record, warning, parallel routes, notifications, and Man reservation when
   applicable.
9. UI opens detail and refreshes board/dashboard/queues.

### 5.13 Parallel Approval and Reject-fast

1. Supervisor and QC may open the same Open record concurrently.
2. First Approve locks only its route; Henkaten remains Open until other route Approves.
3. Second Approve finalizes Approved.
4. First Reject from either route finalizes Rejected immediately; other pending route becomes
   `NOT_REQUIRED`.
5. Stale/different decision receives conflict and refreshes authoritative detail.
6. Decision cannot be edited or revoked.

### 5.14 Withdraw and Clone

1. LL opens own-line Open detail and chooses Withdraw.
2. UI explains reservation/warning/pending-route consequences and requires reason.
3. Success makes source Cancelled and immutable.
4. Clone opens a new form from server prefill.
5. Current checklist is blank and mandatory; shift/job/part/assignment validity is shown.
6. Invalid references are reselected.
7. Submit creates new linked Open record; source remains unchanged.

### 5.15 Cross-line Man Movement and Donor Vacancy

1. LL selects replacement MP currently assigned to another job/line.
2. Open Henkaten reserves MP but effective assignments remain unchanged.
3. Final Approved atomically moves MP and creates donor Assignment Issue.
4. Donor LL/Supervisor receive notification; board shows critical vacancy.
5. Donor LL resolves through another valid Man Henkaten.
6. Duplicate reservation/cycle conflict refreshes candidate availability.
7. Rejected/Cancelled source releases reservation and creates no vacancy.

### 5.16 Notification Deep Link

1. User opens notification and optionally marks read.
2. Deep link is accepted only as navigation intent.
3. Target API rechecks realm/tenant/role/object scope.
4. Allowed target opens with notification context removed from domain state.
5. Forbidden/not-found target shows safe error; notification remains readable and may still be
   marked read.

### 5.17 Warning Lifecycle

1. Hosted create or External Open event creates warning instance.
2. TMMIN affected-part aggregate appears for supplier+part.
3. Additional Open records increment aggregate; oldest time determines aggregate aging.
4. Approved, Rejected, or Cancelled closes only its instance.
5. Aggregate remains affected while any instance Open.
6. When last instance closes, active warning list removes aggregate after authoritative refresh.
7. TMMIN never manually closes or changes warning lifecycle.

### 5.18 Credential Rotation, Revocation, and Loss

1. Admin creates or rotates client and receives secret once.
2. Admin acknowledges secure copy; UI removes secret after leaving.
3. Up to two valid secrets may overlap.
4. Rotation at capacity returns conflict and directs Admin to revoke/complete operational rollover.
5. Revocation invalidates secrets/tokens and updates client state.
6. Lost secret is handled by rotation; plaintext recovery is unavailable.

### 5.19 Hosted versus External Monitoring

1. Every cross-supplier result exposes source mode.
2. Hosted detail uses internal Henkaten/checklist/decision/assignment/audit snapshots.
3. External detail uses supplier-provided source IDs, snapshots, versions, and accepted event
   lineage.
4. External view never requires photo, registration number, username, or Hosted assignment board.
5. TMMIN reads both sources but never approves or corrects supplier lifecycle.
6. Historical old-source data remains navigable and clearly non-current after cutover.

---

## 6. Contract Gap Register

| ID | Area | Required behavior | Current contract | Status | Required resolution |
|---|---|---|---|---|---|
| GAP-01 | Supplier session | Shell knows tenant name/code/timezone/source mode authoritatively. | Session only returns principal, purpose, expiry, CSRF. | `ADDITIVE API REQUIRED` | Add optional tenant context to Supplier session or safe self-context read. |
| GAP-02 | Setup | Supplier Admin receives authoritative Hosted readiness and blockers. | Only individual reads and TMMIN cutover preflight exist. | `ADDITIVE API REQUIRED` | Add Supplier-safe readiness read model; do not duplicate preflight policy in React. |
| GAP-03 | Supplier dashboard | Approval aging, time trend, detailed issues/overrides, full PRD filters. | Basic totals/category/line/part/outcomes/recent activity and limited filters. | `ADDITIVE API REQUIRED` | Add read fields and backward-compatible filter parameters. |
| GAP-04 | Supplier audit | Supervisor/LL scoped and QC tenant audit per PRD. | Capability only granted to Supplier Admin. | `POLICY MISMATCH` | Reconcile PRD visibility with scoped backend authorization/tests before exposing routes. |
| GAP-05 | TMMIN board | Read-only current Hosted Assignment Board. | Board endpoint requires Supplier session. | `ADDITIVE API REQUIRED` | Add TMMIN-scoped read-only board endpoint with Hosted-only policy. |
| GAP-06 | TMMIN dashboard | PRD supplier/source/date/status/4M/line/part/aging/freshness filters and rankings. | Dashboard accepts no query and returns basic aggregates. | `ADDITIVE API REQUIRED` | Add server-side filters and aggregate fields. |
| GAP-07 | Global explorer | Cross-supplier Hosted+External Henkaten query. | Reads are supplier-scoped and source-specific. | `ADDITIVE API REQUIRED` | Add unified read-only query or source-aware cross-supplier endpoints. |
| GAP-08 | Administration lists | Search/status/source filters for suppliers and privileged users. | Cursor+limit only. | `ADDITIVE API REQUIRED` | Add backward-compatible server filters/sort. |
| GAP-09 | Warnings | Filtered/paginated affected parts and richer instance context. | Global affected-parts endpoint has no query contract. | `ADDITIVE API REQUIRED` | Add cursor/filter contract and approval/category/line context as optional fields. |
| GAP-10 | Supplier detail | Current Supplier Admin and Hosted Preparation recover after reload. | Supplier detail returns only Supplier summary. | `ADDITIVE API REQUIRED` | Add safe nested summaries or dedicated reads. |
| GAP-11 | External health | Rejected/duplicate history, error aggregates, correlation lookup. | Dashboard freshness and accepted projection events only. | `ADDITIVE API REQUIRED` | Add sanitized ingestion-health read model and event queries. |
| GAP-12 | Quality external health | Quality sees monitoring health without credential-management permission. | Client list is Admin-only; projection/dashboard data is incomplete for diagnosis. | `ADDITIVE API REQUIRED` | Add Quality-safe health projection excluding client secret and mutation. |
| GAP-13 | Board override | Board exposes critical unresolved override context. | Board schema has assignments/indicators but no explicit override summary. | `ADDITIVE API REQUIRED` | Add optional override/unresolved issue summary to board read model. |
| GAP-14 | Source traceability | Source preparation/current admin state and dedicated cutover history. | Mutations and generic audit exist; detail state is incomplete. | `ADDITIVE API REQUIRED` | Add source governance summary; retain audit as immutable evidence. |
| GAP-15 | Henkaten source traceability | Hosted list/detail exposes immutable source mode/epoch and External projection exposes source epoch. | Hosted read schemas omit both fields; External projection exposes mode but omits epoch. | `ADDITIVE API REQUIRED` | Add optional `sourceMode`/`sourceEpoch` read fields as applicable without changing lifecycle semantics. |

Gap resolution rules:

- changes must be additive/backward-compatible within frozen v1;
- shared Zod, OpenAPI, controller reconciliation, authorization, and tests change together;
- no frontend-only aggregation may claim to be authoritative;
- no filter may operate only on the currently loaded cursor page;
- no permission may be broadened only in route visibility;
- External PII minimization and TMMIN read-only boundaries remain unchanged.

---

## 7. Traceability and Acceptance Checklist

Frontend implementation is complete only when:

- every route has authenticated/anonymous/forced-reset guard behavior;
- every role sees only navigation and actions relevant to its capability;
- every mutation handles validation, version conflict, and session expiry;
- every list uses server pagination/filtering and preserves URL state;
- every page implements loading, empty, retryable error, forbidden, conflict, and relevant stale
  state;
- every monitoring page shows last updated/freshness;
- every one-time credential disappears after acknowledgement/navigation;
- Henkaten terminal records remain immutable;
- parallel approval, reject-fast, Withdraw+Clone, Man reservation/movement, Start/End Shift, and
  source cutover match PRD transitions;
- TMMIN Quality produces no supplier-domain mutation;
- Hosted and External detail never conflate identity/PII/assignment contracts;
- all gaps required by a page are resolved or the incomplete behavior remains explicitly blocked
  from release;
- Chrome/Edge desktop keyboard flows and accessible names pass critical-path verification;
- no process difficulty, skill, health, attendance, schedule outside Shift Run, bulk import/export,
  email/SMS/push/webhook, mobile, or other out-of-scope feature is added.
