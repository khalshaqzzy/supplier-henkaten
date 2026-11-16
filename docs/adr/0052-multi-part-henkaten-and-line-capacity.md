# ADR 0052: Multi-part Henkaten and 100 active lines per supplier

- Status: Accepted
- Date: 2026-11-16

## Context

A Hosted Henkaten recorded exactly one part: a nullable `partId` plus number/name snapshots on the
`Henkaten` row, and exactly one `WarningInstance` whose part snapshot drives the TMMIN affected-part
aggregate. A single change point on a line (a method, machine, material or operator change)
frequently affects several part numbers at once. Line Leaders had to submit the same change once
per part, producing duplicate approvals, duplicate PCR screening and several records that describe
one event.

Separately, a supplier was limited to 20 active lines. The limit was repeated as a literal in the
line create/activate commands, in the setup workbook plan and in the workbook sheet row limit.
Suppliers with more production lines could not be onboarded.

## Decision

1. A Hosted Henkaten references one or more catalog parts, or the single undisclosed `Other` part.
   Every affected part is stored in a new immutable `HenkatenPart` row, ordered by submission
   position. Up to 50 parts are accepted per Henkaten (`MAX_HENKATEN_PARTS`).
2. The existing part columns on `Henkaten` are retained and describe the first affected part (the
   primary part). Existing readers, sort keys, exports and the immutability trigger on `Henkaten`
   keep working without change.
3. One `WarningInstance` is opened per affected part. The one-warning-per-Henkaten uniqueness is
   replaced by uniqueness of `(henkatenId, normalizedPartNumberSnapshot)`. All warnings of a
   Henkaten are closed, hidden and counted together by the existing terminal, deletion and
   finalization paths, which already address warnings by `henkatenId`.
4. `Other` remains exclusive: it cannot be combined with catalog parts, and it still produces one
   private warning per Henkaten.
5. The active line capacity is 100 per supplier, defined once as
   `MAX_ACTIVE_LINES_PER_SUPPLIER` in the shared contracts package and used by the line commands,
   the setup workbook plan and the workbook Line sheet limit.

## Rationale

- A child table keeps each part individually addressable (filtering, per-part dashboards, catalog
  usage checks) and keeps snapshots immutable, which a JSON column or delimited text would not.
- Keeping the primary-part columns avoids rewriting every reader and the database trigger that
  freezes Henkaten evidence, and keeps previously created records valid: the migration backfills
  one `HenkatenPart` row per existing Henkaten.
- The TMMIN affected-part view is an aggregate over warnings by supplier and part number. One
  warning per part makes a multi-part Henkaten appear under each of its parts with no change to
  the aggregate queries, and each part stays affected until that Henkaten leaves Open.
- A single shared constant removes the three independent literals that had to be changed together
  and matches the PRD statement that capacity figures are acceptance baselines, not fixed design
  limits. List endpoints already page at up to 100 rows, so line selectors that request one page of
  active lines still receive the full set at the new capacity.

## Alternatives considered

- **One Henkaten per part, grouped by a shared reference.** Keeps the schema unchanged but
  multiplies approvals, PCR assessments, notifications and Man assignment effects for one event.
- **Parts stored as a JSON array on `Henkaten`.** Simple to write, but part search, per-part
  grouping and the catalog in-use check would need JSON operators and could not use plain indexes,
  and the immutability trigger compares scalar columns.
- **Dropping the primary-part columns.** Cleaner model, but requires a destructive migration and a
  rewrite of the immutability trigger, exports, read models and External parity for no functional
  gain.
- **A single warning listing several parts.** Breaks the supplier+part aggregate, which groups
  warnings by one normalized part number.
- **Removing the line limit.** Capacity baselines also bound setup import size, selectors and
  performance targets; a higher explicit limit keeps those bounded.

## Implementation

### Data

- Migration `20261116002400_henkaten_multi_part` creates `HenkatenPart` (`henkatenId`, `position`,
  nullable `partId`, number/normalized number/name snapshots), backfills position 1 from every
  existing Henkaten, adds unique `(henkatenId, position)` and
  `(henkatenId, normalizedPartNumberSnapshot)`, indexes for supplier+part lookups, composite
  tenant-scoped foreign keys to `Henkaten` and `Part`, and the existing
  `prevent_immutable_henkaten_evidence` trigger for update and delete.
