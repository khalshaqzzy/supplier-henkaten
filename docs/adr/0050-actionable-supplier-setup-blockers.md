# ADR 0050: Actionable supplier setup blockers

- Status: Accepted; implemented locally, verification recorded in session handoff
- Date: 2026-11-10

## Context

Supplier setup readiness is evaluated server side by `evaluateHostedReadiness` and exposed to the
Supplier Admin through `GET /api/v1/supplier/setup-readiness`. The same evaluation feeds the TMMIN
Hosted source-cutover preflight. Each blocker previously carried only an area, a code, a generic
sentence (for example “Setiap job pada line dan shift memerlukan MP.”) and, for Line–Shift
blockers, an opaque identifier whose `resourceType` was misreported as `Job` for Line and LineShift
identifiers. The Setup page listed these sentences together with raw codes in a narrow side rail.

This presentation did not tell the Supplier Admin which line, shift, job or member was affected,
why a position counted as missing (empty, archived member or inactive account), or where the
correction had to be made. A supplier with several lines and shifts could produce dozens of
identical sentences. One MP blocker was emitted per job but without the job identity, so the
entries were indistinguishable.

The TMMIN preflight copied every Hosted readiness field except `contributor` and `area`. The strict
TMMIN preflight contract accepts only `contributor`, `code` and `detail`, so a Hosted target with
Line–Shift blockers produced a response that the typed TMMIN client could not parse.

## Decision

### Structured blocker contract

`supplierSetupBlockerSchema` keeps the existing fields and adds optional, additive fields:

- `reason`: `NOT_CONFIGURED`, `ONLY_INACTIVE`, `UNASSIGNED`, `MEMBER_ARCHIVED`,
  `ACCOUNT_INACTIVE` or `COUNT_MISMATCH`;
- `line` (`id`, `code`, `name`), `shift` (LineShift and ShiftTemplate identifiers, name, hours,
  overnight flag and effective activity), `job` (`id`, `name`, `displayOrder`) and `member`
  (`id`, `fullName`, `role`, `active`, `accountStatus`);
- `candidates` (at most 20) and `candidateTotal` for aggregate blockers that are resolved by acting
  on existing records.

`resourceType` now reports `Line` or `LineShift` correctly. `detail` names the line code, shift and
job for Line–Shift blockers but never contains a person’s name. The response remains backward
compatible; no database schema or migration change is required.

### Reason classification

A Supervisor or Line Leader position is unassigned when no member is linked, archived when the
linked member is inactive and account-inactive when the member has no active account in that role.
An MP position requires only an active member. Each active job without an active MP in an active
Line–Shift is reported with its own job identity, including jobs without an assignment row.
A line without an active Line–Shift is `ONLY_INACTIVE` when an inactive LineShift (or one using an
inactive ShiftTemplate) exists, otherwise `NOT_CONFIGURED`. Aggregate blockers report
`ONLY_INACTIVE`/`ACCOUNT_INACTIVE` with restorable or activatable candidates when such records exist
and `NOT_CONFIGURED` otherwise. A missing job lists the active lines that can receive one.
Readiness counts keep their previous semantics; Line–Shift rows are read once for all active lines
and filtered in memory.

### Tenant boundary for TMMIN

The preflight contributor projects each Hosted blocker to `{ contributor, code, detail }`. Entity
references, member names and account states stay within the supplier tenant, and the TMMIN
response satisfies its strict contract.

### Supplier Admin interface

The Setup page places a full-width “Perlu diselesaikan” panel beside a compact area rail:

- blockers are grouped by setup area in setup order and then by blocker type; Line–Shift blockers
  of one type are merged and arranged under their Line · Shift context;
- each type is an accessible disclosure (`button` with `aria-expanded`/`aria-controls`, labelled
  region, `inert` while collapsed) with icon, title, scoped summary and count;
- each entity row shows its name, reason badge, the current holder when relevant and one or two
  links whose accessible names include the entity context;
- the first type is open by default, expanded types are kept in the `open` query parameter with
  history replacement so Back restores the view, and long lists show six rows before an explicit
  “Tampilkan … lainnya” control;
- the rail lists all six areas with status, minimum progress and a 44 px count control that expands
  and focuses the corresponding area group;
