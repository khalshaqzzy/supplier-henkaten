# Supplemental 4M checklist implementation plan

Date: 2026-10-23 · Branch: `feat/optional-4m-checklist` · Base: `main` (`eeb1541`)

Implementation is included in this branch. Verification and delivery status are recorded in
[sessionHandoff.md](sessionHandoff.md); this document records the analysis, execution sequence,
and acceptance criteria. Phase 15 staging/device acceptance remains in progress.

## Product contract

A 4M category remains required to classify Henkaten. Its checklist is an optional supplement.
A supplier may configure zero categories and zero items per category. Hosted activation/cutover,
clone, submission and approval must not require a checklist, any answers, or all-Yes answers.
Submit must execute directly without a confirmation, acknowledgement, warning dialog or second
submit action for missing, partial or negative checklist evidence. Existing operational fields,
MP qualification, role/tenant/source authorization, approval routing and PCR screening remain.

The same relaxation applies to External ingestion: absence, empty items, No and unanswered items
are accepted as evidence, without converting them to a successful check. Existing all-Yes clients
remain valid. `allPassed`, when supplied, is source metadata and has no workflow authority.

## Existing behavior and dependency analysis

| Layer / source | Existing constraint or assumption | Required change |
| --- | --- | --- |
| `packages/contracts/src/henkaten.ts` | Version required; at least one answer; detail and clone assume a checklist | Optional request fields, integrity refinement, nullable detail/clone evidence |
| `apps/api/src/henkaten/henkaten.service.ts` | Latest active publication, equal answer count, all Yes; writes every answer as Yes | Accept omitted/partial/No; validate supplied version/item identity; persist actual answers |
| `apps/api/src/henkaten/henkaten-presenters.ts` | Throws when snapshot missing | Return `checklist: null` |
| `apps/api/prisma/schema.prisma` | Snapshot relation is already optional; answer column is non-null | Reuse optional snapshot; relax only answer nullability |
| `apps/api/src/master-data/checklist.service.ts` | Empty publication prohibited; deactivation blocked by active legacy occurrence | Permit empty publication and independent deactivation; retain expected versions/audit |
| `apps/api/src/administration/hosted-readiness.service.ts` | Four published categories block readiness and source changes | Keep optional category count, set required count to zero, remove checklist blockers |
| `apps/api/src/shifts/shift.service.ts` | Retained legacy preflight still checks four publications | Remove obsolete checklist dependency; do not revive removed lifecycle endpoints |
| `apps/supplier-web/src/pages/HenkatenCreatePage.tsx` | All-Yes gate, mandatory version/items, danger state when missing | Required operational fields only; optional section; send supplied answers only |
| `apps/supplier-web/src/pages/HenkatenWorkflow.tsx` | No explicitly says it blocks submission | Neutral Yes/No/unanswered labels; allow deselection using the selected button |
| `apps/supplier-web/src/pages/HenkatenPages.tsx` | Detail dereferences version/answers unconditionally | Nullable/empty evidence state and explicit unanswered label |
| `apps/supplier-web/src/pages/MasterDataPages.tsx` | Publish disabled for zero items | Allow saved empty drafts to publish |
| `apps/supplier-web/src/pages/SetupPage.tsx` | Optional setup copy assumes Part | Distinguish optional category and Part counts/actions |
| `packages/contracts/src/master-data.ts` | Published version response requires an item | Permit empty versions |
| `packages/contracts/src/external.ts` | Required checklist, true `allPassed`, nonempty Yes-only items | Optional/nullable checklist; empty items, boolean metadata, nullable/omitted Yes/No answers |
| `apps/api/src/external/external.service.ts` | Projection JSON requires a value | Normalize absent/null checklist to `{}`; preserve supplied object and raw event semantics |
| `apps/api/src/henkaten/henkaten-export.service.ts` | Missing snapshots already safe; answer assumed populated | Retain empty snapshot behavior; label null answer `Belum dijawab` |

Source transitions consume the shared Hosted readiness evaluator, so removing only the form gate
would leave suppliers blocked at activation/cutover. Reset clears the current publication pointer;
form options and clone must continue using that pointer rather than resurrecting old publications.
Imported checklist categories already publish complete versions; omitted categories/sheets remain
omitted and need no import algorithm change. The template's full-category instructions describe
replacement semantics, not a submission requirement.

The PCR input/prompt use category, cause/detail and before/after change; checklist completeness is
not a PCR input. Approval and assignment behavior must not acquire a new checklist condition.
Historical all-Yes evidence and immutable SQL triggers remain unchanged.

## Evidence and request semantics

1. Omit both checklist fields (or send an empty answer array without a version) to submit without
   checklist evidence. Do not fabricate a publication or default Yes answers.
2. A supplied version must be a published version of this supplier and this Henkaten category.
   It need not remain the latest/current/active publication: it represents the questions actually
   displayed when the form was opened. Publishing or deactivating later must not force a completion
   confirmation or erase the submitted evidence.
3. An answer requires its version. Reject duplicate item IDs, unknown IDs and wrong tenant/category
   versions as malformed evidence; these checks are separate from completeness and answer values.