- The two unique indexes that enforced one warning per Henkaten are dropped under the declared
  drop-index migration policy and replaced by unique
  `(henkatenId, normalizedPartNumberSnapshot)`. External warnings keep their one-per-projection
  uniqueness.

### API and contracts

- `POST /api/v1/supplier/henkatens` accepts `partIds` (1–50 distinct active catalog parts). The
  previous `partId` field is still accepted and is equivalent to a one-item `partIds`; exactly one
  of `partIds`, `partId` and `otherPart` must be present. Any unknown or inactive part rejects the
  whole submission. Submission order is preserved.
- Henkaten summary and detail responses add `parts` (`id`, `number`, `name`) in submission order;
  `part` and `partId` continue to describe the first entry.
- Clone prefill adds `parts` with the source parts that are still active; `partStillValid` is true
  only when every source catalog part is still active.
- The TMMIN global list adds `partCount`; External records report 1.
- Part text filters on the Supplier list, TMMIN list, Supplier and TMMIN dashboards and the Excel
  export match any affected part. Supplier “Henkaten per part”, the TMMIN part ranking and the
  export part chart count every affected part. Export rows keep one row per Henkaten and join part
  numbers and names with `; `.
- Deactivating a catalog part is rejected while any Open Henkaten references it in any position.
- Audit metadata and outbox payloads for submission add the full part list beside the primary
  part.
- The local seed submits two parts for every fourth record and three for every eighth; its
  post-seed invariant compares Open warnings per Henkaten.

### Supplier interface

- The Henkaten form replaces the separate search field and single select with one part picker: a
  trigger that opens a searchable list with checkboxes, server-side search with a short debounce,
  keyboard navigation from the search field, a selected counter against the limit, a hint when the
  result page is full, and a *Selesai* action. The list stays open while several parts are chosen.
  `Other` is offered when the search is empty, replaces any catalog selection and closes the list.
- Chosen parts are shown under the trigger as removable entries with part number and name, with
  *Hapus semua* for more than one. The selection is held separately from the visible search
  results, so changing the search never discards chosen parts.
- The review summary lists the chosen part numbers. A cloned Henkaten preselects the parts that
  are still active and shows a notice when some are not.
- Lists show the first part with a `+N` count; the Henkaten record shows a *Part terdampak* panel
  with every part when more than one exists. TMMIN list and record pages show the same
  information.

### Line capacity

- `MAX_ACTIVE_LINES_PER_SUPPLIER = 100` is used by line creation and activation, the setup workbook
  capacity rule and the workbook Line sheet row limit (the generated template guidance reads the
  same value).

## Consequences

- One event affecting several parts is one record with one approval flow and one PCR assessment.
- Open-warning counts can exceed Open Henkaten counts; “active warnings” now means affected
  Henkaten–part pairs. Supplier and TMMIN affected-part aggregates are unchanged in shape.
- Per-part distributions count a multi-part Henkaten once per part, so their sum can exceed the
  number of Henkaten.
- Older cached Supplier clients that still send `partId` keep working.
- External ingestion remains single-part per event.
- Suppliers can hold up to 100 active lines; job, member and concurrency baselines are unchanged.

## Validation

- Contract tests cover distinct multi-part selection and rejection of empty, duplicate, mixed and
  oversized selections.
- Database integration tests cover ordered multi-part submission, idempotent retry, one warning
  per part, immutability of part rows, non-primary part search, affected-part detail, clone
  prefill, warning closure on withdrawal, rejection of duplicate and unknown parts, and the
  100-line capacity boundary.
- Component tests cover multi-selection order, toggling, `Other` exclusivity, chip removal and the
  submitted payload.
- A browser journey covers server search, keyboard selection, focus return, responsive layout
  without horizontal overflow from 320 to 1440 px, accessibility of the form, the multi-part
  record and list presentation, and the catalog in-use guard.

## Risks and follow-up

- The 50-part limit and the 50-row search page are initial values; real usage may justify
  adjusting them.
- Performance baselines in the hardening suite still exercise 20 lines per supplier; a 100-line
  baseline run is needed before the capacity is claimed as performance-validated.
- External suppliers cannot report several parts in one event; extending the ingestion contract is
  a separate decision.
