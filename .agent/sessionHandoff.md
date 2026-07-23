# Session Handoff — Phase 4

Tanggal: 2026-07-23
Branch: `staging`
Status repository: Phase 0–4 selesai; Phase 5 `planned`
Target commit: `feat: add hosted supplier master data management`

## 1. Outcome

Phase 4 menambahkan backend Supplier Master Data lengkap untuk tenant Hosted dan Hosted
Preparation:

- member Supervisor, Line Leader, MP, dan QC dengan permanent logical retention;
- linked operational account dan one-time temporary credential untuk Supervisor/LL/QC; MP tetap
  tanpa akun;
- private member-photo upload, normalization, thumbnail, authenticated delivery, dan asynchronous
  old-file cleanup;
- line, job, part, dan configurable Shift Template;
- persisted checklist draft serta immutable published version untuk MAN/MACHINE/MATERIAL/METHOD;
- typed Default Assignment untuk Supervisor per line, satu LL per line, dan satu MP per job;
- optimistic concurrency, active-capacity limits, deactivation/reference protection, audit, dan
  tenant/source boundary;
- read-only cross-tenant master-data API untuk TMMIN Admin dan TMMIN Quality sesuai privacy policy;
- real Phase 4 minimum Hosted configuration contributor untuk source cutover.

Tidak ada Shift Run, Working Assignment, Henkaten, frontend, External ingestion, atau deployment
yang dibuat pada phase ini.

## 2. Product dan Security Decisions

- Seluruh master data permanen sejak dibuat. Tidak ada public hard-delete endpoint.
- Member role immutable. Koreksi role dilakukan dengan deactivate lalu create replacement.
- Active capacity per supplier adalah 300 member, 20 line, dan 500 job; capacity-changing
  transaction mengunci Supplier row.
- Nomor registrasi, line code, job name dalam line, part number, dan supplier username memakai
  normalized uniqueness yang tetap reserved setelah deactivation.
- Supplier Admin `NORMAL` hanya dapat mutate tenant aktif ber-mode `HOSTED`.
- Supplier Admin dengan purpose `HOSTED_PREPARATION` dapat mengelola konfigurasi Phase 4 ketika
  preparation dan source epoch masih valid; operational writes tetap belum tersedia.
- Pure `EXTERNAL` tanpa preparation ditolak dengan `SOURCE_MODE_MISMATCH`.
- TMMIN Admin dapat membaca Hosted dan active Hosted Preparation; TMMIN Quality hanya dapat membaca
  Hosted. Semua privileged read menulis safe audit tanpa nilai PII.
- TMMIN Quality dapat melihat Hosted member name, registration number, dan photo, tetapi tidak
  username, credential, normalized lookup field, session, atau hash.
- Supervisor/LL/QC belum memperoleh broad master-data read API. Role-scoped operational board
  menjadi milik Phase 8.

PRD, domain model, state machine, events/errors, privacy baseline, dan roadmap telah diselaraskan.

## 3. Persistence dan Migration

Migration baru:

- `apps/api/prisma/migrations/20260723000200_supplier_master_data/migration.sql`

Entity baru:

- `Member`, `MemberPhoto`;
- `Line`, `Job`, `Part`, `ShiftTemplate`;
- `ChecklistTemplate`, `ChecklistDraftItem`, `ChecklistVersion`, `ChecklistVersionItem`;
- `DefaultAssignmentSet`, `DefaultLineSupervisor`, `DefaultLineLeader`, `DefaultJobMp`.

`User.memberId` menghubungkan operational account ke non-MP member. Composite supplier-aware
foreign keys mencegah relasi lintas tenant. PostgreSQL trigger menolak perubahan `Member.role` dan
UPDATE/DELETE terhadap published checklist versions/items. Foreign key memakai restrictive
deletion; tidak ada cascade business-data delete.

Migration berhasil:

- upgrade main database dari Phase 3 ke Phase 4;
- fresh disposable test database dengan migration Phase 3 + Phase 4;
- repeated `migrate deploy` tanpa pending migration.

## 4. API dan Contracts

Supplier routes berada di `/api/v1/supplier/master-data`:

- member list/detail/create/update/activate/deactivate;
- linked account update/activate/deactivate/reset-password;
- photo upload/remove dan full/thumbnail delivery;
- line, nested job, part, dan Shift Template CRUD/status/reorder;
- checklist draft/update/publish/version/status;
- Default Assignment read serta Supervisor/LL/MP assign/change/move/remove.

TMMIN read-only routes berada di
`/api/v1/tmmin/suppliers/{supplierId}/master-data` untuk member/photo, line/job, part, Shift
Template, published checklist, dan current Default Assignment.

Shared Zod contracts menambahkan master-data enums, schemas, pagination/search/filter/sort,
multipart/binary photo interface, capability, domain-event vocabulary, dan errors:

- `CAPACITY_EXCEEDED`;
- `RESOURCE_IN_USE`;
- `IMMUTABLE_FIELD`;
- `INVALID_IMAGE`;
- `CHECKLIST_NOT_PUBLISHED`.

Committed OpenAPI 3.1 telah diregenerasi dan runtime memuat 71 paths.

