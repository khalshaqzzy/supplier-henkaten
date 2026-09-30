# ADR 0046 — Supplier setup workbook import and reset

Date: 2026-09-30
Status: Accepted; implemented locally, staging acceptance pending

## Context

Supplier setup spans members and accounts, lines and jobs, parts, shift templates, recurring Line–Shift assignments, and published 4M checklists. The existing Part import reads one sheet, maps two columns, reviews changed names, and commits atomically. Its template is CSV. The Supplier Master Data overview currently hosts a Henkaten export action, although that export contains operational records rather than setup configuration.

Existing identity and retention rules make a general import more involved than a sequence of individual API calls. MP has no registration number; job name is mutable; shift templates have no unique import code. Checklist versions and operational history are permanent. Tanoko deliberately includes inactive members/jobs, and readiness discovers published checklist versions through active templates. Merely setting master rows inactive would therefore leave old setup visible or make old checklists eligible again after reactivation.

Relevant sources: PRD sections 9, 10, 16.7, 19.4 and 22; amendments dated 22–30 September 2026; ADRs 0033, 0038, 0040, 0042, 0043 and 0045. The PRD's older Shift Run and exclusive MP clauses are superseded by the recurring Line–Shift amendments.

## Confirmed product decisions

- Import Data replaces Export Excel on Supplier Master Data. Export Excel moves to the Supplier Henkaten list and keeps its existing Admin permission and export behavior. TMMIN supplier-detail export remains available.
- A downloadable `.xlsx` template includes editable examples whose cross-sheet references are valid. Data is split into sheets for each setup area.
- Import adds new records and reviews Update/Skip for existing records. Records omitted from the workbook are preserved. Import is not implicit replacement.
- Supervisor, Line Leader and QC usernames and initial passwords are supplied in Excel. MP has no account or registration number. Supplier Admin is not imported.
- Tanoko is maintained manually. Member photos and Canvas layout are also configured through their existing UI.
- Imported checklist changes are shown during review and published on commit.
- Reset setup archives the old setup and leaves active configuration empty. Henkaten history, audit and Supplier Admin remain. Any Open Henkaten blocks reset.
- Reset requires the current Supplier Admin password and a concise description of its consequences on the Account page.

## Proposed workbook contract

The shared sheet contract describes canonical sheet names, headers, field types, required values and limits. Parsing, validation and template generation use that contract; the template generator supplies valid cross-sheet examples and formatting.

| Sheet | Columns and identity |
| --- | --- |
| Panduan | Workbook format version, required fields, role values and brief editing instructions; ignored as data. |
| Member | Kode member, Nama, Role, Nomor registrasi, Username, Password awal. Kode member is stable per supplier; registration/account fields are required only for non-MP. |
| Line | Kode line, Nama line, Urutan. Existing line code remains its key. |
| Job | Kode line, Kode job, Nama job, Urutan, Kategori. Job code is stable within its line; category is optional HIGH/MEDIUM/LOW. |
| Part | Part number, Nama part. Reuse current Part normalization and matching. |
| Shift | Kode shift, Nama shift, Mulai, Selesai, Urutan, Timezone. Shift code is stable per supplier. |
| Line Shift | Kode line, Kode shift, Kode Supervisor, Kode LL. One row per line/shift pair. |
| Assignment MP | Kode line, Kode shift, Kode job, Kode MP. One row per line/shift/job. |
| Checklist 4M | Kategori, Urutan, Pertanyaan. A supplied category represents its entire proposed question list. |

Codes are text identifiers, not new MP registration numbers. Leading zeroes must survive. Excel identifier columns are formatted as text. Role, category and reference cells have validation lists; headers are frozen, column widths readable, and required columns visually distinguishable. Examples cover Supervisor, two distinct LLs, QC, multiple MPs, jobs, parts, a daytime and overnight shift, assignments and all four checklist categories. Timezone defaults to the supplier timezone. Generated example passwords meet the existing 12–128 character policy and are synthetic; no actual account credentials enter template source code.

Absent or empty recognized sheets do not erase existing data. At least one supported data sheet must contain rows. An import can contain a subset of sheets when its references resolve against selected workbook rows or existing tenant records. Unknown sheets and extra columns are reported as ignored. Duplicate aliases mapping to the same setup area, duplicate mapped required headers, unsupported workbook format versions, malformed identifiers and unresolved references block review/commit.

