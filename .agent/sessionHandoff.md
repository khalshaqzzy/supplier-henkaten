# Session Handoff — Customizable Assignment Board Canvas

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
- E2E-owned processes, containers, networks, volumes, and temporary photo roots were removed. The
  existing local PostgreSQL container predated this task and remains untouched.

## 4. Delivery Notes

- Commit-state OpenAPI/generated-client parity is required and was rerun after the delivery commit.
- No user upload/media-storage API is included in the v1 machine catalog.
- The TMMIN endpoint exposes the same reconciled Hosted layout read-only; TMMIN UI continues using
  its existing operational board while the API is available for monitoring integration.

## 5. Next Recommended Action

1. Review the pushed branch and open a PR into `staging` when ready.
2. Run workflow-pinned Linux static-analysis checks in CI; local macOS cannot exercise the mandatory
   `flock` contention branch.
3. Deploy to staging under the existing Phase 15.9 process and conduct touch-device UAT before any
   production claim.
