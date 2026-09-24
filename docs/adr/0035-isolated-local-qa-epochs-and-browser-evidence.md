# ADR 0035: Isolated local QA epochs and browser evidence

- Status: Accepted
- Date: 2026-09-24

## Context

The current application has six login roles across Supplier and TMMIN portals, a separate External ingestion API, a deterministic local Hosted seed, and workflows that mutate shared state. The PRD also contains historical Shift Run requirements superseded by the recurring Line–Shift amendment. A single mutable demo database cannot reliably prove all lifecycle and governance branches without resetting state. Desktop browser automation provides user interface evidence but does not establish iOS Home Screen push or the full device support matrix.

## Decision

End to end local QA is organized into explicit reseed epochs for baseline reading, administration/onboarding, Hosted operations, External/source governance, resilience, and final baseline restoration. Playwright browser automation is the primary path for both portals, with Chromium coverage and Edge smoke when available; other interactive browsers may supplement it. API-only functionality is exercised with an HTTP client against the same local runtime and reconciled with browser-visible projections. Each scenario records expected and actual behavior, authoritative API/database state, audit/notification effects, and sanitized evidence. Bugs are recorded and classified without being fixed during verification. The complete scenario matrix and exit criteria are maintained in `docs/qa/browser-local-end-to-end-verification-plan.md`.

## Rationale and alternatives

Independent epochs prevent test mutations from changing the assumptions of later scenarios, while retaining the production API and the project-owned local seed path. Reusing one database for every branch would make results order dependent and make a final baseline claim unreliable. Browser-only testing would omit the External API and backend authorization boundaries; HTTP verification is therefore paired with UI observation. Running only the existing isolated Playwright suite would not verify the current local seed; the seeded runtime receives its own browser scenarios.

## Implementation details and consequences

`pnpm local:reseed` resets the main local database and member-photo volume, preserves the disposable test database, and rotates credentials in `.local/seed-credentials.json`. The final epoch restores the two Hosted supplier baseline. The old Shift Run lifecycle and MP reservation/cascade acceptance checks are treated as superseded; historical Shift read surfaces remain in scope. A result blocked by local inference, VAPID configuration, or unavailable iOS devices is reported as blocked or outside the local claim, never silently marked passed.

This decision adds documentation only. It does not run QA, change product behavior, or imply staging/production readiness.

## Validation plan

Confirm the plan's inventory against current routes/controllers/contracts and the current seed, then execute every scenario in its designated epoch. Verify each mutation through browser UI, API, database/read model, and audit/notification evidence. Restore the seed and issue a complete Markdown audit report with unresolved defects and limitations.

## Risks and follow-up

Clock-derived Line–Shift boundaries can be missed during a manual run; schedule dedicated current/next intervals relative to the test time. Desktop browser automation and viewport emulation do not reproduce iOS Home Screen push or Android behavior; separate device acceptance remains necessary. Live PCR classification depends on external inference configuration and TMMIN QD adjudication. The next work is execution of the documented plan, with no bug fixing inside the QA run.
