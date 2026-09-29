# ADR 0042: TMMIN Admin access to Hosted Supplier portal

- Status: Accepted
- Date: 2026-09-29

## Context

TMMIN Admin needs to inspect and operate a Hosted supplier's portal using its Supplier Admin capability. The two portals have separate identity realms and session cookies. Reusing a supplier password or emailing a sign-in link would expose credentials and notify the supplier. A cross-realm transition needs a limited, auditable exchange.

## Decision and rationale

The supplier detail page issues a two-minute, high-entropy bearer link only to an authenticated TMMIN Admin for an active Hosted supplier with an active Supplier Admin. The token hash, supplier, target admin, TMMIN actor and actor session, source epoch, expiry, and consumption time are persisted. The raw token appears only in the response and the Supplier URL fragment. The Supplier page clears the fragment before posting it to the API. A conditional database update consumes the token once, including under concurrent redemption. The exchange creates a new Supplier session tagged with the TMMIN actor and actor session. The session is rejected when the actor, target, supplier, source epoch, or initiating TMMIN session becomes invalid. The Supplier UI identifies the TMMIN actor. Password change is unavailable in this session. Link creation and redemption are recorded as TMMIN audit events; no notification or outbox event is written.

This retains the existing Supplier authorization model while making the entry point and actor visible. A new table provides durable replay protection across API instances. The feature does not alter the Supplier Admin password or the one-active-admin invariant.

## Alternatives considered

- Sharing the TMMIN cookie across realms was rejected because it would blur authorization boundaries.
- Signing a stateless token alone was rejected because it cannot guarantee single use across instances.
- Sending a password reset or link to the supplier was rejected because the operator needs an immediate administrative session without a supplier notification.

## Consequences and risks

The bearer link grants Supplier Admin access during its short lifetime, so it must remain out of logs, query strings, and referrers. Existing Supplier sessions in the browser may be replaced when the link is redeemed. The database gains one forward-only migration and retains consumed link records for audit; a retention cleanup can be added later. Supplier mutations continue to use the Supplier Admin authorization role; the initiating TMMIN actor is recorded on session and exchange audit events. A future audit improvement can include the initiating actor on every downstream Supplier mutation.

## Validation and follow-up

Integration coverage checks atomic one-time redemption, session identity, forbidden password change, untrusted origin, revoked actor session, and unchanged supplier notification count. Browser coverage checks the cross-portal button and replay failure. Verify migration upgrade, contract generation, seed compatibility, and CI/security gates before delivery. Staging acceptance should repeat cross-domain cookie and fragment handling on HTTPS.
