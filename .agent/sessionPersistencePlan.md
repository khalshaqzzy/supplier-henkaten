# Persistent browser sessions — implementation plan

Date: 2026-10-20

Status: implemented locally following the confirmed product choices. Automated verification and remaining staging/device acceptance are recorded in `sessionHandoff.md`.
Branch inspected: `feat/session-duration`. Phase 15 remains `in_progress`; no release gate advances.

## 1. Confirmed behavior

| Session | Idle behavior | Absolute lifetime |
| --- | --- | --- |
| Direct TMMIN Admin or Quality login, password change not required | No earlier idle expiry | 30 days from successful login |
| Direct Supplier Admin, Supervisor, Line Leader or QC login, password change not required | No earlier idle expiry | 30 days from successful login |
| Direct Hosted Preparation login, password change not required | No earlier idle expiry; preparation capabilities remain restricted | 30 days from successful login |
| Any direct login still requiring password change | 30-minute sliding idle limit | 12 hours from login |
| TMMIN access as Supplier Admin through magic link | 30-minute sliding idle limit | 12 hours from redemption, additionally bounded by validity of the initiating TMMIN session |

Thirty days means exactly `30 * 24 * 60 * 60 * 1_000` milliseconds from the injected server clock, not the end of a calendar month. Activity never moves that fixed deadline. A login at 20 October 2026 10:00 WIB expires at 19 November 2026 10:00 WIB. Resolution at the exact deadline is denied.

The long session is automatic; no Remember me control or separate credential storage is needed. Closing a tab/browser, leaving a device asleep, or remaining inactive for several days does not itself end an eligible session. The browser must retain its cookies; incognito closure, cleared cookies or browser/OS storage eviction can still require login. Offline operation continues to follow the existing network-only data policy.

Logout, password change/reset, account deactivation, authorization-epoch change, supplier deactivation, source cutover/epoch change, preparation cancellation, setup reset, admin replacement and operator recovery retain their existing revocation/authorization behavior. A long session never grants a new capability. Password change continues to revoke sessions and require another login; that next successful login receives 30 days after `mustChangePassword` is cleared. MP remains without an account.

## 2. Evidence and diagnosis

- PRD section 9.3 and ADR 0009 currently specify a 30-minute idle limit and a 12-hour absolute limit. The confirmed requirement intentionally supersedes those limits for eligible direct logins; the exceptions remain short.
- `apps/api/src/auth/session.service.ts` hard-codes those two limits in `create()`. `resolve()` rejects either expired timestamp and extends idle expiry on authenticated requests, throttled to once per minute. Merely raising the absolute limit would still log an inactive user out after 30 minutes. Raising both constants globally would also lengthen the confirmed exceptions.
- `apps/api/src/auth/auth.facade.ts` already issues a persistent cookie with `expires: absoluteExpiresAt`. Production uses separate realm cookies with `__Host-`, Secure, HttpOnly, SameSite Strict, Path `/`, and no Domain. Cookie persistence itself is already implemented.
- Both portal session providers call the session endpoint on application bootstrap. The API client uses `credentials: 'include'`, and clears application session state for `SESSION_EXPIRED`. Neither provider contains a 30-minute inactivity timer or stores the raw session token in browser JavaScript storage.
- Both query clients poll mounted views every 15 seconds. Such requests can currently refresh idle time. They cannot provide persistence while the browser is closed or suspended and must not become an artificial keepalive solution.
- `SupplierAdminMagicLinkService` separately issues its Supplier cookie and checks the parent TMMIN session directly. The exchange token expires after two minutes and remains single use; this is different from the lifetime of the delegated session.
- `RealtimeService` revalidates through `resolve(..., false)` for events/heartbeats. Protected import parsing also resolves sessions before parsing. Both must continue to use the same server authorization boundaries.
- `UserSession` already stores both deadlines, last activity, revocation, password/authorization/source epochs and delegation identifiers. The public session schema already exposes both timestamps. No new table, column, token type, endpoint, environment variable or refresh-token protocol is required by this design.
- TMMIN Account currently renders technical `Idle expiry` and `Absolute expiry` labels. For new direct sessions these would show the same time twice; the display should become one concise expiry value.

