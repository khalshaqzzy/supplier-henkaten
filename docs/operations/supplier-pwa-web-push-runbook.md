# Supplier PWA and Web Push Runbook

## Scope and Invariants

Supplier Web Push is best-effort. The in-app Notification center is authoritative; never repair a
push incident by changing Henkaten, approval, assignment, or Notification read state. Never log or
copy subscription endpoint, `p256dh`, `auth`, VAPID private key, session, or payload containing PII.

## Environment Readiness

Set `PUSH_ENABLED=true`, a stable environment-specific VAPID public/private pair,
`PUSH_VAPID_SUBJECT` (`mailto:` or HTTPS), exact/suffix vendor host allowlist, and bounded delivery
TTL/attempt/batch/poll values. Staging and production must use different pairs. Validate runtime
env, Compose, PWA manifest/worker/icons, CSP, non-stale HTML/manifest/worker headers, immutable
hashed assets, and release SHA before device testing.

## Device Activation

Use current/previous Chrome or Edge on desktop/Android. On iOS/iPadOS 16.4+, first install through
Share → Add to Home Screen and open from that icon. Permission must follow the explicit “Aktifkan
push” gesture. If denied, reset the site notification permission in browser/OS settings, reload,
and activate again. Line Leaders remain operationally blocked until the current installation is
active; other supplier roles are optional.

## Triage

1. Confirm in-app Notification exists. If absent, investigate outbox/Notification generation—not
   push delivery.
2. Confirm `PUSH_ENABLED`, release identity, worker registration, permission, and current-device
   status via Account without exposing endpoint/key material.
3. Review aggregate delivery states and safe failure classes. `ACCEPTED` is vendor acceptance only.
4. Rising 404/410 indicates expired endpoints and should automatically expire subscriptions;
   instruct users to reactivate. Rising 429/5xx/network classes should retry within bounds; check
   vendor status and egress/DNS. Other 4xx/config/auth classes require configuration correction.
5. Verify server clock, TTL, queue age, and worker process health. Do not replay expired rows by
   editing the database; create a new in-app event only through the real domain workflow.

## Key Compromise or Rotation

Disable push, rotate to a new environment-specific VAPID pair in the secret store, deploy, and
revoke existing active subscriptions. Notify supplier operators that every device must explicitly
re-subscribe. V1 has no silent old-key fallback. Treat any exposed endpoint/key/payload as a
security incident and preserve only redacted evidence.

## Logout, Account, and Shared-device Issues

Logout should revoke server installation first and then browser subscription. Password reset,
role/user/supplier/source-mode/preparation changes revoke affected server subscriptions. If a
shared browser shows the previous user’s status, log out, clear the site worker/storage, log in as
the intended user, and activate; endpoint reassignment cancels pending deliveries for the old
owner.

## Service-worker Recovery and Rollback

When a worker or cached shell is suspected, verify `/sw.js`, `/manifest.webmanifest`, and HTML have
non-stale headers and match the deployed release. Ask the user to finish or discard active form
work, then apply the offered update. If still broken, disable push, unregister the service worker
and clear site data, reload online, sign in, and reactivate. Code rollback is allowed only across
the additive schema; never run a down migration. Push can be disabled independently while the
Notification center and Henkaten lifecycle continue.

## Required Staging Rehearsal

Test Android Chrome/Edge and iPhone/iPad Home Screen PWA in foreground, background, and app-closed
states; granted/denied/reset permissions; deep link with active and expired session; logout;
multi-device; shared-browser reassignment; expired subscription; delayed delivery; worker update;
offline fallback; and Line Leader blocked-before/usable-after activation. Record device/OS/browser,
release SHA, timestamps, safe delivery state, screenshots without PII, and pass/fail owner.
