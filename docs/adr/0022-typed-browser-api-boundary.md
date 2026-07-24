# ADR 0022: Typed Browser API Boundary

- Status: Accepted
- Date: 2026-07-24

## Context

Supplier and TMMIN browser applications share cookies, CSRF rules, problem details, optimistic
versions, cursor pagination, uploads, and realtime invalidation semantics. Direct `fetch` calls in
features would duplicate those rules and permit request or response drift from the executable
OpenAPI contract.

## Decision

`packages/api-client` is the only production browser HTTP boundary. It exports realm-specific
operation groups, generated OpenAPI `paths`, runtime Zod response validation, typed error classes,
query serialization, multipart/blob support, and the Supplier EventSource client.

Every request:

- uses `credentials: include`;
- creates a client correlation ID and forwards in-memory CSRF for unsafe methods;
- parses JSON, 204, blob, and RFC 9457-style problem responses explicitly;
- accepts an abort signal;
- accepts an idempotency key created once per user intent for non-replay-safe mutations.

Safe reads may be retried by the query layer. Mutations and 401/403/409/422/429 responses are not
automatically replayed. A transport failure after dispatching a mutation is reported as an
uncertain outcome and requires authoritative refresh.

The production build requires an explicit API origin. Origins containing credentials, a query, or
a fragment are rejected.

## Consequences

- Feature modules do not contain ad-hoc API URLs or direct `fetch`.
- A syntactically successful but contract-invalid response fails closed as `ApiContractError`.
- OpenAPI generation and generated `paths` drift become CI failures.
- New backend operations require a catalog entry and runtime schema before frontend use.

## Validation

Unit coverage exercises cookies, CSRF, correlation IDs, URL encoding, JSON/204/blob/multipart,
malformed success payloads, problem details, rate limits, aborts, uncertain mutations, session
expiry, and EventSource connect/reconnect/malformed-event behavior.
