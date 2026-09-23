# ADR 0034: Durable local PCR screening and human correction

Status: Accepted and implemented locally
Date: 2026-09-23

## Context

The Henkaten workflow records cause and event detail but previously had no structured indication
that a supplier should submit a Process Change Request (PCR). The SQAM control matrix separates
changes that need PCR from routine Henkaten, and the PCR guide requires special attention to
Safety, Regulations, and Emissions. Classification can take longer than a database transaction and
can fail or be uncertain. A model response cannot authorize a production process change.

## Decision

Each newly submitted Hosted Henkaten receives a `PcrAssessment` in the same transaction as the
record. An External projection receives or refreshes one only when relevant evidence changes. A
separate leased worker calls the locally configured Ling OpenAI-compatible Chat Completions server
after commit. It requests one forced named tool call with `max_tokens: 8192`, validates the result
with Zod, and compares confidence with an environment threshold (default 0.75). Invalid, timed out,
unavailable, or low-confidence results become `REVIEW`. Older records have no assessment unless
explicitly seeded locally; no automatic backfill is performed.

The English prompt encodes the 45-item control matrix and supplied PCR guidance, states that input
is likely Indonesian, treats record text as untrusted, and provides positive and negative examples.
The model returns a PCR assessment of roughly 100–150 English words only for positive findings.
Confidence and original model data remain in the database and are excluded from UI contracts.
PCR status is separate from Henkaten status and approval. TMMIN Admin and Quality can make an
optimistically versioned correction with a mandatory reason. Correction keeps the original model
data, writes an audit event, emits an outbox event, and cannot be overwritten by a late worker.
For an unassessed historical record, TMMIN may establish the first decision with expected
assessment version `0`; subsequent corrections use the stored version.

The Supplier submit route remains on a waiting screen until assessment completes and recovers after
refresh. The PCR indicator, full assessment, and instruction appear on detail for authorized
Supplier roles. TMMIN has PCR and review tabs, corrections on detail, and dedicated notification
filters. Open PCR appears before other Open Henkaten; Closed records follow by occurrence time.
All list pagination uses the same priority order as the page display. Notifications are generated
from outbox events and deep links are scoped by recipient realm and record access.

## Rationale and alternatives

A synchronous model call inside the Henkaten transaction would hold locks and delay submission.
A best-effort in-memory queue would lose work on restart. The durable assessment row and lease
allow recovery without another infrastructure service. Treating low confidence or malformed output
as No-PCR would hide cases requiring human review. Separate assessment status also preserves the
existing approval semantics. Manual correction is versioned so simultaneous reviewers cannot
silently replace each other's decision.

## Consequences

Operations must configure a reachable local inference endpoint and server-only credential. If
inference is unavailable, new records remain visible and move to review; they are not silently
classified as No-PCR. PCR guidance remains advisory until TMMIN QD follows the existing PCR route.
Changes to the matrix require a new prompt version and targeted regression examples. The local
seed labels most historic demo records No-PCR synthetically and creates a small set of meaningful
examples without hundreds of model calls. The local development key is held in a gitignored,
owner-readable `.env`; staging reads its seven PCR settings from GitHub environment secrets via
the deployment renderer. These settings are validated without logging their values.

## Validation and follow-up

The 14th migration applies cleanly to an isolated database. TypeScript, lint, formatting, unit
tests, and API integration pass. Integration checks cover idempotent queueing, External evidence
changes, manual corrections including unassessed history, notification deduplication, and a late
worker result. An isolated 240-record seed verifies PCR/No-PCR/review/manual distributions; the
local demo was reseeded and both portals were inspected in a browser. Before production rollout,
probe the PCR worker with a synthetic record, then evaluate real Indonesian positive and negative
samples with TMMIN QD and tune the confidence threshold where warranted. Public Ling tests through
`curl` and the OpenAI JavaScript SDK succeeded; the PCR worker itself has not been tested against
the live endpoint.
Pre-PR verification also passed the upgrade from the staging migration set, Chromium journeys,
deployment shell/workflow checks, production-like container routing and persistence, and
filesystem/image secret and vulnerability scans. Edge installation on the local macOS host was
blocked by its system installer; the Linux CI journey remains required.
