# ADR 0010: Controlled Hosted Preparation and Source Cutover

Status: Accepted

Date: 2026-07-23

## Context

A pure External supplier must not be forced to place member identity data in TMMIN's platform.
However, migration from External to Hosted requires configuration before the moment of cutover.
Treating preparation as a third source mode would permit ambiguous mixed writes.

## Decision

- A newly provisioned `EXTERNAL` supplier is inactive and has no platform Supplier Admin or member
  PII. Phase 9 activation requires an External credential.
- A newly provisioned `HOSTED` supplier is active and is created atomically with exactly one active
  Supplier Admin and one-time temporary credential.
- `HostedPreparation` is a lifecycle record, never a third SourceMode. While it is ACTIVE, the
  Supplier remains EXTERNAL and External remains source of truth.
- Starting preparation requires TMMIN Admin, optimistic supplier version, reason, privacy
  acknowledgement, and preparation-admin identity.
- Preparation sessions use purpose `HOSTED_PREPARATION`. They may receive Phase 4 master data,
  checklist, and default-assignment capabilities but never shift, Henkaten, or approval writes.
- Cancelling preparation deactivates the preparation admin and revokes its sessions.
- Cutover uses a contributor registry. Every owning phase contributes its preflight and old-source
  revocation checks. A missing contributor blocks cutover.
- The cutover transaction locks Supplier, validates version and all contributors, revokes
  old-source authority, increments source epoch/version, changes SourceMode, completes preparation
  when applicable, writes immutable audit, and inserts an outbox event.

## Rationale

The design preserves the External privacy boundary and makes the migration window explicit without
allowing mixed operational sources. Blocking absent contributors avoids an unsafe permissive
default while Phase 4 and Phase 9 capabilities are not yet implemented.

## Alternatives

- A third `PREPARING` SourceMode was rejected because monitoring and write ownership would become
  ambiguous.
- Creating a Supplier Admin for every External supplier was rejected because it stores unnecessary
  identity data and contradicts data minimization.
- Best-effort cutover hooks were rejected because partial revocation can leave two active writers.

## Implementation Details

Phase 3 implements the lifecycle, preflight registry, locking transaction, denial behavior, source
epoch change, session revocation, audit, and event contract. The production registry intentionally
contains blocking contributors until:

- Phase 4 validates minimum Hosted master/default configuration;
- Phase 5-7 validate no active Hosted shift/Open Henkaten;
- Phase 8-9 validate no Open External projection and revoke/validate External credentials.

Initial source assignment during supplier creation does not increment source epoch and is not
recorded as a cutover.

## Consequences

Real source cutover cannot succeed at the end of Phase 3; this is intentional safe behavior, not a
partial silent implementation. External tenant activation likewise remains owned by Phase 9.

## Validation Plan

- Hosted/External discriminated create-contract and over-posting tests.
- Exactly-one-active-admin and concurrent replacement tests.
- Preparation start/cancel, privacy acknowledgement, session purpose, and operational-denial tests.
- Preflight same-mode/inactive/missing-contributor tests.
- Later owning phases add successful full-registry cutover, old-source credential revocation, and
  history preservation tests.

## Risks

Preparation introduces Hosted PII before source cutover and therefore requires explicit privacy
acknowledgement and the same permanent-retention governance as Hosted data. A stale contributor
registry could block an otherwise valid migration; observability must identify the contributor.

## Follow-up

The Hosted configuration contributor validates active lines/jobs/parts/Shift Templates, complete
typed default assignments, active linked members/accounts, and published checklists for all four
categories. The External credential/projection contributor remains fail-closed until its owning
implementation is available. Phase 13 exposes preflight blockers and preparation/cutover controls
to TMMIN Admin.

The `hosted-operational-state` contributor blocks source cutover while any Hosted Shift Run is
Active, Henkaten is Open, or MP reservation is active. Operational write routes also require a
normal Hosted session whose source epoch still equals the Supplier epoch; Hosted Preparation
cannot start shifts or submit/withdraw Henkaten.
