# 0029 Supplier Web Push Delivery and Line Leader Enforcement

Status: Accepted

Date: 2026-08-05

## Context

Supplier events needing prompt action must reach shop-floor devices while durable in-app
Notifications remain the only delivery source of truth. Push services are untrusted external
targets, delivery is not guaranteed, endpoint material is secret-like, and a shared browser may be
used by different supplier accounts. Line Leaders require a device-level readiness gate.

## Decision

Each browser installation stores a random UUID and sends it as `X-Device-Installation-ID` on
authenticated Supplier requests. The API derives supplier/user from the authenticated session,
never from subscription input. It exposes config/status plus create/revoke operations without
returning endpoint or encryption keys. Browser endpoints are SHA-256 indexed, may be idempotently
reactivated or reassigned to the current user, and must use HTTPS standard port with no credentials
and an exact/suffix vendor-host allowlist.

Line Leader NORMAL sessions are denied operational endpoints with HTTP 428 and
`PUSH_SUBSCRIPTION_REQUIRED` unless the current user+installation has an active, unexpired
subscription. Session, logout, change-password, push config, create, and revoke remain exempt.
Frontend gating provides Account, installation help, and Logout. Other supplier roles opt in.

After an eligible durable Notification is created, one `PushDelivery` is materialized per active
subscription under a unique Notification+subscription key. Eligible kinds are approval pending,
vacancy/Assignment Issue, actionable reservation/conflict, Start Shift blocked, emergency override,
and relevant account/security activity. Routine terminal outcomes remain in-app only.

Payloads use a strict non-PII snapshot: IDs/kind, Henkaten identifier/category/status, line/job,
safe title/body/tag, and relative deep link. MP identity/registration, comments, checklist evidence,
credentials, tokens, endpoint, and keys are forbidden. Logging/audit records only safe IDs,
transitions, and failure classes.

The PostgreSQL worker claims rows with `FOR UPDATE ... SKIP LOCKED`. Network errors, 429, and 5xx
retry within TTL/attempt bounds and honor numeric Retry-After; 404/410 expires the subscription;
other 4xx/config/auth failures are permanent. `ACCEPTED` means only that the push service accepted
the request. Push failure never changes Notification or Henkaten state.

Logout revokes the current installation. Password changes/resets, user or supplier deactivation,
role changes, source-mode cutover, preparation cancellation, and operator recovery revoke affected
subscriptions. VAPID pairs are stable and distinct per environment; v1 rotation forces documented
re-subscription rather than silently retaining an old key.

## Consequences

The migration is additive and supports code rollback without a down migration. Endpoint and key
material remain necessary encrypted-transport database data and must be protected by runtime/DB
access controls. Users can have multiple devices; a shared endpoint belongs only to its most recent
authenticated owner. iOS/iPadOS requires Home Screen installation before permission can be asked.

## Alternatives Considered

- Treat push as authoritative delivery: rejected because browsers/vendors provide no such proof.
- Gate only in the UI: rejected because API clients could bypass it.
- Gate the user globally: rejected because compliance is installation-specific.
- Permit arbitrary HTTPS endpoints: rejected because it creates SSRF risk.
- Include full Notification body: rejected because lock-screen exposure can reveal PII.

## Validation

Contract/unit tests cover config validation, payload/cache/deep-link allowlists, endpoint SSRF,
failure classification, and the Line Leader gate. PostgreSQL tests cover ownership, idempotency,
reassignment, multi-device delivery, concurrent claims, revocation, and transient/permanent vendor
responses. Actual Android and iOS/iPadOS vendor delivery remains a staging UAT gate.