## 3. Implementation design

### A. Central lifetime calculation

In `SessionService`, introduce clearly named constants for persistent lifetime (30 days), short idle (30 minutes), short absolute (12 hours), and the existing touch interval (one minute). Keep this product policy in code, following the existing fixed-policy convention; runtime configuration is unnecessary for the confirmed scope.

Add one internal classifier shared by issuance and resolution. A session is short if it has either delegation identifier or the authenticated user has `mustChangePassword: true`. Otherwise it is persistent, for both realms and both purposes. Do not classify by supplier role alone, duration inferred from database timestamps, or a client-submitted flag. Include `mustChangePassword` in the typed user input to `create()`; inspect every caller and test fixture.

Issuance uses one captured `clock.now()`:

```text
persistent: absoluteExpiresAt = now + 30 days
            idleExpiresAt = absoluteExpiresAt
short:      absoluteExpiresAt = now + 12 hours
            idleExpiresAt = min(now + 30 minutes, absoluteExpiresAt)
```

Retain `idleExpiresAt` in storage and the API for compatibility. For a persistent session it is an effective deadline equal to the absolute deadline, not an earlier inactivity limit. Both existing expiry checks remain in place; do not bypass a stored earlier deadline before validation.

### B. Resolution, activity and revocation

First validate the stored deadlines and all current identity/epoch/revocation checks. Only a still-valid session can be touched. On a throttled active touch:

```text
persistent: update lastActivityAt; normalize idleExpiresAt to stored absoluteExpiresAt
short:      update lastActivityAt; idleExpiresAt = min(now + 30 minutes, stored absoluteExpiresAt)
both:       never update absoluteExpiresAt
passive:    do not update activity, either deadline, or version
```

Retain optimistic version handling and include `revokedAt: null` and stored-deadline validity in the conditional touch predicate so a concurrent revoke/expiry cannot receive a later activity update. Do not describe the touch predicate as eliminating every race between request authentication and a later business write; existing write-boundary authorization remains authoritative.

Preserve all current realm, active-user, epoch, supplier, actor and actor-session checks. Treat either delegation identifier as short defensively. Preserve parent-session revocation and expiry checks in both `resolve()` and magic-link redemption. A delegated request never touches the parent session. Parent inactivity does not expire a new persistent TMMIN session early, but the delegated child still has its own short limits.

### C. Cookies and public response

Keep the current cookie names/attributes and `expires` tied to the session's stored absolute deadline in both ordinary login and magic-link redemption. Do not reset cookie expiry on every request. Leave CSRF derivation, Origin checks, `Cache-Control: no-store`, token hashing and log redaction intact.

Retain the public fields `idleExpiresAt` and `absoluteExpiresAt` with their existing types. No OpenAPI/client shape change is expected; verify generated parity. Do not introduce localStorage tokens, JWTs, background refresh requests or a dependency on SSE to keep a session valid.

### D. Account presentation

In TMMIN `AuthPages.tsx`, replace the duplicate expiry entries with `Sesi berakhir` using `min(idleExpiresAt, absoluteExpiresAt)`. Set the Account header description/eyebrow to concise user-facing copy under repository UI rules. This also truthfully describes the current short-session response, although its idle deadline can move after activity.

For Supplier Account, no new expiry UI is necessary. Preserve the delegation banner, password-change restriction and existing push controls. Both providers continue to bootstrap from the API, clear cached data on real expiration/logout, and recover CSRF from the session response after browser reopening. Do not broaden this change into an offline/network-error redesign.

## 4. Existing sessions and rollback

No database migration or mass rewrite is planned. No expired or revoked session is revived. Existing cookies also retain their original 12-hour expiration, which cannot be extended on a browser that never returns a request.

