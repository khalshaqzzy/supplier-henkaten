# ADR 0009: Identity, Password, Session, and Bootstrap Security

Status: Accepted

Date: 2026-07-23

## Context

The platform has separate TMMIN and Supplier identity realms, privileged tenant provisioning, and
permanent audit requirements. A leaked browser token or ambiguous bootstrap process would cross
tenant and operational boundaries.

## Decision

- Passwords use Argon2id with minimum memory 19,456 KiB, two iterations, parallelism one, and
  32-byte output. Parameters may increase through validated environment values but never fall below
  this floor.
- Passwords contain 12-128 characters. The current hash and four preceding hashes are retained;
  all five are checked before a change.
- Temporary passwords contain at least 128 bits of cryptographic entropy, are returned once under
  `Cache-Control: no-store`, and always set `mustChangePassword`.
- Browser sessions use independent TMMIN and Supplier cookies. The raw 256-bit opaque token appears
  only in the cookie; PostgreSQL stores SHA-256.
- Eligible direct sessions last 30 fixed days without earlier idle expiry. Delegated and
  forced-password-change sessions retain 30-minute idle and 12-hour absolute limits, as defined
  in the lifetime amendment below. Activity writes are throttled to once per minute.
- Hosted cookies use `__Host-`, Secure, HttpOnly, SameSite Strict, Path `/`, and no Domain. Local
  HTTP uses explicit non-`__Host-` names and disables Secure only locally.
- CSRF is an HMAC-SHA-256 synchronizer token derived from raw session token, session UUID, realm, and
  a rotatable runtime secret. Mutations require the token and the exact realm application Origin.
- Five known-account failures within 15 minutes lock the account for 15 minutes. Unknown account
  and IP controls use bounded in-memory HMAC-keyed buckets. Authentication failures do not reveal
  which identity element failed.
- One protected `TMMIN_ADMIN` is created and recovered only by operator CLI. The API cannot create,
  reset, deactivate, or replace it.

## Rationale

Database-backed sessions give immediate revocation and epoch checks without Redis. Separate realms
and host-only cookies prevent accidental cross-application authority. The operator-only protected
administrator preserves a recovery path without exposing a remotely callable super-admin creation
route.

## Alternatives

- JWT-only sessions were rejected because revocation and role/source-epoch changes must be
  immediate.
- Shared realm cookies were rejected because they widen cross-application compromise impact.
- Email password delivery was rejected because email is outside v1.
- Composition rules were rejected in favor of length, history, Argon2id, and throttling.

## Implementation Details

`User` owns password and authorization epochs. `UserSession` snapshots both plus supplier
`sourceEpoch`; a mismatch invalidates the session. Password change/reset and account/source
governance revoke sessions transactionally. Only forced-change session inspection, logout, and
password change are permitted before the temporary password is replaced.

Logs serialize request method/route and response status only. Cookie, Authorization, request body,
query, password, hash, token, secret, registration number, and freeform content are excluded.

## Consequences

Multiple sessions are supported and revocable. The single-instance in-memory unknown-account/IP
limiter is correct for the v1 single-VM topology but must be redesigned before horizontal scaling.
Loss of the operator environment secret requires a new secure operator recovery procedure.

## Validation Plan

- Argon2 parameter, password history, temporary credential, forced reset, lockout, cookie, CSRF,
  cross-realm, epoch, and revocation tests.
- PostgreSQL tests verify token hash-only persistence and session constraints.
- Supertest verifies initial reset, relogin, cross-realm denial, and capability denial.
- CI and log tests verify secret redaction.

## Risks

The absence of MFA/SSO remains an accepted v1 limitation. Single-instance throttling does not
provide distributed abuse coordination. Permanent identity/audit retention still requires
production privacy sign-off.

## Follow-up

Phase 4 adds Supervisor, Line Leader, and QC member-linked accounts. Phase 10 expands negative
security and concurrency coverage. MFA/SSO requires a future ADR.


## Lifetime amendment — 2026-10-20

Status: implemented locally; automated verification is recorded in the session handoff. HTTPS
staging and persistent-profile/device restart acceptance remain pending.

### Context and decision

