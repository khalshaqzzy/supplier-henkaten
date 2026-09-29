# ADR 0044 — Supplier Henkaten PCR guidance and compact list

Date: 2026-09-29
Status: Accepted

## Context

Hosted Henkaten submission waits for an independent PCR assessment. A positive result was visible
on detail but could be missed immediately after submission. The Supplier list placed a PCR badge
beside the identifier, omitted the shift snapshot, and used a wide table. Several UI descriptions
across the portals explained API and lifecycle mechanics without helping the next action.

## Decision

The submit navigation carries the created Henkaten ID to the assessment waiting route. When that
record resolves to PCR, the route opens a dialog only for the submitting Line Leader. It directs
the established PCR submission and briefly points to TMMIN QD for difficulties or disputed
classification. Closing the dialog opens detail. Direct navigation and other Supplier roles do
not open it. The detail guidance remains available for later review; PCR remains advisory and
independent of Henkaten approval.

The dialog uses a full-height orange decision rail with a white document-check icon, a compact
assessment eyebrow, and a quiet divider before the contact note. It shows the assessment text
returned with the PCR result, labeled as AI only when the decision source is AI. Long text scrolls
within the dialog while the action stays visible. The design keeps one action,
"Lihat Henkaten", which navigates to detail and does not imply PCR submission. On narrow screens
the rail becomes a thin top accent with a compact orange icon tile; the dialog stays centered.

The Henkaten list API summary exposes the already stored shift-name snapshot. No schema migration
or seed-data rewrite is needed. The desktop list uses separate Shift, Supervisor, QC, and PCR
columns. Approval states use compact text-and-icon badges; Not Required is visibly labeled.
Only PCR and No-PCR use PCR badges in the list. Pending, Review, and historical unassessed records
show a dash, with distinct accessible names and their full state retained on detail. The list
uses smaller gaps and progressive disclosure for secondary filters. Dense desktop columns wrap
values without horizontal scrolling; narrow viewports use labeled cards.

Visible helper text in the touched Supplier and TMMIN screens is reduced when it merely describes
internal validation, storage, or querying. Consequential access changes, one-time credentials,
and recovery actions remain explicit.

## Rationale and alternatives

An unconditional modal on Henkaten detail would interrupt Supervisor, QC, and Supplier Admin
review and repeat on direct links. The submit-route context limits the interruption to the actor
who must follow up. A two-state PCR column would incorrectly label unresolved assessments as
No-PCR; the dash avoids that error in a compact list while the detail retains the exact state.
Keeping approval routes in one cell was compact but made the two decisions harder to scan.

## Consequences

The shared Henkaten summary contract, generated OpenAPI document, and API client include
`shiftName`. Existing detail responses preserve the same field. Desktop table layout depends on
wrapping and compact cell padding at narrower desktop widths, and mobile cards preserve the
label/value reading order. The dialog depends on navigation state, so a refreshed waiting route
retains the submit context while a fresh direct link does not create it.

## Validation and follow-up

Focused UI tests cover the PCR dialog's role and navigation scope plus nonfinal PCR labels.
Desktop visual review covers 1280, 1440, and 1672 px; mobile review covers 390 px. API contract,
unit, integration, and production build checks remain part of local and PR verification. Staging
UAT should confirm the dialog after a live PCR classification and the table with real long values.
