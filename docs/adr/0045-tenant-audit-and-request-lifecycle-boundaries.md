# ADR 0045: Tenant audit and request lifecycle boundaries

- Status: Accepted
- Date: 2026-09-30

## Context

The Supplier audit query reused a TMMIN filter contract and overwrote the authenticated tenant constraint. Import bodies were buffered before authorization. Long-lived realtime subscriptions and independently committed external batch events retained initial authorization after revocation. Anonymous token attempts retained throttle state indefinitely. Hosted submission could lose its retry identity after a transport failure, accept edited assignment context without a conflict, or fail for a job added after its occurrence was materialized. Inactive shift configuration could be reactivated with inactive references.

## Decision

Trusted audit predicates and caller filters are intersected with `AND` at the shared query boundary. Supplier tenant and historical line scope remain immutable; TMMIN cross-supplier filtering and Quality action restrictions remain supported.

The large import parser is installed after CORS but before the general parser. Only preview/commit POST requests with a current Supplier Admin session, unchanged-password state, exact Origin/CSRF, and writable Hosted or Hosted Preparation scope receive the 80 MiB budget. A separate per-IP throttle and two concurrent slots are enforced before asynchronous authentication or parsing. Slots expire after 60 seconds and release on response completion/disconnect. Other requests retain the general 5 MiB parser.

Realtime output revalidates the authoritative session without extending activity before each replay/live message and each 15-second heartbeat. Invalid sessions terminate subscriptions; current line scope is checked before delivery. This covers expiry, revocation, account/password/authorization/source epochs and impersonating actor/session authority using the existing SessionService rules.

External ingestion transactions lock Supplier then ExternalApiClient, matching source-governance lock order and client revocation. Every event rechecks the current linked token/client identity, expiry, revocation, source epoch, scopes and IP allowlist before duplicate or mutation handling. The outside-transaction duplicate fallback is removed: tenant serialization already supports exact retries, and authorization failures must not be converted to duplicate success. Rejected request audit events remain recorded through the existing batch behavior.

Token-attempt buckets are expired on access and capped at 5,000. New keys fail closed at capacity; active keys retain their counters, preventing identifier churn from resetting throttling.

Hosted forms pin usable displayed context and send additive optional expected LineShift version and expected effective replaced-MP fields. Legacy clients retain server-derived assignment behavior; the current browser supplies the assertions. A first attempt snapshots the entire body and idempotency key. Ambiguous retries use that exact snapshot and keep editing disabled until a definitive rejection or success. A definitive rejected request permits refreshed context and a new intent. Invalid initial assignment contexts remain refreshable.

Existing occurrences acquire only missing job working assignments, preserving existing snapshots and Man movements. Reactivation locks Supplier and LineShift and validates active line/template and every populated role reference. Nullable setup assignments remain supported; activation does not invent new completeness requirements.

## Rationale and alternatives

Shared service enforcement covers controller, batch and direct service callers. Controller-only checks leave transaction races. Replacing active throttle buckets with LRU eviction would let identifier churn reset limits; rejecting new keys preserves active throttles. Normal session resolution on heartbeat would extend idle sessions. Recreating occurrence assignments would overwrite history. Requiring new submission fields on all legacy requests would break existing seed and integration callers without improving the browser's stale-form assertion.

## Consequences

Cross-tenant audit filters return no foreign rows. Authorized import behavior remains compatible, with bounded resource use and readable cross-origin errors. Realtime invalidation adds session and line-scope reads; silent revoked streams close on the next heartbeat, while outgoing metadata is checked before delivery. Revoked external batches retain per-item results but stop further projection writes. Large numbers of distinct token callers may receive a retry response until buckets expire. No database migration is required.

## Validation

Regression coverage exercises real PostgreSQL tenant filtering and TMMIN controls, passive session expiry/revocation without activity extension, client revocation between independently committed batch events, duplicate retry after revocation, stale assignment assertions, jobs added mid-occurrence, and reactivation with inactive references. Unit tests cover pre-parser authorization, malformed anonymous bodies, parser concurrency/capacity recovery, authorized large preparation imports, throttle capacity/reset, SSE cleanup and changed scope. Browser component tests cover exact uncertain retry despite refreshed checklist/context and recovery from an unusable context.

Final commands and results, seed compatibility, runtime cleanup and any remaining validation limits are recorded in `.agent/sessionHandoff.md`.

## Risks and follow-up

Deployment memory sizing and staging device acceptance remain release checks. Parser limits are process-local; multiple API replicas each have their own budget. SSE session validity is checked before emission but no distributed immediate disconnect signal is introduced. Existing legacy clients must adopt expected context fields to obtain stale-form assertions. Production and staging deployment are outside this change.
