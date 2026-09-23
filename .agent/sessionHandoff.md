# Session Handoff — PCR indication for Henkaten

Date: 2026-09-23
Branch: `feat/ai-pcr`
Status: implemented and validated locally; prepared for PR to `staging`. No staging deployment or
UAT claim.

Hosted submissions now persist `PcrAssessment` in the creation transaction. External ingestion
refreshes assessment only when evidence changes. A separate leased worker uses the local Ling
OpenAI-compatible Chat Completions endpoint, a forced validated tool call and 8192 output tokens.
Low confidence, invalid output and failures move to Review. TMMIN Admin/Quality can correct with a
mandatory reason and optimistic version; a late worker cannot overwrite the correction. AI raw
output and confidence remain server-side; full English assessment appears only for current PCR.
Supplier and TMMIN have PCR tabs, priority pagination, indicators, and scoped notifications;
TMMIN also has review tabs and correction UI. Design A is applied to detail, submit waits on a
refresh-safe assessment screen, and active sidebar items are solid orange. The local seed includes
PCR/No-PCR/Review/manual examples while preserving 2 suppliers and 240 Henkaten.

Validation: formatting, lint, typecheck, unit suite, production build, 31 API integration tests on
a freshly migrated disposable database, and OpenAPI check passed. An isolated 240-record seed and
`pnpm local:reseed` completed; the main local database has 2 suppliers and 240 Henkaten (PCR 6,
No-PCR 230, Review 4). Browser review covered both portals, PCR/review tabs, detail assessment,
orange active navigation, and the TMMIN page title shortened to `Henkaten`. ADR 0034 and PRD
amendment define the decision boundary.

The valid gateway key was read without changing `dx-2`. The gitignored local `.env` now has the
public inference endpoint, model, key, threshold, timeout, and worker settings (file mode 0600).
All seven names were set as GitHub `staging` environment secrets through `gh`; the reusable deploy
workflow now validates and renders them into runtime env. Compose configuration and actual-key
runtime rendering were checked without printing values. The deployment script harness passes
locally. No key appears in tracked or nonignored new files. The local Compose stack was stopped
after verification without deleting the seeded database volume.
The separate inference report at `docs/reports/inference-server-403-2026-09-23.md` records the
user-provided successful Ling tool-call tests through `curl` and OpenAI JavaScript SDK and the
Python `urllib` Cloudflare 1010 result. PCR worker inference was not exercised end-to-end after
the request to stop investigating inference. Before activating on staging, evaluate Indonesian
cases with TMMIN QD. Generated OpenAPI/client content is current, and the staged-file drift check
passed.

Pre-PR local parity used Node 22.23.1, pnpm 11.16.0, frozen install, and cleaned build artifacts.
Format, lint, typecheck,
unit tests, OpenAPI drift, and production application build passed. A disposable Docker database
passed all 31 integration tests, fresh migration, and the upgrade from `origin/staging` migrations.
All three Chromium journeys passed after updating the Henkaten title selector. The local macOS
Edge installer requires sudo and could not install Edge; CI's Linux Edge journey remains the
browser gate. Actionlint, ShellCheck, Hadolint, deployment validation, and the deployment harness
passed, including the harness inside Linux with real `flock`. Five production images built and
passed routing, non-root, and restart persistence checks. Gitleaks v8.24.3 found no leaks; Trivy
v0.70.0 reported no HIGH/CRITICAL findings for the filesystem and all five production images.
The high-severity dependency audit exited successfully with the repository's existing exception.
Local ignored credentials were temporarily moved outside the scan path and restored. The PCR
worker was not sent a live inference request in this parity run.

The feature branch already contained four earlier commits absent from `origin/staging`: line
schedules, migration-policy repair, local seed repair, and UI typography rules. A PR from this
branch to `staging` includes those predecessors along with the PCR implementation. No existing
commit was rewritten.

---

# Previous Session Handoff — Compact Tanoko Matrix and Proficiency Enforcement

Date: 2026-09-16
Branch: `feat/tanoko`
Status: implemented and delivered on `feat/tanoko` as PR #16 against `staging`. The last remaining
release-gate failure, the Caddy runtime image scan, is fixed and locally verified pending the next
CI run. Phase 15.9 remains `in_progress`.

## Objective and decisions

