# Session Handoff — Browser Henkaten Mutation CORS Recovery

Date: 2026-09-04

Branch: `fix/submit-approve`

Status: implementation and local browser verification complete. Browser submission and approval
decisions can cross the Supplier-web/API origin boundary again. Phase 15.9 remains `in_progress`.

## 1. Objective and Root Cause

- Reproduce the inability to submit, approve, or reject Hosted Henkaten after `pnpm local:reseed`.
- The seeded database, current Shift Run, checklist, responsibility routes, and backend lifecycle
  were valid: direct API submission, Supervisor approval, and QC rejection all returned success.
- The browser stopped every idempotent mutation during CORS preflight. Supplier web sends the
  required `Idempotency-Key`, but the API omitted that header from `Access-Control-Allow-Headers`.
- The defect was cross-cutting rather than seed-specific and could affect every cross-origin
  idempotent browser mutation, including End Shift, emergency start, Withdraw, and reroute.

## 2. Implementation Completed

- Added `Idempotency-Key` to the API CORS allow-header contract.
- Upgraded the Hosted lifecycle browser journey so Henkaten submission, Supervisor approval, and
  Supervisor rejection are performed through the rendered Supplier UI. Existing direct API checks
  continue to cover QC final approval, QC reject-fast, concurrency, idempotency, and lifecycle
  side effects.
- Preserved the public API, database schema, workflow policy, seed shape, and authorization model.

## 3. Verification

- `pnpm local:reseed` completed with two Hosted suppliers and 240 seeded Henkaten.
- Before the fix, browser submit reproduced the generic uncertain-mutation error and no POST reached
  the API; preflight response omitted `Idempotency-Key`.
- After rebuilding the local stack, preflight returned HTTP 204 with `Idempotency-Key` allowed.
- Manual browser verification passed end to end: Line Leader submitted
  `HEN-NPM-20260904-0014`, Supervisor approved its route, and QC rejected the remaining route; the
  final record was `REJECTED` with immutable decision evidence.
- Format, ESLint, full TypeScript, all 181 Vitest tests plus two Node tests, and the production build
  with explicit `VITE_API_ORIGIN` passed. The first build invocation correctly stopped at the
  repository's required-origin guard; the CI-equivalent invocation passed.
- All four isolated Chromium journeys passed. The Hosted lifecycle journey exercised UI submit,
  Supervisor approve, and Supervisor reject with real cross-origin preflight; every disposable E2E
  PostgreSQL container, network, and volume was removed by the harness.
- A final `pnpm local:reseed` restored the clean two-supplier/240-Henkaten baseline and rotated away
  the temporary diagnostic passwords and records.

## 4. Next Recommended Action

1. Commit and deliver `fix/submit-approve` after final regression checks.
2. Keep Phase 15.9 open until the next hosted staging deployment is green.

---

# Previous Handoff — Stable Responsive Canvas Camera dan Fullscreen

Date: 2026-08-19

Branch: `fix/canvas-viewport-ux`

Status: implementation dan local browser verification complete. Canvas camera tidak lagi berpindah
ke koordinat node setelah drag, editor mempertahankan atau menyesuaikan view secara responsif, dan
fullscreen memakai seluruh workspace. Phase 15.9 tetap `in_progress`.

## 1. Objective and Locked Decisions

- Keep camera state ephemeral per line/page session and separate from persisted layout/draft state.
- Use full-canvas contain fit on the limiting measured viewport axis, including scales below 25%
  when required to prevent clipping.
- Keep explicit Hand mode available in read/edit views, with temporary Space pan when the focusable
  Canvas viewport owns keyboard interaction.
- Fullscreen the complete workspace so toolbar and editing panels remain available; restore the
  prior normal camera on exit.
- Preserve the existing layout document, API, authorization, database, and mobile read-only model.

## 2. Implementation Completed

- Fixed the primary camera jump: bubbled node `dragend` events are ignored by the Stage camera
  handler instead of storing node coordinates as Stage coordinates.
- Replaced the fixed 720 px Stage and separate position/scale state with a measured two-axis
  viewport and unified camera helpers for fit, resize, zoom anchor, and recoverable pan bounds.
- Initial fit now runs once per line; node changes, save, and edit re-entry no longer reset the
  camera. A shrinking editor viewport scales down only when needed to retain a previously complete
  view; manual work views preserve their logical center.
- Added Hand/Select mode, temporary Space pan, pointer-centered wheel zoom, viewport-centered button
  zoom, grab cursors, keyboard focus semantics, and a visible focus ring.
