# Audit QA Seeded App — Seluruh Role dan Kedua Client Surface

Tanggal audit: 2026-07-28

Branch: `staging`

Baseline awal: working tree setelah audit Supplier Admin/TMMIN Admin dan Supervisor/Line Leader
tanggal 27 Juli 2026

Status: **lulus setelah dua APP_DEFECT diperbaiki**

## 1. Tujuan

Audit ini menutup QA seeded application untuk:

- seluruh role yang mempunyai credential: Supplier Admin, Supervisor, Line Leader, QC, TMMIN
  Admin, dan TMMIN Quality;
- kedua client surface: `supplier-web` dan `tmmin-web`;
- fungsi v1 dalam PRD melalui kombinasi pemeriksaan interaktif seeded runtime, triangulasi
  database/API/UI, PostgreSQL integration, serta isolated full-stack browser journeys.

MP tidak mempunyai akun menurut PRD sehingga diverifikasi sebagai master member dan assignment
actor, bukan login role.

Laporan ini mengonsolidasikan evidence dari:

- `docs/audits/seededAppQaAudit.md`;
- `docs/audits/seededAppSupervisorLineLeaderQaAudit.md`;
- audit lanjutan QC dan TMMIN Quality pada 28 Juli 2026.

## 2. Metode dan Klasifikasi

Setiap anomali dibandingkan dengan empat sumber:

1. invariant PostgreSQL sebagai state authoritative;
2. response API, authorization status, version, dan Problem Details;
3. UI browser 1280×720, route/capability, filter, deep-link, console, dan overflow;
4. regression test pada lapisan pemilik.

Klasifikasi:

- `SEED_DEFECT`: fixture atau invariant seeded state salah;
- `APP_DEFECT`: seed/API authoritative benar tetapi runtime, adapter, authorization presentation,
  atau UI salah;
- `CONTRACT_DOC_MISMATCH`: aplikasi konsisten tetapi menyimpang dari PRD.

Mutation kompleks yang dapat menghabiskan fixture tidak diulang sembarang pada satu shared state.
Coverage lifecycle lengkap dijalankan pada database/browser epoch terisolasi. Seed dikembalikan
melalui `local:reseed` sebelum verifikasi akhir.

## 3. Environment

| Area | Evidence |
| --- | --- |
| Host | macOS, timezone Asia/Jakarta |
| Host Node.js | 26.3.1; di luar range repository dan dicatat sebagai workstation risk |
| Runtime repository | Compose/build memakai Node.js 22.23.1 |
| Database | PostgreSQL 18 + pgvector |
| Browser interaktif | Chromium-compatible in-app browser |
| Browser suite | Chromium lengkap dan Microsoft Edge smoke |
| Viewport | 1280×720 |
| Seed lifecycle | `pnpm local:start:clean`, lalu `pnpm local:reseed` |
| Portal | `http://localhost:5173` dan `http://localhost:5174` |
| Credential | manifest gitignored mode `0600`; nilai tidak dicetak |

OrbStack sempat belum menyediakan socket saat command pertama dipanggil. Setelah daemon siap,
Docker 29.4.0 merespons normal. Ini adalah environment startup timing, bukan defect aplikasi.

## 4. Invariant Seed

Clean start dan reseed akhir menghasilkan:

| Invariant | GKI | NPM | Total |
| --- | ---: | ---: | ---: |
| Supplier Hosted | 1 | 1 | 2 |
| Line aktif | 3 | 3 | 6 |
| Job aktif | 12 | 12 | 24 |
| Member aktif | 22 | 22 | 44 |
| Henkaten | 120 | 120 | 240 |
| Henkaten Open | 8 | 8 | 16 |
| Warning Open | 8 | 8 | 16 |
| Reservation aktif | 1 | 1 | 2 |
| Assignment Issue Open | 1 | 1 | 2 |

Distribusi lifecycle:

| Supplier | Open | Approved | Rejected | Cancelled |
| --- | ---: | ---: | ---: | ---: |
| GKI | 8 | 58 | 29 | 25 |
| NPM | 8 | 66 | 20 | 26 |

Setiap supplier mempunyai lima route Supervisor Pending, tiga Supervisor Approved, enam QC Pending,
dan dua QC Approved pada delapan Henkaten Open. Angka UI Overview/queue/warning cocok dengan
database dan API. Tidak ditemukan seed defect.

## 5. Matriks Role dan Surface

