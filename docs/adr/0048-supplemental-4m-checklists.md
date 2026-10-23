# ADR 0048: Supplemental 4M checklists

- Status: Accepted; implementation and validation tracked in the session handoff
- Date: 2026-10-23
- Supersedes: mandatory checklist portions of ADRs 0014 and 0033; publication minimum and readiness
  assumptions in ADRs 0040 and 0046

## Context

Checklist configuration, complete answers and all-Yes responses were previously prerequisites for
Hosted Henkaten. The shared Hosted readiness evaluator also required four publications, while
External ingestion required positive nonempty evidence. Form, clone, detail and publication
contracts encoded the same assumptions. Relaxing only the submit button would leave backend and
supplier activation gates intact and would misrepresent non-positive evidence as Yes.

## Decision

4M checklists are optional supplements. Category classification remains required. Zero configured
categories, empty published categories, untouched items and No answers are valid. Missing/negative
checklist evidence causes no submission confirmation, acknowledgement, override reason or extra
submit step. Operational validation, approval routing, MP proficiency and PCR remain independent.

Requests may omit checklist fields. When evidence is supplied, its version must belong to the
same supplier/category and all answered item IDs must belong to that immutable publication.
Duplicate, foreign or unknown references remain invalid. Published evidence already displayed to
an LL may be used after a newer publication or template deactivation; current activation is not
an evidence-integrity requirement. The UI retains the displayed publication through search refresh.
Clone uses the current optional publication, without copying answers.

A versioned snapshot retains all labels and order, with actual Yes/No values and SQL NULL for
unanswered items. An absent version produces no snapshot and a nullable detail response. An empty
publication produces an empty versioned snapshot. Existing immutable triggers and historical
all-Yes rows remain unchanged. Only the answer column's NOT NULL constraint is relaxed, with an
exact migration-policy declaration. The snapshot relation is already optional.

Hosted readiness retains category counts with required count zero and no checklist blockers.
Empty drafts may publish immutable versions; checklist deactivation is independent of retained
active Shift Runs. Legacy preflight no longer imposes four publications. Existing setup import
replacement/omission and reset publication-pointer semantics are preserved.

External events may omit/null the checklist or provide empty, No or unanswered items. Optional
`allPassed` is descriptive source metadata with no workflow authority. Absent/null evidence is
represented by an empty JSON object in the projection, preserving its existing storage and detail
shape; supplied event evidence and ordering/idempotency checks remain intact. Existing all-Yes
payloads retain their schema version and remain accepted. Export distinguishes Yes, No and
`Belum dijawab`; absent snapshots produce no artificial checklist rows.

## Rationale and alternatives

A nullable answer preserves the complete question set while explicitly distinguishing No from
unanswered. Keeping only answered rows would lose the unanswered labels/order at submission.
Automatically changing No or missing values to Yes would falsify evidence. Synthetic publications
or versions for unconfigured suppliers would obscure the absence of configuration. A confirmation
or override workflow would reintroduce a completion gate and is unnecessary for supplemental data.

Requiring the latest active publication was rejected because it could block otherwise valid
operational submission after an unrelated admin edit. Validating the supplied immutable version
retains provenance without treating configuration freshness as a prerequisite. Silently dropping
unknown answers was rejected because it would lose operator-supplied evidence.

## Implementation and consequences

Changes span shared contracts, Prisma migration, Hosted service/presenter/clone, checklist
publication/deactivation, shared readiness, retained legacy preflight, External ingestion,
Supplier form/detail/setup/editor and export. Generated OpenAPI and client types must ship with
the widened nullable responses. The implementation plan and file-level dependency map are in
[optionalChecklistPlan.md](../../.agent/optionalChecklistPlan.md).

No existing record or publication is rewritten. Existing clients sending complete Yes-only
requests remain supported. Readers must tolerate absent snapshots, nullable answers and empty
publications. The populated local seed remains valid and provides historical compatibility
coverage alongside dedicated optional-evidence fixtures.

## Validation

Required coverage includes optional request contracts; malformed reference rejection; all four
categories without evidence; empty publication; all-unanswered, partial, No and mixed responses;
immutable stored labels and values; publication refresh/deactivation; cross-tenant/category/item
checks; exact retries; clone/detail/export; External ingestion; and unchanged approval/PCR/Man
behavior. Chromium and Edge journeys verify direct submission with zero dialogs, mobile/desktop
layout and accessibility. Fresh migration, previous-main upgrade, seed smoke and local CI parity
are recorded with results in the handoff.

## Risks and follow-up

Apply the forward migration before the API and refresh web clients together. Old bundles may still
enforce the previous local gate. Old API readers are incompatible with newly absent snapshots/null
answers/empty publications: rollback must retain the widened readers and schema, rather than
reinstalling the old application unconditionally. Do not synthesize Yes values or delete evidence
for rollback. Staging/device acceptance must exercise an unconfigured supplier, mixed responses,
reset and active-occurrence deactivation before release acceptance is claimed.