- Implement the approved PDF-derived design A with the existing supplier navbar, left-aligned
  Matriks/Riwayat tabs, name-only clipped MP headers and right-side cell editor from design C.
- Keep the UI compact: 16px desktop content inset, 36px matrix rows, viewport-owned matrix scroll,
  sticky MP names and Line/Job/Kategori columns, sticky summary, no dashboard metric cards.
- Supplier Admin and every GL (SUPERVISOR) can edit any active MP/job within their supplier.
  LL and QC have read access only. Authorization is enforced by API capabilities and service checks.
- High/Medium/Low categorizes jobs visually; mastery levels 1–4 are independent. Missing mastery
  is unassessed. No MP employment categories, license, annual restrictions or extra criteria.
- Require level >=3 at Man submission and final atomic movement. A downgrade while approval is
  pending blocks movement; existing reservation and assignment checks remain in force.

## Seed follow-up verification

- `pnpm --filter @tmmin-henkaten/api exec vitest run src/cli/local-seed-plan.spec.ts`: 6 passed.
- API typecheck, targeted ESLint, Prettier check and `git diff --check`: passed.
- Full bootstrap + `local:seed` ran successfully against isolated Docker Compose project
  `tanoko-seed-check` (separate database/photo volumes and credentials output): 2 Hosted
  suppliers and 240 Henkaten; all existing and new post-seed invariants passed.
- SQL verified 12 default assignments per supplier, minimum level 3 for both suppliers.
  Mapping totals: level 1=50, level 2=42, level 3=159, level 4=56, explicit unassessed=2;
  51 additional pairs have no assessment. History includes 179 GL and 164 Admin entries.
- Temporary Compose stack and volumes were removed after verification. Existing local demo
  database and credentials were not reset. Updated seed applies on the next local reseed.

## CI follow-up — 2026-09-16

- PR #16 initially failed only in deployment-quality security-exception validation and the
  filesystem Trivy scan. The exception registry had three expired entries, while the lockfile
  contained patched advisories for `fast-uri`, `multer`, `mysql2`, and `sharp` that required
  current dependency resolutions.
- Updated `multer` to 2.4.0 and `sharp` to 0.35.4, and pinned safe override resolutions for
  `fast-uri` 3.1.6 and `mysql2` 3.22.0. The registry expiry dates now remain within the active
  review window. Local Trivy filesystem scan reports zero HIGH/CRITICAL findings and the exact
  exception validator passes.
- Production build, format, lint, typecheck, unit tests, OpenAPI drift check, deployment
  validation and deployment harness pass locally. The next push is expected to rerun CI with
  the dependency and registry corrections.
- The follow-up container scan identified newly published HIGH Alpine advisories in the pinned
  Nginx runtime image (`libexpat` and `util-linux`). Both static runtime Dockerfiles now run
  `apk upgrade --no-cache` after the pinned base image so the image contains the fixed Alpine
  packages at build time; Hadolint passes for both files.
- The next container scan reached the Caddy image and found fixed advisories in Go modules
  (`x/crypto` 0.53.0 and gRPC 1.82.1). The Caddy build now pins `x/crypto` 0.55.0 and gRPC
  1.83.1 before producing the static binary.

### Caddy image scan resolution — 2026-09-16

- Run `35070388492` reduced the release gate to a single failing step: `Scan Caddy image` reported
  CVE-2026-56854 (`golang.org/x/crypto` 0.53.0) and CVE-2026-84445 (`google.golang.org/grpc`
  1.83.1). The previous pin commit therefore did not take effect.
- Root cause: the pre-existing `go get golang.org/x/text@v0.39.0` step ran after the `x/crypto`
  0.55.0 request and resolved the shared module graph back down, because `x/crypto` 0.55.0 requires
  `x/text` 0.41.0. The build log showed `v0.53.0` while the Dockerfile still read as patched.
- `deploy/caddy/Dockerfile` now applies the three floors (`grpc` 1.83.2, `x/text` 0.41.0,
  `x/crypto` 0.55.0) before a final `go mod tidy`, then asserts each resolved version with
  `go list -m` so a silent downgrade fails the build. An intermediate ordering with `go mod tidy`
  before the floors was rejected because it left `go.sum` incomplete and made the build succeed
  from a cold module cache while failing from a warm one.
