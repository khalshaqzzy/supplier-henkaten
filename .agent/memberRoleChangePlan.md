# Supplier Admin member role changes

Date: 2026-11-02. Branch: `feat/member-role-handover`, based on local `main`.
Status: implemented and locally verified. Staging/UAT and dependency-audit release gates remain pending. This document records the agreed scope and validation plan; no release acceptance is implied.

## Product decisions

Supplier Admin may change an existing Line Leader, Supervisor or QC to either of the other two operational roles. MP transitions and administrative roles are excluded. The same Member and User IDs, registration, username, password, photo, import code and active/inactive state are retained. Existing identifier uniqueness remains intact, including archived records. This replaces the old deactivate-and-recreate guidance for these role corrections.

Assignments and Open Henkaten responsibilities may be handed to explicitly selected replacements in the same transaction. Role change never silently deactivates an assignment, cancels Henkaten, changes a prior approval or automatically assigns the member to their new role. An archived member can be corrected while remaining archived; restore and account activation are separate actions. Restoring a member does not activate login. Account activation issues a new temporary password and requires a password change.

A former LL may approve a Henkaten they created when their current role and current assignment authorize the decision. The creator and original occurrence snapshots remain unchanged. There is no added creator/self-approval restriction.

Direct Hosted Supplier Admin, valid Hosted Preparation and existing delegated Supplier Admin support access follow their established write boundaries. Delegated operator attribution must be retained. No direct TMMIN mutation route is added.

## Source findings and architectural choice

The current edit contract excludes role, the UI disables the field and a database trigger rejects updates. Archived identifiers stay reserved. Member/User role consistency, sessions, assignments and approval history therefore make merely enabling the dropdown insufficient.

Keep person identity stable and introduce a dedicated reviewed role command. A durable append-only MemberRoleChange records old/new role, resulting member version, actor, reason, handovers and idempotency hash. The database role trigger accepts only operational transitions backed by this command. A deferred consistency check ensures linked User and Member roles agree at commit. A partially updated role cannot commit.

LL access/withdrawal currently uses ShiftRun.lineLeaderMemberId, while Supervisor approval uses its current route. Introduce a separate HenkatenLineLeaderResponsibility override. Missing override preserves the old occurrence-owner fallback. Updating an override transfers current authority without editing creator, ShiftRun, evidence or terminal records. New submissions after an in-occurrence LL change also receive the current-owner override when the retained occurrence snapshot names a different LL. Every subsequent role command must use the override before the occurrence fallback. Read-model counts, notifications and deep-link/action checks must agree with this authority.

QC approvals are pooled by role. They have no individual QC assignee to reroute. Leaving QC while approvals are pending requires another active QC with an active account. Do not invent personal QC routes. Completed QC decisions retain their actorRole snapshot.

## Review and transaction

1. Choose the new role through a separate Ubah role action. Ordinary profile saves still cannot change role.
2. Preview from a consistent snapshot: source Member/User versions, all retained LineShift/default references, relevant Open Henkaten, candidate account/member versions and LL occupancy. Provide a revision digest, explicit dependencies and actionable blockers.
3. Choose one eligible same-supplier replacement of the old role for all dependencies, including inactive configuration that could otherwise become invalid on restoration. Show inactive assignment labels explicitly. A replacement LL cannot violate either the active LineShift uniqueness or retained default LL uniqueness. A person may receive several Open Henkaten, but at most one active LineShift.
4. Show the selected role transition and common replacement, preserved account/member state and required reason. Mention that an active user must log in again; inactive accounts remain inactive.
5. Submit with an Idempotency-Key and exact preview revision. On an uncertain result freeze edits and retry the same payload/key. On definitive version conflict refresh the review and require fresh replacement choices; never silently accept additional work or changed recipients.
6. Inside a serializable transaction acquire the Supplier mutation lock, revalidate the current admin/session/source and delegated session, check durable retry receipt, recompute the review, validate exact coverage and candidate roles/accounts/capacity, then apply all handovers and role/account updates. Increment affected versions and setup revision; write audit evidence and command receipt atomically. Revoke source sessions and push subscriptions. Any failure rolls everything back.
7. Revalidate in-flight operational writes after acquiring the same supplier lock, so a request authenticated before revocation cannot approve or submit with the previous role after the change commits.
8. Preserve completed approval decisions, historical occurrence/creator snapshots, Man placements, checklist evidence and deleted records. Exclude deleted Henkaten from visible handover work.

Review commands are bounded to 1,000 dependencies. Larger handovers show a blocker and direct prior reassignment through existing assignment/reroute flows, rather than an unbounded write transaction.

## UI specification

