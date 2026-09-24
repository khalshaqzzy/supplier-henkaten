# ADR 0037: Boundaries for local QA finding remediation

- Status: Accepted
- Date: 2026-09-24

## Context

The 24 September local browser QA recorded twelve findings across source governance, authentication, Line–Shift operations, and portal read models. Several fixes cross API and UI boundaries. The original 47-scenario outcomes are historical evidence and do not become passing outcomes merely because a code fix or automated regression passes.

## Decision

1. Hosted-to-External cutover deactivates the prior Supplier Admin in the cutover transaction. Starting Hosted Preparation on an External supplier defensively deactivates any remaining active Supplier Admin and revokes that account's sessions and push subscriptions before creating the preparation Admin. A previously used supplier username remains reserved; a duplicate receives a field-specific conflict.
2. Supplier Admin reset and replacement use the Supplier aggregate version returned by its detail API. They do not use the Admin User version.
3. Account login throttling counts failed attempts only, including unknown usernames. A successful login clears the account failure bucket. Existing per-IP limits and the database's five-failure, 15-minute lockout remain in force. No stricter account threshold is introduced.
4. Clone prefill validates the current selectable Line–Shift and assigned active Job. Historical ShiftRun state is not a validity condition for a new occurrence. Protected photo endpoints permit same-site embedding while retaining authorization and private caching.
5. UI mutations update or invalidate the exact query keys used by their detail and list views. Warning detail carries a human-readable identifier alongside the internal routing ID. Supplier pagination uses the API cursor. Supervisor approval controls require the current responsible member; the API remains authoritative.

## Consequences

No database migration or new notification event is required. The API contracts and generated client change for public Supplier principal member ID, clone prefill Line–Shift ID, and warning display identifier. The reroute notification decision is recorded separately in ADR 0036.

Automated unit, integration, and isolated browser regressions establish code behavior. A subsequent browser rerun may separately update QA outcomes for the already observed steps; it must preserve the original evidence and must not continue the unexecuted QA branches.
