# ADR 0023: Purpose-aware Session and Cache Boundaries

- Status: Accepted
- Date: 2026-07-24

## Context

A Supplier identity may have a normal operational session or a restricted Hosted Preparation
session. Both realms use cookie sessions, while React Query and browser memory can outlive route
changes. Treating route visibility as authorization or retaining data after identity changes risks
cross-purpose and cross-tenant disclosure.

## Decision

Session responses provide authoritative capabilities, purpose, expiry, and Supplier context.
Backend capability derivation denies operational routes during Hosted Preparation; the frontend
uses the same response only for navigation and early route guards.

All query keys include realm, user ID, Supplier ID where applicable, and session purpose. TMMIN
global-monitoring keys always include its realm and principal ID even when no Supplier filter is
selected. Logout, expiry, principal change, Supplier change, or purpose change clears:

- React Query caches;
- CSRF memory;
- form/draft memory;
- one-time credentials;
- unused idempotency intents;
- intended destinations.

Intended destinations are temporary relative paths, must remain in the current realm, and never
contain credentials. `/design` stays outside session and API bootstrap.

## Consequences

- Hosted Preparation exposes Setup, Master Data, Default Assignment, Account, and Logout only.
- A capability-hidden route still relies on backend denial.
- Session restoration is deterministic across refresh, forced reset, expiry, and identity changes.
- Sensitive browser state is deliberately non-persistent.

## Validation

Foundation tests cover public `/design`, intended-path sanitization, forced reset, capability
navigation, purpose restriction, realm isolation, cache clearing, and unsupported viewport logout.
Backend policy and integration tests verify preparation and TMMIN Quality mutation denial
independently of React.