Use existing shared Dialog, Field, NativeSelect, Button, Alert and credential components, existing Inter font and HDS tokens. Keep orange for the established primary action/selection; neutral surfaces, quiet dividers and explicit state text. The interaction has three stages: Role baru, Pengalihan, Tinjauan. Show name, registration and username throughout. The handover stage shows one row and one replacement selector covering all Line–Shift assignments, retained default line assignments and related Open Henkaten responsibilities. The final review names that single replacement, without repeated resource rows or internal dependency counts. The client expands this single choice into every reviewed dependency in the existing atomic request. Candidate options include name, registration and availability reason. Disable progression until the common replacement is chosen or while the preview has blockers.

Desktop dialog is bounded to 740 px; header/footer remain usable with scrollable long content. At <=640 px use a full-height dialog, stacked transfer fields, sticky action area, 44 px touch targets and safe-area padding. Preserve keyboard focus trap, Escape/cancel before submission, accessible field labels, focusable error summary, loading feedback and reduced motion. Prevent closing only while saving or outcome is uncertain. A refresh or Back must not silently persist anything. Do not repeat architecture explanations in product copy.

Show account active/nonactive independently of member status. Akun nonaktif exposes Aktifkan akun only when the member is active; an archived member receives a visible restore-first instruction. Reset password appears for active accounts. Activation is separate from both restore and role change and uses the existing one-time credential surface.

## Implementation sequence

- Contracts and persistence: dedicated request/preview/result schemas; migration, ledger and responsibility model; guarded role consistency; fresh and upgrade migration checks.
- Backend command: preview, exact dependency matching, one-choice-to-all client mapping, atomic handover, stable identifiers, session revocation, stale-review and idempotent-retry handling; transaction-bound authorization and source/tenant checks.
- Operational integration: LL list/detail/clone/withdraw authority, Supervisor routing history, pooled QC coverage, dashboard and notification ownership; no historical evidence rewrite.
- Frontend: role dialog, active/archived states, transfer review and error recovery; separate account activation; typed client and regenerated OpenAPI.
- Tests and docs: role transitions, dependency and authorization negatives, concurrent/stale requests, rollback and historical evidence, restoration/login, component/browser accessibility and responsive QA. Amend PRD and ADR 0011, preserve Phase 15 acceptance state and record exact checks in handoff.

## Acceptance matrix

- All six directed operational role pairs succeed without dependencies; MP/admin transitions and generic profile role edits fail.
- Same Member/User IDs, normalized identifiers, photo and password hash survive; member/account active flags survive independently.
- Source old session and push subscription are revoked; new login resolves the target role. An old queued approval is denied after change.
- Active and inactive assignment references transfer; duplicate/missing/extra mapping IDs, self, wrong tenant, wrong role, inactive member/account and occupied LL are rejected atomically.
- Pending Supervisor routes and LL Open responsibility transfer; original snapshots and completed decisions do not change. New LL can read/withdraw, including after a second handover; former LL cannot act through an old occurrence fallback. New Supervisor can act only on their current route.
- QC can leave with no pending work or with another usable QC; the last usable QC cannot leave pending approvals stranded.
- Stale member/account/assignment/candidate/route or newly created Open work requires review refresh. Competing changes serialize; transaction failure leaves no receipt, role mismatch or partial handover.
- Retry returns the recorded command without applying again. Reusing a key with different member/payload fails. Receipt contains no plaintext credentials. Ambiguous activation recovery uses refreshed state and an explicit password reset if the one-time password was lost.
- Archived role correction does not activate login; restore then account activation enables login with forced password change; stale/repeated activation does not rotate passwords twice.
- Hosted Preparation, delegated access, source cutover, inactive supplier, revoked admin session, CSRF, tenant boundaries and role capability negatives remain enforced.
- Readiness/import previews become stale after a role command; Excel import keeps refusing implicit role changes and points users to Ubah role. Seed creates original role-linked accounts and should not need any ordinary fixture role changes.
- Desktop/tablet/phone: no page overflow or clipped actions; keyboard focus/error recovery; loading/empty/blocker/stale/network states; no credentials in persisted browser state or logs.

## Delivery and recovery

Run pinned runtime/dependency and relevant local CI checks, Docker PostgreSQL integration and Chromium/Edge E2E. Inspect screenshots at 1440, 768 and 390 px. Run seed smoke against the migrated API. Before any commit apply all repository-required workflow parity, deployment and secret scans. Commit/push/PR/deployment are not implied by branch creation.

Use an additive migration; do not backfill invented role history or alter old migration files. Existing members and Henkaten without responsibility overrides keep their previous behavior. After role transitions exist, rolling back to old binaries would ignore LL overrides; recovery must retain the widened authorization reader or deploy a forward fix. Disabling new commands alone is safe; deleting ledger/override rows or reverting historical role evidence is not a recovery procedure.