### 5.1 Supplier Admin — `supplier-web`

| Area | Hasil |
| --- | --- |
| Login/session/account | Lulus |
| Overview seluruh tenant | Lulus |
| Assignment Board seluruh line | Lulus |
| Henkaten list/detail/history | Lulus |
| Shift list/detail dan emergency override | Lulus |
| Setup/readiness | Lulus |
| Member/account/photo | Lulus |
| Line/job/part/Shift Template/checklist | Lulus |
| Default assignment | Lulus |
| Notification dan audit | Lulus |
| Approval/input Henkaten | Tidak ditampilkan dan backend menolak |

### 5.2 Supervisor — `supplier-web`

| Area | Hasil |
| --- | --- |
| Multi-line dan single-line scope | Lulus |
| Overview/Board/Henkaten/Shift | Lulus |
| Approval queue line responsibility | Lulus |
| Approve-first/final dan reject-fast | Lulus |
| Comment, actor, version, idempotency | Lulus |
| Notification dan audit scoped | Lulus |
| Cross-line/cross-tenant negative | Lulus |

Supervisor GKI 1 hanya menerima opsi GKI-L1 dan GKI-L3 pada Overview. Route dan data line lain
ditolak tanpa leakage identifier tenant.

### 5.3 Line Leader — `supplier-web`

| Area | Hasil |
| --- | --- |
| Own-line Overview/Board/Shift | Lulus |
| Start/End Shift dan preflight | Lulus |
| Resolution wizard dan emergency boundary | Lulus |
| Input MAN/MACHINE/MATERIAL/METHOD | Lulus |
| Checklist all-Yes dan form context | Lulus |
| Withdraw + Clone | Lulus |
| Man reservation/movement/cascade vacancy | Lulus |
| Notification/audit/deep-link | Lulus |
| Approval queue/decision | Tidak tersedia dan backend menolak |

Line Leader GKI 1 hanya menerima GKI-L1. Seluruh tiga Line Leader NPM telah menjadi variance
evidence untuk issue, partial approval, dan active Man reservation.

### 5.4 QC — `supplier-web`

| Area | Hasil |
| --- | --- |
| Tenant-wide Overview | Lulus; 8 Open, 6 QC Pending |
| Assignment Board seluruh tiga line | Lulus |
| Henkaten list/detail/history | Lulus |
| Shared QC queue | Lulus; 6 pending sama dengan DB |
| Read-only Shift dan resolution context | Lulus; tidak ada operational mutation |
| Notification read/unread | Lulus |
| Tenant audit | Lulus |
| Approve/reject/first decision locking | Lulus pada integration/E2E |
| Master data/configuration | 403 dan tidak ada navigation |
| Input Henkaten | 403 |
| Layout 1280×720 | Tidak ada horizontal overflow |

Audit interaktif sengaja memicu failed action recovery pada detail partial approval. Browser
automation tidak menyelesaikan native confirmation sehingga tidak ada POST authoritative; hal ini
dipakai hanya untuk memverifikasi UI error/retry state. Decision lifecycle sebenarnya dibuktikan
oleh isolated browser journey dan PostgreSQL integration.

### 5.5 TMMIN Admin — `tmmin-web`

| Area | Hasil |
| --- | --- |
| Global Overview/warning/Henkaten | Lulus |
| Supplier lifecycle | Lulus |
| Supplier Admin replacement/reset | Lulus |
| TMMIN Quality administration | Lulus |
| Source governance/cutover preflight | Lulus |
| External credential issue/rotate/revoke | Lulus |
| External ingestion health | Lulus |
| Hosted support master/shift/board | Lulus |
| Notification/audit/system status | Lulus |
| Supplier-domain approval/mutation | Tidak tersedia |

State External dibuat pada isolated journey melalui production UI/API, bukan ditambahkan ke baseline
seed dua supplier Hosted.

### 5.6 TMMIN Quality — `tmmin-web`

| Area | Hasil |
| --- | --- |
| Global Overview dan filters | Lulus |
| Active warning dan part drill-down | Lulus |
| Hosted/External Henkaten Explorer | Lulus |
| Supplier registry/detail | Lulus setelah F-02 |
| Source preflight/history read-only | Lulus |
| Hosted support master/shift/board | Lulus |
| External health | Lulus |
| Audit dan system status | Lulus |
| Notification empty/read state | Lulus; baseline Hosted tidak menghasilkan TMMIN event |
| Supplier/credential/quality-user mutation | Tidak ditampilkan; direct protected routes 403 |
| Layout 1280×720 | Tidak ada horizontal overflow |