Headers use a documented canonical format and small alias set. General import does not require a manual mapping wizard for every sheet. The existing flexible CSV/Excel Part import remains available; its parser/validation helpers are shared where useful.

### Existing data matching

Add optional normalized import codes for Member, Job and ShiftTemplate with tenant/parent-scoped uniqueness. Existing individual CRUD remains compatible. New imports require codes for these rows and retain them across future imports, including renames.

For existing rows without a code, exact unique identifiers can suggest linking: registration/username for non-MP, line plus job name for a job, and an unambiguous shift candidate. Every suggested initial link is visible and confirmed in review. MP name is never an automatic identity match; an explicit existing-member selector supports initial linkage. Ambiguous or contradictory matches block that row until corrected. Binding an import code is audited and versioned.

Existing inactive or reset-archived rows are never silently reactivated. Review offers explicit Restore/Skip where restoration is valid. Existing identity is retained on restore. Existing member role is immutable; imports cannot turn an MP into an LL or move an existing job to another line. These require the existing correction workflow. Natural keys and import codes are not silently recycled into new identities after reset.

Blank nullable assignment values explicitly propose removing that assignment on an included row; review displays the removal. Missing rows/sheets preserve assignments. Checklist changes are reviewed as a whole category, including removed questions and replacement of any current draft. Update publishes a new immutable version; Skip preserves the current draft/publication.

## Import interaction

### 1. Select file

A large centered dialog opens from Import Data. The upload surface supports browse, drag/drop and keyboard activation, with `.xlsx` and 50 MB constraints visible. Download template is a secondary action. Selected filename, size, replace-file action and real processing state are shown.

Parsing occurs in a browser worker using the installed read-excel-file multi-sheet API. Read only relevant data; enforce compressed-file size, expanded-sheet/cell/string budgets and row limits before preparing a server payload. The existing 50,000 Part row maximum remains; total-workbook and other-sheet limits must be explicit and measured against the 20 line/300 member/500 job baseline. Completely blank rows are skipped, while partially filled rows retain accurate original Excel positions.

### 2. Validate and review

Desktop shows a sheet rail with counts/statuses and a content pane. Mobile uses a compact sheet selector and full-height dialog. Summary counts distinguish New, Changed, Unchanged, Restored and Errors. New/unchanged records need no per-row action. Review focuses on differences and material actions, with Update/Skip choices and bulk controls scoped to the current sheet. No changed record is overwritten without an explicit choice.

Cross-sheet validation uses the final selected state, including existing values for skipped changes. It checks supplier-scoped references, roles, active/restored resources, uniqueness, capacities, per-job assignment identity, LL's one-active-Line–Shift rule, valid times/timezone and checklist questions. MP may be assigned repeatedly; overlapping schedules are valid. Default MP assignment does not require a Tanoko assessment; Man replacement still requires manual Tanoko level >= 3 through existing rules.

Errors show Sheet, Row, Column, Problem and Correction. Clicking an error selects its sheet/row. A downloadable error report contains no passwords or raw sensitive cells. Invalid rows are not silently discarded and a workbook with unresolved blocking errors cannot be partially committed. New incomplete setup can be saved where existing individual setup rules permit it; readiness gaps are warnings/next actions, distinct from invalid data.

### 3. Import

The final footer states counts and provides a specific Import data action. Editing is disabled after submission until the result is known. The import is applied atomically across all selected sheets. UI states distinguish Preparing, Queued, Importing, Completed, Conflict and Failed; numerical progress is used only for measured work.

Recommend a durable import operation with polling/status recovery, rather than a single long request whose response can be lost. Authorization, preview/version checks and bounded password hashing precede enqueueing. The background apply transaction validates the persisted plan against current state and commits resource writes, audit, outbox and the operation's success receipt together. Preparation and write progress do not imply partially committed setup. A leased worker recovers after process interruption without replaying a successful transaction.

The same Idempotency-Key and immutable payload are reused for uncertain retries. A different payload with the same key is rejected. Only the operation ID may be kept in session storage, scoped by supplier/user; raw rows, passwords and workbook contents remain outside browser persistent storage. Requester, session/source context and authorization are checked on operation access and before application. When authentication is no longer valid the pending write is rejected; commit-boundary checks are consistent with existing request lifecycle controls.

### 4. Result

Display confirmed totals per sheet and readiness next actions, with Lihat readiness and Tutup. Missing Tanoko assessment is shown as an actionable next step when relevant; import must not claim Man replacement is ready. Closing/reopening during server application reconnects to status. Closing a populated, unsubmitted draft requires confirmation and clears sensitive memory.

