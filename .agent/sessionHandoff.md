# Session Handoff — Staging CI DNS Preflight Recovery

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