- Fullscreen now targets the Canvas shell, measures after `fullscreenchange`, maximizes the complete
  logical canvas in the remaining viewport, keeps toolbar/palette/inspector available, and restores
  the normal camera after exit without a ResizeObserver race.
- Limited editing availability to desktop and tablet-landscape media conditions while retaining
  read-only pan/zoom on smaller Canvas views.
- Extended unit/E2E coverage and synchronized PRD section 16.6, ADR 0031, and roadmap 8.3A.

## 3. Verification

- Repository formatting, lint, full TypeScript, all 183 unit tests across seven projects plus scripts,
  production builds, and `git diff --check` passed.
- Supplier Web unit suite passed: 47 tests across 10 files. New camera evidence covers sub-25% fit,
  fullscreen-axis maximization, logical-center resize, pointer-anchored zoom, and pan recovery.
- Production Supplier Web builds passed through the E2E harness with the required API origin; the
  lazy BoardCanvas chunk remains separate at approximately 457 kB minified / 136 kB gzip and the
  PWA precache remains 26 entries without machine PNG precaching.
- Full Chromium E2E passed all four isolated journeys. Hosted coverage proves node drag does not
  move the camera, Hand and Space pan work, fullscreen expands/restores, save succeeds, responsive
  screenshots have no document overflow, and Axe reports zero violations.
- Pre-commit parity additionally passed `pnpm install --frozen-lockfile`, `pnpm openapi:check`,
  `docker compose config --quiet`, and the migration-backed API integration suite (38/38). The first
  integration attempt exposed the known push retry timing race (`attemptCount` observed before the
  worker claim); a clean database reset and complete repeat passed without source changes.
- Edge passed both tagged governance/onboarding journeys. Gitleaks v8.24.3 directory mode scanned
  the complete worktree and found no leaks; `git diff --check` remained clean.
- Every E2E-owned PostgreSQL container, network, volume, app process, and temporary resource was
  removed by the harness. The pre-existing local full-stack PostgreSQL service was restored after
  the disposable integration reset so the user's running local services retain their prior state.

## 4. Next Recommended Action

1. Conduct manual pointer/touch UAT on the target shop-floor display and tablet landscape device.
2. Commit and deliver `fix/canvas-viewport-ux` after visual approval; no migration or deployment
   sequencing change is required.

---

# Previous Handoff — Polished Local Canvas Seed dan MP Portraits

Date: 2026-08-19

Branch: `staging`

Status: implementation dan local verification complete. Enam production line kini memiliki saved
Canvas version 1 yang siap demo, dan 24 assigned MP memakai empat portrait ImageGen fiktif secara
deterministik. Perubahan tetap development-only; Phase 15.9 tetap `in_progress`.

## 1. Objective and Locked Decisions

- Seed tiga saved line layouts per Hosted supplier melalui production Supplier Admin PUT endpoint,
  bukan direct Prisma insert, setelah live Shift Runs tersedia.
- Keep job/member/photo/assignment/4M content authoritative in the read model; layout JSON stores
  only stable job IDs and spatial/decorative configuration.
- Use the soft-isometric machine family for NPM and the simple 2D family for GKI, with equipment
  mappings locked per line.
- Generate exactly four fictional Indonesian operator portraits as separate ImageGen assets and
  reuse them by `mpIndex % 4`; each line gets four distinct faces, while three reserve MPs per
  supplier retain initials fallback.
- Preserve the seven synthetic PNG role avatars and keep all generated portrait assets out of the
  frontend bundle, PWA cache, and production API runtime image.

## 2. Implementation Completed

- Added four tracked, normalized JPEG portraits plus a provenance/prompt manifest under
  `scripts/assets/local-seed/mp-portraits/`. Each asset is sRGB JPEG, 768x1024, metadata-stripped,
  quality 88, and below 2 MiB.
- Added a pure deterministic Canvas factory that schema-validates a 2400x1350 document containing
  locked production zones/header and editable machines, arrows, and four live job slots.
- Added deterministic Canvas specifications for all six lines and their exact machine mappings.
- Generalized the internal local-seed upload helper for buffer, filename, and MIME type so role
  avatars remain PNG while MP portraits use JPEG.
- Added endpoint-driven creation of three layouts per supplier, strict post-seed reconciliation,
  photo-checksum reuse counts, audit-count, and outbox-health verification.
