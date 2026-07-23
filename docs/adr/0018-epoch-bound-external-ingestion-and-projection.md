# ADR 0018: Epoch-bound External Ingestion and Projection

- Status: Accepted
- Date: 2026-07-23

## Context

External suppliers must report Henkaten state without receiving Hosted workflow access or sending
Hosted personnel data. Supplier systems need retry-safe single and batch delivery, while TMMIN needs
one current warning/dashboard view and immutable evidence of what was received. Source-mode cutover
must invalidate the previous integration immediately.

The deployment topology is one API instance per environment with PostgreSQL as the only durable
state service. Redis, a message broker, and a separate OAuth provider are outside the accepted
topology.

## Decision

Use TMMIN-managed external clients bound to exactly one supplier, source epoch, fixed ingestion
scope, and optional IP allowlist.

- Client secrets are random, shown once, and stored only as Argon2id hashes. Rotation permits at
  most two simultaneously valid secrets.
- Authentication exchanges a client ID and secret for a random opaque bearer token. Only a SHA-256
  token digest is stored; the token expires after 15 minutes.
- Every token request and ingestion authenticates the current client, supplier active state,
  `EXTERNAL` source mode, source epoch, scope, revocation state, expiry, and allowlist.
- The public event schema is strict, category-discriminated, versioned as `1.0`, and excludes Hosted
  personnel and credential fields.
- Raw accepted events are immutable. Their uniqueness boundary is
  `(supplierId, sourceEpoch, eventId)`, with a SHA-256 hash of canonical JSON for retry comparison.
- A projection is unique by `(supplierId, sourceEpoch, sourceHenkatenId)` and advances through
  contiguous source versions. Version 1 must open the Henkaten; terminal states cannot advance.
- Raw evidence, projection, warning state, audit, freshness, and outbox event commit in one
  serializable transaction per event.
- Batch ingestion validates and commits each item independently, orders valid items per source, and
  preserves input-order results.
- Hosted and External warnings share `WarningInstance`, which has a database constraint requiring
  exactly one source relation. External projections never appear on the Assignment Board.
- Token and ingestion limits use keyed in-process counters because the accepted runtime has one API
  instance. The keys are HMAC digests rather than raw client/IP identifiers.

## Rationale

Source epochs make cutover a cryptographic authorization boundary without deleting history. Opaque
stored-hash tokens support immediate revocation without introducing signed-token key management.
Immutable raw events preserve traceability, while a bounded current projection avoids replaying
history for every dashboard read.

Per-item transactions make a malformed batch item independent from valid work and keep lock
duration bounded. Database uniqueness plus post-transaction duplicate reconciliation gives
deterministic behavior when identical first deliveries race under PostgreSQL serializable snapshot
semantics.

## Alternatives Considered

### Long-lived client secret on every ingestion request

Rejected because it expands secret exposure and makes immediate token-level revocation and short
authorization lifetime unavailable.

### Stateless signed access tokens

Rejected because source cutover and client revocation would require a revocation list or tolerate
stale authorization until expiry. Opaque token lookup is simple at the accepted scale.

### Replace the raw event with only the current projection

Rejected because idempotency disputes, ordered transition evidence, and audit traceability require
the original accepted representation.

### Whole-batch transaction

Rejected because one invalid or conflicting item would roll back unrelated supplier events and
large batches would hold locks for too long.

### Shared distributed rate-limit store

Deferred until the topology uses multiple API replicas. Adding Redis solely for counters would
violate the locked infrastructure boundary.

## Consequences

- A source-mode change invalidates old clients and tokens through epoch mismatch even before
  explicit revocation cleanup completes.
- PostgreSQL retains raw external history permanently; capacity and retention must be observed.
- In-process rate counters reset on process restart and are correct only for the single-instance
  topology.
- Batch calls consume one request token regardless of item count, while the strict 500-item and
  5 MiB bounds cap amplification.
- External notification recipients are TMMIN Admin users; supplier External users have no web
  identity or notification endpoint.

## Validation

- Contract tests cover all 4M payload variants, strict-field rejection, status/decision consistency,
  and batch bounds.
- PostgreSQL integration tests cover one-time secrets, token issuance, exact retry, hash conflict,
  version gaps, terminal projection, immutable raw evidence, partial batches, warning closure,
  TMMIN reads, notification delivery, concurrent identical delivery, and immediate revocation.
- Fresh migration creates credential, token, raw event, projection, warning relation, indexes, and
  the append-only trigger.
- OpenAPI is generated from the same Zod schemas used by runtime validation.

## Follow-up Work

- Measure rate-limit and ingestion latency under the compact representative workload.
- Revisit rate-counter coordination before adding a second API replica.
- Version the public schema rather than breaking `1.0`.
