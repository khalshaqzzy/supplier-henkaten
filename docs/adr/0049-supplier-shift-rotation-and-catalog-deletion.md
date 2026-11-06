# ADR 0049: Supplier shift rotation and catalog deletion

- Status: Accepted; implemented locally, verification recorded in session handoff
- Date: 2026-11-06

## Context

Recurring assignments belong to named ShiftTemplates through LineShift. Operational teams rotate
day/night work periodically, while their named shift and its member assignments remain stable.
Two separate time edits expose an intermediate schedule and repeated swap requests can undo a
successful rotation. Historical ShiftRun occurrences retain their own schedule snapshots.

Assignment selection uses native browser controls, which do not provide visible search or useful
identity/occupancy context. Tanoko filters job rows by line but cannot independently restrict MP
columns to members assigned on that line.

Parts have permanent retained identities and historical Henkaten foreign keys. Individual Part
deactivation blocks Open dependencies. Supplier-wide catalog clearing needs a distinct operation
that does not require closing Henkaten or rewriting historical evidence.

## Decision

A dedicated Supplier Admin command exchanges start/end minutes and timezone for exactly two active
ShiftTemplates of the current supplier. Names, identifiers, order, import codes, assignments and
historical occurrence snapshots are retained. All referencing LineShift versions are incremented
so forms holding earlier operational context must refresh. Changes apply immediately to all lines
using either template, with the same timing semantics as ordinary schedule edits. Future scheduling
and automatic periodic rotation are excluded.

A retained Part gains nullable `deletedAt`. Bulk deletion marks every nondeleted Part inactive and
deleted in one transaction, including already inactive Parts and those referenced by Open Henkaten.
The catalog, direct detail/edit/activation and new-Henkaten selection exclude deleted Parts. Existing
Henkaten continues to use its retained Part reference and snapshots. The action does not close,
cancel or delete Henkaten. Individual deactivation keeps its existing Open dependency rule.

Part numbers remain reserved within the supplier. Dedicated Part import exposes a deleted-match
flag and requires an explicit restore decision even when the incoming name is unchanged; that
reviewed update clears deletion and activates the Part. General setup import uses its existing
explicit Restore action. Direct activation and duplicate creation cannot bypass review.

Both commands use serializable supplier locking, transaction-bound current-session/source/delegated
operator checks and a durable CatalogCommand ledger scoped by supplier, requester and idempotency
key. Same-key/same-payload retries return the original result before checking resource versions;
a different payload is rejected. Part deletion compares a SHA-256 revision of sorted current Part
IDs/versions with the reviewed count snapshot. Parts created after a completed deletion survive a
retry of that completed command. Audits record identities/counts without copying historical content.

Assignment selection uses a dedicated SearchSelect with separate query/committed identity, custom
Radix popover, listbox keyboard navigation, search by name/registration/import code, explicit clear,
occupied-account explanations and no browser datalist. LL occupancy remains enforced on the server.
Popovers have accessible names; portalled Select content renders above modal overlays.

Tanoko returns each MP's deduplicated line IDs from active LineShift assignments on active lines
and active ShiftTemplates in the same repeatable-read matrix snapshot. This data is available under
Tanoko read permission, avoiding an additional master-data permission for operational readers.
Two independent toggles scope Job rows and MP columns after selecting a line, with Job enabled by
default. Text/category search runs within the selected dimensions. Neither toggle means the matrix
is unrestricted by line; history continues to filter historical job line only. Assignment membership
reflects configured assignment rather than inferred qualification or historical occurrence evidence.

## Alternatives considered

- Swapping MP/Supervisor/LL assignments changes named team ownership and was rejected.
- Separate template PATCH requests are non-atomic and cannot safely retry a swap.
- Physical Part removal breaks permanent evidence and restricted foreign keys.
- Blocking catalog clearing until every Open Henkaten is closed interrupts operational use.
- Loading all master-data assignments from Tanoko requires unnecessary reader permissions and an
  inconsistent second snapshot.
- Browser datalist/native member selects cannot provide the requested search and occupancy UX.

## Consequences and risks

The schedule change is supplier-wide and immediate. The sheet must display both before/after times,
overnight labels, timezone and affected lines. Existing historical occurrence identity and schedule
snapshots remain retained. The operation does not rewrite a previously materialized occurrence for
the same named shift/business date, following the existing recurring-schedule boundary.

Deleted master rows and command results consume permanent storage. Their IDs and reserved part
numbers cannot be reused for different identities. No standalone restore browser is introduced.
The additive database migration is required before deploying the API. Rolling back to a binary
that does not understand Part deletion is unsafe after a bulk deletion: old catalog readers can
expose retained inactive rows, and old restoration writers cannot clear deletion atomically with
activation. Keep the new schema/evidence and use a forward correction.

## Validation and follow-up

Contract tests reject identical shift IDs, unversioned resources, extra tenant/filter scope and
invalid revisions. Component tests cover query separation, duplicate names, registration/code
search, disabled LL choices, empty recovery, clear and focus restoration. PostgreSQL tests cover
atomic swap, assignment retention, stale/unknown resource rejection, durable replay, deletion,
deleted deep-link/activation exclusion, later-Part preservation and reviewed import restoration.
Browser acceptance exercises all four improvements, lost responses, an Open Henkaten's retained
Part, responsive layouts, reduced motion and axe. Exact results and any remaining gaps are in the
session handoff; staging/device acceptance remains separate.


Local verification completed on 6 November 2026: all 311 workspace unit tests, two repository-script
tests, 106 PostgreSQL integration tests and 20 Chromium/Microsoft Edge journeys passed. The focused
journey passed again on both browsers after final interaction styling. Fresh migration, main-to-current
upgrade, local seed/invariant smoke, strict typing, lint, formatting, generated-contract stability,
production builds and Gitleaks directory scanning passed. Desktop, tablet and 390/320px application
screenshots were reviewed, with no scoped axe violations or document overflow. Staging/device
acceptance remains a separate release gate; no deployment was performed.


Delivery verification also repeats the build from removed generated artifacts using the exact
workflow Node 22.23.1/pnpm 11.16.0 runtime. Linux deployment harness, current-source production
container routing/persistence and current vulnerability-database scans passed before publication.
The reviewed change is delivered through a feature-branch PR; hosted CI and subsequent release
acceptance remain independently observable gates.