Dashboard baseline menampilkan dua Hosted, nol External, 16 Open, empat affected part, dan dua
supplier dengan warning. Seluruh route monitoring bebas browser console warning/error selama audit.

## 6. Matriks Fungsi PRD

| Domain PRD | Evidence | Hasil |
| --- | --- | --- |
| Identity, realm, forced reset, session | Unit, integration, onboarding Chromium/Edge | Lulus |
| Tenant/line/object scope | Interactive role smoke, negative integration/E2E | Lulus |
| Master data/photo/deactivation | Supplier Admin audit, integration, onboarding | Lulus |
| Default/Working Assignment | Seed DB, Board, shift integration/E2E | Lulus |
| Start/End Shift/preflight/override | LL/Admin UI, lifecycle E2E, integration | Lulus |
| Henkaten 4M/checklist/idempotency | UI form, lifecycle E2E, integration | Lulus |
| Withdraw + Clone | LL audit, lifecycle E2E, integration | Lulus |
| Parallel Supervisor/QC approval | Supervisor/QC UI, lifecycle E2E, integration | Lulus |
| Reject-fast/terminal immutability | E2E dan integration | Lulus |
| Man reservation/movement/cascade | Board, Man concurrency E2E, integration | Lulus |
| Board realtime/stale fallback | Interactive Board dan E2E | Lulus |
| Supplier dashboard/filter | Seluruh supplier role smoke | Lulus |
| TMMIN dashboard/warning/freshness | Admin/Quality UI dan governance E2E | Lulus |
| Notification read state/deep-link | Supplier UI, integration, External E2E | Lulus |
| Audit traceability | Kedua surface dan integration | Lulus |
| External token/single/batch/order/rate policy | Governance E2E dan integration | Lulus |
| Source preparation/preflight/cutover | Governance E2E dan TMMIN UI | Lulus |
| Accessibility/desktop/Chrome/Edge | Axe/keyboard E2E, interactive overflow | Lulus |
| Loading/empty/error/conflict/stale | Component tests, interactive recovery, E2E | Lulus setelah F-01 |

Deployment VM evidence, backup/recovery, HA, dan production activation tidak diklaim oleh audit
aplikasi ini. Batas tersebut tetap mengikuti PRD dan Phase 15.

## 7. Temuan Baru dan Akar Masalah

### F-01 — Refresh record tidak membersihkan error action

- Severity: **Medium**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: QC membuka Henkaten partial approval, action gagal/conflict, lalu memilih
  `Refresh record`.
- Expected: error lama hilang, query/version terbaru dimuat, comment dan intent key direset.
- Actual: query diinvalidasi tetapi alert `Action tidak dapat diproses` tetap terlihat sampai full
  page reload.
- Bukti seed/API: record Open, Supervisor Approved, QC Pending, dan version authoritative valid.
- Akar masalah: fungsi `refresh()` mereset intent/comment/reroute tetapi tidak mereset local
  `problem` state.
- Pemilik: `apps/supplier-web/src/pages/HenkatenPages.tsx`.
- Fix: `setProblem(null)` dilakukan sebelum query invalidation.
- Regression: `apps/supplier-web/src/App.test.tsx` memicu decision failure, menekan refresh,
  memastikan alert hilang, dan memastikan detail direfetch.
- Verifikasi live: setelah reseed/build baru, `Refresh record` menghapus alert tanpa full reload.

### F-02 — Detail supplier Quality menampilkan credential action terlarang dan status admin palsu

- Severity: **High**
- Klasifikasi: `APP_DEFECT`
- Reproduksi: TMMIN Quality membuka detail supplier Hosted.
- Expected: monitoring/read-only links saja; privileged Supplier Admin identity yang disensor tidak
  boleh disimpulkan sebagai tidak ada.
- Actual:
  - link `External credentials` terlihat lalu berakhir pada 403;
  - panel menulis `Belum ada Supplier Admin aktif` karena API secara benar tidak mengirim identity
    privileged kepada Quality.
- Bukti seed: Supplier Admin GKI dan NPM aktif.
- Bukti API/authorization: credential route tetap 403 untuk Quality; `currentSupplierAdmin = null`
  adalah privacy/capability boundary, bukan bukti tidak ada user.
- Akar masalah: context rail mengeluarkan link credential tanpa role guard dan empty copy panel
  tidak membedakan Admin dari Quality.