4. A versioned submission snapshots every original item label/order. Persist the submitted Yes/No;
   persist SQL `NULL` for omitted answers. A zero-item version produces an empty snapshot. No version
   produces no snapshot and a detail response of `checklist: null`.
5. Keep the displayed checklist stable for the selected category while Part search/options refresh.
   Changing category resets answers and selects that category's current optional publication.
6. Clone copies operational text and loads the current optional publication, with no copied answers.
   When no current publication exists, return nullable version and empty items; cloning still works.
7. Idempotent retries retain the original request and key, including the original checklist version
   and partial answers. Do not add schema defaults that rewrite existing all-Yes retry payloads.
8. External raw events retain supplied evidence semantics. Projection `{}` represents absent/null
   evidence without a storage migration or changing the existing record-shaped detail response.

## Implementation order

1. Relax the answer column with an exact `allow-drop-not-null` migration declaration; do not rewrite
   existing rows, alter enums or remove evidence triggers. Regenerate Prisma.
2. Change shared request/detail/clone/publication/External contracts together. Preserve Yes/No enums;
   null is a stored unanswered state, not a third answered value.
3. Implement transactional Hosted validation and snapshot writes, nullable presenter/clone behavior,
   empty publication, deactivation, shared readiness and retained preflight changes.
4. Update form validity/payload, stable displayed publication, labels/deselection, detail and setup
   states, and empty-publication control. Add no checklist confirmation flow.
5. Align External projection ingestion and export cells. Regenerate committed OpenAPI/client files.
6. Add contract, form/component, PostgreSQL and Chromium/Edge regression cases. Run fresh seed smoke
   and inspect legacy fixture compatibility. The populated demo remains a valid optional example;
   removing demo checklists is unnecessary and would reduce historical coverage.
7. Update PRD, roadmap, ADR 0048 and handoff. Run local CI parity from clean generated artifacts,
   stage intended generated changes for index-based drift checks, scan, commit, push and open PR
   to main. Monitor required checks against the exact head; do not merge as part of this scope.

## Acceptance matrix

| Scenario | Expected result / evidence |
| --- | --- |
| No configured/published category | Readiness has no checklist blockers; LL can submit each category |
| Published empty category | Save and publish succeed; submit enabled; immutable empty snapshot |
| Nonempty checklist entirely untouched | Direct submit; all snapshotted answers are null |
| Some Yes, some untouched | Direct submit; actual Yes and null preserved |
| Some No, some untouched / mixed Yes-No-null | Direct submit; no fabricated Yes; no confirmation |
| All Yes from an existing client | Same successful workflow and exact retry |
| Selected answer clicked again | Item returns to unanswered with accessible pressed state |
| Background search/new publication | Displayed question/version and original evidence retained |
| Wrong category/tenant/version/item or duplicate item | Validation/conflict, atomic failure; no Henkaten created |
| Unknown network result | Same immutable request and key on retry, form remains locked |
| Detail/export of absent, empty and partial evidence | No crash; No and unanswered remain distinguishable |
| Clone without an active publication | Prefill succeeds; empty optional evidence; no copied answers |
| Deactivate supplement after an occurrence exists | Success with expected-version/audit checks |
| Setup reset/import and source readiness | No publication resurrection or mandatory four-category gate |
| External absent/null/empty/No/unanswered | Accepted, retry-safe, raw evidence/projection retained |
| Approval, PCR, warnings, Man/Tanoko | Existing routing/qualification/lifecycle rules preserved |

Meaningful automated coverage belongs in existing contract tests, Henkaten form/workflow tests,
master-data and operational PostgreSQL integration, External ingestion integration, and a dedicated
`optional-checklist.spec.ts` journey tagged for Chromium and Edge. Browser assertions cover direct
POST, absence of dialogs, nullable detail/clone, partial persisted values, desktop/mobile overflow
and accessibility. Existing export integration must assert Yes, No and `Belum dijawab` cells.

## Release, rollback and risks

Apply the nullable-column migration before running the new API. Coordinate API and web deployment;
an old web bundle still enforces all-Yes locally and must refresh to adopt the change. Existing
API clients with populated Yes-only evidence remain valid, but consumers of detail/clone responses
must support the widened nullable shapes. Published history may now contain empty versions.

An unconditional rollback to the pre-change application is unsafe after optional records exist:
its presenter throws for missing snapshots, its contracts reject null answers/empty versions and
its readiness reinstates the old gate. Keep the relaxed schema and deploy a compatibility-preserving
fix if rollback is needed. Never backfill Yes, delete history, or restore NOT NULL over unanswered
records. No schema-down/data-rewrite operation is part of this rollout.

The main risks are misleading stored Yes values, silently lost answers after a publication refresh,
stale client validation, nullable reader assumptions and a residual readiness gate. The explicit
snapshot model, stable displayed publication and cross-layer tests address these risks. Checklist
identity validation can still reject corrupted payloads; users can deliberately omit the optional
evidence, but the server must never silently replace or drop answers they supplied.
