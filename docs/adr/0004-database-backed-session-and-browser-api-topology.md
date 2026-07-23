# 0004 Database-backed Sessions and Browser API Topology

Status: Accepted

Date: 2026-07-23

Implementation refinement (Phase 3): cookies use `SameSite=Strict`; CSRF uses an HMAC-derived
synchronizer token bound to session UUID and realm. Realm-specific `/auth/supplier/*` and
`/auth/tmmin/*` routes never accept the other realm's cookie.

Scope: browser authentication sessions, cookies, CSRF, identity realms, and API routing

## Context

Supplier and TMMIN users authenticate through different applications and identity realms. Session
revocation must take effect after password reset, account deactivation, role change, or source-mode
cutover. Production domains are not yet final, so authentication must not depend on cross-site
third-party cookies.

## Decision

Sessions use opaque random tokens with at least 256 bits of entropy. Only a SHA-256 token hash and
session metadata are stored in PostgreSQL. Supplier and TMMIN realms use separate session records
and separate cookie names.

Staging and production cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, and `Path=/`, with no
`Domain` attribute. Local HTTP uses non-prefixed development cookie names with `Secure=false`.

Both browser applications call a same-origin `/api` path. Vite proxies it locally and Caddy proxies
it in hosted environments. The public API domain remains available for External supplier bearer
authentication and operational access.

Sessions expire after 30 minutes idle or 12 hours absolute. CSRF protection uses a synchronizer
token tied to the session and submitted in `X-CSRF-Token` for state-changing browser requests.
Password reset, password change, deactivation, role change, and source cutover revoke affected
sessions.

## Rationale

Database-backed sessions allow immediate revocation and auditable lifecycle control. Host-only
cookies reduce domain injection risk. Same-origin browser routing avoids dependence on third-party
cookie policies while keeping the External REST API independently addressable.

## Alternatives Considered

- **JWT-only sessions:** rejected because immediate revocation and role-change invalidation become
  harder.
- **One shared cookie for both realms:** rejected because it prevents clear realm separation and
  simultaneous sessions.
- **Domain-wide cookies:** rejected because they expose a larger subdomain trust boundary.
- **Cross-origin browser calls with `SameSite=None`:** rejected as the default because browser
  third-party-cookie restrictions can still break the workflow.
- **Double-submit cookie CSRF:** rejected in favor of a server-bound synchronizer token.

## Implementation Details

Session metadata includes principal, realm, supplier scope where applicable, created/last-seen/
absolute-expiry timestamps, revoked timestamp/reason, password or authorization epoch, safe client
metadata, and CSRF-token hash. Session and CSRF secrets are never logged or included in audit
before/after values.

Local cookie names are `tmmin_henkaten_supplier_session` and
`tmmin_henkaten_tmmin_session`. Hosted names add the `__Host-` prefix.

## Consequences

The API performs a database lookup for authenticated requests. A same-origin proxy must be included
in future frontend and Caddy configuration. Local and hosted cookie configuration differs and must
be covered by environment validation.

## Validation Plan

- Token entropy and hash-storage tests.
- Idle and absolute timeout tests with a controlled clock.
- Revocation tests for all security events.
- CSRF negative tests.
- Cookie attribute tests for local and hosted environments.
- Simultaneous supplier and TMMIN browser session tests.

## Risks

- Excessive last-seen writes can create database load and need bounded touch intervals.
- Incorrect proxy trust settings can record spoofed client IPs.
- Missing CSRF enforcement on one mutation route would weaken cookie authentication.

## Validation Evidence

Identity realm, user-role, supplier-scope, login, session-response, password-change, and safe health
contracts compile and pass schema tests. No session store, cookie, proxy, or CSRF runtime has been
implemented.

## Follow-up

Authentication, session storage, throttling, revocation, and route guards will be implemented after
the persistence foundation.
