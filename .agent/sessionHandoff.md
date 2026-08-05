# Session Handoff — Responsive Supplier PWA and Web Push

Date: 2026-08-05

Branch: `feat/responsive-supplier-pwa-push`

Status: repository implementation and local automated verification are complete. Phase 15.9 remains
`in_progress`; no hosted staging deploy, real-device push, or Phase 16 UAT claim has been made. The
accepted desktop Supplier view remains the baseline at `>=1280px`.

## 1. Objective and Locked Decisions

Implement every Supplier workflow for mobile/tablet while preserving desktop, add an online-only
installable PWA, and add best-effort Supplier Web Push. Notification center remains authoritative.
NORMAL Line Leaders are hard-blocked per browser installation until push is active; Supplier Admin,
Supervisor, and QC are opt-in. TMMIN web and external credentials are unchanged.

Official breakpoints are mobile 360–767px, tablet 768–1279px, and desktop at least 1280px. Browser
targets are current/previous Chrome and Edge on desktop/Android plus iOS/iPadOS 16.4+ Home Screen
PWA. There is no offline domain data, draft, background sync, or queued mutation.

## 2. Implementation Completed in the Working Tree

- Responsive Supplier shell removes the unsupported viewport gate, adds mobile/tablet navigation,
  adaptive grids/forms/tables/board/dialog patterns and 44px targets while restricting layout
  overrides below 1280px.
- PWA uses Vite `injectManifest`, a custom TypeScript worker, stable root manifest, brand icons,
  network-first navigation/offline page, strict cache exclusions, safe push click handling,
  prompted updates, and offline status UI.
- Shared contracts/API client/OpenAPI add push config, create, and owner-only expected-version
  revoke plus `PUSH_SUBSCRIPTION_REQUIRED` and stable `X-Device-Installation-ID`.
- Additive Prisma migration adds PushSubscription/PushDelivery with endpoint/delivery uniqueness,
  lifecycle/failure metadata, and concurrency indexes.
- Backend validates VAPID/runtime bounds and vendor exact/suffix HTTPS endpoints; derives tenant,
  user, and installation from authenticated context; never returns endpoint/key material.
- Eligible durable Notifications materialize idempotent delivery rows. A PostgreSQL SKIP LOCKED
  worker implements VAPID send, TTL/attempt bounds, Retry-After, 404/410 expiry, accepted semantics,
  and safe failure logging. Push never mutates Notification/Henkaten lifecycle.
- Frontend Account/Notifications show device state, explicit activation/disable, iOS installation
  guidance, permission troubleshooting, and Line Leader activation gate. Backend independently
  enforces the same gate while exempting activation/session/password/logout paths.
- Logout and account/session/supplier/source lifecycle paths revoke affected server subscriptions;
  browser subscription is removed on logout/password change.
- Caddy/nginx, Compose/env validation, deployment smoke, three ADRs, and the operational runbook are
  updated for worker/manifest CSP, cache headers, VAPID, icons, and recovery.

## 3. Data and Contract Changes

- Migration: `20260805001000_supplier_web_push` is additive/backward-compatible. Do not create or
  run a down migration for rollback.
- API:
  - `GET /api/v1/supplier/push/config`
  - `POST /api/v1/supplier/push-subscriptions`
  - `DELETE /api/v1/supplier/push-subscriptions/:id`
- Authenticated Supplier requests carry `X-Device-Installation-ID`; body input never chooses user,
  supplier, or installation.
- Required environment: `PUSH_ENABLED`, environment-specific VAPID public/private/subject,
  `PUSH_ENDPOINT_HOSTS`, and bounded delivery TTL/max-attempt/batch/poll settings.

## 4. Verification Completed Locally

- Exact runtime Node.js 22.23.1, formatting, ESLint, TypeScript, generated OpenAPI/client, and
  production builds pass. The Supplier PWA build emits the manifest, `sw.js`, and a 24-entry static
  precache.
- Repository unit suite passes: 157 tests total, including 32 contracts, 44 API, 32 Supplier web,
  12 TMMIN web, 19 UI, 10 API client, 6 fixtures, and 2 script tests.
- PostgreSQL integration passes 37/37, including Line Leader blocking/activation, cross-user denial,
  shared endpoint reassignment, multi-device idempotency, concurrent claims, retry/expiry, and
  installation-scoped logout revocation.
- Fresh migration deploy passes all 10 migrations. Compact backend baseline passes 2/2; measured
  p95 remains below every configured target.
- Browser E2E passes all six isolated journeys: four Chromium plus the two `@edge` journeys in
  Microsoft Edge. Supplier checks cover 390×844, 768×1024, 1024×768, 1280×720, and 1672×941,
  including retained desktop UI, no document overflow, 44px menu target, Axe, deterministic
  screenshots, manifest/worker registration, offline fallback, and API/photo cache exclusions.
- Deployment environment/Compose validation and the deployment script harness pass all topology,
  first deploy, failure, lock, stale-run, rollback, atomic activation, and retention scenarios.
- Security exception registry is exact/unexpired; `pnpm audit --audit-level high` exits successfully
  with the repository's one ignored high advisory and two moderate advisories; `git diff --check`
  passes.

These checks are local evidence. Hosted HTTPS staging, actual vendor push delivery, real-device
Android/iPhone/iPad rehearsal, and Supplier Line Leader acceptance remain required launch gates.

## 5. Required Next Actions

1. Complete Phase 15.9/15.11 hosted staging baseline, provision a stable staging VAPID pair, then
   execute Android Chrome/Edge and iPhone/iPad Home Screen real-device rehearsal.
2. Verify actual vendor delivery, permission grant/deny/reset, app background/closed behavior,
   multi-device/logout/expiry, service-worker update/recovery, and deployed cache headers.
3. Start Phase 16 UAT only after responsive matrix, vendor push, redeploy/rollback, and Supplier
   Line Leader acceptance pass.

## 6. Operational Boundaries and Residual Risk

- Do not log/audit endpoint, `p256dh`, `auth`, payload PII, VAPID private key, token, or credential.
- Push `ACCEPTED` is vendor acceptance, not display proof. A failed push never changes domain state.
- VAPID rotation in v1 requires disabling/revoking old subscriptions and explicit re-subscription.
- Service-worker recovery and key-compromise response are documented in
  `docs/operations/supplier-pwa-web-push-runbook.md`.
- Existing no-backup/no-PITR/no-HA and automatic production deployment risks remain unchanged.
- Existing local containers/processes that predate this session must not be stopped as cleanup for
  this implementation.
