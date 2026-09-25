# ADR 0033: Recurring Line–Shift assignment without an operational Shift Run lifecycle

Status: Accepted and implemented locally
Date: 2026-09-22

## Context

The original Hosted workflow required a planned Shift Run, preflight, Start Shift, End Shift,
exclusive MP placement, and an MP reservation before a Man change could be submitted. This made
Henkaten entry depend on administrative lifecycle actions and prevented the same MP from appearing
in more than one assignment, including within one line.

The approved operating model treats shifts as recurring line configuration. Operators select the
relevant Line–Shift assignment; the system determines the current occurrence from its timezone and
schedule. Outside a running interval, the selected shift means its next scheduled occurrence.

## Decision

`LineShift` links an active Line and Shift Template and owns its Supervisor, Line Leader, active
state, and ordered `LineShiftJobAssignment` defaults. Supplier Admin is the only role allowed to
create, activate, deactivate, or edit this configuration. Adding a Line–Shift may copy assignments
from another shift on the same line. Active schedules on one line may not overlap so automatic
selection remains deterministic.

There is no supplier-facing Shift Run preflight, Start Shift, Emergency Start, End Shift, or active
shift state. A Line Leader's operational context is derived from the clock. During a shift its
Line–Shift is selected automatically; outside shift time the Line Leader selects one and the
Henkaten becomes effective at that shift's next start. The effect ends at that occurrence's end,
where the next occurrence naturally starts again from its configured defaults.

Man Henkaten submission applies the replacement to the selected job immediately for that occurrence.
The only replacement eligibility gate is an active MP with Tanoko level 3 or 4 for the exact job.
No reservation, source-assignment move, vacancy cascade, exclusivity, or duplicate-MP check is
performed. The same MP may appear in multiple lines, shifts, or jobs concurrently. Reject and
Withdraw recompute the effective assignment from the latest other Open/Approved Man Henkaten in
that occurrence, falling back to the Line–Shift default.

Existing Shift Run, Working Assignment, reservation, and movement records are retained as historical
compatibility data. New submissions materialize an internal occurrence snapshot only where legacy
foreign keys/read models require it; that snapshot has no user-controlled lifecycle and is not an
operational gate.

## Consequences

The Assignment Board is clock-derived and can be empty between shifts. Line Setup replaces Default
Assignment management. Source cutover is no longer blocked by an active Shift Run or reservation;
an Open Henkaten remains a blocker. Historical TMMIN Shift Run reads remain available, while supplier
Shift Run command endpoints and UI routes are removed.

The recurring model deliberately permits duplicate MP assignment. Any attendance, capacity, or
workforce-conflict policy would be a separate future requirement and must not be reintroduced as a
Henkaten blocker implicitly.

## Setup readiness correction (2026-09-25)

Hosted readiness evaluates each active Line–Shift even while its Supervisor or Line Leader is
unset. This distinguishes a missing Line–Shift from an existing shift with missing assignments.
An assigned Supervisor or Line Leader counts only with an active member and active account for
the expected role; a default MP counts only while active. Before any line exists, the Default
Assignments area remains pending, since a zero-of-zero count is not a completed configuration.

The supplier-facing readiness response omits the internal `contributor` property used by Source
Governance preflight. This keeps the strict shared API contract usable when blockers exist; the
preflight contributor identifier remains available inside governance. Returning `contributor` in
the public response or relaxing the shared schema would expose an internal detail without helping
the Supplier Admin resolve a blocker.

API integration validates strict parsing for empty and partial setup responses. The onboarding
browser journey checks the visible blockers immediately after first login and password change,
before master data entry. Remaining risk is release drift until staging UAT checks this route;
no migration or historical assignment rewrite is involved.

Removing the legacy partial unique index on active `WorkingAssignment.effectiveMpMemberId` is
therefore an intentional metadata-only schema change: it removes an obsolete uniqueness invariant
without deleting assignment or Henkaten rows. The migration uses the exact-name
`migration-policy: allow-drop-index` declaration; the CI checker accepts only the immediately
following exact `DROP INDEX IF EXISTS` statement and continues rejecting every unannotated `DROP`.

## Validation

The forward migration preserves historical rows and backfills Line–Shift configuration from active
lines, shift templates, and prior defaults. Local validation covers a clean 13-migration deployment,
an upgrade from the prior 12-migration staging state, contracts, full TypeScript, lint, generated
client/OpenAPI parity, production builds, repository unit tests, and API integration for current/next
occurrence selection, Tanoko-only replacement, duplicate MP assignment, reject/withdraw restoration,
removed supplier Shift endpoints, and Line Setup. The Admin Line Setup onboarding journey passes on
Chromium and Edge. Production-like Compose acceptance and HIGH/CRITICAL filesystem plus image scans
also pass. The local seed creates 240 Henkaten via Line–Shift commands, retains time-distributed
dashboard evidence using internal compatibility occurrence snapshots, and asserts the dashboard
totals and trend before reporting success. Dedicated during-shift/outside-shift browser coverage and
staging UAT remain pending.