An existing direct session that is still valid at its first post-deploy request may have its idle deadline normalized to its original absolute deadline, but its original 12-hour absolute bound remains. An already idle-expired session is rejected before that normalization. Existing special sessions keep the short limits. Therefore all eligible users obtain the full 30 days on their next successful direct login; zero-transition-login persistence for every existing browser is not promised.

This transitional behavior is intentional and must be covered by tests and release notes. It avoids timestamp-based guesses or a new policy column solely to distinguish old sessions. If exact preservation of the legacy sliding-idle behavior later becomes a requirement, revisit a persisted policy version rather than infer it from timestamps.

Rollback is code-only and schema compatible. Earlier code will still honor persisted 30-day absolute bounds but can shorten their idle expiry to 30 minutes on the next throttled active request. Rolling back code alone does not immediately invalidate already issued 30-day sessions. If immediate reversion of issued sessions is required, revoke the precisely identified eligible sessions as an explicit operational action; do not silently clear all users or rewrite historical evidence. Never claim a rollback automatically restores every old session deadline.

## 5. Work sequence and file scope

| Step | Files/areas | Completion evidence |
| --- | --- | --- |
| 1 | `apps/api/src/auth/session.service.ts`; inspect ordinary login and magic-link create callers | One shared policy; persistent deadlines fixed; exceptions short; touch capped and conditional |
| 2 | New `apps/api/src/auth/session.service.spec.ts` | Clock-based creation, boundary, active/passive touch and legacy-transition tests |
| 3 | New `apps/api/src/auth/session-lifetime.integration.spec.ts`; existing magic-link and passive-session integration tests | Actual PostgreSQL, HTTP/cookie/CSRF and revocation evidence |
| 4 | `apps/tmmin-web/src/pages/AuthPages.tsx`, relevant portal tests | Concise accurate Account expiry and unchanged login/logout restoration |
| 5 | `apps/e2e/tests/` and isolated harness selection as necessary | Chromium and actual Edge recovery/logout tests for both portals |
| 6 | PRD section 9.3, ADR 0009, this plan, roadmap and handoff | Documentation marked implemented only after relevant checks pass |
| 7 | Existing workflow/release tooling | Local CI parity before a requested commit, required remote checks after a requested push, HTTPS staging acceptance before release claims |

Inspect local seed and fixtures when changing the typed create input. Production seed uses the ordinary API and should need no payload change; prove that with a fresh isolated seed smoke during implementation and record the result. Do not modify the main development database for verification.

## 6. Acceptance tests

Use the existing injectable `CLOCK`, overridden with a mutable test clock. Avoid waiting real minutes/days, globally faking timers around PostgreSQL, or changing the production server's clock. Browser-side clock changes alone cannot verify backend expiry.