- The assertion was proven by rebuilding with the old, buggy dependency order: the guard failed the
  build where the image scan previously caught it only after publishing the image.

Verification for this fix:

- `docker compose --env-file deploy/env/runtime.staging.env.example -f deploy/compose/docker-compose.remote.yml build --pull postgres api supplier-web tmmin-web caddy` built all five images.
- Trivy 0.70.0 `image --scanners vuln --severity HIGH,CRITICAL` reported zero findings for the Caddy
  image and for cold-cache rebuilds (`--no-cache`) of the API, both web, and PostgreSQL images.
  Earlier local findings in the PostgreSQL and web images came from cached `apk upgrade` layers, not
  from the images; cold-cache builds are clean and match the passing CI scans.
- The rebuilt Caddy binary reports `v2.11.4` and validates the production Caddyfile (`Valid
  configuration`).
- Hadolint 2.14.0 passed for all five production Dockerfiles (a `DL4006` warning introduced by the
  first assertion draft was removed by dropping the pipeline), actionlint 1.7.7, ShellCheck 0.11.0,
  `bootstrap-vm.sh --check`, `pnpm deployment:validate`, `pnpm test:deployment`,
  `pnpm security:exceptions:check`, `docker compose config --quiet`, `pnpm format:check`,
  `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, and `pnpm openapi:check` all passed.
- The mandatory Gitleaks v8.24.3 directory scan reported no leaks across the worktree once three
  git-ignored local artifacts were set aside without being read (`.local/.ssh/supplier-henkaten-staging-ci`,
  `playwright-report/`, `test-results/`) and then restored; all three are untracked and cannot enter
  a commit. The filesystem Trivy scan flags only the same git-ignored SSH key, which CI never checks out.
- The full production Compose build/start/routing/non-root/persistence sequence was not re-run
  locally for this change; CI passed every one of those steps at this SHA and the change touches
  only the Caddy image's Go dependencies, with the Caddyfile unchanged.

Delivery result:

- Commit `6e32b7d` was pushed to `feat/tanoko`. CI run `35076423277` completed successfully with all
  ten required jobs green, including `Production containers and routing` with its `Scan Caddy image`
  step, and `Release candidate gate`. `Deploy staging` remains skipped for pull requests by design.
  PR #16 is `MERGEABLE` with merge state `CLEAN`.
- The commit-mode Gitleaks scan over the new commit reported no leaks. No container, network, or
  volume from this work remains; the local development stack was not started or stopped.

## Changed files and implementation

- New `packages/contracts/src/tanoko.ts`, API Tanoko controller/service/eligibility helper,
  Prisma mapping/history models and forward migration `20260916001200_tanoko`.
- Supplier API client methods, generated OpenAPI/client contract, role capabilities and native
  navigation/route integration. Job Setup creates/updates the independent skill category.
- New `TanokoPage.tsx`/`tanoko.css`: searchable matrix, line/category filters, 24-column pages,
  qualified totals, keyboard cell navigation, fullscreen, responsive inspector, explicit save,
  conflict recovery, read-only states, optional notes and immutable searchable history.
- Serializable versioned writes atomically update mapping/history/general audit. Polling is 30s
  and focus-based; Tanoko SSE is not implemented and drafts are not overwritten by polling.
- Local seed covers unassessed cells and levels 1–4 through the same versioned API, with
  Admin and both GL actors plus upgrade, downgrade and clearing history. Every seeded default
  MP is qualified at level >=3 on its default job; Man replacements are independently assessed
  on the exact target job. Post-seed invariants check default qualifications and visual/history
  coverage. Production migration never invents proficiency; real MPs require assessment.
- Three ImageGen concepts and prompts are saved under `.agent/design/tanoko/`.
- PRD, roadmap and ADR 0032 synchronize the new scope and release consequences.

## Verification

- `pnpm generate`, `pnpm shared:build`, `pnpm typecheck`, API build and production Supplier build passed.
- `pnpm openapi:generate` and `pnpm api-client:generate` refreshed the shared contract;
  contract-freeze unit coverage confirms all 155 operations across 138 paths are documented.
- `pnpm test:unit` passed before the final three UI interaction tests; the final Supplier suite
  passes 50 tests. New coverage includes draft discard, read-only controls and conflict reload.
- `pnpm db:up`, `pnpm db:wait`, `pnpm db:test:reset`, `pnpm db:test:migrate` passed on Docker
  PostgreSQL 18/pgvector. All 12 migrations applied from empty state.
- `NODE_ENV=test DATABASE_URL=<disposable-test-url> RELEASE_SHA=tanoko-local
  SESSION_CSRF_SECRET=<test-value> AUTH_THROTTLE_SECRET=<test-value> OUTBOX_ENABLED=false
  pnpm --filter @tmmin-henkaten/api test:integration` passed all 39 tests, including Tanoko
  permission/version/history checks, insufficient submission mastery and downgrade at final approval.
- All five Chromium journeys passed: governance, hosted lifecycle, Man concurrency, onboarding,
  and Tanoko. All three Edge journeys passed: governance, onboarding, and Tanoko.
- Tanoko browser evidence verifies frozen axes, save/history/reload, API conflict/read-only rejection,
  no horizontal document overflow at 1440/1280/768/390 widths and zero Axe violations.
- `pnpm exec eslint .`, `pnpm format:check` and `git diff --check` passed after test typing cleanup.
- An early mobile screenshot captured the existing sidebar transition mid-frame; the final
  responsive test waits for the sidebar to leave the viewport. Final Edge screenshot is correct.
- The E2E harness can leave pnpm-spawned Vite descendants and log database-shutdown errors after
  successful tests. Session-owned processes were cleaned separately after all journeys passed. Docker test containers were stopped; no session-owned runtime is retained.

## Delivery and next action

No commit, push, staging deployment or production migration has been performed. Review the local
changes, then use the full repository pre-commit/CI parity and normal release workflow. Production
rollout requires real GL/Admin qualification entry before Man substitutions. Large tenant payload
performance and shop-floor UAT remain follow-up work.

---

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

## Current Handoff — Recurring Line–Shift Operations

Date: 2026-09-22

Status: implementation and local verification complete; ready for PR to `staging`. No deployment
or staging UAT claim.

The approved model removes supplier Shift Run preflight, Start Shift, Emergency Start, End Shift,
active-shift dependency, MP reservation, MP exclusivity, and donor-vacancy cascade. `LineShift` now
owns shift-specific Supervisor, Line Leader, and per-job MP defaults; only Supplier Admin may edit.
Active schedules on one line cannot overlap.

UI copy rule: keep only labels, values, statuses, errors, and action-critical instructions. Remove
explanatory typography about system behavior or technical guarantees (such as lifecycle, hosting,
immutability, session storage, and server-side validation); assume operators know the workflow.
Apply this consistently to existing and new components while keeping the screens polished.

Henkaten submission resolves a clock-derived occurrence. During an interval it auto-selects the
current Line–Shift; outside an interval the LL selects a shift and the effect starts at its next
scheduled start. Man replacement applies immediately to that occurrence and checks only active MP
plus exact-job Tanoko >= 3. Duplicate MP assignment is unrestricted. Reject/Withdraw restores the
latest other effective override or the default, while the next recurrence begins from defaults.

Implemented locally: forward-only schema/migration, Line–Shift service/endpoints/contracts/client,
automatic occurrence compatibility snapshots, immediate Man assignment and restoration, clock-
derived board, Admin Line Setup, new Henkaten form, removal of supplier Shift UI/routes/endpoints,
cutover/readiness/catalog updates, local seed Line–Shift configuration, and ADR 0033. Historical
Shift Run tables and TMMIN read-only endpoints remain for compatibility. Supplier creation contracts
now require `lineShiftId`; the old ShiftRun/reservation creation path was removed.

Verification completed: clean reset plus all 13 migrations; upgrade from the 12-migration
`origin/staging` state; lint; formatting; full TypeScript; generated API client and OpenAPI document
parity; 188 repository/script unit tests; 28 API integration tests; and production builds for API
plus both frontends with `VITE_API_ORIGIN=https://api.example.test`. Integration coverage includes
current/next occurrence, duplicate MP, immediate replacement, reject/withdraw restoration, removed
Shift endpoints, and Admin Line Setup behavior. The replacement onboarding journey creates a
Line–Shift and edits its Supervisor/LL/MP assignment; all six isolated Playwright journeys passed
on Chromium and Edge. Dedicated during-shift and outside-shift Henkaten browser journeys remain
deferred to staging UAT.

