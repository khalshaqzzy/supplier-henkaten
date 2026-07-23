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
- Session idle and absolute lifetimes are 30 minutes and 12 hours. Activity writes are throttled to
  once per minute.
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