- Extended the existing local-seed and Canvas ADRs and the implementation roadmap; no migration,
  endpoint, OpenAPI, production fixture fallback, or Phase 15.9 status change was introduced.

## 3. Verification

- Portrait asset validation and Canvas factory unit coverage passed, including deterministic
  mapping, unique IDs, bounds, strict schema, one job slot per live job, and equipment families.
- Full format, lint, typecheck, unit, OpenAPI, production build, PostgreSQL 18 migration, integration
  (38 tests), and Playwright Chromium/Edge suites passed.
- Clean `local:start:clean` and `local:reseed` both completed with two Hosted suppliers and 240
  Henkaten; the reseed preserved the test database.
- Post-seed checks proved six version-1 layouts, four reconciled job slots per layout, six
  `BOARD_LAYOUT_CREATED` audits, 19 current photos per supplier, each generated portrait referenced
  six times globally, and a healthy outbox.
- Browser QA passed at 390x844, 768x1024, 1280x720, and 1672x941: portraits crop naturally, nodes do
  not overlap, mobile remains read-only, desktop/tablet editing remains available, and no document
  overflow was present.

## 4. Next Recommended Action

1. Review the tracked ImageGen portraits and seeded Canvas composition in the local supplier portal.
2. Commit the implementation when the visual direction is approved; keep the assets explicitly
   documented as fictional, synthetic, and local-demo-only.

---

## Previous Handoff — Staging CI DNS Preflight Recovery

Date: 2026-08-19

Branch: `staging`

Status: the staging CI failure in run `32104023080` was traced to missing public DNS records for
all three locked staging domains. The Cloudflare zone contained malformed records with the zone
name duplicated; correct DNS-only A records now point to `34.177.111.165`. Phase 15.9 remains
`in_progress` until the post-fix staging deployment is green.

## 1. Objective and Root Cause

- All application, database, E2E, security, container, routing, and Trivy gates passed for SHA
  `cd9c23d5bf13c5c4d62cba391bde527d5a5e7575`.
- `Deploy staging / Deploy under remote lock` exited with status 2 immediately after runtime-env
  validation because `getent ahosts` returned no result inside a command substitution governed by
  `set -euo pipefail`. This bypassed the intended actionable DNS error.
- Direct inspection of `34.177.111.165` confirmed Ubuntu 22.04, healthy Docker/Compose, healthy
  prior-release containers, reachable ports 22/80/443, and no public records for the locked domains.
- Cloudflare held malformed names such as
  `supplier-henkaten.qd-tmmin.site.qd-tmmin.site`; these do not answer the required hostname.

## 2. Changes and Operational Recovery

- Moved the DNS resolver helper into `deploy/scripts/lib.sh` and made failed lookups return an empty
  result so `remote-preflight.sh` reaches its explicit VM/domain resolution errors.
- Added a deployment-harness regression proving exit status 2 from `getent` cannot terminate the
  resolver call prematurely.
- Full-suite parity also exposed a sub-millisecond push-delivery race: PostgreSQL `now()` is fixed
  at transaction start while newly inserted delivery timestamps are millisecond-rounded. Due and
  lease comparisons now use `clock_timestamp()` so the worker evaluates the actual statement time.
- Created DNS-only A records for `supplier-henkaten.qd-tmmin.site`, `henkaten.qd-tmmin.site`, and
  `supplier-henkaten-api.qd-tmmin.site`, all targeting `34.177.111.165` with TTL 300.
- Pruned only unused Docker build cache on the staging VM. This reclaimed 16.04 GB; active
  containers and persistent data were not touched. Free disk increased from about 5 GiB to 20 GiB.
- The refreshed Trivy database reported CVE-2026-14456 in the OpenSSL runtime package. Debian has
  no fixed package and marks the Debian 13 equivalent fix deferred; an exact, expiring exception
  is registered because exploitation requires a QUIC server while the API is TCP HTTP behind Caddy.

## 3. Verification

- `bash -n deploy/scripts/*.sh deploy/tests/*.sh` passed.
- `pnpm run test:deployment` passed.
- Clean-worktree format, lint, typecheck, unit, OpenAPI, production build, migration, integration
  (38 tests), and Playwright Chromium/Edge suites passed.
- ShellCheck v0.11.0 using the workflow-pinned image passed.
- `git diff --check` passed.
- Both authoritative Cloudflare nameservers and the staging VM resolver answer all three staging
  domains with `34.177.111.165`. Re-running the failed release candidate's remote preflight then
  passed every DNS and host-identity check.