The production-like Compose acceptance built all five runtime images, applied all migrations,
bootstrapped the protected administrator idempotently, and passed health, routing, headers,
non-root, and restart-persistence checks. Actionlint, ShellCheck, Hadolint, deployment validation,
the deployment harness, Ubuntu 22.04 bootstrap input validation, security-exception validation,
`pnpm audit --audit-level high`, Gitleaks, Trivy filesystem scanning, and HIGH/CRITICAL scans of all
five images passed. The `js-yaml` override was raised to 4.3.2 to remove the newly disclosed audit
finding. Line Setup now requests the API-supported member page limit of 100 instead of 500.

PR #17 initially failed its static migration gate because the intentional removal of the legacy MP
uniqueness index matched the blanket `DROP` rule. The checker now supports an exact-name,
immediately-following `migration-policy: allow-drop-index` declaration, with deployment-harness
coverage for accepted exact matches and rejected missing/mismatched declarations. Other `DROP`
statements remain forbidden.

Fresh-database local-seed smoke passes through the built API with the production-like outbox worker
enabled. A regression introduced during the Line–Shift cutover had removed both Henkaten seed calls,
leaving the dashboard empty even though the retained plan still specified 120 records per supplier.
The seed now creates all 240 Henkaten through the Line–Shift API, relocates 216 terminal records into
72 synthetic historical occurrence snapshots, keeps 24 current records, and verifies the Supplier
dashboard response before writing credentials. Evidence after completion: 2 suppliers; 240 Henkaten;
16 Open warnings; 18 LineShifts; 72 LineShiftJobAssignments; all three shift templates represented;
6 Canvas layouts; and 0 pending outbox events. Every configured default MP/job pair is Tanoko level
3 or 4. No preflight, Start Shift, End Shift, reservation, or MP exclusivity path is used. The smoke
database, temporary API, photos, and credentials were removed afterward; the main local database was
not changed by this verification.