## Password handling

- Initial passwords are required for new non-MP accounts, use the established length policy, are preserved exactly without trimming, and are hashed with existing Argon2id settings using bounded concurrency.
- Import does not change credentials of existing accounts. Nonempty Password awal cells on existing rows are explicitly reported as ignored; credential reset remains the dedicated account action.
- Password cells are masked in browser previews. Neither template review responses, error reports, audit, logs nor terminal import results expose plaintext. The uploaded workbook is never stored on the server.
- Only hashes for actual new-account rows can enter a pending durable plan; they are removed with temporary plan data after the operation terminates. The endpoint must redact nested password fields before any diagnostics. Failure messages identify only the cell location and validation requirement.
- Existing inactive accounts require a separate explicit restoration policy: keep their existing password and must-change state on ordinary restore; do not replace them with the workbook value. If account recovery is needed, use the dedicated reset-password action.
- New users have mustChangePassword=true and password history is written in the same transaction as their accounts.

## Reset interaction and semantics

The Account page adds a restrained separate Reset setup card, using the existing design tokens and a destructive action. Proposed copy: "Kosongkan master data dan assignment. Riwayat Henkaten tetap tersimpan." The confirmation dialog identifies the supplier, summarizes affected counts, states that member accounts will be disabled, and requires Password admin with an accessible visibility control. No extra typed phrase is needed.

Preflight lists blocking Open Henkaten and links to the filtered list. Empty setup has a disabled action with Setup sudah kosong. Wrong password is an inline field error; throttling gives a retry time. Counts/version changes refresh preflight rather than applying a stale confirmation. Reset initially requires a direct Supplier Admin session: delegated TMMIN support sessions cannot enter another administrator's password. Hosted Preparation retains the existing configuration-write boundary, and External history does not count as erasable setup.

Reset is one supplier-scoped transaction with idempotent receipt and these effects:

1. Recheck administrator/session/source context and current password proof, obtain the common supplier setup mutation lock, and recheck Open Henkaten at the final boundary.
2. Archive members, lines, jobs, parts, shift templates and Line–Shifts; increment versions and attach reset/archive metadata. Clear mutable default references and current setup MP assignments while preserving identities referenced by history.
3. Disable Supervisor/LL/QC accounts and revoke their sessions, push subscriptions and pending account-targeted delivery. Keep Supplier Admin, tenant identity, timezone and source configuration.
4. Empty checklist drafts, deactivate templates and clear the current published-version pointer. Preserve all published versions and Henkaten checklist snapshots. The next publication explicitly establishes a new current version.
5. Clear current Tanoko levels with normal version/history/audit evidence; preserve Tanoko history. Reset-archived MPs/jobs are excluded from the current matrix, while normally inactive rows continue to follow its existing display policy. Restore does not resurrect old proficiency values.
6. Reset mutable Canvas configuration to fresh generated layout and invalidate affected board/readiness/master/Tanoko views; preserve relevant audit evidence and old operational snapshots.
7. Record reset batch summary and each meaningful state change without secrets, publish safe invalidation events, and complete the receipt atomically. Supplier Admin is returned to Setup Supplier with actionable empty states.

Archived records remain accessible through archive/history surfaces. Reimporting the same keys links/restores the old identities explicitly and starts with empty assignments/current checklist/Tanoko as appropriate. Reset is not database reset, does not clear Henkaten identifiers/sequences, and does not change the supplier source epoch.

## Backend and concurrency design

Proposed routes under `/api/v1/supplier/master-data`:

- `GET /setup-import/template`: styled, versioned workbook with supplier timezone and valid examples.
- `POST /setup-import/preview`: normalized rows and safe source locations; returns diff, reference errors, versions and suggested initial links without credentials.
- `POST /setup-import/commit`: explicit row/category decisions, versions, required new-account passwords and Idempotency-Key; returns operation/status handle.
- `GET /setup-import/operations/:id`: requester-scoped status, confirmed totals and safe diagnostics.
- `GET /setup-reset/preview`: affected counts, revision and Open blockers.
- `POST /setup-reset`: password, preview/revision and Idempotency-Key; returns confirmed reset receipt.

Shared contracts and generated API client/OpenAPI must describe all states and structured diagnostics. Split normalized credential-free rows from private account password inputs. Extend the existing import body middleware by exact route allowlist; preserve its pre-parser Supplier Admin, Origin/CSRF, writable-purpose, capacity and time protections. Apply smaller route-specific limits to reset and status endpoints.