- Pemilik: `apps/tmmin-web/src/pages/AdminPages.tsx`.
- Fix:
  - link credential hanya dirender untuk TMMIN Admin;
  - Quality melihat `Detail Supplier Admin hanya tersedia untuk TMMIN Admin`.
- Regression: `apps/tmmin-web/src/App.test.tsx`.
- Verifikasi live: detail supplier Quality tidak mempunyai link credential, tidak menyatakan admin
  tidak ada, dan Hosted support tetap tersedia.

## 8. Ringkasan Klasifikasi

Audit lanjutan ini:

| Klasifikasi | Jumlah |
| --- | ---: |
| `SEED_DEFECT` | 0 |
| `APP_DEFECT` | 2 |
| `CONTRACT_DOC_MISMATCH` | 0 |

Kumulatif tiga audit seeded app:

| Audit | Seed | App | Contract |
| --- | ---: | ---: | ---: |
| Supplier Admin/TMMIN Admin | 0 | 7 | 0 |
| Supervisor/Line Leader | 0 | 6 | 0 |
| Seluruh role/surface lanjutan | 0 | 2 | 0 |
| **Total** | **0** | **15** | **0** |

Tidak ada public API, OpenAPI, Prisma schema, migration, production fallback, atau perubahan business
rule backend dari dua fix terakhir.

## 9. Validation Evidence

| Gate | Hasil |
| --- | --- |
| Targeted frontend regression | Supplier 17/17; TMMIN 11/11 |
| Root unit | 117 Vitest + 2 Node tests lulus |
| Format, lint, TypeScript | Lulus |
| OpenAPI/generated client drift | Lulus |
| Production build | Lulus dengan explicit `VITE_API_ORIGIN` |
| PostgreSQL integration serial | 33/33 lulus |
| Browser E2E | Chromium 4/4 + Edge 2/2 lulus |
| Clean start/reseed | Lulus dengan Node.js 22.23.1 container |
| Gitleaks directory scan | Lulus; tidak ada leak pada source tree |
| Browser console | Tidak ada warning/error pada audit route Quality |
| Viewport | Tidak ada horizontal overflow pada route yang diaudit |

Command root `pnpm build` tanpa environment berhenti sesuai guard karena
`VITE_API_ORIGIN` wajib untuk production build. Rerun dengan explicit local API origin lulus. Ini
adalah konfigurasi build yang disengaja, bukan defect.

Integration setup berhasil 33/33. Sourcing `.env` langsung oleh shell sempat menghasilkan warning
karena satu display-name value mengandung spasi tanpa shell quoting; database tooling dan test tetap
memakai nilai database yang benar. `.env` adalah dotenv input, bukan shell script. Tidak ada secret
yang dicetak.

Directory scan awal mendeteksi private staging key yang berada di gitignored `.local/.ssh`. Key
operator tidak dihapus atau diubah; directory itu dipindahkan sementara ke luar repository selama
scan dan dikembalikan otomatis. Source-tree scan kemudian lulus tanpa leak.

## 10. Risiko Residual

- Host Node.js 26.3.1 berada di luar range 22.23.1–22.x repository. Compose/build acceptance tetap
  memakai Node.js 22.23.1.
- Vite masih memberi non-blocking chunk-size warning.
- PostgreSQL driver masih memberi deprecation warning pada concurrency test mengenai overlapping
  `client.query()`; suite lulus dan follow-up teknis tetap disarankan sebelum pg 9.
- Baseline seed sengaja hanya mempunyai dua supplier Hosted. External workflow dan TMMIN
  notification state dibuktikan pada isolated production-path E2E, bukan permanent seed row.
- Backup, recovery, HA, RPO/RTO, dan staging VM rehearsal tetap di luar acceptance audit aplikasi.

## 11. Kesimpulan

Seed deterministic konsisten dan cukup untuk seluruh Hosted role. Tidak ada bukti bahwa defect
berasal dari seeding. Seluruh anomali yang ditemukan berasal dari application presentation/runtime
dan telah diperbaiki pada lapisan pemilik.

Seluruh role bercredential, kedua client surface, major v1 lifecycle, scope negatif, monitoring,
External integration, Chrome/Edge desktop, serta error/conflict recovery mempunyai evidence
interaktif atau executable. Seed dikembalikan ke baseline dua Hosted/240 Henkaten setelah mutation
audit.