## 5. Member Photo Boundary

Dependencies:

- `sharp@0.35.3`;
- `multer@2.2.0`;
- `@types/multer@2.2.0`.

Runtime configuration:

- `PHOTO_STORAGE_ROOT`, default local `.local/uploads/member-photos`.

Pipeline:

- single multipart field `photo`, maksimum 2 MiB;
- JPEG/PNG/WebP dengan MIME dan decoded format yang cocok;
- corrupt, animated/multi-page, dan gambar di atas 25 megapixel ditolak;
- EXIF orientation dinormalisasi dan metadata dibuang;
- full WebP maksimal 1024×1024 quality 82 tanpa enlargement;
- thumbnail WebP 256×256 center-crop quality 80;
- generated opaque paths pada private persistent root;
- temporary write dan atomic rename pada volume yang sama;
- replacement/removal menandai old metadata dan enqueue idempotent cleanup;
- delivery setelah database authorization dengan `image/webp`, private cache, ETag, dan `nosniff`;
- readiness memeriksa storage root writable.

Tidak ada backup photo volume; accepted critical recovery risk tetap berlaku.

## 6. Checklist, Assignment, dan Cutover

- Checklist template dibuat lazily per supplier/category.
- Draft adalah persisted working copy dan replacement menaikkan template version.
- Publish memerlukan minimal satu unique normalized item dan menghasilkan immutable numbered
  version.
- Semua empat current active published categories wajib agar Hosted cutover eligible.
- Default Assignment menggunakan typed relations dan supplier-level monotonic assignment-set
  version.
- Supervisor dapat memegang beberapa line; LL maksimal satu line; MP maksimal satu job.
- LL/MP move melepas donor dan mengisi target dalam satu transaction.
- Default mutation tidak membuat Henkaten atau Working Assignment.
- Phase 4 contributor memeriksa active Supplier Admin, line+Supervisor+LL, job+MP, part, Shift
  Template, dan empat published checklist.
- Phase 9 contributor tetap blocking, sehingga production source cutover belum dapat diselesaikan.

## 7. Documentation dan ADR

ADR baru:

- `0011-permanent-master-data-and-member-account-lifecycle.md`;
- `0012-versioned-checklists-and-typed-default-assignments.md`.

ADR yang diperbarui:

- 0003 tenant isolation dan privileged read;
- 0005 master-data lock ordering;
- 0007 photo validation/storage/cleanup;
- 0010 real Phase 4 cutover contributor.

Kedua ADR baru memuat actual validation evidence. README dan `.env.example` memuat photo storage
serta Phase 4 development surface.

## 8. Verification Evidence

Semua verification dijalankan dengan Node.js `22.23.1`.

Unit:

- contracts: 14 passed;
- deterministic fixtures: 6 passed;
- API unit: 5 passed.

PostgreSQL integration/Supertest:

- 3 test files;
- 11 tests passed;
- fresh/upgrade migration, tenant constraints, immutable triggers, account/member linkage,
  one-time credential, pure External/Hosted Preparation boundaries, default assignments, checklist
  publish, malformed/cross-tenant photo denial, photo processing/delivery, privileged PII-read
  audit, and cutover contributor covered.

Quality/database commands yang lulus:

- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test:unit`;
- `pnpm db:verify`;
- `pnpm db:test:reset`;
- `pnpm db:test:migrate`;
- `pnpm test:integration`;
- `pnpm openapi:check`;
- `pnpm build`;
- `pnpm validate`;
- `docker compose config --quiet`;
- `git diff --check`.

Runtime smoke:

- `/health` → `200`;
- `/ready` → `200`, checks database, migrations, dan photo storage semuanya `ready`;
- `/api/v1/openapi.json` → valid OpenAPI 3.1 dengan 71 paths.

API smoke process dihentikan setelah verifikasi. Local Docker container dihentikan pada final
cleanup tanpa menghapus persistent main volume.

## 9. Intentional Deferrals

- Phase 5: Shift Run, Working Assignment snapshot, preflight, hard gate, emergency override,
  Assignment Issue.
- Phase 6–7: Henkaten, approval, reservation, Man movement, End Shift finalization.
- Phase 8: board, notification, SSE, dashboard, audit read APIs.
- Phase 9: External credentials/ingestion dan final source-cutover contributors.
- Phase 10: backend contract freeze/performance/security hardening.
- Phase 11+: frontend, E2E, containers, deployment, dan UAT.

Phase 5–7 harus memperluas reference protection untuk active Shift Run, Working Assignment, Open
Henkaten, dan reservation.

## 10. Next Recommended Batch

Mulai Phase 5.1:

1. expand-only migration untuk `ShiftRun`, `WorkingAssignment`, dan `AssignmentIssue`;
2. implement Shift Run state machine dan one-active-shift-per-line invariant;
3. snapshot Default Assignment set/version saat Start Shift;
4. implement preflight vacancy/conflict/carry-over hard gates;
5. implement audited emergency override dengan required reason;
6. expose shift list/detail/current queries dan real PostgreSQL concurrency tests.

Jangan memulai Henkaten, frontend, External ingestion, atau deployment sebelum dependency phase
masing-masing terpenuhi.