A supplier setup revision and common lock protocol coordinate import, reset and all existing writers of affected resources. Integrate ordinary member/catalog/checklist/Line–Shift/Tanoko/Canvas edits as well as account restoration and relevant operational creates; a reset-only lock cannot prevent concurrent ordinary writes. Retain resource expected versions, including account versions and binding changes. Recheck Open Henkaten under the same lock used by concurrent Hosted submission. Avoid holding a database transaction while hashing passwords or parsing files. Reset and import cannot apply concurrently for the same supplier.

Schema work is additive: import code fields/normalized constraints, setup revision/reset metadata, current checklist publication pointer, and operation/receipt state with idempotency binding. Backfill the current checklist pointer to the latest published version according to existing behavior; do not infer skills or create MP registration numbers. New writers and read models must preserve historical relations. Operation plan data has bounded retention and is cleaned after terminal state; receipts retain only safe outcome metadata.

## Visual direction

Use the current neutral surfaces, orange primary action, typography scale, borders and radii. Review tables have aligned compact values, readable differences and restrained status badges. The dialog header/footer remain visible and only content scrolls; horizontal scrolling stays local to tables. Long names, many sheets, pagination and dynamic errors must not shift or clip primary actions. Motion is subtle and respects reduced motion.

All touched pages are reviewed together: Master Data, import dialog, Henkaten export entry, Account reset card/dialog, readiness, archive views and affected Tanoko/checklist empty states. Remove account-page technical session prose where it does not help the user act. Maintain 44 px targets, keyboard navigation, focus trap/restore, programmatic field errors, live status announcements and non-color-only state cues.

### Loading and transition acceptance

Polished loading states are an explicit product requirement across every touched action, including short secondary actions, status recovery and empty-state transitions.

| Surface | Loading behavior |
| --- | --- |
| Template download | Download button retains width, shows a small progress icon and Mengunduh template; duplicate requests are prevented and failure remains beside the action with retry. |
| Workbook parsing | Selected-file card remains visible with Membaca file and then Memeriksa sheet. Worker activity keeps the dialog responsive. Replace/cancel can invalidate local parsing safely; an obsolete result never replaces the new file. |
| Initial server matching | Rail/count/table skeletons match the final geometry. Memeriksa data identifies the active operation without showing invented counts. Header, filename and footer remain stable. |
| Sheet review | Cached sheet content appears immediately. A required fetch uses skeleton rows of the same height; loading one area does not unnecessarily blank the whole dialog. Current selection and review choices remain visible. |
| Import submission | Primary button keeps its dimensions and shows Menyiapkan import; review becomes read-only. Once queued, a compact stage tracker distinguishes Antrean, Memproses and Selesai. Percentages are reserved for real measurable work and never imply partial persistence. |
| Uncertain/network result | Memeriksa hasil import with safe status polling/retry; keep the operation ID and confirmed previous status. Never label an uncertain response as a failed transaction or enable a duplicate submission. |
| Reset preflight | Counts/blockers have matching skeletons; the destructive action remains disabled until the current summary is known. A failed preflight has a visible Coba lagi action. |
| Reset submission | Inline Memverifikasi password followed by Mereset setup; lock relevant fields and prevent double-submit. On uncertain response, Memeriksa hasil reset recovers through the receipt. Success is shown only after confirmed commit. |
| Post-success refresh | Update counts/readiness with a restrained fetching indicator while preserving readable confirmed results. Navigation into the empty setup uses the page's normal skeleton geometry, then actionable empty states. |

Use one animation rhythm from the existing token system: restrained neutral skeleton treatment and subtle icon motion, no decorative loaders or alternating layout. Reduced motion disables shimmer and unnecessary transitions while leaving clear text feedback. Use aria-busy at the affected region and a polite live region for meaningful stage changes; do not announce every polling response or replace the entire dialog's focusable structure during loading. Clear password fields after reset proof is no longer needed.

Visual acceptance covers immediate and delayed responses, slow network, file replacement during parsing, rapid sheet switching, retry after failure, offline/reconnect, an expired session, unknown commit result and completed-result refresh. Screenshot/manual review must inspect intermediate loading states at the same mobile/tablet/desktop widths as success states, including sticky footer and PWA banner interactions.

## Implementation sequence and acceptance