- readiness refetches whenever the page mounts so a resolved blocker does not reappear from cache.

Corrective links follow the reason: unassigned and archived positions open Line Setup; an inactive
account opens the member’s account section with replacement as the secondary action; an archived
member offers replacement and the member’s status section; inactive templates, lines and members
open their status sections; a missing job opens the line’s job panel; creation pages are used when
nothing can be restored. A Supplier Admin count mismatch has no supplier-side action.

### Deep-link destinations

Destinations accept `focus` and, for Line Setup, `lineId` and `lineShiftId`. Line Setup selects the
requested line and shift and records later shift selection in the URL. `useFocusTarget` waits for
page data, locates `data-focus-target`, scrolls it into view, applies a 2.6 s orange highlight,
focuses `data-focus-initial` or the first control (or the section itself when read-only) and then
removes `focus` from the URL. Targets are Supervisor, Line Leader, each job row, the new-shift
control and the shift status action in Line Setup, and the account, status and job sections on
master detail pages. Reduced-motion users receive a static ring without animation.

## Rationale

Structured entity references let the client compose concise copy and routes without parsing server
sentences, while keeping SPA routing out of the API. Reason codes are required because the same
missing position has different owners: Line Setup for assignment and member detail for account or
archive state. Merging per-entity blockers into typed groups keeps large suppliers readable without
changing the authoritative blocker count. URL-based expansion and focus parameters survive reloads
and Back navigation and can be shared within the tenant.

## Alternatives considered

- **Server-provided route strings.** Rejected because they couple the API to frontend routes.
- **Grouping in the API.** Rejected because it would change blocker counts and the existing
  contract consumed by TMMIN preflight and tests.
- **Expanding items inside the existing 300 px rail.** Rejected because Line–Shift lists with
  member names and two actions do not fit legibly and become very long.
- **Inline gap indicators throughout Line Setup and a dedicated return link.** Deferred; the
  destination highlight and Back restoration were selected for this scope.
- **Radix Accordion from the shared package.** Not used because the shared wrapper is uncontrolled;
  a native disclosure provides controlled state, URL persistence and `inert` semantics.

## Implementation details

- Contracts: `packages/contracts/src/read-models.ts` (`supplierSetupBlockerSchema`, reason and
  candidate schemas, `SupplierSetupReadiness` type).
- API: `apps/api/src/administration/hosted-readiness.service.ts`; projection in
  `source-governance.service.ts`.
- Supplier web: `setupBlockers.ts` (grouping/actions), `SetupBlockerPanel.tsx`, `SetupPage.tsx`,
  `setup-blockers.css`, `app/focus-target.ts`, Line Setup and master detail targets, global
  highlight styles in `app.css`.
- OpenAPI document and generated client are regenerated from the shared schema.

## Consequences

- Supplier Admins see the exact line, shift, job and member behind each blocker and reach the
  relevant control in one action.
- Member names in readiness are visible only to supplier users with master-data read capability,
  who can already read member records.
- TMMIN preflight responses become valid for every Hosted blocker set and expose no person names.
- Additional readiness queries run only for aggregate blockers that are present, each bounded to
  20 candidates.
- Destination pages own a small contract (`focus` values and `data-focus-target` markers) that must
  be preserved when those pages change.

## Validation

- API unit tests cover every reason, entity payload, candidate selection and contract parsing.
- PostgreSQL integration tests assert named MP blockers per job, Line/Shift entities and a strict
  TMMIN preflight projection.
- Supplier unit/component tests cover grouping, reason-specific actions, URL-persisted expansion,
  rail reveal, long-list collapse, ready state, axe and the focus hook.
- A Chromium/Edge browser journey verifies expansion, deep links with highlight and focus, saving an
  assignment, Back restoration, detail-page destinations, overflow and axe at 1440–320 px.

## Risks and follow-up

- `MEMBER_ARCHIVED` and `ACCOUNT_INACTIVE` positions arise mainly through reset, import or role
  changes; they are covered by unit tests rather than the browser journey.
- Inline gap indicators in Line Setup and a return link to Setup remain possible refinements.
- Staging/device acceptance of the new page remains part of the existing release gates.