1. Parameterize creation across the six authenticated roles. Completed-password direct logins receive exactly 30 days; a direct Hosted Preparation Admin receives the same duration and restricted capabilities. A user requiring password change receives the short policy; after password change/relogin the user receives the long policy.
2. With no intervening requests, persistent resolution succeeds after 31 minutes, 13 hours, 7 days, and just before 30 days; fails exactly at and after the deadline. Independently corrupting either stored deadline to the past must still reject the session.
3. Active requests before/after the one-minute touch threshold do not move a persistent deadline. Short activity refreshes only its idle deadline and never beyond its absolute deadline. Requests near hour 12 cannot extend a short session. Passive resolution updates no activity/deadline/version for either policy.
4. Verify API response timestamps and cookie `Expires` agree, production security attributes remain present, no Domain is added, realm cookies are distinct, and only token hashes are stored. Use an injected production config in a focused facade/cookie test where useful; do not boot external production services merely to inspect cookie serialization.
5. After simulated multi-day inactivity, get a session, recover its CSRF token and perform an authorized mutation. Check wrong Origin/missing or wrong CSRF, cross-realm and cross-tenant denial alongside expiry.
6. A delegated session idles out at 30 minutes or expires at 12 hours even with a 30-day parent. Parent expiry, parent logout, actor deactivation or epoch change rejects redemption and already-issued child access. Child requests do not move the parent activity/deadlines. The two-minute link expiry, single-use replay check and forbidden Supplier password change remain covered.
7. Parameterize long-session invalidation for logout, password change/reset, authorization epoch, user/supplier deactivation and source epoch. Rerun existing preparation cancellation, setup-reset/admin replacement and recovery suites for their respective revocation behavior. No stale session is revived by a concurrent touch; assert conditional update predicates/outcomes.
8. Verify passive SSE remains valid within the fixed lifetime and terminates after expiry/revocation without extending either policy. Adapt the existing passive-session integration test deliberately; retain its earlier-stored-deadline rejection case.
9. Legacy cases: still-active short-deadline direct session retains its original 12-hour bound after normalization; idle-expired and revoked legacy sessions remain rejected; newly logged-in eligible sessions receive 30 days. Delegated legacy sessions stay short.
10. Chromium and actual Edge: login to each portal, reload, close/reopen a tab and restore from a fresh browser context with only the persistent cookie state; protected content and CSRF-backed actions work. Inspect persistent cookie expiry, logout and subsequent denied access. Do not call storage-state replay proof of a real OS/browser restart; add manual persistent-profile restart acceptance on staging. Use server clock injection in API tests for the multi-day boundary, not a public test-only time-travel endpoint.
11. TMMIN Account shows one expiry entry with the correct effective timestamp. Expired responses still clear cached authenticated data and lead to login. Private browsing/cookie removal appropriately requires a new login.

Run focused tests during development, then repository format/lint/typecheck/unit/OpenAPI/build checks and Docker PostgreSQL integration tests. Before any requested commit, follow the complete workflow-pinned clean-artifact parity and scanners in `.agent/rules.md`; no checks are waived by this plan. With no migration, verify migration parity remains unchanged. Before release, run cross-domain HTTPS cookie/browser-close-reopen acceptance, delegated access, revocation and Supplier PWA recovery on staging; preserve the remaining Phase 15/16 gates.

## 7. Risks and scope boundaries

A retained cookie now grants its existing authority for up to 30 days until server revocation. This is an explicit persistence tradeoff for both TMMIN roles and every Supplier account, including shared devices; the short delegated/forced-change exceptions limit the special cases. Existing logout and immediate server-side authorization checks remain essential. No new MFA, SSO, device registry, session-management screen or global session cleanup worker is part of this feature.

Long persistence does not guarantee access when cookies have been deleted or a network is unavailable. CSRF-secret rotation can invalidate an in-memory CSRF token until session refresh; existing rotation/recovery behavior is retained. Increasing session lifetime does not increase export-file TTL or magic-link TTL. Expired session retention already exists; storage cleanup can be measured separately if needed.

## 8. Planning evidence and implementation outcome

Completed: static inspection of PRD/rules/handoff/roadmap, ADRs 0004/0009/0023/0042, session schema, ordinary/delegated login, guards, passive SSE, protected import authorization, client credentials/error handling, both session providers, query polling, Account views and existing integration/E2E harnesses. All three product questions were answered: 30 days, all six roles, special sessions remain short.

The initial analysis session changed documentation only. Implementation subsequently changed `SessionService`, TMMIN Account and focused unit/integration/browser tests on the existing branch. No schema, public contract or deployment configuration change was needed. Existing database-backed session providers, cookie issuance and revocation paths are retained. Local automated checks and fresh isolated seed compatibility are recorded in the current handoff; no staging/device, commit, push or deployment claim follows from local implementation. Subsequent delivery authorization and its expanded image-security checks are recorded separately in the handoff. Before release, complete the existing delivery checks and HTTPS browser/persistent-profile restart acceptance.
