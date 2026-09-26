# ADR 0040: Supplier master data import, archive, and navigation

Status: Accepted
Date: 2026-09-26

## Context

Supplier Admin configured parts individually and had no way to review a file against existing part numbers. Member deactivation existed, but its label did not match the intended removal workflow and account usernames were absent from the list. Master Data child pages relied on browser history or sidebar navigation. The board read model returned only current occurrences, and the checklist editor placed draft, publishing, status, and history controls in one dense panel.

## Decision

Part import accepts CSV and `.xlsx` through a browser review flow. Parsing checks required headers, row limits, and duplicate numbers. Safe nonnegative integer cells in Excel are converted to decimal identifiers; long numbers and identifiers with leading zeros must be stored as text to preserve their exact value. A tenant scoped preview returns the current name, status, identifier, and version of each matching part. The administrator selects Update or Skip for each existing number, with bulk choices. The commit applies new rows and selected name updates in one transaction, rejects stale versions and newly conflicting numbers, and records each write in the audit trail. Existing active status is preserved.

Member removal is represented by deactivation and labeled Hapus member. An in-app confirmation explains the move to Arsip and preserved history. Deactivated members leave the default active list and remain available through Arsip for restoration. Existing reference checks, session revocation, and retained history continue to govern that transition. Account usernames appear in the member list and detail view.

The assignment board may request current occurrences, other configured shifts at their next occurrence, or both. The default remains current. Each line result declares whether it is current. Canvas is available when the filtered result contains one Line–Shift. Master Data child pages expose fixed parent links; successful changes use shared transient confirmation messages. Both login forms expose a keyboard accessible password visibility control. The checklist editor separates draft editing from publishing and version history, and blocks publishing while unsaved edits are present.

## Rationale and alternatives considered

Reviewing file conflicts before a write lets an administrator choose which existing names to replace. Automatically overwriting all duplicates would hide material changes. Sequential calls to the individual Part endpoint would allow partial imports and lose a clear batch result. Hard deleting members would conflict with retained references and audit. Browser history alone is unreliable after deep links, so parent links target stable Master Data routes. Returning only the current board shifts could not support comparison with other schedules; exposing next occurrences through the existing tenant scoped read model avoids a second board surface.

## Implementation and consequences

The two new Part endpoints carry validated rows rather than the original file; the browser parses the selected first sheet and sends only part number and name. File contents are not persisted. The supplier row lock serializes Part mutations that share the import review boundary. Preview is advisory; commit repeats tenant, uniqueness, and version checks. Failed commits roll back all writes. Import is capped at 500 rows and 2 MB per file. `.xls` is not supported. No database migration is required.

Member archive is a view of inactive members, not a new storage entity. The board response adds `isCurrent`, and the board query adds `shiftStatus`. Existing TMMIN and Supplier consumers retain the current-only default when they omit the parameter. Other shifts show their next scheduled occurrence, so their date may differ from the current shift's date. Toast messages supplement persistent error feedback and never replace it.

The mobile PWA status banner sits below the app header and allows pointer events to pass through its non-interactive area. A fixed bottom banner had intercepted the import confirmation action during a transient offline state in Edge; keeping the retry control interactive without blocking page actions resolves that overlap.

## Validation plan and risks

CSV conflict selection and `.xlsx` parsing were exercised in Chromium and Edge browser journeys. API integration covers duplicate rejection, stale version rollback, tenant isolation, and current/other shift partitioning; unit tests cover parsing and form behavior. Onboarding journeys capture desktop layouts for all four checklist categories and a mobile Man layout. OpenAPI generation and client output are deterministic. The local seed uses compatible individual Part creation and board layout endpoints, so no seed edit is needed; a fresh seed against the built API completed with two Hosted suppliers and 240 Henkaten.

Large import transactions may take longer than individual writes; the 500-row cap bounds that work. A user must re-review a file after a concurrent Part change. Staging touch-device and operator acceptance remain follow-up gates.