Frequent reauthentication after inactivity interrupts routine Quality and Supplier work. The
existing persistent cookie already survives browser closure, but server-side idle expiry and the
12-hour absolute deadline invalidate it. Both server deadlines therefore need to be addressed.

Eligible direct TMMIN Admin/Quality and Supplier Admin/Supervisor/Line Leader/QC sessions will be
issued for exactly 30 days from successful login, without an earlier inactivity limit. Direct
Hosted Preparation sessions will use the same lifetime while retaining preparation restrictions.
Delegated Supplier sessions and sessions still requiring a password change will retain 30-minute
sliding idle and 12-hour absolute limits. Delegated access remains bounded by the initiating TMMIN
session, and the two-minute single-use exchange-link lifetime is unchanged.

### Implementation direction and rationale

One internal classifier in `SessionService` will determine the lifetime at issuance and activity
updates, based on the existing delegation identifiers and the authenticated user's
`mustChangePassword` value. The typed creation input will include that flag. Persistent sessions
will store equal idle and absolute deadlines at login time plus 30 days. Short sessions will
retain their sliding idle deadline, capped at their original absolute deadline.

Resolution will still reject either expired stored deadline before touching activity. Active
persistent touches may update last activity but cannot extend the absolute bound. Passive
resolution will update neither activity nor deadlines. Cookie expiry will remain the stored
absolute deadline. Existing token hashing, host-only realm cookies, CSRF, Origin, identity/epoch,
revocation and delegated-parent checks will be retained.

The two existing public timestamps will be retained, avoiding a schema migration, client contract
change or refresh-token subsystem. A single effective expiry will be displayed on TMMIN Account
instead of duplicate technical deadlines. No new browser credential storage or artificial
keepalive requests will be introduced.

### Compatibility and consequences

Existing session rows/cookies will not be mass-extended and expired/revoked sessions will not be
revived. A legacy direct session still valid on its first active request may have its idle
deadline normalized to its existing absolute bound; that original 12-hour bound remains intact.
The full 30 days will be obtained on the next eligible successful login. Existing special sessions
will remain short. This transition is explicit rather than inferred from timestamp differences.

Code-only rollback is schema compatible but does not immediately revoke previously issued
30-day sessions. Earlier code can shorten their idle expiry on an active touch while retaining
the persisted absolute deadline. An immediate policy reversion for already issued sessions would
require a separately scoped revocation operation.

### Alternatives considered

Changing only the absolute deadline would leave the inactivity problem intact. Raising both
global constants would incorrectly lengthen delegated and forced-change access. Indefinite or
sliding 30-day sessions would not provide the selected fixed cutoff. A new persisted policy
column would preserve legacy sliding-idle behavior exactly but would add migration work without
being required by the accepted transition. Refresh tokens, JWT replacement and client heartbeats
would add lifecycle complexity to an already durable, revocable session design.

### Risks

A retained or stolen cookie can carry its existing authority for longer until expiry or server
revocation; this is the accepted persistence tradeoff. Shared-device users retain responsibility
for logout. Browser storage removal, private-browser closure, OS eviction and unavailable network
can still prevent session restoration. Long persistence does not increase capability, export TTL
or link TTL, and does not replace the existing authorization checks on protected operations.

### Validation and follow-up

Clock-driven unit and real PostgreSQL/HTTP tests will cover all six roles, Hosted Preparation,
fixed day-30 boundaries, passive/active touches, legacy transition, short exceptions, parent
expiry/revocation, password/source/authorization epochs and cookie/CSRF compatibility. Browser
tests will cover both portals in Chromium and actual Edge, cookie-backed restoration, logout and
concise expiry presentation. Real persistent-profile restart and HTTPS cross-domain/PWA behavior
remain staging acceptance checks; replaying test storage state alone is not equivalent evidence.

Implementation retains the existing schema and public contract. Clock-driven unit and real
PostgreSQL/HTTP checks cover issuance, fixed expiry, special-session activity and invalidation;
production cookie attributes are asserted separately. Automated browser coverage restores both
portals from persistent cookie state and checks logout. This is distinct from a physical browser
restart. Exact local results, seed compatibility and remaining release gates are recorded in the
[session handoff](../../.agent/sessionHandoff.md). The accepted transition, rollout and rollback
requirements remain in the [implementation plan](../../.agent/sessionPersistencePlan.md).
