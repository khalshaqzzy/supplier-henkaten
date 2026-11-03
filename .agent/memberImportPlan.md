# Impor khusus Member & Akun

Status: implemented locally, 2 November 2026; final validation evidence in sessionHandoff.md.

## Context and scope

`MasterListPage` has a Part import entry but no member import entry. The setup workbook already
supports Member rows, stable import codes, explicit MP linkage, reviewed merge, durable operations,
bounded password hashing and transactional supplier locking. Reuse that engine rather than issue
individual CRUD requests. The new entry is on `/master-data/members` only and accepts CSV and `.xlsx`.
The server exposes strictly Member-only preview/commit routes. No other master-data resource is writable
through those routes. Existing setup workbook and Part import remain available.

The PRD's general CSV exclusion needs a narrow Member exception. The November account lifecycle
amendment takes precedence over the old setup writer's automatic account activation on restore.
Member restore and account activation must remain separate in both import entry points.

## Product decisions

- Supplier Admin only, with the existing Hosted, Hosted Preparation and delegated support boundaries.
- Maximum 300 data rows per file and 300 active members after merge. Maximum 50 MB compressed/input,
  existing bounded ZIP expansion/complexity, 32 columns and 32 sheets. Check row counts before building
  normalized row objects; use a worker so cancellation/file replacement does not block the interface.
- CSV uses the first physical record as headers; support BOM, quoted commas/newlines and detected
  comma/semicolon delimiters. Ignore genuinely empty records while preserving original row positions.
- XLSX reads `Member` when present, otherwise one unambiguous non-guide worksheet. Other sheets are
  ignored with an explicit note; multiple candidate sheets require renaming the intended one `Member`.
- Recognized headers may be reordered and extra columns ignored. Keep the existing template field names
  and keys: Kode member/code, Nama/name, Role/role, Nomor registrasi/registration, Username/username,
  Password awal/password. Mandatory headers: code, name, role. This is template-based import; arbitrary
  column mapping and `.xls` are outside this change.
- Stable member code is mandatory. Preserve leading-zero text identifiers; never guess lost zeroes or
  coerce unsafe numeric values. Password whitespace is significant and passwords must be text.
- MP has no registration/account/password. Supervisor, LL and QC require registration and username;
  only NEW operational accounts require a 12–128 character initial password and first-login change.
  Supplier Admin and TMMIN accounts cannot be imported.
- Match by existing code, then existing operational registration/username. Ambiguous identity is blocked;
  existing codes cannot be renamed. Uncoded MP requires an explicit existing-person selection or remains
  a new member; names never merge identities automatically.
- New rows create members/accounts; changed rows need Update/Skip; archived rows need explicit Restore/
  Skip. Omitted rows and passwords on existing accounts remain unchanged. Role changes use Ubah role.
- Restore activates the member only. Inactive accounts remain inactive until the separate activation
  action issues a temporary password. Restoring assignments requiring such an account is blocked until
  activation; setup workbook review must model this final state truthfully.
- Import never updates photos, Tanoko, assignments or other setup entities through its scoped routes.

## UI/UX specification

Keep HDS, Inter, existing neutral surfaces and orange action. Add secondary `Import CSV / Excel` beside
primary `Tambah member`; keep that header action available in empty/filtered states, preserving filter/no-result behavior without duplicate dialogs.
Use the existing import dialog state machine with a focused Member mode, not the multi-sheet rail.

1. **Pilih file:** title `Import Member & Akun`; concise drag/drop and keyboard file picker; format,
   size/row limit and Download template Excel/CSV. Excel guide contains conditional fields and editable
   examples. Surface filename and file replacement action after selection.
2. **Periksa data:** show actual Baru/Berubah/Sesuai/Error totals; source row, member code/name, role,
   registration and username; password masked and absent from server preview payload. Show before/after
   changes and explicit row decisions, bulk Update/Skip, explicit uncoded MP linkage. Row errors identify
   source row/column and correction, with focusable summary and safe downloadable details.
3. **Import/Hasil:** stable header/footer and reserved loading geometry, real queued/running/completed
   status with no fabricated percentages. Disable edits during submission/uncertain outcomes, retry exact
   payload/key. Store operation ID only for recovery, scoped by supplier/requester/entry. On confirmed
   completion clear credentials, invalidate member/readiness queries and offer `Lihat member`.

Desktop retains readable review width; on phone use full-height dialog, locally scrolling content,
wrapped differences and persistent safe-area footer. Remove redundant single-sheet controls. Minimum
44px action targets; keyboard focus trap/restore, live stage announcements, focusable error summary,
non-color status labels, reduced motion. Use concise action copy; no architecture prose in the UI.

## Implementation sequence

1. Add narrow shared request schemas and server routes, OpenAPI/client methods, template generation.
   Preserve requester-scoped shared operation polling. Reuse existing import parser budget (a dedicated preauthorized 2MB
   JSON parser for at most 300 normalized rows); avoid granting this route the 80MB Part budget.
2. Add Member CSV/XLSX worker/parser with input/row/column bounds, worksheet choice and structured issues.
3. Add focused dialog mode, entry/empty state, template downloads and targeted responsive polish.
4. Correct shared restore writer/final-state model and align workbook restoration integration coverage.
5. Validate contracts/parser, route confinement, merge/restore/password/idempotency, stale and revoked
   commands. Verify the production seed remains compatible (no database migration expected).
6. Exercise actual downloaded Excel and CSV import through Chromium and Edge. Inspect desktop/tablet/
   phone at 1440/768/390px, keyboard/axe, slow matching, error, review and success; retain screenshots.
7. Run format/lint/typecheck/unit, OpenAPI generation consistency, build and Docker PostgreSQL integration.
   Update PRD/ADR/roadmap/handoff with actual evidence; stop task-owned runtimes. No commit/deployment
   implied; the complete CI parity in rules.md applies before any later commit.

## Risk and acceptance gates

- CSV passwords must never appear in review requests, DOM, error exports, logs or persistent browser
  storage. Only a commit carries new credentials; queued payload contains hashes, not plaintext.
- Repeated/uncertain commit must produce one durable operation and preserve original credentials.
- A forged Part/Line/assignment/checklist row to the member route must fail before mutation.
- All existing IDs/photos/passwords and inactive account states survive updates/restores; no role changes.
- Detect registration/username conflicts including archived members and Supplier Admin reservations.
- Concurrent manual edit/role change/reset/import must invalidate stale review; execution revalidates
  session/source/delegated operator under the common supplier lock.
- Multi-sheet setup reactivation with inactive operational accounts now needs separate account activation
  before dependent assignment restoration. This intentional compatibility correction needs regression QA.
- Real desktop Excel/device/staging acceptance remains distinct from local automated browser evidence.


## Analysis outcome and implemented refinements

The shared engine was sufficient; no migration, new dependency or seed edit was required. Dedicated
routes enforce scope independently of the visible controls. The main compatibility defect was account
activation during restore; the shared planner/writer and real database regression now enforce separate
activation. Imported username changes also revoke old sessions/push as ordinary username changes do.
The shared dialog additionally clears stale/failed review, announces errors, and supports cancelling
an obsolete parsing worker through file replacement. Unit tests exercise these interaction boundaries.
