# Supplier operations improvements

Date: 6 November 2026. Branch: `feat/supplier-operations-improvements`, based on fetched `origin/main`.

## Analysis and decisions

The existing recurring Line–Shift keeps assignments under a ShiftTemplate identity. Swapping
assignment IDs would invert that ownership. Two ordinary template updates would expose an
intermediate schedule and could swap twice on retry. A dedicated atomic command therefore swaps
start/end minutes and timezone between two active templates, retains names/IDs/assignments and
historical ShiftRun snapshots, and increments affected LineShift versions to reject stale forms.
It applies immediately to all lines using those templates, following existing template-edit
semantics. Scheduling future rotations is outside this change.

Assignment pickers currently use native select; the shared Combobox uses browser datalist and
cannot meet the requested UX. Add a separate searchable selection component with a controlled
popover, selected identity, name/registration/code search, clear choice, unavailable explanations,
keyboard navigation, visible focus, and empty results. Reuse it for every assignment role.

Parts are permanent retained records with Restrict historical references. Bulk deletion is therefore
application deletion: mark all current Parts deleted and inactive atomically, exclude them from
catalog access and new selection, preserve historical Henkaten snapshots and references, and do
not block for Open Henkaten. A reviewed supplier-wide count/revision prevents stale confirmation;
a durable command result prevents retries from deleting later Parts. Imports may explicitly
restore the same reserved number; ordinary direct activation must not bypass deletion.

Tanoko currently filters job rows only. User confirmed two independent line-scope toggles with
Job enabled by default. MP scope uses persisted assignments from all active LineShifts on the
selected active line, not skill mappings. Both scopes intersect before text/category filtering.
Read assignment membership in the same matrix snapshot, making it available to all Tanoko readers
without granting master-data permissions. Preserve existing history line semantics.

## Implementation sequence

1. Shared strict contracts, additive deletion/command persistence, authorized transactional API,
   typed client and OpenAPI. Review seed compatibility.
2. Dedicated searchable assignment selector and responsive swap review dialog with two templates,
   before/after times and affected-line summary. The action is available only in Shift Template,
   as confirmed during implementation; Line Setup remains focused on assignments. Explicit retry uses unchanged payload/key.
3. Supplier-wide Part delete review with count, inline errors, pending/result feedback and retry.
4. Confirmed Tanoko scopes with named toggles, counts and page reset.
5. Contract/component/integration/browser regression checks, responsive visual inspection and axe;
   update PRD, roadmap, handoff and ADR. Stop task-owned runtime resources.

## Acceptance

- Swap retains assignment IDs and names, swaps overnight/timezone values, rejects stale/cross-tenant
  requests, revalidates current authorization, and does not run twice for the same command.
- Search supports keyboard and pointer, duplicate names, disabled LL occupancy, clearing, no matches,
  long names, and mobile widths without browser datalist/native member select.
- Delete includes active/inactive current Parts regardless of filters and Open references, retains
  history, excludes deleted deep links, rejects stale review, and safely retries after lost response.
- Tanoko Job / MP / both / neither, empty assignment, multi-shift deduplication, search/category and
  pagination interact correctly; default behavior is preserved.

Staging/device/UAT remains Phase 15 in progress. No merge or deployment is included.


## Completed locally

All five implementation steps are complete. The Shift Template-only action placement and two
independent Tanoko toggles reflect confirmed UX decisions. The current handoff records successful
unit/integration/browser checks, migration/seed evidence, visual refinement and runtime cleanup.
Future scheduled rotation, standalone Part restore browsing and deployment remain outside this scope.
