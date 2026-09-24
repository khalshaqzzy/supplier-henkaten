# ADR 0036: No in-app notification for Supervisor reroute

- Status: Accepted
- Date: 2026-09-24

## Context

The local browser QA found that rerouting a pending Supervisor approval changed the responsible member and wrote an audit entry, but did not notify the new Supervisor. The QA scenario expected a notification. The PRD defines notifications for several Henkaten events but does not list Supervisor reroute as a trigger. The former Supervisor also saw an enabled approval action; that separate UI defect remains.

## Decision

Supervisor reroute does not generate an in-app notification. The authoritative approval route and pending-work surfaces determine who may act. The reroute must remain audited. The previous owner must not be offered an approval action, and the API must continue rejecting their decision.

## Rationale and alternatives

The product owner confirmed that notification delivery is not required for this action. Creating a new outbox/notification event would add delivery and deduplication behavior outside the agreed product contract. The alternative of notifying only on selected reroutes was rejected because no such condition was requested or defined.

## Implementation direction and consequences

No application event or notification changes are needed for the missing-notification observation F-10. The S-08 QA oracle is updated to require route ownership, audit, and authorization, without a notification assertion. The original QA observation remains in its report, with an explicit later disposition. The stale former-owner approval button F-11 is independently actionable.

## Validation and follow-up

When F-11 is repaired, verify the new owner can decide, the former owner has no enabled action and still receives 403 from a direct decision request, and the reroute audit exists. This validation is limited to the previously observed reroute flow. If notification policy changes later, amend this ADR, PRD event list, and QA oracle together.