- The production-like five-service stack passed exact routing, headers, non-root, bootstrap
  idempotence, restart, and persistence checks. Trivy 0.70.0 filesystem and all five image scans
  passed with the exact exception registry.

## 4. Next Recommended Action

1. Commit and push the guarded-preflight, worker-clock, and security-registry changes to `staging`.
2. Inspect the resulting GitHub Actions run through deployment and external smoke verification;
   keep Phase 15.9 open unless every required job is green.

---

## Previous Handoff — Customizable Assignment Board Canvas

Date: 2026-08-18

Branch: `feat/canvas-board`

Status: the versioned per-line Assignment Board Canvas is implementation- and local-verification-
complete and delivered on `feat/canvas-board`. No staging deployment or UAT claim has been made.
Phase 15.9 remains `in_progress`.

## 1. Objective and Locked Decisions

- Preserve the current Assignment Board as the default, canonical mobile/accessibility fallback.
- Add an explicitly selected, single-line Canvas using the hybrid editor/spatial/card direction
  approved in planning.
- Keep layout shared by line and independent of user, Line Leader turnover, and Shift Run.
- Keep Working Assignment and Henkaten lifecycle authoritative; layout JSON must not persist member
  name, registration number, photo URL, assignment state, or Henkaten content.
- Render MP photos on job cards when available and initials only when the live thumbnail is absent or
  fails to load. Render only the four Man/Machine/Material/Method dots as a legend.

## 2. Implementation Completed

- Added strict shared Canvas contracts for bounds, transforms, `JOB_SLOT`, curated machine,
  rectangle, outline, arrow, and text nodes, document/node limits, optimistic save, response, and
  reconciliation metadata.
- Added `LineBoardLayout` and forward-only migration `20260817001100_assignment_board_canvas` with
  supplier/line uniqueness, schema/version, audit actors, and timestamps.
- Added Supplier GET/PUT and TMMIN Hosted read-only GET endpoints, capability wiring, OpenAPI 3.1,
  and generated clients. Supplier Admin and the active Line Leader can edit; Supervisor, QC, other
  roles, and TMMIN are read-only. PUT remains Hosted-only.
- Added deterministic generated layout and reconciliation: every active included job appears once,
  new jobs enter the overflow grid, inactive slots leave runtime output, decorative nodes survive,
  and existing job coordinates remain stable when live assignment/photo/4M data changes.
- Added transactional optimistic save, redacted node-count audit, safe
  `BOARD_LAYOUT_UPDATED` outbox event, and realtime `assignment-board-layout` invalidation.
- Added lazy `konva@10.3.1` / `react-konva@19.2.5` Canvas with viewport Stage, non-listening grid
  layer, interactive layer, pan, 25–200% zoom, fit, fullscreen, snapping, 50-step undo/redo,
  explicit draft/save/discard/conflict flows, resize/rotate/lock/reorder/duplicate/delete rules,
  numeric Canvas/node properties, Layers DOM, keyboard movement, and reset auto-layout.
- Required job cards cannot be deleted, duplicated, or rotated. Generated/reset cards are vertical
  (`300 x 440`) and use the cover-cropped portrait MP photo as their dominant area, with
  credentialed image loading and initials fallback. They also render live job name, MP
  name/registration, direct state text/icon/border, and current 4M dots.
- Added two generated transparent machine families: twelve polished soft-isometric cutouts and
  twelve simple generic 2D icons. The 24-entry typed manifest carries distinct stable keys,
  style-aware labels, ImageGen source, aspect ratio, default size, and accessible description. All
  assets have alpha; the simple 2D family is optimized to a maximum 512 px dimension.
- Machine PNGs and the Konva editor are loaded only with the lazy Canvas route chunk. Machine PNGs
  are excluded from the PWA shell precache and remain network-on-demand.
- Added URL-backed `Default | Canvas` toggle, single-line selection, dirty-state confirmations,
  mobile read-only Canvas behavior, risk rail retention, and 4M-only legend on both views.
- Final QA fixed tablet document overflow by containing the Stage's intrinsic inline size and using
  a viewport-bounded initial measurement. Arrow selection now exposes explicit left/right endpoint
  handles.
- Portrait-card follow-up QA found a separate 768 px intrinsic-width issue in the board toolbar.
  Tablet toolbar items now wrap, the metric grid uses zero-min tracks, and the Hosted Canvas journey
  again passes every responsive viewport without document overflow.
- Added ADR 0031 and updated PRD/roadmap. Security dependency pins now resolve the current nanoid and
  deepmerge-ts high-severity advisories.

