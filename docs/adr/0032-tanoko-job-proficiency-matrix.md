# ADR 0032: Tenant-scoped Tanoko job proficiency

Status: Accepted and implemented locally
Date: 2026-09-16

## Context

The paper Tanoko matrix records operators across columns and line-specific jobs down rows.
A durable proficiency record is needed to qualify Man replacements without introducing a
separate HR, licensing, or training-criteria system. Existing assignment and reservation rules
remain authoritative for operational availability.

## Decision and rationale

One nullable 1–4 level is stored for each supplier/member/job tuple. A missing or null mapping
means unassessed, never qualified. High/Medium/Low is independent job metadata, editable through
existing Supplier Admin setup. Existing jobs retain null category until explicitly categorized.

All Supplier Admins and Supervisors can edit any active MP/job within their supplier; assignment
to a particular line is not required. LL/QC can read. TMMIN and external ingestion contracts are
not extended with Tanoko. The normal Hosted session and source epoch are checked on every request.

The PDF matrix is retained as the main screen. Native supplier navigation, compact geometry,
sticky names/jobs, clipped names with full-name disclosure, quarter-filled level circles and
numeric values make the matrix readable without introducing employment categories or licenses.
A docked inspector retains MP/job identity while its body scrolls. History uses a separate tab,
server-side search and keyset pagination. A 24-column page bounds matrix DOM growth; full data
remains searchable and per-job totals include all active MPs.

## Implementation details

TanokoMapping uses tenant-composite member/job foreign keys and a unique tuple. TanokoChange
stores immutable descriptive snapshots. Mapping update, change history and general audit are
written in one supplier-locked serializable transaction with expectedVersion checks. Clearing a
level preserves the versioned mapping, preventing a stale editor from recreating an old value.

Man submission and final atomic movement require current level 3 or 4 for the exact target job.
Downgrades during pending approval are permitted; the movement transaction fails without
persisting approval effects when current proficiency is insufficient. Already completed
assignments are not retroactively moved by a proficiency change.

Reads are refreshed after local writes, on focus and every 30 seconds. Polling does not overwrite
editor drafts. Conflicts require explicit refresh. No offline edit or Tanoko SSE guarantee exists.

## Alternatives

A local-only matrix would lose auditability and shared edits. A line-owner-only permission would
prevent authorized GL updates across lines. Automatic production level backfill would fabricate
qualification. These options were rejected. Whole-matrix batch edit is deferred to keep conflict
handling explicit per cell.

## Consequences and risks

Existing production MP/job pairs begin unassessed. Operational owners must populate verified
mapping before submitting Man replacements. Synthetic local seed data supplies demo qualifications
only. The local seed explicitly assesses every default MP to at least level 3 on its default
job before assignment, and every Man replacement on its exact target job before submission.
Other pairs include levels 1–4 and unassessed cells, with Admin/GL reassessment, correction and
clearing history. These synthetic assessments use the normal versioned API; post-seed checks
reject any unqualified default assignment. A large supplier's full matrix payload should be measured before further scale expansion;
column paging bounds the rendered cells but not the read payload. Skill qualifies only the target
job; all existing reservation and assignment checks continue to apply.

## Validation and follow-up

Database migration, TypeScript, contract reconciliation, unit tests, integration tests and
browser journeys cover successful writes, role rejection, version conflicts, history pagination,
insufficient mastery and downgrade before final movement. Browser QA covers sticky boundaries,
responsive overflow, accessibility, persisted changes and history after reload. Release and target
device UAT remain separate activities.
