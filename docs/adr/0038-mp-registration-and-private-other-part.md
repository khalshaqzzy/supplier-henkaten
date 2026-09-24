# ADR 0038: MP registration and undisclosed Hosted part

- Status: Accepted
- Date: 2026-09-24

## Context

MP does not need a registration number in the supplier workflow. A supplier may also need to
record a Henkaten without disclosing a specific affected part, including when that part is not
supplied to TMMIN. The original Hosted model required a registered Part on every Henkaten and
grouped all open warnings by supplier and normalized part number. A literal `Other` in that
grouping would incorrectly imply that unrelated undisclosed parts are the same part.

## Decision

MP registration numbers are removed from current Member profiles. Registration remains required
and supplier-unique for Supervisor, Line Leader, and QC. Historical assignment snapshots remain
unaltered. The API represents an MP registration number as null, and current MP-facing UI omits
the field and value.

Hosted Henkaten submission accepts either an active supplier Part ID or `otherPart: true`, never
both. Other requires no part number or name, creates no Part master record, and persists a null
`partId`. Public snapshots display `Other` with no part name. Each Other warning receives a
record-specific grouping key derived from its Henkaten ID; named parts continue grouping by
supplier and normalized part number. The warning list and detail API expose a warning key for
navigation, while the visible label remains `Other`. Clone prefill retains the Other choice.
Hosted readiness treats part masters as optional, since an Other-only supplier can operate
without registering a part it does not intend to disclose.

## Rationale and alternatives

Creating a Part master named Other would imply that all undisclosed parts share a real identity
and would pollute part administration. Free-text entry would disclose the very information the
supplier chose to withhold. Omitting the warning would hide an open Henkaten from TMMIN Quality.
Null `partId` and an explicit submit option preserve the disclosure choice while keeping the
existing warning lifecycle.

## Implementation and consequences

The forward migration makes Member registration columns and Henkaten partId nullable, removes
existing MP profile numbers, and constrains registration according to member role. Existing
non-MP uniqueness remains. Part snapshots stay string-valued for read-model compatibility, with
`Other` as a display label and no name. The Other warning grouping key is internal and must
never be presented as a part number. External ingestion remains unchanged.

The migration is not reversible through a code-only rollback to a release that requires non-null
MP registration or Henkaten partId. Rollback eligibility therefore requires a null-aware target
release. No historical Henkaten snapshot is rewritten.

## Validation

The fresh 15-migration database and previous-SHA-to-current upgrade passed locally. API
integration covers MP creation, Other submission without part creation, idempotent retry, clone,
and distinct warning detail for two Other Henkatens. Contract/unit suites, generated OpenAPI and
client parity, all six Chromium/Edge journeys, production builds, production-like routing and
persistence, and local deployment/security scans passed. Linux CI and staging UAT remain the
release evidence for lock contention, live migration and operator review.

## Risks and follow-up

The visible Other label is deliberately non-specific. Reports must not treat multiple Other
records as one affected part. Historical MP registration snapshots remain in old records under
the existing retention policy. Staging UAT must check the privacy wording with TMMIN Quality and
supplier users before production release.