## 3. Verification Completed Locally

- Clean 11-migration deploy on the disposable PostgreSQL 18/pgvector test database passed.
- All 38 API integration tests passed. New evidence covers generated/saved layouts, active Line
  Leader and Admin editing, Supervisor/TMMIN read-only access, version conflict, reconciliation,
  redacted audit, and outbox payload.
- Repository unit tests passed after the final dependency update: contracts 36, API 46, API client
  11, UI 19, fixture 6, TMMIN web 12, and Supplier web 42.
- Follow-up 2D asset validation confirmed all twelve files have transparent corner alpha, unique
  style-aware catalog labels, closed-contract keys, and successful Contracts/Supplier unit,
  Supplier/E2E TypeScript, targeted lint, OpenAPI regeneration/check, and production build checks.
- Formatting, lint, full TypeScript, OpenAPI document check, generated-client regeneration,
  production build, frozen lockfile install, Compose config, and `git diff --check` passed.
- Production build emits a separate `BoardCanvas` chunk (about 452 kB minified / 134 kB gzip). PWA
  precache remains 26 entries / about 2.51 MiB and excludes all 24 machine PNGs, which remain lazy
  network assets.
- Final Chromium passed all four isolated journeys after the 768 px overflow correction. The Canvas
  journey saves as active Line Leader, reads as Supervisor, verifies default fallback, and captures
  responsive evidence at 390×844, 768×1024, 1024×768, 1280×720, 1440×900, and 1672×941 with reduced
  motion, zero document overflow, responsive navigation assertions, and zero axe violations. Edge
  smoke passed both tagged journeys; every E2E-owned database, process, network, volume, and photo
  root was cleaned by the harness.
- The 2026-08-18 portrait-card follow-up reran formatting, lint, full TypeScript, all repository unit
  tests, production build, migration-backed Hosted Chromium E2E, axe, reduced-motion, and the full
  responsive screenshot matrix. Governance Chromium passed before the toolbar diagnostic; Hosted
  Chromium passed after the final wrap/min-track fix. The Edge-only harness correctly had no Hosted
  journey because that spec is not tagged for Edge; no browser-specific application branch changed.
- Codex Security diff scan `294aa57f-73ec-453d-a727-c12311e1f2c4` reviewed the complete 27-file
  source inventory with complete coverage and no reportable findings. The final endpoint-handle and
  responsive-containment refinement was additionally reviewed as a UI-only diff and revalidated by
  typecheck, unit tests, production build, and full Chromium E2E.
- Security exception validation and `pnpm audit --audit-level high` passed (only the registered high
  exception remains ignored; two moderate advisories remain below the configured threshold).
  Gitleaks v8.24.3 directory scan passed after the pre-existing git-ignored staging key was moved to
  a temporary directory without reading it and restored immediately afterward.
- Deployment environment validation and script harness passed; local macOS lacks `flock`, so Linux
  lock contention remains a CI-only check. The new migration also passed a direct forward-only SQL
  scan because the repository helper cannot see an untracked migration until it is staged.
- CI PR #12 run 32101378423 failed at the Caddy image Trivy scan due to 7 Go stdlib vulnerabilities
  in Go v1.25.12. Upgraded `deploy/caddy/Dockerfile` builder image to `golang:1.25.13-alpine@sha256:1e0126852075c9c60731c8ba49088448b91f63e2aed97ca9d1a9791622a05946`
  with explicit `main.go` and `go mod tidy`. Hadolint, deployment validation, deployment test harness,
  security exception check, remote Compose Caddy build, and Trivy image vulnerability scan all passed locally with 0 findings.
- E2E-owned processes, containers, networks, volumes, and temporary photo roots were removed. The
  existing local PostgreSQL container predated this task and remains untouched.

## 4. Delivery Notes

- Commit-state OpenAPI/generated-client parity is required and was rerun after the delivery commit.
- No user upload/media-storage API is included in the v1 machine catalog.
- The TMMIN endpoint exposes the same reconciled Hosted layout read-only; TMMIN UI continues using
  its existing operational board while the API is available for monitoring integration.

## 5. Next Recommended Action

1. Commit and push the Caddy builder fix to `feat/canvas-board` to re-trigger PR #12 CI.
2. Verify all CI jobs (including Production containers and routing & Release candidate gate) are green.
3. Deploy to staging under the existing Phase 15.9 process and conduct touch-device UAT before any
   production claim.