## Current Handoff — PCR screening, 2026-09-23

The user-approved PCR plan is implemented locally on `feat/ai-pcr`; no staging or production
deployment has been performed. Hosted submit queues PCR screening in its transaction. External
ingest requeues only when screening evidence changes. A separate leased worker calls Ling through
one forced OpenAI-compatible tool call (`max_tokens: 8192`), with the 45 control items and PCR
guidance in the English prompt. Invalid, unavailable, or below-threshold results become Review.
Admin and Quality can correct decisions with version and required reason, including a first manual
decision for an unassessed historical record (`expectedVersion: 0`); audit and outbox preserve
both the AI result and subsequent action. The two portals expose scoped PCR views, notification
tabs, and the Design A assessment only for a current PCR decision. The TMMIN page title is now
“Henkaten”; the orange active sidebar item and compact Quality workspace label were verified in
the browser.

Local `local:reseed` was run after an isolated seed smoke. The demo remains two suppliers and
240 Henkaten: 6 PCR, 230 No-PCR, 4 Review, including manual correction examples across Open and
Closed records. Demo credentials were rotated in the git-ignored local credentials file. The
main local database is ready for UI review at ports 5173 and 5174.

Checks passed: all 14 migrations on a clean disposable test database; `pnpm format:check`,
`pnpm lint`, `pnpm typecheck`, production build with explicit `VITE_API_ORIGIN`, repository unit
tests, 31 API integration tests, and `git diff --check`. Integration checks now cover idempotent
Hosted queueing, External status-only retention and evidence-change requeueing, TMMIN role/version
checks, first manual decisions on historical records, notification deduplication, and a late AI
result racing with manual correction. Browser
inspection confirmed Supplier and TMMIN PCR tabs, the Review tab, table badges, priority order,
PCR detail and the shortened title. The OpenAPI document check passes; the repository's combined
`openapi:check` still reports the expected Git HEAD difference for the newly generated API client
until these changes are committed.

The local runtime has no PCR endpoint/key configured, so new live submissions currently resolve
to Review. Diagnosis of the separate public inference 403/1010 is in
`docs/reports/inference-server-403-2026-09-23.md`. No key or server configuration was changed.
Before live model UAT, configure the runtime secret and verify the application HTTP client against
the inference endpoint, then review Indonesian positive/negative cases with TMMIN QD.