1. Reconcile PRD scope/retention/export clauses and accept the workbook/restore semantics; freeze sheet contract and UI state model.
2. Add forward-only schema changes and shared contracts; verify fresh/upgrade migration, preserved historical references and unchanged individual CRUD. Review seed compatibility.
3. Implement template generation and worker parsing/structured validation; exercise all example rows through the same production validators.
4. Implement preview/matching, transactional writer helpers, operation recovery, password handling, idempotency and exact-route parser protection. Reuse domain invariants without calling independently committing CRUD endpoints in a loop.
5. Implement reset preflight/reauthentication/transaction, integrate the common lock protocol and update checklist/Tanoko/Canvas/current read models.
6. Implement and refine the import dialog, move Supplier export action, and add Account reset UI. Keep the specialized Part import and TMMIN export working.
7. Run meaningful unit tests, Docker PostgreSQL integration/negative authorization and concurrency tests, then isolated Chromium/Edge E2E plus screenshots/axe at mobile/tablet/desktop widths. Validate template in Excel when available, including dropdowns, text identifiers and overnight shifts.
8. Run the repository-required local CI parity checks, fresh seed smoke, OpenAPI/client parity, format/lint/types/build, migration/secret/dependency/container gates and cleanup before any later commit/delivery. Update PRD, roadmap, handoff and this ADR with actual evidence. No deployment is implied by this plan.

Critical acceptance cases include: empty supplier to valid setup; partial workbook against existing setup; repeat import; update/skip affecting references; ambiguous MP linkage; unchanged/inactive credentials; password length and nested redaction; overnight and overlapping shifts; duplicate LL across file plus existing setup; repeated MP assignments; old checklist publication after reset; reset followed by reimport; no Tanoko value resurrection; concurrent edit/reset/import/Hosted submission; network loss before and after commit; server restart; account/source revocation while queued; rollback across all sheets; cross-tenant/role access; large Part batch and maximum new accounts within memory/time budgets; keyboard, reduced motion and PWA banner overlap.

## Alternatives and consequences

Sequential individual CRUD would leave partial setup and repeat credential creation on retry. Automatic replacement would delete or deactivate data absent from a file without a reviewed decision. Matching MP by name would merge different people. Plaintext job payloads would retain passwords unnecessarily. Hard deletion would violate the confirmed retention policy and permanent historical foreign keys. Deactivation alone would not make Tanoko/checklist behavior empty after reset.

The design adds schema and operation coordination work, but makes the general import reusable, repeatable and reviewable while preserving history. Capacity review must measure hashing and maximum-size workbook behavior before declaring production performance acceptance.

## Validation in this session and follow-up

The initial analysis established workbook, linkage, restoration, operation recovery and reset semantics. Implementation and local verification are recorded below. Commit, delivery and deployment remain separate actions.

## Local implementation evidence — 30 September 2026

The contracts, additive migration, operation worker, atomic planner/writer, template generator, authenticated endpoints and responsive Supplier dialogs are implemented. Existing Part import is retained. Reset uses one atomic request; the loading label covers password verification and reset together, avoiding a fabricated per-stage percentage. Durable import operations retain only hashed credentials and wipe the payload after success/failure.

Fresh migration execution, main-to-current migration upgrade, unit tests, typecheck, lint and the PostgreSQL integration suite were exercised. The browser journey downloads and imports the actual workbook, reviews checklist changes, checks 1440/1280/768/390 px layouts, runs axe checks, verifies export relocation and resets through the account dialog. Contrast findings were corrected before the final browser run. Integration scenarios include idempotent retry, omitted data, stable identity restoration, retained passwords/publications, stale revisions, invalid references and authorization revocation. Exact final counts and remaining release limits are recorded in sessionHandoff.md.

The final template includes a complete column dictionary in Panduan, conditional account-field rules, limits, reference guidance and header notes. Examples span two lines, four jobs, ten members, three parts, four Line–Shifts, eight MP assignments and twelve checklist questions. Typed references to existing setup are permitted even when absent from template dropdown lists; authoritative validation occurs during import review. The expanded example workbook is exercised through the real PostgreSQL import/reset suite.

## Delivery review — 30 September 2026

Assignment audit identity is taken from the upsert result so newly seeded Line–Shift assignment rows remain traceable. The PostgreSQL suite verifies every imported MP assignment audit references a real persisted row. The browser suite explicitly selects Microsoft Edge unless an executable override is supplied; the previous device-only default could run Chromium under an Edge device profile. Production container and workflow parity are rerun for delivery, with exact commands and results in the handoff.
