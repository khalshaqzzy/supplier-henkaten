# Current Session Handoff: Member detail workspace and shared Select

- Date: 2026-11-11. Branch `feat/supplier-member-ui-polish` from main `0f7eda9`. Delivery authorized: commit, push the branch and open a PR to main with a comprehensive description. Merge/deployment excluded. Phase 15 remains the sole `in_progress` phase; staging/device/UAT acceptance is unchanged.
- **Standing instruction from the user: start Docker with OrbStack and run the full local GitHub Actions parity checks (rules §4.2) before every commit. Local checks for this delivery were delegated to a Haiku subagent that reports failures for the main session to fix.**
- Objective: polish `/master-data/members/:memberId` into an advanced workspace in the existing style, and replace every Supplier-owned native dropdown with a polished shared component.
- Confirmed choices: profile save stays on the page; role is read-only with the role-change action; select search appears automatically above eight options; the shared Henkaten export panel (used by TMMIN too) keeps its native selects.
- Shared UI: new `packages/ui/src/components/select.tsx` (Radix Popover + custom listbox, WAI-ARIA select-only combobox, `aria-activedescendant`, typeahead, auto search, groups, description/meta/disabledReason, empty-string values, hidden `name` input, `data-*` passthrough, `data-value` per option) with `select.test.tsx`. The old Radix `Select` was removed from `advanced.tsx`; `NativeSelect`/`CompactNativeSelect` remain for TMMIN and the export panel. Styles replace the old `.hds-select*` block.
- Supplier: `MemberDetailPage.tsx`, `member-detail.css`, `memberRoles.ts`; `MemberLifecycle` removed from `MasterDataPages.tsx` (which exports `OneTimeCredential`). All supplier `NativeSelect` usages (Overview, Activity, Henkaten list/detail, Board, Henkaten create, Tanoko, Default assignments, Setup import, Part import, Member role dialog, member list/create, job skills) now use `Select`; CSS overrides moved from `select` to `.hds-select`. Test helpers: `apps/supplier-web/src/test/select.ts` and `chooseOption` in `apps/e2e/tests/support.ts`.
- Browser: new `member-detail.spec.ts` (header/rail, dirty/discard/in-place save, MP variant, keyboard role selection with descriptions, filter select bounds and focus return, axe, screenshots at 1440/1024/768/390/320). Existing journeys that used native selects use `chooseOption`. Baselines for review are copied (uncommitted) to `.agent/qa-screenshots/member-detail-select/`, with open-list screenshots of other converted pages in `converted-pages/`.
- Narrow-width review fixed: rail facts overflowing at 320 px (`min-width: 0` on fact values), mobile header facts in a two-column grid (an `auto-fit` grid inside the column flex header over-measured its height), breadcrumbs hidden on phones (back link remains), and save/discard stacked below 480 px.
- Docs: PRD amendment, PAGES.md (member detail, shared select rule), roadmap entry, ADR 0051. Seed: no edit needed (no API, contract, schema or seed-consumed behaviour change).
- Parity (delegated run; pnpm 11.16.0, system Node 22.23.2 because nodejs.org was unreachable from the sandbox): clean artifacts, frozen install, format, typecheck, unit (336 tests; one unmodified API import-body spec flaked with ECONNRESET once and passed on rerun), OpenAPI check, production build, compose config, database verify/migrate, integration (106), destructive-migration check against `0f7eda9`, full browser suite (23/23 journeys, Chromium + Edge), Actionlint/ShellCheck/Hadolint, deployment validate/harness, Ubuntu bootstrap checks, security exceptions (7), audit (0 high/critical), Gitleaks directory mode and `git diff --check` passed. Lint initially failed on two type assertions in `HenkatenCreatePage.test.tsx`; they became `toHaveProperty('disabled', false)`, after which lint, typecheck, format and that test file passed. Database checks ran in an isolated Compose project (`supplier-henkaten-ci-parity`, port 55434) because `scripts/database.mjs` targets the user's `supplier-henkaten-local` project; its scratch volume was removed by name. Production image rebuild/Trivy was not rerun (no image, dependency or Dockerfile change); local CodeQL is an accepted gap.

---

# Current Session Handoff: Actionable setup blockers

- Date: 2026-11-10. Branch `feat/setup-blocker-navigation` from main `d5bcba8`. Delivery authorized: commit, push the branch, open a PR to main with a comprehensive description and monitor hosted checks. Merge/deployment excluded. Phase 15 remains the sole `in_progress` phase; staging/device/UAT acceptance is unchanged.
- **Standing instruction from the user: start Docker with OrbStack (`open -a OrbStack`) and always run the full local GitHub Actions parity checks (rules §4.2, including Docker database, E2E and release gates) before every commit.**
- Objective: Setup Supplier blockers become expandable rows that name the affected line, shift, job and member with the reason, and link to the exact page and control that resolves them.
- Confirmed UX choices: full-width main panel beside a compact area rail; destinations auto-select line/shift and highlight/focus the field; reasons are distinguished with reason-specific actions. Inline gap badges in Line Setup and a “back to Setup” link were deferred.
- Backend: `evaluateHostedReadiness` adds optional `reason`, `line`, `shift`, `job`, `member`, `candidates` (≤20) and `candidateTotal`; reports one MP blocker per job (including jobs without an assignment row); distinguishes unassigned/archived member/inactive account; corrects `resourceType` to `Line`/`LineShift`. Counts/codes unchanged; no migration. TMMIN preflight now projects `{contributor, code, detail}` only, fixing a strict-contract parse failure and keeping member names inside the tenant. OpenAPI and the generated client were regenerated.
- Frontend: `setupBlockers.ts` (grouping/actions), `SetupBlockerPanel.tsx`, rewritten `SetupPage.tsx`, `setup-blockers.css`, `app/focus-target.ts` (`?focus=` contract with `data-focus-target`/`data-focus-initial`), Line Setup (`lineId`, `lineShiftId`, targets supervisor/line-leader/job:<id>/add-shift/shift-status) and master detail targets (account/status/jobs). Expanded groups persist in `open=`; readiness refetches on mount.
- Docs: PRD amendment, PAGES.md, implementation roadmap, ADR 0050. Seed: no edit needed (the seed does not consume readiness). Fresh seed smoke on a task-owned temporary database `supplier_henkaten_seedsmoke` (migrate, bootstrap, `local:seed` against the built API on a spare loopback port) completed with two Hosted suppliers and 240 Henkaten; the database and seed artifacts were removed. The user's existing local volumes were not touched.
- Parity (official Node 22.23.1, pnpm 11.16.0): `pnpm clean` plus removal of ignored dist/tsbuildinfo/Prisma/test output, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` (331 workspace tests), `pnpm openapi:check` (generated files staged first because the client check diffs against the index), `VITE_API_ORIGIN=https://api.example.invalid pnpm build`, `docker compose config --quiet`, `pnpm db:up/db:wait/db:verify`, `pnpm db:test:reset/db:test:migrate`, CI-env `pnpm test:integration` (106 passed), `pnpm migrations:destructive-check d5bcba8` (no migration SQL changed), archived origin/main migrations then current deploy/status on a separate upgrade database (up to date), `pnpm db:down` — all passed.
- Browser: focused `setup-blockers` journey passed; screenshots at 1440/1024/768/390/320 reviewed. The local E2E runner can hang during teardown after Playwright reports success (API outbox loses its database first); stop the task once the summary line is printed.
- Full browser suite (`pnpm --filter @tmmin-henkaten/e2e exec playwright install chromium msedge`, `pnpm test:e2e`): all 10 Chromium journeys passed. Edge `setup-blockers` then failed in the test helper (`animation.finished` rejected with `AbortError` when a resize cancelled a transition), and the suite stopped there. The helper now waits for running finite animations and tolerates cancellations. Afterwards the changed journey passed on Chromium (`--chromium-only --spec=setup-blockers`) and all 10 Edge journeys passed (`--edge-only`). Chromium journeys other than this spec were not rerun; only this spec's helper changed.
- Release gate: workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0 and Hadolint 2.14.0, `pnpm deployment:validate`, the deployment harness in Linux `docker:29-cli` with real flock, `pnpm security:exceptions:check` (7 exact entries), `pnpm security:audit` (4 low/17 moderate, no high/critical), and both Ubuntu 22.04 bootstrap checks passed. Current-source images were rebuilt with `--pull` in isolated project `henkaten-blockers-delivery` (scratchpad `SHARED_DIR`). The CI migration/bootstrap, routing/release identity, deep link, unauthorized session/realtime, headers, non-root, private PostgreSQL, bootstrap idempotence and restart persistence assertions passed, and the stack was stopped.
- Trivy 0.70.0 (database current on 10 November 2026) newly reported CVE-2026-78661 (HIGH, `golang.org/x/net` 0.60.0, fixed 0.62.0) in the Caddy image. The Caddy builder now pins x/net 0.62.0 with its required x/crypto 0.58.0 and x/text 0.43.0, resolved with the pinned Go image, and the exact post-tidy assertions are updated (ADR 0008 amendment). No exception was added. After the patch, a full release-gate rerun passed: source filesystem plus all five images HIGH/CRITICAL, the rebuilt production-like stack assertions, Gitleaks 8.24.3 directory mode (no leaks) and `git diff --check`.
- Next action: monitor the PR's hosted checks to green.

## Session efficiency lessons (apply in future sessions)

What slowed this session, and the shortcut to use next time:

1. **Docker was not running.** The first Docker call was rejected and needed a user round trip. Start of every session: `open -a OrbStack`, then `docker info >/dev/null` before any database/E2E/container step. Never use `pnpm local:start:clean`/`local:reseed` or remove `supplier-henkaten-local-*` volumes; they hold the user's local data.
2. **E2E runner teardown hang (largest waste).** `node apps/e2e/scripts/run.mjs` can print `1 passed` and then never exit. Root cause (verified with `ps -o pid,ppid`): `/opt/homebrew/bin/pnpm` is a shim that re-launches the pinned pnpm 11.16.0 as an inner `node …/store/v11/links/@/pnpm/11.16.0/…/pnpm.mjs` process. `stopChild` signals only the outer process (SIGKILL after 5 s), so the inner pnpm and its `vite`/`vite preview` child are orphaned with PPID 1. They keep the runner's stdout/stderr pipes open, and Node never exits. The API `57P03`/“terminating connection” crash in the log is only a side effect of Compose stopping PostgreSQL first. CI installs pnpm 11.16.0 directly and is unaffected. Locally: watch the log for the Playwright summary (`passed (`/`failed`) rather than process exit, then kill orphaned `pnpm.mjs --filter @tmmin-henkaten/... exec` processes (PPID 1) and their children. That releases the runner. Optional permanent fix: spawn servers `detached` and kill the process group, or invoke the pinned pnpm directly. Never start a second runner while one is alive, and give every run its own log file. Two concurrent runs writing one log caused confusion here.
3. **E2E cost model.** Each journey takes about 25 s, nearly all setup (fresh Compose PostgreSQL, migrations, Supplier production build, API, Vite preview). The test body is 2–16 s. Iterate with `node apps/e2e/scripts/run.mjs --chromium-only --spec=<file>`. Run the full Chromium+Edge suite (about 9 minutes for 20 journeys) once, just before commit.
4. **Browser-test flakiness from motion.** axe `color-contrast` failed on colors captured mid-transition. Before axe or screenshots, wait until no finite animation is `running` (`settleAnimations` in `setup-blockers.spec.ts`). Swallow `finished` rejections: on Edge a viewport resize cancels transitions and `finished` rejects with `AbortError`, which failed the first full-suite run after all Chromium journeys had passed. The full suite stops at the first failure, so journeys after it never run. Disclosures that start collapsed must be clicked before their links are queried.
5. **jsdom/test-tooling gaps.** jsdom has no `CSS.escape`, so match `dataset` values instead. Use `queryAllByRole` when zero matches is valid. Fake-timer tests need `act(() => vi.advanceTimersByTimeAsync(n))` (no `async` wrapper) to satisfy `require-await`. macOS has no `timeout` command.
6. **Pinned Node is not the system Node.** The system has 22.23.2; CI pins 22.23.1. Download the official `node-v22.23.1-darwin-arm64.tar.xz`, verify `SHASUMS256.txt`, extract to the scratchpad and prefix `PATH`. pnpm 11.16.0 is already global.
7. **`pnpm openapi:check` fails on intentional contract changes unless generated files are staged.** `api-client:check` runs `git diff --exit-code` against the index. After `pnpm openapi:generate && pnpm api-client:generate`, `git add apps/api/openapi/openapi.json packages/api-client/src/generated/openapi.ts` before parity.
8. **Clean-artifact state.** `pnpm clean`, then `rm -rf apps/api/dist apps/api/src/generated apps/supplier-web/dist apps/tmmin-web/dist packages/*/dist packages/*/*.tsbuildinfo apps/*/*.tsbuildinfo blob-report playwright-report test-results` (copy needed screenshots out of `test-results/e2e/` first).
9. **Seed smoke without touching user data.** Create a task-owned database inside the local Compose PostgreSQL (`CREATE DATABASE supplier_henkaten_seedsmoke; CREATE EXTENSION vector`), then `prisma migrate deploy --config prisma.config.ts` with `NODE_ENV=development`, `POSTGRES_DB` equal to the URL database name (not `_test`), and start `node apps/api/dist/main.js` on a spare loopback port with the `compose.yaml` API env. Run `node dist/cli/admin.js bootstrap` (not `bootstrap-admin.js`), then `LOCAL_SEED_CONFIRM=supplier-henkaten-local-seed LOCAL_SEED_API_ORIGIN=http://127.0.0.1:<port> LOCAL_SEED_CREDENTIALS_PATH=<scratchpad> node dist/cli/local-seed.js`. Afterwards `DROP DATABASE … WITH (FORCE)` and `pnpm db:down`.
10. **Production-container gate on macOS.** `runtime.staging.env.example` hard-codes `SHARED_DIR=/tmp/...`. Copy it to the scratchpad, override `SHARED_DIR` and `COMPOSE_PROJECT_NAME`, and pass that file as `--env-file`. The Linux deployment harness runs in `docker:29-cli` after `apk add bash jq util-linux coreutils git`. Trivy runs as `aquasec/trivy:0.70.0` with the Docker socket and a scratchpad cache; Gitleaks runs as `zricethezav/gitleaks:v8.24.3 dir /repo --redact`.
11. **Script the gates.** Write the parity sequence (quality → integration → migration upgrade) and the release sequence (actionlint/ShellCheck/Hadolint → deployment validate/harness/exceptions/audit/bootstrap → production stack assertions → Trivy → Gitleaks → `git diff --check`) as scratchpad scripts with `set -euo pipefail`. Run each once in the background and follow it with a log monitor that matches both success and failure lines. Run the browser suite and the production stack one after the other, not in parallel, because both are CPU/Docker heavy.
12. **Context budget.** This session hit context compaction. Read files with offsets or `grep`, keep generated OpenAPI/E2E logs out of the conversation (tail/grep only), and record decisions in this handoff early so compaction loses nothing.

---

# Current Session Handoff: Shift dropdown layout polish

- Date: 2026-11-06. Local branch `fix/shift-select-option-layout` starts from clean main after PR #45. Scope is the supplied screenshot's overlapping Shift Template dropdown options. Follow-up delivery is now authorized directly to main, including its automatic production workflow.
- Root cause: `.hds-select__item > span:first-child` imposed the 16px icon dimensions on ItemText whenever Radix omitted the unchecked ItemIndicator. Multiword labels wrapped into a tiny fixed-height slot and overlapped subsequent options. Previous browser screenshots captured selected/closed controls and missed the open unselected state.
- Change: shared Select separates value, icon indicator, option copy, label and optional description with named classes; the checkmark has its own absolute slot and labels take flexible width/automatic height. Popup width/height is viewport bounded, trigger/menu spacing and focus/placeholder states are explicit, and rows have at least 44px targets. Shift choices show current hours, overnight marker and timezone without copying descriptions into the selected trigger. Existing keyboard selection and pair-exclusion behavior remain.
- Files: shared advanced Select and styles, CatalogActions options, existing supplier-operations browser journey, roadmap and ADR 0049. No API, database, dependency or seed changes; no seed edit/smoke is required for this frontend-only change.
- Verification: the focused Chromium/Edge journey now opens both unselected menus at 1440/768/390/320px, checks label width and containment, nonoverlapping rows, 44px targets, popup viewport bounds and axe, and captures each menu before selection. It also checks selected checkmark, label-only trigger and disabled partner choice. Both Chromium and installed Edge passed the final expanded journey after the token correction. UI 24 tests and Supplier 108 tests passed; UI/Supplier/E2E TypeScript, targeted lint, formatting, both frontend production builds and `git diff --check` passed. The shared token-contract test caught a literal dropdown offset during implementation; it now reuses componentMetrics.popoverOffset. Actual screenshots at all four widths were reviewed; the popup has zero scoped axe violations. E2E-owned API/browser/database resources were removed.
- Main delivery parity: both workflow files were inspected. With official Node 22.23.1/pnpm 11.16.0, `pnpm clean`, explicit ignored dist/build-metadata/Prisma removal and frozen install preceded formatting, lint, full TypeScript, all 311 workspace unit tests plus two repository-script tests, actual OpenAPI/client drift checks and production builds; all passed. Docker PostgreSQL fresh migration, the unchanged-main migration upgrade and all 106 integration tests passed. The full Chromium/installed-Edge suite passed all 20 journeys, including the expanded open-menu geometry checks.
- Release validation: workflow-pinned Actionlint/ShellCheck/Hadolint, Linux deployment-script harness with real flock, Ubuntu bootstrap checks, environment/Compose validation, security exception registry and dependency audit passed. Current-source production images were rebuilt with --pull, then local routing/release/headers/non-root/private-DB/bootstrap/restart-persistence assertions and Trivy 0.70.0 source/five-image HIGH/CRITICAL scans passed using the 6 November DB and unchanged ignore file. Final directory/commit Gitleaks and format/diff checks accompany publication. All local task-owned containers/processes are stopped.
- Publication: direct main push and its automatic production workflow are authorized. Normal Git transport timed out while the GitHub API remained reachable; publication may use the Git Data API with matching tree/commit verification and a nonforcing branch update. The exact resulting commit and authoritative CI/deployment outcome are available in GitHub Actions for main. Hosted checks and production smoke are monitored before completion is reported. Phase 15 remains the sole current in_progress phase; device/UAT acceptance is separate.

---

# Current Session Handoff: Supplier operations improvements

- Date: 2026-11-06. Branch: `feat/supplier-operations-improvements`, created from fetched `origin/main` (`ffe009a`) with a clean working tree. Follow-up delivery is authorized: commit, push this feature branch, open a PR to main and monitor checks. Merge and deployment are excluded.
- Objective: add shift-time rotation, custom searchable assignment controls, unblocked supplier-wide Part catalog deletion and independent Tanoko line dimensions. Analysis/sequence/acceptance is retained in [supplierOperationsPlan.md](supplierOperationsPlan.md). Phase 15 remains the sole current `in_progress` phase; staging/device/UAT acceptance is unchanged.
- Confirmed UX: Tanoko has independent “Job di line ini” and “MP di line ini” checkboxes with Job enabled by default. MP scope comes from configured assignments across active LineShifts on the selected active line, not Tanoko qualification. Both/neither modes, search/category and page reset are supported. Qualified MP row totals follow the filtered member set. History retains its existing job-line semantics.
- Placement correction: **Tukar waktu shift is available only on Shift Template**, not Line Setup. The responsive right sheet selects two active templates, places affected line scope first, compares old/new hours with overnight/timezone markers and a 24-hour track, and keeps actions fixed above the safe area. Names/IDs/MP/Supervisor/LL assignments and historical occurrences remain retained. The schedule changes immediately supplier-wide; no future rotation scheduler is included.
- Search UI: new shared SearchSelect uses a custom named Radix popover/listbox rather than native select/datalist. It separates query from committed identity, searches name/registration/import code, wraps long names, shows selected identity/checkmark and occupancy/account reasons, supports explicit clearing, keyboard navigation, focus restoration and empty recovery. Member responses now expose the existing optional importCode for matching. The three assignment roles reuse this control. Portalled Select options render above modal overlays.
- Part deletion: reviewed current count/revision covers active/inactive Parts across all list filters. No Open-Henkaten blocker applies. Deleted Parts are retained with `deletedAt` and active=false, hidden from catalog/details/ordinary edit/activation/new-input selection, while existing Henkaten snapshots/references remain readable. Part numbers stay reserved; dedicated Part import explicitly offers restoration, and general setup Restore clears deletion. Deleted Part restoration clears an earlier reset-archive marker as well. Ordinary deactivation remains unchanged.
- Backend: additive migration `20261106002300_supplier_catalog_commands` adds Part deletion and a requester/supplier/key-scoped command ledger with retained results. Strict request/result contracts, three endpoints, typed client and generated OpenAPI are included. Transactions serialize on the supplier, revalidate current session/source/delegated operator, reject stale versions/revisions and mismatched key payloads, and return original results for safe retries. Changed LineShift versions invalidate stale forms. Audits retain counts/template IDs and delegated operator identity.
- Documentation: PRD amendment, implementation plan, roadmap, ADR 0049 and the ADR 0011 visibility exception are updated. No new dependency or seed-data edit is needed. The existing local seed uses unchanged create/assignment contracts and completed against a freshly migrated Docker database: two Hosted suppliers and 240 Henkaten with its built-in invariant/dashboard checks; seed API/database/photos/credential file were removed.
- Completed validation: supported Node 22.23.2/pnpm 11.16.0, frozen install, formatting, lint, full TypeScript, 311 workspace unit tests plus two repository-script tests, and 106 PostgreSQL integration tests. Tests cover atomic swaps, identity/version retention, stale/unknown pairs, replay/payload conflict, deduplicated Tanoko membership, deleted detail/activation exclusion, later-Part preservation and reviewed restoration (including reset-archive cleanup). All 23 migrations apply fresh; an isolated origin/main 22-migration database upgrades to current and reports up to date, then is dropped.
- API/build validation: OpenAPI generator `--check` passed, generated client was regenerated with identical before/after SHA-256, and production application build passed. This is artifact stability evidence; the repository's Git-diff drift wrapper naturally compares the intentional new generated contract with HEAD. That initial implementation run used Node 22.23.2; the stricter clean-artifact Node 22.23.1 delivery parity is recorded in the follow-up below.
- Browser validation: the focused four-feature journey passed Chromium and installed Microsoft Edge, including lost commit responses, exact-command retry, an Open Henkaten retaining Part history, 1440/768/390/320px screenshots, fixed sheet/footer geometry, no document overflow, reduced motion and zero scoped axe violations. Existing onboarding selectors were updated for the custom member pickers. Full regression passed all 20 journeys (ten Chromium, ten installed Microsoft Edge); after the final primary-action/focus/touch-target polish, the focused journey passed again on both browsers.
- Visual review: inspected actual app screenshots and all six standalone inspection renders. Refined dialog specificity, body scrolling instead of clipped comparison rows, line scope placement, title alignment, modal dropdown layering, search popover naming/animation/viewport collision padding, mobile delete bottom sheet, button icon slots and the 320px catalog grid containment. Isolated sheet inspection reports 0 FAIL/0 WARN, allowing its legitimate floating shadow and blank ground outside the captured component. Subjective final component critique: design 8.1/usability 8.4/creativity 7.8/content 8.6 (overall 8.2); phone comparison requires intentional body scrolling. Artifacts and critique are outside the repo in this chat visualization folder `supplier-operations/`.
- Secret scanning: Gitleaks 8.24.3 directory scan passed with no leaks. Compose configuration and `git diff --check` passed. Production-container validation/scanning and hosted CI are recorded separately in the delivery follow-up; deployment remains excluded.
- Final verification/cleanup: after the reset-archive restoration regression and explicit FK update semantics, a reset disposable database applied all 23 current migrations and all 106 integration tests passed again. The origin/main upgrade was rerun against the final migration. Final formatting, lint, TypeScript, production build, API OpenAPI `--check` and Gitleaks 8.24.3 directory scan passed. All 20 full browser journeys plus both post-polish focused journeys passed; the final actual/statically captured UI has been inspected and standalone inspection remains 0 FAIL/0 WARN with the stated overlay allowances. No schema-diff SQL was applied: a read-only Prisma diff shows no CatalogCommand/deletedAt drift; legacy custom schema differences remain outside this change. The seed API, temporary seed/upgrade DBs/photos/credentials, E2E resources, inspector browser and local PostgreSQL stack are stopped/removed. `docker ps` and process inspection show no task-owned app/test runtime left running. `git diff --check` passes. Implementation and clean-artifact delivery parity completed; the feature branch is published for a PR to main, with hosted-check monitoring tracked on that PR.


## Delivery follow-up — 6 November 2026

Commit/push to the existing feature branch, a PR targeting main, and hosted-check monitoring are
authorized. Both workflows were inspected; deployment remains excluded. The main base remains
`ffe009aa85d305c97cd38f0847c7b643ee968821` after remote verification.

Pre-commit parity uses checksum-verified official Node 22.23.1 and pnpm 11.16.0. `pnpm exec node -v`
was also checked inside the API package. `pnpm clean`, explicit removal of ignored package/app dist,
TypeScript build metadata and generated Prisma output, and `pnpm install --frozen-lockfile` preceded
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check` and
`VITE_API_ORIGIN=https://api.example.invalid pnpm build`; all passed. Intended generated contracts
were staged first so the actual OpenAPI/client Git-diff drift commands used their intended baseline.

`docker compose config --quiet`, `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`,
`pnpm db:test:migrate`, and `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci
SESSION_CSRF_SECRET=<CI test value> AUTH_THROTTLE_SECRET=<CI test value> OUTBOX_ENABLED=false pnpm
test:integration` passed all 106 tests. The archived origin/main migrations were applied to a separate
upgrade database before current deploy/status; all 23 migrations were current. The upgrade database
was dropped and `pnpm db:down` stopped the test stack. A direct staged-SQL scan found no destructive
statement; the repository commit-range migration check is run after commit and before push.

Workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0, Hadolint 2.14.0, `bash -n`, both Ubuntu 22.04
bootstrap input checks, `pnpm deployment:validate`, the deployment-script harness in Linux Docker
29 CLI with real flock, `pnpm security:exceptions:check` and `pnpm security:audit` passed. Audit has
four low/17 moderate advisories and no high/critical finding. The first Linux harness invocation
lacked jq in its test image; adding jq to the ephemeral harness image allowed the exact test to pass.
No repository dependency or scanner suppression changed.

Current-source production Compose images were rebuilt with `--pull`. In isolated local project
`henkaten-ops-delivery`, the exact CI migration/bootstrap, three-domain routing/release identity,
deep-link, unauthorized session/realtime, headers, non-root/private-PostgreSQL, repeated bootstrap
and restart database/photo-persistence assertions passed. The production-like stack was stopped.
Trivy 0.70.0 with the official database updated 2026-11-06 (next update 2026-11-07) passed the source
filesystem and all five current runtime image HIGH/CRITICAL scans with the existing ignore file.
The latest policy bundle skips one AWS CloudFront rule that needs Trivy >=0.72; no AWS/CloudFront
configuration is part of this repository. Gitleaks 8.24.3 directory mode passed with no leaks.

The pinned-runtime `pnpm --filter @tmmin-henkaten/e2e exec playwright install chromium msedge` and
`pnpm test:e2e` completed successfully: all 20 journeys passed (ten Chromium, ten installed Edge).
Gitleaks directory mode and formatting are checked again on the final staged content. Commit-mode
Gitleaks and the commit-range migration check precede push. All task-owned runtimes/containers are
stopped. Delivery is through head branch `feat/supplier-operations-improvements` targeting main;
the resulting PR records its exact SHA and authoritative hosted CI results. Hosted checks are
monitored to completion before delivery is reported; merge/deployment remain excluded.

---

# Current Session Handoff: Member import guidance and actionable errors

- Date: 2026-11-03. Branch: `feat/member-import-guidance`, created from clean `main`, confirmed equal to `origin/main` after fetch. Delivery includes documentation, commit, branch push, comprehensive PR to `main` and monitoring checks. Merge/deployment are outside scope.
- Objective: expand the dedicated Member import guide and examples and make upload/validation failures understandable and actionable. Phase 15 remains `in_progress`; staging/device acceptance is unchanged.
- Implementation: both templates share 20 synthetic examples (seven operational accounts and thirteen MPs), readable 12-character `MemberAwal01` sample passwords, an expanded sectional Excel guide, detailed column notes and text identifiers. Instructions require replacing sample rows/passwords before use. General setup template password generation is unchanged.
- Feedback: source row/column corrections for local, server and commit validation; server errors expand automatically; CSV column-count errors preserve physical lines; file reading failures show replacement/template actions without empty metrics. Existing credentials remain absent from preview/error exports, identity/lifecycle rules and uncertain-result retries remain intact.
- Files: member template and test, shared example constant/export, Member parser/worker/feedback/dialog/CSS and tests, browser journey, both frontend Dockerfiles, PRD/import plan/ADR/roadmap/handoff. No dependency, API schema, database schema or migration change. Seed uses unchanged CRUD/schema and needs no edit.
- Application parity: checksum-verified Node 22.23.1/pnpm 11.16.0; `pnpm clean`, explicit removal of ignored generated/build roots, and `pnpm install --frozen-lockfile`, followed by `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build` passed. Final unit result: 305 workspace tests plus two repository-script tests. OpenAPI and generated client remain unchanged.
- Database parity: `docker compose config --quiet`, `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, then `NODE_ENV=test DATABASE_URL=<Docker disposable URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<CI test value> AUTH_THROTTLE_SECRET=<CI test value> OUTBOX_ENABLED=false pnpm test:integration` passed all 103 tests/11 files. An isolated upgrade DB applied all 22 migrations archived from `origin/main`, then current deploy/status confirmed up to date. The upgrade DB was dropped and `pnpm db:down` stopped the local test stack.
- Browser parity: `E2E_EDGE_EXECUTABLE_PATH=<signature-verified Microsoft Edge package payload> pnpm test:e2e` passed all 18 isolated journeys (nine Chromium and nine actual Microsoft Edge 156.0.4314.58). The official Microsoft package was signature/notarization checked and expanded without system installation. The Member journey covers actual downloaded Excel, CSV updates, corrupt Excel, wrong CSV column counts, visible field causes, code conflicts, scope confinement, uncertain-response recovery and separate activation. Axe has no Member-dialog violations. Screenshots at 1440/768/390 px were inspected.
- Visual/copy review: the sectional guide was reviewed through an HTML reading preview of actual workbook cell text/styles; this is not a native Excel render. The real workbook is validated by ExcelJS/parser/import tests. Error-dialog inspection at all three widths reports 0 FAIL/0 WARN, allowing the existing floating modal shadow and the page-owned h1. Source lint flags unchanged general-workbook styles that Member mode already overrides; table/control borders follow the app-screen conventions. Draft/audit/final humanizer notes and screenshots are outside the repository in this chat visualizations folder `member-guidance/`.
- Deployment parity: both GitHub workflow files were inspected. `pnpm deployment:validate`, `pnpm migrations:destructive-check origin/main`, `pnpm security:exceptions:check`, `pnpm security:audit` (4 low/17 moderate; no high/critical), workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0 and Hadolint 2.14.0 passed. The deployment harness passed in Linux Docker 29 CLI with real flock; Ubuntu 22.04 staging/production bootstrap input checks passed.
- Runtime security: fresh 2026-11-03 Trivy DB found two HIGH libexpat vulnerabilities in the pre-existing frontend image packages. Both frontend Dockerfiles now require libexpat >=2.10.0-r0. No exception was added. All five current-source runtime images and source filesystem pass Trivy 0.70.0 HIGH/CRITICAL vulnerability/secret/misconfiguration checks. Current runtime images passed migration/bootstrap, three-domain routing/release identity, deep links, unauthorized session/realtime, headers, non-root/private PostgreSQL, bootstrap idempotence and database/photo persistence after restart; the production-like stack stopped itself.
- Review corrections: lint caught generic stringification in the guide test; it now filters string cells. A late recovery-test URL mock initially replaced the constructor, then needed explicit static override declarations; final full parity passed after correction. One broad browser run stopped at a test-type build error and is excluded from final acceptance. An initial Docker package-upgrade layer stalled; the successful fresh retry and rebuilt image scans are the delivery evidence. Downloading a replacement template now retains the original file-repair cause, with a dedicated regression test.
- Secret scanning: Gitleaks 8.24.3 directory scan passed with no leaks; a final directory/commit scan is run at delivery. `git diff --check` passes. Hosted CodeQL/dependency-review/PR checks remain separate delivery gates and are monitored after push.
- Delivery: branch `feat/member-import-guidance` targets a PR to `main`. Local validation is complete; hosted PR checks are monitored after push. All task-owned PostgreSQL, API/browser harness and production-like resources have been stopped. Consult the PR checks for the latest hosted result. Next action after delivery is PR review and the remaining staging/device acceptance.

---

# Current Session Handoff — Member & Akun CSV/Excel import

- Date: 2026-11-02. Branch: `feat/member-account-import`, created from current `main`/`origin/main`. The working tree was clean at task start. The requested delivery is commit, feature-branch push and PR to `main`; merge/deployment remain outside scope.
- Objective: analyze and implement a focused Member & Akun CSV/Excel import with polished responsive review. The analysis and implementation sequence are retained in [memberImportPlan.md](memberImportPlan.md). PRD amendment and ADR 0046 define the narrowed scope and lifecycle correction. Phase 15 remains `in_progress`; no device/staging/UAT acceptance is advanced.
- Implemented: secondary `Import CSV / Excel` action on `/master-data/members`, focused HDS dialog, Excel/CSV templates, bounded browser worker, source-row/column errors with safe export, explicit Update/Skip/Restore review, existing uncoded MP linkage, masked credentials, stale-review refresh, file replacement cancellation, exact-payload/key retry and shared durable operation recovery. The list action remains visible in empty and filtered states without mounting duplicate import dialogs. Desktop uses 920 px, phone uses full height with persistent safe-area actions; values/labels are readable and action targets are at least 44 px.
- File contract: `.csv`/`.xlsx`, 50 MB, 300 data rows, 300 final active members. CSV handles BOM, comma/semicolon, quoted multiline records and physical line numbers. Excel chooses Member or one unambiguous non-guide sheet and reports other sheets as ignored. Stable member code/name/role required; recognized headers may be reordered, extra columns ignored. MP has no account or registration; only new Supervisor/LL/QC accounts require registration, username and a 12–128 character initial password. Existing identifiers/roles/passwords/photos are retained. `.xls` and arbitrary manual column mapping are excluded.
- Backend/contracts: dedicated Member-only template/preview/commit endpoints and strict bounded schemas. The preview and commit cannot accept Part, Line, Shift, assignment or checklist rows. A 2 MB JSON budget reuses the pre-parser role/session/Origin/CSRF/source/purpose/rate/pending checks. Writes reuse the setup planner, supplier revision/locking, atomic durable job, session/delegated revalidation and requester-scoped operation polling. Preview requests omit passwords; the persisted job contains sanitized rows/hashes and is cleared at terminal state. OpenAPI and generated client are updated.
- Lifecycle correction: shared setup restoration previously activated operational accounts. Planner and writer now restore the member while retaining inactive account state and old password; activation remains separate. Full-workbook restoration requiring those accounts must restore members, explicitly activate accounts, then restore dependent assignments. Imported username changes increment authorization epoch and revoke old sessions/push, matching ordinary username edits. A real PostgreSQL regression verifies this.
- Files: new Member template/parser/worker/tests and E2E journey; shared contracts/client/controller/OpenAPI; import middleware and tests; setup planner/writer/template/integration tests; focused shared dialog/style/list entry and component tests; PRD/plan/roadmap/ADR/handoff. No dependency, database-schema or migration change.
- Seed compatibility: no seed edit required because existing CRUD contracts and schema remain unchanged. A fresh task-owned database applied all 22 migrations, bootstrapped the built API and passed the existing local seed: two Hosted suppliers and 240 Henkaten plus dashboard/invariant checks. Its API, database, photos and credential manifest were removed. A preexisting pg query deprecation notice remains informational.
- Local delivery parity: ignored generated Prisma/build/Vite output was removed explicitly, preserving source and node_modules. Using Node 22.23.1 and pnpm 11.16.0, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build` passed. Unit result: 294 workspace tests plus two repository script tests. Generated OpenAPI/client output was staged as the intended new baseline before the unchanged drift command; a separate regeneration also proved byte stability.
- Database parity: `docker compose config --quiet`, `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, and `NODE_ENV=test DATABASE_URL=<Docker disposable test DB> RELEASE_SHA=ci SESSION_CSRF_SECRET=<test-only value> AUTH_THROTTLE_SECRET=<test-only value> OUTBOX_ENABLED=false pnpm test:integration` passed 103 tests/11 files. The origin/main archive applied all 22 migrations to a separate fresh upgrade database; current deploy/status confirmed up to date, and the task database was dropped. No SQL changed.
- Browser verification: Member import, existing general setup import/reset and Part CSV/Excel journeys passed in Chromium and actual Microsoft Edge. The Member journey covers downloaded Excel, CSV update, forged cross-resource rejection, lost commit-response recovery with identical request/key and restoration leaving the account inactive. Axe reported no dialog violations. Screenshots at 1440/768/390 px cover upload, matching/loading, errors, review and confirmed results. Full delivery browser suite passed all 18 journeys (nine Chromium and nine actual Edge). The final parser budget casing and result-link reopening regressions are separately covered after that full run.
- Visual refinements: browser measurements caught the inherited entrance keyframe overriding the centering transform. Member mode now fades opacity only and honors reduced motion; footer geometry/viewport assertions cover opening and every captured state. The first restore test used a label locator that missed the nested native select; the accessible-role locator was corrected. Standalone visual snapshots/screenshots are outside the repository in this chat's `member-import/` visualization folder. Source taste lint flags the unchanged general-workbook gradient/shadows; Member mode overrides the gradient and resting button shadows. Isolated-dialog inspection allows its legitimate floating shadow and h2 (the page itself owns h1); nested existing radii remain a documented stylistic warning. Final standalone inspection passed at all three widths with 0 failures and 1 defended inherited-radius warning. All three rendered viewports were inspected.
- Additional delivery checks: workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0, Hadolint 2.14.0, both pinned Ubuntu 22.04 bootstrap `--check` environments, `pnpm deployment:validate`, `pnpm security:exceptions:check` and the Docker 29 Linux deployment harness with real flock passed. `pnpm security:audit` passed with 4 low/17 moderate and no high/critical findings. Both `.github/workflows/` files were inspected; hosted CodeQL and dependency-review actions remain remote CI gates.
- Container parity: current-source `docker compose --env-file <task example env> -f deploy/compose/docker-compose.remote.yml build --pull postgres api supplier-web tmmin-web caddy`, migrations/bootstrap and the exact CI routing/release/CSP/HSTS/non-root/private-DB/bootstrap-idempotence/restart/photo/database persistence assertions passed in isolated project `henkaten-member-publish`. Trivy 0.70.0 HIGH/CRITICAL filesystem plus all five current runtime images passed using the committed `.trivyignore` and the fresh 2026-11-02 official DB cache (next update 2026-11-03). No new vulnerability suppression was added. The production-like stack was stopped.
- Final review refinements: the 2 MB member parser selector is case-insensitive, matching Express routing, with a regression that fails against the previous selector. The completed-result link clears local operation state before returning to the same member list, so reopening starts a new import; component/browser coverage exercises this path. The final patch passed format/lint/types/unit/OpenAPI/build again, both Member browser journeys (including result-link reopening), production routing/persistence and all six Trivy scans.
- Verification corrections: an initial integration invocation omitted DATABASE_URL required by three existing suites; the full rerun with the exact CI environment passed. Test-only TypeScript declarations were corrected before the clean delivery run. One browser invocation overlapped a local OpenAPI rebuild and lost the generated API entry; build/test ordering was made sequential before successful reruns. None of these interrupted runs is counted as acceptance evidence.
- Secret scanning: pinned Gitleaks 8.24.3 directory mode passed before delivery. Final directory scan passed with no leaks. Commit-mode `detect --log-opts=-1`, migration-range verification and hosted PR checks are verified during delivery; consult the PR checks for current hosted status.
- Cleanup/delivery: all local gates are complete. Task-owned PostgreSQL, production-like stack, seed API and browser harnesses have been stopped; unrelated projects are preserved. Delivery is on `feat/member-account-import` with a PR targeting `main`; locate the PR by that head branch for current CI status. No merge or deployment is authorized. Next action after delivery is PR review and the remaining device/staging/UAT acceptance.

---

# Previous Session Handoff — Reviewed member role changes

- Date: 2026-11-02. Branch: `feat/member-role-handover`, created from local `main` at `2af5907b832c269b39580de41344834236338d19`. Earlier local analysis documentation was retained. Commit/push/PR delivery is now requested; merge and deployment remain outside scope.
- Scope: Supplier Admin can change LL/Supervisor/QC while preserving Member/User IDs, registration, username, password, photo, import code and active/inactive states. MP/admin roles are excluded. All old-role assignment/Open responsibilities are handed to one explicit replacement in the UI, within one transaction. Former creators may approve their own earlier Henkaten when their current role and assignment authorize it. Separate account activation supports restored members.
- Product/architecture: [memberRoleChangePlan.md](memberRoleChangePlan.md), PRD amendment dated 2 November and ADR 0011 record the decisions and recovery boundary. Phase 15 remains in progress; staging/device/UAT and remote CI are not advanced.
- Persistence: additive migration `20261102002200_member_role_handover` introduces an append-only MemberRoleChange command ledger and current Henkaten LL responsibility. A recorded operational command gates role updates; a deferred constraint checks Member/User role agreement. Existing identifier reservations remain unchanged. No historical role/creator/occurrence/approval evidence is rewritten.
- Backend: dedicated preview/commit contracts, exact dependency coverage, bounded review, candidate/account/tenant validation, LL occupancy, last-QC coverage, stale-review checks, serializable supplier locking, durable same-key retry and transaction-bound session/source/delegated authorization. Source sessions/push subscriptions are revoked. Pending Supervisor routes retain routing history; LL list/detail/withdraw, dashboards, notifications and audit/realtime line scope use current responsibility. New submissions after an in-occurrence LL change get current-owner context when the occurrence snapshot differs.
- Accounts/UI: separate activation after member restore; one-time password and forced password change; repeated/stale activation does not rotate twice; activation clears old login lockout. Responsive three-stage role dialog, preserved identity/status, one combined replacement row covering every underlying reference, explicit review/reason, unavailable recipients, conflict refresh, focusable errors and exact-payload retry after uncertain network results. More than 1,000 dependencies require prior operational reassignment. Ordinary profile/import requests still cannot change role; workbook guidance points to the explicit action.
- Files: new role contracts/tests and typed client methods; Prisma schema/migration; current-principal guard; MemberRoleService/controller/module; member account activation; Henkaten/approval authorization and current LL handling; read/notification/realtime scopes; OpenAPI/client artifacts and contract counts; role dialog/styles/component tests and browser journey; PRD/plan/roadmap/ADR/handoff. Delivery also includes the minimal dependency/runtime security updates recorded below.
- Runtime: checksum-verified Node 22.23.1 from the official archive and pnpm 11.16.0. `pnpm runtime:check`, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `VITE_API_ORIGIN=https://api.example.invalid pnpm build`, API `openapi:check`, regenerated-client byte-hash stability and `git diff --check` passed. Unit result: 279 workspace tests plus two repository script tests. The new E2E DOM-snapshot addition also passed targeted ESLint and E2E TypeScript checks.
- Database: `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, disposable reset/current migrations and full integration passed: 102 tests across 11 files. Environment: `NODE_ENV=test`, disposable Docker DATABASE_URL, `RELEASE_SHA=ci`, test-only CSRF/throttle secrets, `OUTBOX_ENABLED=false`. The final dedicated role suite passed all 17 cases after the bounded-preview/activation refinements. It covers all six transitions, archived correction/activation, preserved credentials, old-session denial, stale and competing commands, wrong/missing/extra/duplicate/foreign mappings, occupied LL, double LL handover, Supervisor routing, QC coverage, self-created approval, delegated/preparation boundaries, rollback on audit failure and completed-decision role retention.
- Migration/seed: an isolated upgrade database applied all 21 migrations archived from `main`, then successfully applied the current migration. A separate fresh migrated database and built API passed the unchanged local seed: two Hosted suppliers and 240 Henkaten, with seed invariants and dashboard checks. No seed change was necessary. Both task-owned databases, seed credentials and photo files were removed afterward.
- Browsers: final full isolated harness passed all 16 journeys (eight Chromium and eight actual Microsoft Edge). Final role-specific Chromium/Edge reruns also passed, including old-session revocation, current-occurrence submission/withdrawal by the replacement LL and restored-account login. Axe checks on the role dialog had no violations; screenshots at 1440/768/390 px were inspected. Single-replacement mapping, retry/stale/blocked component tests passed. A prior broad run was interrupted for the discovered same-occurrence ownership fix and is not the final acceptance run.
- Visual QA: HDS/Inter and orange primary actions retained; 740 px desktop dialog, full-height phone flow, scrollable content, persistent footer and safe-area padding. Captured test DOM and PNGs are outside the repository in the chat visualization folder `role-change/`. A standalone dialog inspection passed at all three widths (0 failures/warnings), allowing only the existing shared floating-dialog shadow. Full-page inspection flags included inert legacy shell typography/covered text, which are outside this dialog change. Source design lint has one explainable false positive on `box-shadow: none`, which explicitly removes inherited button shadows. The retained default configuration remains in the atomic scope but is grouped into the common replacement selection, following the confirmed UI simplification.
- Delivery security repair, 2026-11-02: the existing baseline failed the current high-severity audit. Pinned Zod 4.6.6, Multer 2.5.0, body-parser 2.4.0, Undici 7.30.1 and React Router DOM 7.18.2; updated the distroless cc-debian12 runtime digest to `sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f`. Removed the patched React Router advisory ignore and OpenSSL CVE-2026-84782 image ignore. The five existing exact test/document Gitleaks exceptions and local-development DS-0002 exception were revalidated through 2026-11-30. The remaining unpatched Caddy go-jose/v3 finding is scoped and recorded below. `pnpm security:audit` now passes with 4 low and 17 moderate findings, no high/critical or ignored advisory. OpenAPI was regenerated for Zod's updated datetime patterns (seconds required), nullable schema representation and starts-with metadata; generated TypeScript shapes remain stable.
- Clean delivery parity: removed only ignored generated Prisma/build/Vite artifacts, then used Node 22.23.1 and pnpm 11.16.0 for `pnpm install --frozen-lockfile`, `pnpm runtime:check`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, regenerated/staged OpenAPI then `pnpm openapi:check`, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build`: passed. Unit coverage remains 279 workspace tests plus 2 script tests. `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, and the exact CI integration environment above passed 102 tests/11 files. A fresh archived `origin/main` migration directory applied 21 migrations, current deploy applied migration 22, and `prisma migrate status --config prisma.config.ts` confirmed up to date. The exact migration checker passed against the staged SQL in a disposable Git fixture; the real HEAD-range checker is required after commit.
- Deployment parity: workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0 and Hadolint 2.14.0 passed. `pnpm deployment:validate`, `pnpm security:exceptions:check`, Linux Docker 29 deployment-script harness with real flock and both pinned Ubuntu 22.04 bootstrap `--check` environments passed. All 16 Chromium/actual Edge journeys passed after the dependency patches, and task children/stacks were removed. Patched production acceptance passed, including routing, release identity, CSP/HSTS, non-root/private PostgreSQL, bootstrap idempotency and database/photo persistence. Trivy 0.70.0 HIGH/CRITICAL filesystem and all five rebuilt runtime images passed with the exact registry/ignore file; the official 2026-11-02 database artifact digest was verified before scanning with `--skip-db-update`. Final API packaging uses apt install download-only to extract the complete signed Debian package; its libssl/libcrypto bytes match the original package md5 records and the image scan passed again. Remote CI remains required before reporting successful delivery.
- Cleanup: browser harness descendants were explicitly stopped by matching only task-recorded Vite ports; isolated browser stacks removed their containers/networks/volumes. The task-started local PostgreSQL stack is stopped after checks; unrelated Docker projects are preserved. No task server is intentionally kept running.
- Latest UI refinement, 2026-11-02: replaced individual assignment/default/Henkaten selectors and dependency counts with one combined row and one common replacement. Review shows that replacement once; the client still submits every dependency ID with the same member ID. No API/schema/seed changes. All five role-dialog component tests passed, including 26 mixed references covered by one choice. Supplier/E2E TypeScript, targeted ESLint/Prettier and `git diff --check` passed. Fresh Chromium and actual Edge journeys both passed with one selector, explicit default assignment verification, LL responsibility and same-occurrence submission/withdrawal. The first new default assertion used lineId instead of the established resourceId response field; corrected before the successful rerun. PRD, plan and ADR 0011 reflect the revised interaction.
- Secret scan: `docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 dir /repo --config=/repo/.gitleaks.toml --redact --verbose` passed with no leaks. Before push, run the same image in `detect --source=/repo --config=/repo/.gitleaks.toml --redact --verbose --log-opts=-1` mode, `pnpm migrations:destructive-check origin/main` and confirm a clean working tree.
- Exact runtime scan commands: `docker run --rm -v "$PWD:/repo:ro" -v <fresh-official-cache>:/root/.cache/trivy -w /repo aquasec/trivy:0.70.0 fs --timeout 15m --skip-db-update --no-progress --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed=false --ignorefile .trivyignore --exit-code 1 /repo`; image mode adds the Docker socket and uses `image --timeout 15m --skip-db-update --no-progress --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed=false --ignorefile /repo/.trivyignore --exit-code 1 <image>`. Production acceptance uses the exact CI assertions with isolated project `henkaten-role-publish`, a task-owned env/bind directory, and the workflow example domains/loopback ports.
- Next action: commit and push `feat/member-role-handover`, open a PR to `main`, attach it to this chat and monitor required checks. Do not merge or deploy.

### Runtime scan compatibility, 2026-11-02

The latest distroless base still contains OpenSSL 3.0.20. The API therefore overlays the complete
authenticated Debian `libssl3=3.0.22-1~deb12u2` package payload and original control/md5 metadata
from a separate build stage; no package manager or root shell is added to the runtime. Both
frontend runtimes require Brotli >=1.2.1-r0 and curl/libcurl >=8.23.0-r0; PostgreSQL requires the
same Brotli/libcurl floors. This invalidates stale cached security-upgrade layers. Caddy pins and
asserts go-jose/v4 v4.1.6 after module tidy.

Go-jose/v3 has no upstream patch for CVE-2026-116587. Inspection of the exact compiled dependency
chain found `modules/standard -> modules/caddypki -> smallstep/certificates/authority ->
go.step.sm/crypto/jose -> go-jose/v3`. The configured Caddyfile disables admin and exposes only
three public-domain reverse proxies; it enables neither an internal CA/ACME server nor JWK
provisioning. The private-RSA JWK parser is outside this configured request path. One exact CVE
exception expires 2026-11-16 and must be re-reviewed before any PKI/provisioner/JWK configuration
change. The independent v4 path remains patched and version-asserted. Upstream evidence:
https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q. This is a scoped residual
dependency risk, not a claim that the v3 code is patched.


---

# Previous Session Handoff — Member role lifecycle analysis

- Date: 2026-11-02. Branch inspected: `main`.
- Objective: explain the archived Line Leader / duplicate Supervisor creation screenshots against the PRD and current code. Analysis only; application behavior, schema and product policy were not changed.
- Finding: role immutability is enforced by the edit UI, strict update contract and PostgreSQL trigger. Deactivation retains registration and username reservations. The documented deactivate-and-recreate correction path therefore cannot reuse both original identifiers. Generic Prisma conflict mapping conceals the conflicting field.
- Screenshot evidence: `Pulihkan member` is consistent with an inactive member; the failed action shown is creation of a new Supervisor with the old registration and username. Exact production constraint failure and deployed release were not inspected.
- Follow-up: agree how a person retains their registration and account when their operational role changes, then design an atomic, audited transition covering assignments, pending approvals and session revocation. Do not use fabricated registration numbers or direct role SQL as routine support instructions.
- Validation: static inspection of member service/controller, contracts, UI, schema/migrations, setup import and approval service; existing test assertions were read, not executed. No runtime or production acceptance is claimed. Phase 15 remains in progress; no release gate changed. No processes or containers were started.
- Decision detail: [ADR 0011 review](../docs/adr/0011-permanent-master-data-and-member-account-lifecycle.md).

---

# Previous Session Handoff — Supplemental 4M checklists

- Date: 2026-10-23.
- Branch: `feat/optional-4m-checklist`, created from main `eeb1541`.
- Objective: analyze, plan and implement optional 4M supplements, then document, push and open a monitored PR to `main`. Implementation was explicitly confirmed. Merge/deployment are outside the requested delivery.
- Delivery: implementation commit `a453acf6d20da6c0dfbc26b3fca2d103850697e5` was pushed and [PR #41](https://github.com/khalshaqzzy/supplier-henkaten/pull/41) opened against `main`. Required CI is monitored against the latest PR head; a two-minute thread heartbeat is active until checks/review are complete. No merge/deployment is authorized for this task. Current remote truth must be read from the PR, rather than inferred from this recorded snapshot.
- Scope: no minimum categories/items, no completeness/all-Yes submission gate, no extra checklist confirmation. Existing category/operational requirements, Tanoko, tenant/source/role checks, approval routing and PCR remain effective.
- Implementation: optional Hosted request fields with version/item integrity checks; nullable detail/clone evidence; actual Yes/No/null snapshot answers; empty publication and independent deactivation; optional shared readiness and retained legacy preflight; stable displayed form publication and answer deselection; Supplier detail/setup/editor states; External absent/null/empty/No/unanswered evidence; explicit unanswered export cells; regenerated OpenAPI/client.
- Persistence: migration `20261023002100_optional_checklist_answers` only relaxes `HenkatenChecklistAnswer.answer` nullability, using the exact migration-policy declaration. Historical rows and immutable triggers remain. A versioned supplement snapshots all question labels/order; no version produces no artificial snapshot. Valid same-tenant/category historical publications may retain evidence shown before a later publication/deactivation.
- Plan and decisions: [optionalChecklistPlan.md](optionalChecklistPlan.md), PRD amendment, roadmap and [ADR 0048](../docs/adr/0048-supplemental-4m-checklists.md). Readers must support null/empty evidence. Pre-change application rollback is incompatible with new optional records; retain widened readers/schema in any recovery fix, without fabricated Yes or deleted evidence.
- Phase: 15 remains `in_progress`; staging/device/UAT acceptance has not advanced.
- Quality: official checksum-verified Node 22.23.1 and pnpm 11.16.0; removed only ignored generated/build/browser roots, then `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, `VITE_API_ORIGIN=https://api.example.invalid pnpm build`, `pnpm security:audit` and `git diff --check` passed. Unit result: 273 workspace tests plus repository script tests. Intended generated files were staged before the index-based client drift check. Final test-selector-only correction was rechecked with format/lint/typecheck and the full browser suite.
- Database: `docker compose config --quiet`, `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, then `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=integration-test-csrf-secret-at-least-32 AUTH_THROTTLE_SECRET=integration-test-throttle-secret-32 OUTBOX_ENABLED=false pnpm test:integration` passed all 85 tests/10 files. An initial new fixture omitted its required source mode; corrected before the successful fresh rerun. A separate `optional_checklist_upgrade_test` applied archived `origin/main` migrations using `PRISMA_MIGRATIONS_PATH`, then current `prisma:migrate:deploy` and `prisma migrate status --config prisma.config.ts`: all 21 migrations up to date. The existing migration checker was also run against the staged migration via a temporary index-range copy; its exact nullable-column policy passed. The unmodified HEAD-range command is rerun after commit.
- Browsers: `pnpm --filter @tmmin-henkaten/e2e exec playwright install chromium msedge`, then `pnpm test:e2e` passed all 14 isolated journeys (7 Chromium and 7 actual Microsoft Edge). Dedicated optional-checklist runs also passed both browsers, with no dialogs, direct submission, empty/partial/No/null snapshot/detail/clone assertions, 1440/390 px overflow and axe checks, screenshots visually inspected. The first new test used an exact Part label that omitted the required-field marker; its selector was corrected. A separate full run was interrupted by concurrently regenerating shared build output and triggering Vite context HMR; the successful final full run was isolated from build/type generation. Harness processes, test databases, containers, networks and volumes were removed; ignored failure traces were removed after QA screenshots were copied outside the repo.
- Deployment: workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0 and Hadolint 2.14.0; `pnpm deployment:validate`, `pnpm security:exceptions:check`, the deployment harness in Linux Docker 29 with real flock, and staging/production Ubuntu 22.04 bootstrap input checks passed. Production-like Compose built all five images with `--pull`, applied migrations/bootstrap, and passed readiness, three-domain routing/release identity/deep-link, 401 API/SSE, HSTS/CSP/header, non-root/private-PostgreSQL, idempotent-bootstrap and restart/persistence assertions. It used a task-owned project and bind directory, then stopped its stack.
- Scans: checksum-verified Trivy 0.70.0 HIGH/CRITICAL filesystem (staged source; vuln/secret/misconfig) and all five rebuilt production images passed with existing exact exceptions. Dependency audit passed with 12 moderate and the existing ignored high advisory; no scanner rule/exception was changed. Gitleaks 8.24.3 directory scan passed with no leaks after browser artifact cleanup; the one-commit Gitleaks scan also passed before push. Post-commit `pnpm migrations:destructive-check origin/main` and `pnpm openapi:check` passed with a clean working tree. Remote PR checks are not inferred from local results.
- Seed compatibility: no seed edit is needed; populated checklist seed/fixtures remain valid optional examples. Fresh `prisma:migrate:deploy`, protected bootstrap and `local:seed` against the separate Docker `optional_checklist_seed` database and built loopback API passed: 2 Hosted suppliers, 240 Henkaten, Line–Shift configuration, dashboard and outbox invariants. Temporary API, database, photos/exports and generated credentials were removed; the local main database was not reseeded.
- Cleanup: task-owned test, upgrade, seed, production and browser resources are stopped/removed; `pnpm db:down` completed. OrbStack was initially stopped and started for validation; existing unrelated `flowlens-demo-api-1` and `flowlens-demo-db-1` containers resumed automatically and were preserved. No task-owned runtime remains.
- Next action: monitor PR #41 at its latest head, inspect required jobs and failure logs, resolve branch-related failures under the same local validation rules, and report ready only after all required checks pass. Stop the heartbeat after completion or PR closure. Do not merge/deploy. The delivery-record follow-up changes documentation only; application and database acceptance evidence above remains applicable.

---

# Current Session Handoff — Main CI dependency repair

- Date: 2026-10-23.
- Branch: `fix/main-ci-vite`, based on main merge `de43aff37e088eece18e3b7cc23db8e282f9c940`.
- Objective: restore Release CI after run `39905812974` failed the complete-lockfile audit and Trivy filesystem scan.
- Cause: Vite 8.1.5 is affected by GHSA-587h-7wmj-h5pm / CVE-2026-112942. The advisory was added to the scanner databases after the feature PR checks passed.
- Change: pin both portal dependencies to Vite 8.1.6 and regenerate the shared lockfile, including Vitest/plugin peer references. The fresh runtime scans additionally found Caddy compress v1.18.6 affected by CVE-2026-63209; its Dockerfile now floors and asserts v1.18.7 after module tidy. No ignore, audit threshold, workflow, application contract, seed, schema or migration change is required.
- Decision: use the patched release on the existing 8.1 line; preserve all security gates and existing exact exceptions. See ADR 0008.
- Phase: 15 remains `in_progress`; deployment and device/UAT acceptance are separate gates.
- Delivery: PR #39 has merged; its completed heartbeat monitor was deleted. This repair is validated separately against the new main base.
- Verification: official SHA-256-verified Node 22.23.1 and pnpm 11.16.0; clean-artifact frozen install, formatting, lint, typecheck, 266 workspace unit tests plus script tests, OpenAPI/client drift and production builds; `pnpm security:audit` passes with 12 moderate and the pre-existing exact ignored high advisory. The final rerun removed ignored API/generated/portal/shared build roots first, repeated the workflow quality commands in order, and passed with no generated contract drift.
- PostgreSQL: `docker compose config --quiet`, `pnpm db:up`, `db:wait`, `db:verify`, `db:test:reset`, `db:test:migrate`, then the exact CI `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<CI test value> AUTH_THROTTLE_SECRET=<CI test value> OUTBOX_ENABLED=false pnpm test:integration` passed all 81 tests/10 files. `pnpm migrations:destructive-check origin/main` passed. Previous-main archive migrations followed by current migration deploy/status passed all 20 migrations on a separate upgrade database. Both databases/stacks were cleaned up.
- Browsers: pinned Playwright Chromium/standard Microsoft Edge install and `pnpm test:e2e` passed all 12 isolated journeys (six per browser), including cookie restoration/logout. Harness-owned servers, volumes, networks and databases were removed.
- Deployment: workflow-pinned Actionlint, ShellCheck and Hadolint; `pnpm deployment:validate`, `pnpm security:exceptions:check`, Linux Docker 29 deployment harness with real flock; Ubuntu 22.04 staging/production bootstrap checks passed. An initial helper download failed on local container DNS; the helper-only retry used `--dns 1.1.1.1` and passed, without changing repository or engine DNS configuration.
- Containers: exact workflow build/start/routing/header/release-identity/non-root/private-database/idempotent-bootstrap/restart-persistence steps passed after the compression patch. Trivy 0.70.0 (checksum verified, fresh DB) filesystem and all five rebuilt production images passed HIGH/CRITICAL with existing exact ignores. The first expanded scan found the compression issue and was rerun after patching; no new exception was added.
- Secrets: Gitleaks 8.24.3 directory scan passed after removing only ignored browser artifacts. An earlier scan during active E2E found generated test credentials in traces; those transient artifacts were removed, without changing scanner rules. Commit-mode scan is required before push.

---

# Current Session Handoff — Persistent browser sessions

- Date: 2026-10-20
- Branch: `feat/session-duration`.
- Objective: implement the confirmed 30-day fixed lifetime for eligible direct logins across all six TMMIN/Supplier roles, including restricted Hosted Preparation, while retaining short delegated/forced-change sessions.
- Status: implementation complete; subsequent delivery authorization covers commit/push on `feat/session-duration`, a comprehensive PR, checks monitored every two minutes, and merge into `main` after successful required checks. Local pre-commit delivery evidence is recorded below. Phase 15 remains `in_progress`; device/UAT gates are not waived.

## Implementation and decisions

`SessionService` now uses one classifier for creation and active touches. A completed-password direct login receives equal idle/absolute deadlines exactly 30 days from the injected clock. Delegated sessions (either actor identifier) and sessions requiring password change retain a 30-minute sliding idle deadline capped at their original 12-hour absolute deadline. Active requests never move the absolute deadline. Passive resolution remains read-only. Conditional touches preserve optimistic version checks and add unrevoked/unexpired predicates; existing request/write-boundary authorization remains necessary for concurrent revocation.

Cookie issuance already uses the stored absolute deadline and required attributes, so no cookie/client/provider rewrite was needed. Existing password/authorization/source epochs, active-account/supplier checks, CSRF/Origin, hash-only token storage, realm isolation, passive SSE revalidation, and delegated-parent checks remain intact. TMMIN Account now shows one effective `Sesi berakhir` value with concise header copy. The session feature required no schema migration, API-shape, generated-client, runtime-env or application dependency change. Delivery additionally updates runtime-image packages and Go build dependencies as recorded below.

Existing expired/revoked sessions are never revived or mass-extended. Still-valid legacy direct sessions can normalize idle to their original absolute bound on a throttled request, retaining their original 12-hour deadline/cookie. Full persistence begins at the next eligible login. Code-only rollback remains compatible but does not immediately revoke already-issued long sessions; older code may shorten idle on a later touch.

Changed files: API session service; new session unit, production-cookie facade unit and clock-overridden HTTP/PostgreSQL integration tests; TMMIN Account and app test; new Chromium/Edge cookie-restoration journey; PRD section 9.3/amendment, roadmap, implementation plan, ADR 0009 and this handoff. Ordinary login/magic-link create callers pass full Prisma users with the required password-change flag. Local seed uses the existing HTTP payloads, so no seed or fixture source edit was required.

## Local verification — 2026-10-20

- Runtime: official Node 22.23.1 Darwin arm64 archive was SHA-256 verified against its official manifest in a task-specific temporary runtime directory; pnpm 11.16.0. Initial focused development checks used installed Node 22.23.2; final verification uses the pinned runtime. `pnpm install --frozen-lockfile` passed. Initial implementation acceptance did not claim clean-artifact pre-commit parity; the subsequent delivery rerun is recorded below.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: passed after correcting a new browser-test import. The final extra short-boundary unit cases also passed focused ESLint.
- `pnpm test:unit`: passed all workspace suites (contracts 44, fixtures 6, API client 9, UI 21, API 95, Supplier 75, TMMIN 16), plus repository script tests. The initial Account fixture lacked the route capability; it was corrected and the full suite rerun successfully.
- Docker PostgreSQL: `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`: passed on disposable `supplier_henkaten_test`, all 20 existing migrations. No migration was added.
- `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<safe-test-value> AUTH_THROTTLE_SECRET=<safe-test-value> OUTBOX_ENABLED=false PCR_WORKER_ENABLED=false LOG_LEVEL=error pnpm test:integration`: all 81 tests/10 files passed. The new 19-test suite covers all six roles, multi-day inactivity, exact day-30 cutoff, unchanged fixed deadlines, CSRF-backed mutation and negative Origin/token/realm cases, forced-change relogin, preparation restrictions, epochs/deactivation/logout/reset, legacy transition, passive resolution and short delegated-parent expiry. The initial preparation assertion expected a capability not present in the existing role grants; it was corrected to assert the actual restricted master-data capabilities without changing product authorization.
- `pnpm openapi:check`: passed; generated client regeneration has no diff. `VITE_API_ORIGIN=https://api.example.invalid pnpm build`: passed for API and both portals. Existing build warnings do not fail the build.
- `pnpm deployment:validate`: passed staging env validation and remote Compose config. This is configuration validation, not deployment.
- Fresh isolated seed smoke: a dedicated `supplier_henkaten_session_seed` database applied all migrations, bootstrapped a temporary protected admin and ran built API plus `LOCAL_SEED_CONFIRM=supplier-henkaten-local-seed ... pnpm --filter @tmmin-henkaten/api run local:seed`: passed with two Hosted suppliers and 240 Henkaten; independent supplier count returned 2. The first extra count query targeted the maintenance database after successful seed; the harness was corrected and the full fresh smoke rerun. Temporary API, database, photos/exports and credentials were removed in the harness finally block. Main development data was not seeded or reset.
- `pnpm test:e2e`: passed all 12 isolated journeys, six Chromium and six actual Microsoft Edge, including the new session-restoration journey in both browsers. The standard installed Microsoft Edge application was used; no executable override was required. The new journey restores both portals from only persistent cookie state in a fresh context, reopens tabs, verifies 30-day cookie timestamps/session response, performs UI logout and denies later protected access. This is not a physical OS/browser restart claim. The TMMIN Account screenshot was visually inspected at 1280px and has one clear expiry entry.

## Remaining release work and cleanup

Complete cross-domain HTTPS/persistent-profile restart, device/PWA acceptance and existing release gates on staging. The delivery validation below supplies the local workflow checks for the requested commit. Remote checks and deployment outcomes must be verified against the actual PR/merge SHA; local evidence alone does not imply those outcomes. No new policy question remains.

All E2E-owned API/web processes, databases, Compose networks/volumes and temporary photo roots were removed by the successful harness. `pnpm db:down` removed the session-started local database container/network while preserving its volume. Fresh seed processes/database/credentials were removed. Documentation link/code-fence and `git diff --check` validation passed. `docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 dir /repo --config=/repo/.gitleaks.toml --redact --verbose` passed with no leaks (334.53 MB scanned). No broad scanner exception was added. The final API-only typecheck also passed after the additional short-boundary unit tests. OrbStack was started only for verification and restored to its initial stopped state after task-container cleanup; pre-existing unrelated container definitions/volumes were not changed. No task-owned runtime remains.


## PR delivery validation — 2026-10-20

Both workflows were inspected before delivery. `main` is still the PR base at `139a03d0074676b2ae7504e3b94d5ab894f80b72`; it has no new migration beyond the existing 20. A merge to `main` triggers the existing Production deployment caller after Release CI passes. The delivery plan is to push the current feature branch, create a comprehensive PR, monitor checks every two minutes, and use a normal merge commit only after required checks pass; branch protection must not be bypassed.

Clean-artifact parity uses checksum-verified Node 22.23.1 and pnpm 11.16.0: `pnpm clean`, remove only Git-ignored generated/build roots, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build`: passed. Generated OpenAPI/client files have no diff.

`docker compose config --quiet`; `pnpm db:up`; `pnpm db:wait`; `pnpm db:verify`; `pnpm db:test:reset`; `pnpm db:test:migrate`; exact CI `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<safe-test-value> AUTH_THROTTLE_SECRET=<safe-test-value> OUTBOX_ENABLED=false pnpm test:integration`: all 81 tests/10 files passed. `pnpm migrations:destructive-check origin/main` passed. A dedicated `supplier_henkaten_upgrade_test` applied `git archive origin/main apps/api/prisma` using `PRISMA_MIGRATIONS_PATH`, then current migrate deploy/status; all 20 migrations are up to date. Upgrade DB was dropped and `pnpm db:down` stopped the local database stack.

`pnpm --filter @tmmin-henkaten/e2e exec playwright install chromium msedge` succeeded using the installed standard Edge application; `pnpm test:e2e` passed all 12 isolated journeys (six Chromium, six actual Edge) again after the clean-artifact rebuild. The harness removed its processes, containers, networks, volumes and photo roots.

Workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0 and Hadolint 2.14.0 passed. Both staging and production Ubuntu 22.04 bootstrap input checks passed. The deployment-script harness passed inside Linux Docker 29 CLI with bash/jq/util-linux/git/coreutils and real `flock`; this is not the weaker macOS no-flock result. `pnpm deployment:validate` and `pnpm security:audit` passed; audit retains the existing exact high React Router exception and 11 moderate findings.

Security delivery prerequisites discovered during the expanded checks:

- `.agent/securityExceptions.json` had an expired existing `CVE-2026-84782` exception. Revalidated on 2026-10-20 using the [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-84782) and unchanged TCP/Go TLS paths: Debian bookworm still has no fixed OpenSSL 3.0 package and the application does not enable the required OpenSSL DTLS path. Only that existing exact exception is renewed through 2026-10-31 with updated rationale; no new broad ignore is added. The exception registry check passes.
- Both frontend runtime Dockerfiles now require `libexpat>=2.9.0-r0` and `libx11>=1.8.14-r0`, alongside the prior pcre2/tiff floors. This forces the patched distribution packages instead of reusing an old cached upgrade layer. Fresh image scans confirm `CVE-2026-77214` and `CVE-2026-88806` are absent. The [Alpine tracker](https://security.alpinelinux.org/vuln/CVE-2026-77214) confirms the expat fixed version.
- The Caddy build moves from Go 1.25.13 to digest-pinned Go 1.26.10, pins `golang.org/x/net` 0.60.0, and aligns its required x/crypto 0.57.0 and x/text 0.42.0. Existing post-tidy version assertions are retained and extended for x/net. Caddy remains 2.11.4 and grpc remains 1.83.2. These address scan findings `CVE-2026-78667`, `CVE-2026-78669`, and `CVE-2026-97031`; the current [Go release history](https://go.dev/doc/devel/release#go1.26.10) also records the 19 October x509 fix. Module requirements were checked from the official Go proxy before finalizing compatible pins.

Trivy 0.70.0 was downloaded from the official release and checksum verified, with a freshly downloaded vulnerability database. Complete source export scanning uses every tracked and non-ignored untracked source file, no broad source exclusions, and the committed exact ignore file. Final delivery gate: all five final runtime images passed Trivy 0.70.0 `image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed=false --ignorefile .trivyignore --exit-code 1`; the complete clean source export passed `fs --scanners vuln,secret,misconfig` with the same severity/ignore settings. No high/critical finding remains outside the exact registered exceptions. The final rebuilt stack passed the workflow routing/release-identity, deep-link, 401 API/SSE, HSTS/CSP/no-server-header, non-root/private-database, idempotent bootstrap and restart/persistence assertions. It used an isolated Compose project and task-owned bind path; all task containers/networks were stopped. Hadolint and source scans were repeated after the runtime security patches. Final format/exception/diff checks passed; directory Gitleaks is run immediately before commit and commit-mode Gitleaks before push. Remote PR/check/merge evidence is reported against the published head and is not inferred from local acceptance.

---

# Previous Session Handoff — Persistent session analysis and implementation plan

- Date: 2026-10-20
- Branch inspected: `feat/session-duration`.
- Objective: analyze longer inactive-browser sessions for TMMIN and Supplier and prepare a complete implementation plan.
- Status: planning complete; application implementation remains planned. Phase 15 remains `in_progress`; no acceptance/release gate advances.
- Confirmed product choices: 30 fixed days from successful login for all six TMMIN/Supplier roles, including direct restricted Hosted Preparation; no earlier idle limit. Delegated magic-link access and any session still requiring password change retain 30-minute idle/12-hour absolute limits.
- Findings: server deadlines, not absent persistent cookies, cause frequent relogin. Ordinary cookies already expire at the absolute deadline and both portals restore through the session endpoint. Mounted query polling cannot preserve a session while the browser is suspended/closed. Magic-link redemption and delegated-parent validation must retain the short exception and independent parent checks.
- Plan: shared server lifetime classification; equal 30-day deadlines for eligible direct sessions; capped short idle touches; passive validation unchanged; existing cookie/CSRF/epoch/revocation boundaries; one effective TMMIN Account expiry. No schema, API-shape, runtime-config or refresh-token addition is required.
- Legacy behavior: no mass extension or revival. A still-valid old direct session can normalize idle to its original absolute bound on activity, but retains that original 12-hour deadline/cookie; full persistence starts at next eligible login. Code rollback does not immediately revoke already issued long sessions.
- Files changed: `.agent/sessionPersistencePlan.md`, PRD amendment, implementation roadmap, this handoff and lifetime amendment in ADR 0009. Application source, generated artifacts and runtime configuration were not changed.
- Validation: static source/contract/schema/ADR/test-harness inspection; documentation whitespace and relative-link checks passed. All three clarification questions were answered. No unit, integration, browser or deployment verification is claimed for the planned implementation.
- Open questions: none required for the agreed scope. Existing sessions' transitional behavior is documented explicitly; no zero-login migration is promised.
- Next action: implement the ordered work in `sessionPersistencePlan.md`, run clock-based unit and PostgreSQL HTTP/revocation tests, Chromium/Edge restoration checks, fresh isolated seed smoke, then the required delivery/staging checks before any completion claim.
- Cleanup: no server, worker, watcher or Docker container was started; no database/session was changed. No commit, push or deployment was performed.

---

# Previous Session Handoff — TMMIN Henkaten visibility deletion

- Date: 2026-10-09
- Objective: implement individual and supplier-wide Henkaten deletion for TMMIN Admin and Quality with polished confirmation flows, internal historical retention, unchanged MP, and delivery by PR to main.
- Branch: `feat/tmmin-henkaten-deletion`, based on main `fdaaf23cb29c219b71b1c59733b1db0164541547`.
- Status: implementation complete; local CI parity verified as recorded below. Delivery targets main by feature PR; no staging/device/UAT or governance gate is advanced. Inspect the branch's Release CI and attached PR for final remote delivery evidence.
- Phase: Phase 15 remains `in_progress`; implementation does not complete staging/device rehearsal.
- Decisions: both TMMIN roles; every business status, source and epoch; active/inactive suppliers; hide all application evidence while retaining internal records; no Cancelled transition; keep effective MP unchanged, including Approved Man. There is no restore/archive UI. Withdraw retains its established Supplier behavior.
- Changes: schema and additive migration; deletion capability/contracts/client/OpenAPI; supplier-locked idempotent command receipts; visible-only API/read-model queries; related warning/PCR/audit/ingestion/notification suppression; outbox/realtime/push safeguards; export creation/publication/download invalidation; clone source-link suppression; detail/supplier dialogs, retry states and feedback; 15-second active query refresh and focus refresh in both portals; regression/browser tests; security baseline patch updates; PRD, roadmap and ADR 0047.
- Runtime: official Node 22.23.1 darwin-arm64 archive checksum verified; pnpm 11.16.0. Checks prepend `/tmp/henkaten-deletion-tools/node-v22.23.1-darwin-arm64/bin` to PATH. Docker PostgreSQL 18.4/pgvector 0.8.5; isolated databases only. Microsoft Edge 155.0.4283.45 is the actual Microsoft browser, copied from its official universal package because the standard Playwright installer requires root; no system permission changes were made.

## Verification commands and evidence

The required workflow was read from `.github/workflows/ci.yml`; the deployment reusable workflow is push-only and no deployment is requested. The clean-artifact quality sequence used `pnpm clean`, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, then `VITE_API_ORIGIN=https://api.example.invalid pnpm build`. All passed. The intended generated OpenAPI client was staged before its drift check, so the check validates byte stability rather than rejecting the intended contract addition. Final test-only additions were followed by API typecheck/integration and workspace lint/format checks.

- Unit suites: scripts 2, contracts 44, fixtures 6, client 9, UI 21, API 71, TMMIN 15 and Supplier 75 passed. The new UI test proves the immutable request/key is reused after an uncertain network result and dialog reopening.
- `docker compose config --quiet`; `pnpm db:up`; `pnpm db:wait`; `pnpm db:verify`; `pnpm db:test:reset`; `pnpm db:test:migrate`: passed, all 20 migrations from empty. `NODE_ENV=test DATABASE_URL=postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test RELEASE_SHA=ci SESSION_CSRF_SECRET=integration-test-csrf-secret-at-least-32 AUTH_THROTTLE_SECRET=integration-test-throttle-secret-32 OUTBOX_ENABLED=false pnpm test:integration`: passed; final API integration suite 62 tests/9 files after clone/late-PCR additions.
- Upgrade: create isolated `supplier_henkaten_deletion_upgrade_test`; `git archive main apps/api/prisma | tar -x -C <temporary root>`; run `PRISMA_MIGRATIONS_PATH=<temporary root>/apps/api/prisma/migrations pnpm --filter @tmmin-henkaten/api run prisma:migrate:deploy`, current `prisma:migrate:deploy`, then `prisma migrate status --config prisma.config.ts`: passed, database up to date. The existing migration-policy checker was run precommit with its changed-file enumeration explicitly including the pending migration; SQL passed unchanged static policy. Standard `pnpm migrations:destructive-check main` is also required after commit.
- `pnpm --filter @tmmin-henkaten/e2e exec playwright install chromium msedge`: Chromium succeeded; Edge standard installer hit a root requirement. Official Edge package extraction completed without root. `pnpm test:e2e`: all five Chromium and five actual Edge journeys passed. Deletion journey verifies Admin individual Approved deletion, Quality bulk deletion, required reason/code, focus containment, axe, unavailable detail, empty projections, denied replay and 390px mobile layout. Screenshots were visually reviewed; dialog contrast, icons and concise mobile footer were refined.
- Fresh seed compatibility: no seed source change is required for nullable visibility metadata. In isolated `supplier_henkaten_deletion_seed`, deploy migrations, `pnpm admin:bootstrap`, launch the built API with development-only seed budgets and outbox enabled, then `LOCAL_SEED_CONFIRM=supplier-henkaten-local-seed LOCAL_SEED_API_ORIGIN=http://127.0.0.1:3101 LOCAL_SEED_CREDENTIALS_PATH=<temporary path> pnpm --filter @tmmin-henkaten/api run local:seed`: passed, two Hosted suppliers and 240 Henkaten. API/database/photos/exports/credentials were removed by the harness.
- `pnpm deployment:validate`; workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0, Hadolint 2.14.0; `bootstrap-vm.sh --check` for staging and production in pinned Ubuntu 22.04; Linux Docker CLI harness with bash/jq/util-linux/git/coreutils running `bash deploy/tests/deployment-scripts.sh` (real flock): passed. The initial Alpine repository fetch failed transiently; retry passed.
- Production Compose: `docker compose --env-file deploy/env/runtime.staging.env.example -f deploy/compose/docker-compose.remote.yml build --pull postgres api supplier-web tmmin-web caddy`; start postgres; run operations `migrate` and `bootstrap-admin`; start/wait five services; verify three domain release/readiness identities, SPA fallback, unauthenticated API/SSE, HSTS/CSP, absence of server-identifying headers, non-root users, unexposed DB, idempotent bootstrap, marker/database-system-identifier persistence across restart: passed after final dependency/runtime patch builds.
- `pnpm security:exceptions:check`; `pnpm security:audit`: passed. Newly reported proxy-addr/source-map-js/sharp advisories were patched rather than ignored. Existing scoped React Router exception remains; audit reports 11 moderate and one ignored high. Expired OpenSSL QUIC exception was removed after current Debian evidence marked bookworm unaffected. Frontend pcre2/libtiff minimum patched versions were required after initial image scan found two fixable highs.
- Trivy 0.70.0 matches the pinned action default. `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed=false --ignorefile .trivyignore --exit-code 1 .`, and `trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed=false --ignorefile .trivyignore --exit-code 1 <each of the five production images>`: final scans use native arm64 CLI with the exact committed ignore file. Container DNS/download attempts failed; native CLI completed. Source and all five final image scans passed with zero HIGH/CRITICAL findings.
- `docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 dir /repo --config=/repo/.gitleaks.toml --redact --verbose`: no leaks; repeated after final documentation. `git diff --check`: passed. Commit-mode Gitleaks and remote required jobs are checked after commit/push.

## Review notes and limits

- Export job creation now takes the same Supplier lock as deletion, closing a race where a concurrently created pre-deletion snapshot could otherwise miss invalidation. Publication also conditionally checks invalidation, and invalidated running jobs are eligible for expiry cleanup.
- Man calculation intentionally retains deleted Open/Approved evidence internally; board indicators use visible-only readers. Operational context was compared before/after deletion for both roles and every Hosted status.
- Bulk receipts are checked before current preview validation: an exact retry cannot remove records submitted later. Preview refresh is disabled while confirming except explicit stale/error recovery. Bulk SQL uses array predicates rather than one JSON audit predicate per record.
- Late notification generation/read and PCR completion share the supplier boundary; pending push/outbox are suppressed. Already delivered OS notifications and downloaded files cannot be recalled; application links become unavailable.
- Active mounted query views refresh every 15 seconds and on focus; the deleting client invalidates immediately. Supplier delete does not remove Supplier setup/accounts.
- Physical database purge and application undo are outside the product contract. Exceptionally large bulk operations may require measured asynchronous processing; the transaction is bounded to 60 seconds.
- Pre-existing `.DS_Store` modification is preserved and excluded from delivery.
- Next action: review the feature PR and required Release CI; deploy through normal main release workflow only after review. Complete outstanding Phase 15 staging/device/governance acceptance separately.
- Cleanup: session-owned dev/seed/E2E processes and local/production-like Compose stacks were stopped; no inspection server remains running.

---

# Previous Session Handoff — Henkaten withdrawal and retention analysis

- Date: 2026-10-09
- Objective: explain current Henkaten deletion/cancellation rules from the PRD, current implementation and retained architecture decisions.
- Status: static analysis complete; application code, schema and API behavior were not changed. Phase 15 remains `in_progress`; no release or UAT gate was advanced.
- Completed: traced Supplier detail actions, capability/Hosted/tenant checks, historical LL ownership, version/reason validation, serializable finalization, recurring Man restoration, clone behavior, database immutability, External cancellation and setup retention. Persisted Henkaten has no delete path; Open cancellation uses Withdraw, and occurrence expiry does not auto-cancel it.
- Findings: OpenAPI requires and the client sends Idempotency-Key for Withdraw, but its controller/service do not consume or persist it. A retry after committed cancellation returns 404 rather than the original successful result. Clone is independent and available on all LL-visible statuses; withdrawal uses historical occurrence ownership rather than current LineShift assignment or an explicit creator-user comparison. PCR is not cleared by withdrawal.
- Decisions: preserve the existing retention policy and distinguish superseded Start/End Shift and reservation rules from current recurring operations. No new deletion permission or cancellation workflow was adopted.
- Files changed: this handoff, implementationPhases.md and the current withdrawal/retention review in ADR 0014.
- Open questions/next action: if cancellation changes are commissioned, specify receipt-based retry/error semantics and whether responsibility for old Open records should transfer when an LL is reassigned or deactivated; add focused integration coverage for those cases, partial approval, races and multiple Man overrides.
- Validation: read PRD/rules/handoff/roadmap/ADRs; searched and inspected application code, contracts, generated OpenAPI, SQL triggers, existing integration tests and prior browser QA evidence. No new unit, integration or browser test run was performed. No server, worker or Docker container was started; unrelated existing `.DS_Store` changes were preserved.

# Previous Session Handoff — Supplier setup import and reset

- Date: 2026-09-30
- Branch: `feat/setup-import-reset`, created from `main` at `e540d97` following the explicit branch instruction; prior edits were preserved.
- Objective: implement the approved setup workbook import, export relocation, polished loading/review/error states and password-confirmed reset.
- Status: implemented and pushed; PR #37 targets `main`. A follow-up addresses GitHub CodeQL annotations, and remote checks must be green before reporting delivery complete. Merge and deployment are not requested. Phase 15 remains `in_progress`; staging/device and production acceptance gates remain unchanged.

## Implemented behavior

Master Data offers Import Data; Supplier Admin Export Excel moved to the Henkaten list, and TMMIN export and standalone Part import remain available. The responsive dialog parses a bounded XLSX in a worker, reviews new/changed/archived data per sheet, provides explicit Update/Skip/Restore and MP linkage, masks passwords, reports sheet/row/column errors, offers error downloads and recovers durable operation status. Loading states use stable skeleton/button geometry, truthful reading/validation/matching/application labels and reduced motion; reset combines verification/application in one truthful label.

The comprehensive template includes Panduan plus eight data sheets. It contains per-sheet/per-column instructions, conditional account fields, limits, reference rules and dropdowns, text identifiers, frozen headers and header notes. Valid examples cover 10 members (Supervisor, four LLs, QC, four MPs), two lines, four jobs with all skill categories, three parts including leading zeroes, two daytime/overnight shifts, four Line–Shifts, eight MP assignments and twelve checklist questions across four categories. The 45 source rows produce 37 setup records/category publications. Reference dropdowns allow typed existing codes absent from the file; validation lists and formatting can be copied to additional rows.

Imports merge and preserve omitted data. New operational account usernames/passwords come from Excel, require first-login password change, and preserve existing password hashes. Tanoko, photos and Canvas are manual. Checklists publish complete new category versions after review. Stable import codes, setup revisions, a current checklist publication pointer and reset archive timestamps are additive schema changes.

Import stores an idempotent durable operation with only hashed new credentials, validates selected references and authorization at the transaction boundary, serializes with ordinary setup writes, commits atomically and clears temporary payloads at completion/failure. The worker supports lease-based recovery after restart. Reset requires the directly signed-in Admin's password, blocks any Open Henkaten or pending import, archives all setup including ordinarily inactive records, clears mutable assignments/drafts/Tanoko/Canvas, deactivates operational users and revokes their sessions/push subscriptions. Admin and Henkaten/audit/publication/Tanoko histories remain retained. Reset-archived rows do not appear in Tanoko; checklist eligibility follows the current pointer.

Changed areas: Prisma migration/schema, contracts/client/OpenAPI, master-data planning/service/controller/template/lock, existing mutation coordination, checklist/readiness/Henkaten eligibility, Supplier Account/Master Data/Henkaten pages and dialog styles, parser/unit/integration/E2E tests, PRD/roadmap and ADR 0046.

## Local verification

- Host Node 22.23.2 and pnpm 11.16.0; CI-pinned Node remains 22.23.1. No clean-artifact delivery parity or commit is claimed.
- `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`: Docker PostgreSQL 18.4/pgvector; all 19 migrations applied from empty.
- Main-to-current upgrade in isolated `supplier_henkaten_setup_upgrade_test`: archived main migration directory, then current deploy; passed. `pnpm migrations:destructive-check main` passed.
- `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<test value> AUTH_THROTTLE_SECRET=<test value> OUTBOX_ENABLED=false pnpm test:integration`: 56 tests/9 files passed after a fresh test DB reset. The setup suite additionally passes with the expanded template and checks 37 records, credentials, repeat/merge, bad references, stale revision, Open blocking, Closed history, reset/restore and queued-session revocation.
- `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, API OpenAPI drift check and generated-client regeneration passed before the final template expansion; final-state suites passed: contracts 44, fixtures 6, client 9, UI 21, API 71, TMMIN 14 and Supplier 75.
- `VITE_API_ORIGIN=https://api.example.invalid pnpm build`: production applications passed before template expansion; final expanded-template build passed.
- Full Chromium harness: all five journeys passed. Setup journey separately passed on Chromium and Edge, with actual downloadable workbook import, checklist review, 1440/1280/768/390 px screenshots, axe checks, export relocation and Account password reset. Final expanded-template journey passed on both Chromium and Edge, including axe checks.
- Seed compatibility: seed uses individual APIs and checklist publish, so no seed source change was needed. Fresh isolated seed smoke against the built API and all migrations completed with two Hosted suppliers and 240 Henkaten; temporary API, database, uploads and credentials were removed. The harness required enabled outbox and development-only larger request budgets. Initial harness attempts failed due overlapping build removal, default rate limits and disabled outbox; these were harness configuration failures, resolved before the successful smoke.
- `docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 dir /repo --config=/repo/.gitleaks.toml --redact --verbose`: no leaks found. `git diff --check` passed.

Intermediate issues corrected: Job skill categories now use HIGH/MEDIUM/LOW, relational sheets no longer assume a code column, nested checklist item create matches the Prisma schema, current publication fixture pointers are populated, malformed operation IDs are rejected, protected parser tests cover both import routes, contrast failures were corrected, result text/route test assertions follow the actual UI, and reference linking clears stale decisions.

## Remaining acceptance and next action

Review the diff and actual template. Production-scale maximum-row/hash concurrency, restart fault injection and live Microsoft Excel editing remain staging/UAT acceptance; browser/parser/real PostgreSQL tests cover local correctness. The original implementation checks did not claim delivery parity. The requested PR delivery adds exact-runtime clean-artifact checks and production container/security parity below. Merge and staging/production deployment remain outside this task. Session-started API/dev servers, seed/upgrade databases and credentials were removed. The local Compose PostgreSQL stack is stopped after verification.

---

# Previous Session Handoff — Main audit fixes

- Date: 2026-09-30
- Branch: `fix/main-audit-findings`, created from clean `main` at `035c41631405d01df4c78deb30c4892b00ea650a`
- Objective: resolve the five security findings and four correctness findings from the Standard main audit.
- Delivery: user subsequently authorized pushing this branch and opening a comprehensive PR to `main`; merge and deployment are outside this delivery request.
- Phase: Phase 15 remains in progress; staging/device and release acceptance gates are unchanged.

## PR delivery validation — 2026-09-30

Exact pinned runtime: Node 22.23.1 (official archive checksum verified, temporary PATH) and pnpm 11.16.0. Began with `pnpm clean`, removed only ignored generated/build roots, then `pnpm install --frozen-lockfile`. Delivery scans detected newly indexed high-severity Undici and brace-expansion advisories; existing overrides and lockfile are patched to 7.29.1 and 5.0.11 respectively. An exact Trivy exception for CVE-2026-84782 expires 2026-10-14: the newly reported OpenSSL DTLS retransmission vulnerability has no fixed Debian bookworm package, including the current distroless base; API/Prisma/PostgreSQL use TCP and Caddy uses Go TLS, with no OpenSSL DTLS path. The upstream advisory and Debian tracker are linked in securityExceptions.json. Other findings remain scanned.

Completed checks:

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm openapi:check`; production `VITE_API_ORIGIN=https://api.example.invalid pnpm build`. Repeated after dependency updates.
- `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, then `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<test value> AUTH_THROTTLE_SECRET=<test value> OUTBOX_ENABLED=false pnpm test:integration`: 49 tests/8 files passed.
- Previous-main upgrade: `git archive origin/main apps/api/prisma`, previous `PRISMA_MIGRATIONS_PATH` plus current `pnpm --filter @tmmin-henkaten/api run prisma:migrate:deploy`, then `prisma migrate status --config prisma.config.ts` in `supplier_henkaten_upgrade_test`: all 18 migrations applied, current schema up to date; `pnpm db:down` completed.
- `pnpm migrations:destructive-check origin/main`, `pnpm deployment:validate`, `pnpm security:exceptions:check`, `pnpm security:audit`: passed (audit retains 8 moderate and one existing ignored high).
- Workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0 and Hadolint 2.14.0 Docker images; deployment harness in Linux `docker:29-cli` with real `flock`; pinned Ubuntu 22.04 staging/production `bootstrap-vm.sh --check`: passed.

Final delivery checks passed:

- `pnpm test:e2e`: all eight isolated journeys (four Chromium, four Microsoft Edge). Chromium installed by Playwright 1.62.0; Edge 154.0.4258.48 was extracted from the official hash-verified package into a temporary directory and selected through `E2E_EDGE_EXECUTABLE_PATH`, avoiding global installation. A first run overlapped shared-artifact builds and reported a Vite hot-reload/provider error; the full stable-artifact rerun passed. All ephemeral journey containers/volumes and processes were cleaned.
- The `containers` job run steps from `.github/workflows/ci.yml`: rebuilt all five production images with `--pull`, ran migrate/bootstrap, verified routing/release/headers/non-root/private PostgreSQL and persistence after restart, then stopped the stack.
- Trivy 0.70.0 with a refreshed vulnerability database: `fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignorefile .trivyignore --exit-code 1`, and `image --scanners vuln --severity HIGH,CRITICAL --ignorefile .trivyignore --exit-code 1` for API, Supplier, TMMIN, PostgreSQL and Caddy: passed with the exact registered exceptions. Latest distroless cc-debian12 was additionally inspected/scanned and also contains CVE-2026-84782; no fixed Debian package is available.
- Workflow Gitleaks 8.24.3 `dir /repo --config=/repo/.gitleaks.toml --redact --verbose`: passed. The latest commit is also scanned using `detect --log-opts=-1` before push.
- `bash -n deploy/scripts/*.sh deploy/tests/*.sh`, `git diff --check` and final formatting: passed.
 GitHub CodeQL and dependency-review service checks run after PR creation; delivery is not reported successful until Release CI is green. No merge or deployment is performed.

## Completed work

Audit filtering intersects caller filters with trusted tenant/line predicates. Large imports use a shared production/test parser setup after CORS, authenticating Supplier Admin and Origin/CSRF/writable scope before the 80 MiB parser, with a per-IP throttle, two pending/in-flight slots and 60-second budget. Authorized Hosted Preparation is preserved. Realtime validates current sessions without activity extension and current scope before replay/live/heartbeat output. External ingestion locks and reloads client/token authorization per event; the duplicate fallback outside the transaction was removed. Anonymous token throttle state expires and has a 5,000-key hard cap without evicting active throttles.

Hosted submission snapshots the payload/key for uncertain retries, disables editing until definitive outcomes, pins usable displayed context, and sends optional expected LineShift version/effective replaced MP assertions. Empty/ambiguous initial context can recover by refresh. Existing occurrences add only missing job working assignments. Reactivation locks Supplier/LineShift and rejects inactive populated references while retaining nullable setup assignments.

Changed areas: API auth/parser/session, read models/realtime, External ingestion/throttle, Henkaten occurrence/submission, LineShift activation, Supplier create form, shared contracts, generated OpenAPI/client, regression tests, PRD/roadmap and ADR 0045. No database migration or new direct dependency is required. Delivery scans update existing overrides to Undici 7.29.1 and brace-expansion 5.0.11 for four high-severity advisories without broadening security exceptions.

## Decisions and review

The pre-patch boundary investigation checked direct callers, preparation modes, lifecycle races, duplicate handling, parser aliases and session idle behavior. One independent candidate review identified CORS error ordering, unusable initial context recovery and payload rebuilding on uncertain retry. Those issues were confirmed and corrected with regression tests. Legacy submission callers may omit the additive assertions; the current browser supplies them. A fresh seed smoke confirms existing seed/fixtures remain compatible, so no seed edit was needed.

## Validation

Runtime: Node 22.23.2 (repo pins 22.23.1; both satisfy the package engine), pnpm 11.16.0. This session did not create a commit and does not claim complete release/CI parity.

Passed commands/results:

- `pnpm clean` and `pnpm install --frozen-lockfile`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`: workspace suites passed; API 68, Supplier 68, TMMIN 14, contracts 38, client 9, UI 21, fixtures 6 and script 2 tests.
- `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`: Docker PostgreSQL 18.4/pgvector 0.8.5; fresh 18-migration test database.
- `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<local test value> AUTH_THROTTLE_SECRET=<local test value> OUTBOX_ENABLED=false pnpm --filter @tmmin-henkaten/api run test:integration`: all 49 tests across 8 files passed.
- `pnpm openapi:generate`, `pnpm api-client:generate`, `pnpm --filter @tmmin-henkaten/api run openapi:check`: schema artifacts generated and API drift check passed. Client regeneration was compared for byte-stable output. The wrapper `pnpm openapi:check` includes a working-tree `git diff --exit-code`; the subsequent delivery run passed with the intended generated-client change staged.
- `VITE_API_ORIGIN=https://api.example.invalid pnpm build`: all production applications built.
- `pnpm format:check`, `git diff --check`, `docker compose config --quiet`.
- `pnpm --filter @tmmin-henkaten/e2e exec node scripts/run.mjs --chromium-only --spec=part-import`: CSV conflict review and Excel workbook journey passed (1 Chromium test); isolated database/server/frontend processes cleaned by the harness.
- Fresh seed smoke in a separate Docker database, with `NODE_ENV=development`, explicit loopback API/DB, local seed confirmation and temporary credentials/files: migrations, `pnpm admin:bootstrap`, built API, and `pnpm --filter @tmmin-henkaten/api run local:seed` completed with two Hosted suppliers and 240 Henkaten. Temporary API, database, photo/export directories and credentials were removed.
- `docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 dir /repo --config=/repo/.gitleaks.toml --redact --verbose`: no leaks found.

Intermediate failures corrected: overlapping generation commands caused Prisma ENOTEMPTY and downstream generated-type errors; generation/check commands were then serialized and regenerated. Test fixtures initially omitted Supplier.sourceMode and session revocation consistency fields; these fixtures were corrected. Test-only typing/lint assertions and parser formatting were corrected. The first production build omitted required VITE_API_ORIGIN; it passed with the workflow value above.

## Remaining limits and next action

No staging/production deployment, full Edge/device journey, production load/exhaustion test, deployment image/security scan or complete release parity was performed. Parser resource limits are process-local; staging capacity and device acceptance remain release gates. Existing legacy clients require adoption of expected context assertions to obtain stale-form conflicts.

Review the working diff and, if delivery is requested, run the full branch-triggered workflow parity with the exact pinned Node version before committing/pushing. Re-run the generated-client HEAD drift gate after commit. All session-started servers and Docker test containers have been stopped.

---

# Current Session Handoff — Editable Excel export summary

- Date: 2026-09-29
- Branch: `feat/excel-summary-charts`, based on `main`; user requested a pushed branch.
- Phase: 15 remains `in_progress`; staging and device acceptance remain pending.

The Hosted Henkaten Excel export now defaults to one rolling calendar month through the supplier-local business date in both Supplier and TMMIN filter sheets. A visible `Semua periode` action clears only the date range; Reset returns to the rolling month. The `Ringkasan` sheet replaces 12-cell color bars with KPI cards, six editable native Excel charts (status, 4M, Top 10 Line by status, up to 12 calendar months by 4M, Top 10 Part, and PCR distribution), visible source cells, and compact pending approval counts. Monthly zeroes within the selected range are explicit. Long-lived detail sheets still use the ExcelJS streaming writer. A bounded streaming ZIP pass adds chart OOXML parts before the private file is published; partial files are cleaned on failure. No database schema or API contract changed, so local seed fixtures require no edit.

Changed files: export service and chart module, focused export integration/unit tests, shared filter sheet and date/component tests, Supplier/TMMIN callers, package manifests/lockfile, PRD, roadmap, and ADR 0043.

Validation: clean-artifact frozen install; repository format, lint, typecheck, unit suites (API 61, Supplier 66, TMMIN 14, UI 21, contracts 38, fixtures 6, client 9), OpenAPI/client parity, and production application build passed. A fresh 18-migration disposable database and full API integration suite passed 41/41. The generated workbook was parsed by openpyxl: six native charts, including two four-series stacked charts, retained five traceability sheets and reconciled totals. LibreOffice PDF rendering was inspected to shorten long Line/Part chart labels while leaving complete names in source tables. An earlier four-chart workbook opened in Microsoft Excel without a repair prompt; the Mac installation requires a Microsoft 365 subscription to edit/save, so interactive chart editing remains a staging UAT check. The final four isolated Chromium browser journeys passed. Deployment env validation, destructive migration check against `main`, script harness, security exception check, dependency audit, Gitleaks directory scan, and Trivy HIGH/CRITICAL scan of the rebuilt API image passed. The API production image was rebuilt with the current chart code. Host Node is 22.23.2 versus CI-pinned 22.23.1; production Docker builds use the pinned version. No schema or API contract changed, so local seed fixtures require no edit. Edge installation on macOS still requires interactive privileges; Linux CI covers Edge.

The staging-like Compose stack, local PostgreSQL, and isolated browser test containers were stopped after validation. `git diff --check` and the commit-scope Gitleaks scan passed. The implementation was pushed as `202aa7b`, and PR #35 targets `main`.

PR #35 to `main` exposed one lint error in the new chart-label integration assertion: ExcelJS cell values have a wider type than `string`, so direct stringification triggered `@typescript-eslint/no-base-to-string`. The assertion now checks and narrows the value to a string before measuring its length. Repository format, lint, typecheck, unit tests, OpenAPI/client parity, and production build passed after the fix. The first local integration rerun reused accumulated test records and failed an unrelated top-10 Supplier overview assertion; resetting the disposable test database, applying all 18 migrations, and rerunning all 41 integration tests passed. No export behavior changed in this fix. PR CI is being rerun.

---

# Previous Session Handoff — Supplier Henkaten list and PCR guidance

- Date: 2026-09-29
- Branch: `feat/minor-ui-improvements`, based on `origin/main`; target PR to `main`.
- Phase: 15 remains `in_progress`; staging and device acceptance remain pending.

The submitting Line Leader now sees a PCR guidance dialog after the assessment resolves to PCR. The dialog shows the actual assessment text and labels it as AI only when the decision source is AI; it then directs PCR submission through the established channel, gives a short TMMIN QD contact note, and opens the Henkaten detail when dismissed. Other roles, direct links, and No-PCR results do not open it. The final design was refined from two imagegen-frontend-web references and user feedback: a full-height orange left field with a white document-check icon, no outer white border around the orange, an increased inset to the text column, concise hierarchy, and one compact detail action. Mobile uses a top accent and compact icon tile. Generated design references remain outside the repository.

The Supplier Henkaten list now includes the stored shift snapshot and separate Supervisor, QC, and PCR columns. Approval decisions use compact icon and text pills. PCR and No-PCR have visible badges; unresolved and historical PCR states show a dash in the list with accessible state names and full detail state retained. The desktop table fits without horizontal scrolling at 1280, 1440, and 1672 px; 390 px uses labeled cards. The header, filters, and vertical gaps are tighter. Selected Supplier and TMMIN helper copy was shortened. The shared summary contract, presenter, OpenAPI artifact, client, focused tests, PRD, roadmap, and ADR 0044 were updated.

Validation: clean-artifact `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, API OpenAPI generation/check, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build` passed. A fresh disposable database applied all 18 migrations and `pnpm test:integration` passed 41/41. Four isolated Chromium browser journeys passed using `pnpm test:e2e:chromium`; local Edge installation was unavailable. A rendered desktop/mobile dialog fixture was inspected after the final spacing and border adjustments, with no viewport overflow. An isolated fresh local-seed smoke using uniquely named Compose volumes produced two Hosted suppliers and 240 Henkaten; `local-seed.ts` already writes `shiftNameSnapshot`, so no fixture edit was required. The first disposable seed attempt hit the default API rate limit, then passed after matching the local lifecycle's higher test limit.

After the final dialog revision, the Supplier unit suite passed 66/66 tests, including AI and TMMIN source attribution; Supplier typecheck, production build, and repository format check passed again. The rendered desktop/mobile fixture was inspected with assessment text visible.

The local deployment checks passed: migration destructive check against `origin/main`, `pnpm deployment:validate`, Linux Docker CLI `pnpm test:deployment` equivalent with real `flock`, `pnpm security:exceptions:check`, `pnpm security:audit` (one high finding already covered by the exact exception registry), workflow-pinned Actionlint, ShellCheck, Hadolint, Ubuntu 22.04 bootstrap input checks, and Gitleaks v8.24.3 directory scan. The five-image production Compose build, migration, bootstrap/idempotence, release routing, readiness, security headers, non-root/private database, and restart persistence passed; the stack was stopped. Trivy 0.70.0 filesystem and five runtime image HIGH/CRITICAL scans passed using the exact ignore file. All task-started containers were stopped. `git diff --check` passed. Host Node is 22.23.2 versus CI-pinned 22.23.1; Docker builds used 22.23.1.

Delivery: the branch was pushed and [PR #34](https://github.com/khalshaqzzy/supplier-henkaten/pull/34) was opened against `main` and attached to this task. The HEAD-comparing combined `pnpm openapi:check`, migration policy check, and Gitleaks commit scan passed before push. The user explicitly requested no PR check monitoring, so no PR check status is claimed. Staging UAT remains the release gate; no production deployment is claimed.

---

# Previous Session Handoff — Hosted Henkaten Excel export

- Date: 2026-09-29
- Branch: `feat/excel-export`, based on `origin/main`; target PR to `main`.
- Phase: 15 remains `in_progress`; staging rehearsal and device acceptance remain pending.

Supplier Admin now exports Hosted Henkaten from Master Data beside Lihat readiness. TMMIN Admin uses the same filter sheet from supplier detail. The sheet covers business date, line, shift, status, 4M, part, approval route/status, and PCR, with queued/running/ready/failed states and progress. A workbook contains concise `Ringkasan`, `Henkaten`, `Approval`, `Checklist`, and `Riwayat` tabs. The Henkaten identifier links traceability details across tabs; the summary uses compact cell-bar graphics. External records are excluded. A durable job streams bounded batches to a private XLSX file, expires after one hour, checks requester/realm and Supplier Hosted epoch on reads, and audits requests and downloads. Request creation and audit are one transaction. The TMMIN support session remains a Supplier Admin session, with the initiating TMMIN user identified in audit.

Changed files: Henkaten export service/controller/module, Prisma schema and forward migration, config and Compose volume paths, shared contract and generated OpenAPI/client, Supplier/TMMIN pages, shared sheet and CSS, focused integration test, dependency lockfile, PRD/roadmap, and ADR 0043. Seed data shape and API calls were inspected. The new job table and additive endpoints do not require changing seed fixtures. `pnpm local:reseed` succeeded with two Hosted suppliers and 240 Henkaten. Browser smoke exported all 120 records for one supplier to a valid downloadable XLSX.

Validation: clean-artifact `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, API `openapi:check`, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build` passed. `docker compose config --quiet`, `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, and the CI-environment `pnpm test:integration` passed: 18 fresh migrations and 41/41 integration tests. A 17-migration `origin/main` database upgraded to 18 migrations and reached current status. Four isolated Chromium E2E journeys passed; Supplier and TMMIN export sheets were opened in seeded browser sessions, and Supplier sheet was visually inspected at 1440 and 390 px. `pnpm deployment:validate`, `pnpm test:deployment`, `pnpm security:exceptions:check`, `pnpm security:audit`, Actionlint, ShellCheck, Hadolint, Ubuntu bootstrap checks, and Gitleaks directory scan passed. The deployment harness passed under a Linux Docker CLI image with real `flock`. macOS Edge is absent and its installer requires interactive privileges, so local browser E2E used Chromium; CI can run Edge. The five-image production Compose build passed. A production-like stack passed migration, bootstrap idempotence, routing/release identity, headers, non-root/private database, and restart persistence. Trivy 0.70.0 filesystem plus all five runtime image scans passed at HIGH/CRITICAL with the exact ignore file. All test/stack containers started for this task were stopped. `git diff --check` passed. The first bootstrap could not be reverified because the existing temporary staging data path already contained an administrator; CI uses a fresh path.

Delivery: commit `c3813e3` passed post-commit `pnpm migrations:destructive-check c5785fe28ce0c92b0997e936f7285943808fb4bb`, `pnpm openapi:check`, and the Gitleaks v8.24.3 commit scan. The branch was pushed and [PR #33](https://github.com/khalshaqzzy/supplier-henkaten/pull/33) opened against `main` and attached to the task. The user explicitly requested no check monitoring after the PR; no PR check status is claimed here.

Next: review PR #33 and perform the existing Phase 15 staging and device acceptance gates before any release claim. Larger-history export/storage-capacity testing and multi-instance worker coordination remain staging scale checks (ADR 0043).

---

# Previous Session Handoff — Supplier dashboard filter and TMMIN magic link

- Date: 2026-09-29
- Branch: `feat/suppluer-filter-ui`, based on `origin/main`; target PR to `main`.
- Phase: 15 remains `in_progress`; staging rehearsal and device acceptance remain pending.

The Supplier Overview desktop filter now fits one row at 1280, 1440, and 1672 px. Period, status, 4M category, line, advanced filters, Apply, and update status remain accessible. Advanced fields (shift, part, approval route/status, trend interval) use a compact anchored popover. Draft, Apply, Reset, and URL query behavior remain intact. Variation A guided the implementation; the image concepts are preview references outside the repository.

TMMIN Admin can issue a two-minute single-use link from an active Hosted supplier detail page. It opens the Supplier web in a new tab. The 32-byte random token is stored only as a SHA-256 hash, passed in the URL fragment, removed from the browser address, and atomically consumed by the Supplier API. The Supplier session identifies both the target Supplier Admin and the initiating TMMIN Admin/session; it becomes invalid when that TMMIN session is revoked or expires. Issuance and redemption are audited. The feature creates no supplier notification, outbox event, or password change; password change is blocked for the delegated session. Inactive/External supplier, inactive admin, non-admin actor, wrong origin, expired token, and replay are rejected. See ADR 0042. `fast-uri` was upgraded to 3.1.7 in the pnpm override and lockfile to resolve two high-severity findings in the previous 3.1.6 resolution.

Changed files: Supplier Overview, dashboard CSS and focused tests; TMMIN supplier detail button; Supplier magic-login route, session banner and account affordance; API auth/session and administration controllers/service, Prisma schema plus forward migration, shared auth contracts, generated OpenAPI/client, integration and E2E tests; workspace dependency override/lockfile; PRD, roadmap, ADR 0041 and 0042. Local seed fixture and payload shapes were inspected and require no edit because the added columns are nullable and the new endpoints are additive.

Verification to date: clean artifact/frozen install; format, lint, typecheck; unit suites (API 59, Supplier 62, TMMIN 14, shared suites) after updating the frozen route count; generated OpenAPI/client; production application build; fresh 17-migration disposable DB and 40/40 integration tests, plus a focused 3-test auth rerun after extending revocation coverage; previous 16-migration to current 17-migration upgrade; four isolated Chromium E2E journeys including filter accessibility and link replay; dependency audit threshold; deployment validation, security exceptions, Actionlint, ShellCheck, Hadolint, bash syntax, Ubuntu bootstrap checks, macOS and Linux deployment harness including `flock`, and Gitleaks directory scan. A separate fresh seed database completed with two Hosted suppliers and 240 Henkaten; its credential file and API process were removed/stopped. The five-image production-like Compose build, current migration, bootstrap/idempotence, routing, headers, non-root/private database, and persistence across PostgreSQL/API restart passed. Trivy 0.70.0 filesystem and all five runtime image scans passed with the exact ignore file. All local, E2E, and production-like containers started for this session were stopped. The generated client drift check necessarily differs from `HEAD` until the implementation commit; rerun `pnpm openapi:check` after commit. Final post-commit Gitleaks and GitHub checks remain. The macOS Edge installer requires interactive sudo; CI installs both Chromium and Edge on Linux. No staging or production deployment has occurred in this branch.

Next action: finish local parity and cleanup, commit, push, open PR to `main`, attach it to this task, and monitor all PR gates until green. If CI fails, fix the issue and rerun affected local checks before pushing a correction.

---

# Previous Session Handoff — Overlapping Line–Shifts and LL-derived submission

- Date: 2026-09-28
- Branch: `feat/overlapping-shifts-ll`, created from `main`
- Target: PR to `main`; post-push check monitoring explicitly waived for this delivery.

Active Line–Shift schedules may overlap on the same line or across lines. One LL may hold exactly one active Line–Shift assignment across a supplier. Assignment and activation reject a duplicate LL with a contextual conflict; the database partial unique index protects concurrent writes. A new Line–Shift copied from another shift leaves its LL empty. The forward migration keeps the oldest active assignment by `createdAt, id`, clears only the duplicate LL field on other active Line–Shifts, increments their version, and writes a SYSTEM audit event. It preserves Supervisor, MP, shift, and historical Henkaten data.

Hosted Henkaten submission resolves the authenticated LL's active Line–Shift in the creation transaction, with the current occurrence during that shift or the next occurrence while off shift. The form has no shift picker; it displays the assignment and effective occurrence, refreshes its context, and sends the shown shift/start as stale-context assertions. The board filters Canvas by Line–Shift when overlapping shifts share a line. Supplier Admin Line Setup lists all active LL occupancy, disables occupied LL options, gives availability guidance, and uses an interactive 24-hour timeline to select a shift. A mobile inspection found and corrected overflow in the create toolbar; desktop and mobile screenshots then showed no horizontal page overflow at 390 px.

The local seed now assigns distinct LL accounts to its three lines and three shifts. A clean local full-stack reseed passed with two Hosted suppliers and 240 Henkaten. The PWA update button now accepts Workbox's `{ type: 'SKIP_WAITING' }` message and reports loading/error state, fixing the stuck refresh prompt. Supplier and TMMIN login/password-change forms now use a shared password input with the visibility control inside the field.

Changed files: `.agent/PRD.md`, `.agent/implementationPhases.md`, this handoff, ADR 0033; API LineShift and Henkaten services, controller, migration, Prisma comment, seed, OpenAPI document and freeze test, integration tests; Supplier Line Setup, Henkaten create, board, PWA files and CSS; TMMIN auth/CSS; shared contracts, generated API client, and shared password input/CSS.

Validation: clean artifacts and frozen install; format, lint, typecheck, all unit suites; API OpenAPI generation/check and production build; fresh 16-migration disposable database and 37/37 API integration tests (rerun after locking LL assignment during submission); previous-`main` 15-migration to current 16-migration upgrade; and duplicate-LL migration backfill/audit smoke. The clean local full-stack seed created two Hosted suppliers and 240 Henkaten. Four isolated Chromium browser journeys passed, followed by a focused onboarding rerun after the final mobile UI changes. Visual inspection covered Admin Line Setup and LL Henkaten on desktop/mobile and login mobile; the 390 px Admin page had no horizontal overflow.

Local CI-equivalent delivery checks passed: `docker compose config --quiet`, deployment env validation, deployment script harness both on macOS and in Linux with real `flock`, security exception registry, dependency audit threshold, pinned Actionlint/ShellCheck/Hadolint, `bash -n`, Ubuntu 22.04 bootstrap input checks, Gitleaks v8.24.3 directory scan, and Trivy 0.70.0 filesystem plus all five freshly rebuilt production runtime images at HIGH/CRITICAL. A production-like five-image Compose stack passed current migration, first bootstrap and idempotence, routing/release identity, security headers, non-root/private database, and persistence across PostgreSQL/API restart. The macOS Playwright Edge installation requested a sudo password and could not run unattended; Chromium coverage passed. The host runs Node 22.23.2 versus CI's pinned 22.23.1; Docker production builds used pinned 22.23.1. All local, E2E, and production-like project containers were stopped. After the delivery commit, the migration policy checker recognized the new SQL, OpenAPI/client regeneration had no drift, and Gitleaks scanned the commit without findings. The branch is ready for a PR to `main`; no post-push check monitoring is requested.

Current roadmap state remains Phase 15 `in_progress`; staging rehearsal and device acceptance have not been completed by this branch. No staging or production deployment has been performed. The next recommended action after PR review is staging verification of migrated incomplete assignments and overlapping shift handover, followed by the existing release gates.

---

# Previous Session Handoff — Part import mapping and selective conflicts

- Date: 2026-09-26
- Branch: `feat/part-import-mapping`
- Scope: Supplier Part import refinement within Phase 15; API row limits changed without a database schema change.

The browser reads the first Excel sheet or CSV, shows ten source rows, suggests recognized headers, and lets Supplier Admin map the Part number and Nama part columns. The review sends only mapped number/name pairs to the tenant-scoped preview and commit endpoints. The original File is not retained after parsing; source cells are held in page memory for mapping and released after commit, replacement, or navigation. The server never receives or stores the file. The limit is 50 MB and 50,000 data rows. Duplicate-number rejection, exact safe-integer handling, atomic commit, audit, version check, and preservation of active status remain in force. Only existing parts with a different trimmed name appear in the review table, 50 per page; new and matching parts appear in summary counts. Matching names are skipped automatically. The UI adds a three-step progression, highlighted preview columns, responsive mapping controls, and clear read/validate/match/save loading states.

Changed files: Supplier import parser, page, CSS, unit tests; API import body limit, batched transaction, audit writer, integration coverage; shared row-limit contract and generated OpenAPI document (client regenerated with no type diff); focused Playwright journey; PRD, implementation roadmap, and ADR 0040. Seed compatibility: individual Part creation and import payload shape are unchanged, so no seed edit is required. A fresh disposable seed against the built API passed with two Hosted suppliers and 240 Henkaten. The first smoke hit the default request rate limit; after resetting the disposable database, a runtime with seed-appropriate throttle limits passed. All smoke processes, temporary credentials/photos, and containers were stopped or removed.

Validation completed: pinned frozen install; format, lint, typecheck, all unit tests, OpenAPI document generation/check, production build; fresh 15-migration test database and 36 API integration tests, including one 50,000-part create with a request exceeding the ordinary 5 MB body limit, matching per-part audit count, and 510 updates across database batches. The full isolated Chromium/Edge E2E suite passed; import captures cover desktop/mobile mapping and conflict review. Browser inspection found local horizontal scrolling for extra source columns; a mobile swipe hint was added and the focused journey passed again in Chromium and Edge. Production-like five-image Compose build, migration, bootstrap/idempotence, routing, headers, non-root execution, private database, and restart persistence passed. Actionlint, ShellCheck, Hadolint, bash syntax, Ubuntu bootstrap input checks, Linux deployment harness (including flock), migration policy, deployment env validation, security exception registry, dependency audit, Gitleaks directory scan, and Trivy filesystem plus all five runtime images passed. No staging deployment was performed. Delivery follows post-commit generated-client parity and Gitleaks commit scan, then a branch push and PR to staging. The request explicitly waives post-push check monitoring.

## Previous Handoff — Supplier Admin flow improvements

- Date: 2026-09-26
- Branch: `feat/feedback-26-sep`
- Scope: Supplier and TMMIN login visibility, Supplier Master Data and Assignment Board UX, reviewed Part import, and Checklist 4M layout. Phase 15 remains `in_progress`; staging rehearsal and device acceptance are separate pending gates.

Implemented keyboard accessible password visibility on both login pages; explicit back links on Master Data lists, forms, Checklist 4M, Line Setup, and Part import; transient success messages after saved changes; Member username in list/detail; and Hapus member as deactivation into the Arsip filter, preserving history and existing reference checks. Member archive and password reset use in-app confirmation dialogs. The board filters currently scheduled, other configured, or all Line–Shift occurrences and labels each result. Canvas requires one visible Line–Shift. Checklist editing now separates draft controls from publication/history, signals unsaved edits, and blocks publish until the draft is saved. Desktop captures cover Man, Machine, Material, and Method; mobile captures cover Man and the import review.

Part import accepts CSV and first-sheet `.xlsx`, validates headers, 2 MB/500-row limits, required names, and duplicate identifiers, then previews new and existing parts. Existing names default to Skip with individual and bulk Update/Skip controls. One atomic supplier-scoped commit checks current versions and audits writes. Excel numeric cells are accepted only as exact nonnegative safe integers; long identifiers and leading-zero identifiers must be text. The downloadable template uses a numeric example. The API contract, OpenAPI document, generated client, PRD, roadmap, rules, and ADR 0040 were updated. No database migration was needed. The local seed uses compatible individual Part creation and board-layout calls, so no seed edit was needed; a fresh seed against the built API completed with two Hosted suppliers and 240 Henkaten. `.agent/rules.md` now requires seed review and a fresh smoke when schema or contracts change.

Changed files are in `.agent/`, `docs/adr/0040-*`, the Supplier/TMMIN web apps, Part and Board API services/controllers, shared contracts/client, E2E journeys and XLSX fixture, and `pnpm-lock.yaml`. No staging or production deployment occurred in this task.

Local verification from a clean TypeScript artifact state: `pnpm clean`, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` (59 API, 57 Supplier web, 14 TMMIN web and all shared tests), `VITE_API_ORIGIN=https://api.example.invalid pnpm build`, `docker compose config --quiet`, `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, and `NODE_ENV=test DATABASE_URL=<disposable-test-url> RELEASE_SHA=ci SESSION_CSRF_SECRET=<safe-test-value> AUTH_THROTTLE_SECRET=<safe-test-value> OUTBOX_ENABLED=false pnpm test:integration` (35/35) passed. OpenAPI and generated client were regenerated twice with identical SHA-256 outputs; the HEAD-comparing `pnpm openapi:check` is deferred until after the generated files are committed. The final `pnpm test:e2e` passed all eight isolated Chromium/Edge journeys, including the corrected CSV/XLSX import in both browsers.

Staging CI parity also passed: `pnpm migrations:destructive-check 3576d957a4ec43493db80b6c020e60b32e410cb6`, fresh and previous-SHA-to-current migrations with status current, `pnpm deployment:validate`, the deployment harness inside Linux Docker with real `flock`, `pnpm security:exceptions:check`, `pnpm security:audit`, workflow-pinned Actionlint/ShellCheck/Hadolint, `bash -n`, both Ubuntu 22.04 bootstrap input checks, Gitleaks v8.24.3 directory scan, Trivy 0.70.0 filesystem and five image scans. The production-like Compose stack passed build, migrate, bootstrap/idempotence, routing, headers, non-root/private database checks, and restart persistence; all project containers were stopped. Trivy used the local vulnerability DB cache because a fresh registry download was exceptionally slow. The host runs Node 22.23.2 versus CI's pinned 22.23.1; Docker builds used 22.23.1. Existing local Playwright failure reports contained synthetic E2E passwords; their generated Markdown was removed and the final Gitleaks scan passed without a source exception.

The first final browser rerun found a transient offline PWA banner intercepting the mobile import save button in Edge. The mobile banner was moved below the header, and its non-interactive area now lets pointer events pass through; the affected Edge journey and the subsequent full suite passed.

The final Supplier image was rebuilt after the PWA/dialog changes and its HIGH/CRITICAL Trivy scan passed with no findings. Commit `445d379` passed post-commit OpenAPI/client drift and Gitleaks commit scans; the branch was pushed and [PR #27](https://github.com/khalshaqzzy/supplier-henkaten/pull/27) opened against `staging`. Release CI run `36235112737` was in progress when this handoff was written. Next: inspect every required job, fix any failure, and continue the separate staging touch-device and operator acceptance gates.

---

# Previous Session Handoff — Supplier setup readiness

- Date: 2026-09-25
- Branch: `fix/supplier-setup-readiness`
- Scope: first-login Hosted Supplier Admin setup and partial Line–Shift readiness; Phase 15 remains in progress.

The Supplier Setup endpoint previously returned internal `contributor` fields inside every
blocker, while the shared supplier response schema rejected unknown fields. An incomplete or
empty tenant therefore received HTTP 200 but the frontend displayed “Readiness tidak dapat dimuat”.
The endpoint now removes this internal field while Source Governance continues to use it for
preflight. Readiness also retains partially configured Line–Shifts when checking missing
Supervisor, Line Leader, or MP defaults; inactive assignees do not count as complete. An empty
supplier's Default Assignments area remains pending until a line exists.

The API integration test parses the actual empty and partial endpoint responses through the
shared strict schema. The onboarding browser journey opens Setup immediately after the first
password change and confirms that blockers render. All 34 API integration tests and all six
Chromium/Edge browser journeys passed. Clean-artifact frozen install, format, lint, typecheck,
repository unit tests, OpenAPI/client parity, production builds, fresh and previous-SHA migration,
deployment env/harness, security exceptions, dependency audit, Actionlint, ShellCheck, Hadolint,
Ubuntu bootstrap input validation, Gitleaks directory scan, Trivy filesystem and five rebuilt
image scans passed. Production-like five-service Compose migration/bootstrap, routing, readiness,
non-root and database isolation, idempotent bootstrap, and restart persistence checks passed; its
containers were stopped. The host runs Node 22.23.2 rather than CI's 22.23.1; the Docker builds
use pinned 22.23.1. macOS has no `flock`, so Linux CI remains authoritative for lock contention.
Browser reports were moved temporarily outside the repository for Gitleaks and restored after
the scan. No schema migration or product contract change is required. Staging and production
behavior have not been verified.

---

# Previous Session Handoff — MP registration and undisclosed Other part

- Date: 2026-09-24
- Branch: `feat/supplier-privacy`
- Scope: Hosted MP master data and Henkaten part disclosure; Phase 15 staging acceptance remains in progress.

The Supplier Admin form no longer requests a registration number for MP, and the migration removes
existing MP profile numbers. Other roles still require unique registration numbers. Current MP
views use names and assignment states without registration text; historical snapshots remain.

The Hosted Henkaten form now offers `Other` without a part number or name. Submission stores a null
part ID, does not create a master Part, and shows the Other label. Each Other Henkaten creates its
own TMMIN warning; named parts retain supplier/number aggregation. Clone prefill preserves Other.
Part masters are optional in Hosted readiness, including for an Other-only supplier.
The API contract, OpenAPI, generated client, local seed, fixtures, PRD, roadmap, and ADR 0038 were
updated. External ingestion was not changed.

Verification: `pnpm clean`, frozen install, format, lint, typecheck, all repository unit tests,
generated OpenAPI document/client parity, and production API/Supplier/TMMIN builds with
`VITE_API_ORIGIN=https://api.example.invalid` passed. A clean disposable database applied all
15 migrations; a separate upgrade database applied the 14 `origin/staging` migrations followed
by the new migration and reported schema current. All 33 API integration tests passed, including
Other privacy, retry, clone, separate warnings, MP creation, and optional part readiness. All six
isolated Chromium/Edge browser journeys passed after updating selectors that had expected an MP
number. Deployment script harness, env validation, ShellCheck, Hadolint, Actionlint, Ubuntu
bootstrap input validation, security exception check, audit threshold, Gitleaks directory scan,
Trivy filesystem and all five image scans passed. The production-like five-service stack passed
migration, bootstrap, routing, headers, non-root, restart, and persistence checks; containers were
stopped. The migration checker now permits only an exact declared `DROP NOT NULL` expansion and
its harness accepts exact matches and rejects mismatches. macOS lacks `flock`; Linux CI remains
the authoritative lock-contention check.

Local ignored `.local` evaluation scripts and `.env`/browser reports were moved temporarily out
of the repository during lint or secret scanning and restored unchanged. An initial integration
failure was test-order interference from two new Open Man records; the test now withdraws both.
The first two browser runs failed on old selectors for the removed MP number; the corrected full
suite passed. No staging or production deployment claim has been made. Rollback to the prior
staging code is unsafe after null MP/Other records are written; ADR 0038 records this boundary.
Exact local command evidence: `pnpm clean`, `pnpm install --frozen-lockfile`,
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
`pnpm --filter @tmmin-henkaten/api run openapi:check`,
`VITE_API_ORIGIN=https://api.example.invalid pnpm build`, `pnpm db:up`, `pnpm db:wait`,
`pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`,
`NODE_ENV=test DATABASE_URL=<disposable-test-url> RELEASE_SHA=ci
SESSION_CSRF_SECRET=<test-value> AUTH_THROTTLE_SECRET=<test-value> OUTBOX_ENABLED=false pnpm
test:integration`, `pnpm test:e2e`, `pnpm db:down`, `pnpm deployment:validate`,
`pnpm test:deployment`, `pnpm security:exceptions:check`, `pnpm security:audit`,
`git diff --check`, and the workflow-pinned container/scanner checks described above all passed.
The generated client was regenerated twice with identical checksum; the HEAD-comparing combined
`pnpm openapi:check` must run after the delivery commit. Next: commit, run commit-state drift and
migration checks, push, create PR to staging, verify checks, merge after green, and notify the
linked manual book task.

---

# Previous Session Handoff — Production deployment preparation

- Date: 2026-09-24
- Branch: `feat/production-deployment`
- Status: production caller, bootstrap support, domain documentation, and production Environment preparation are in progress. No production release has run.

The `main` push and PR paths now use the existing release gate. Staging run `35977992005` passed
every gate and remote deployment; independent public smoke passed on all three staging domains
for SHA `dfc2aa2428b1db5fce407ec2033a1da87b0632bd`, closing 15.9. Only a successful `main` push
calls the reusable production deployment for Supplier `henkaten.qualitydivision.com`, Admin
`admin-henkaten.qualitydivision.com`, and API `henkaten-api.qualitydivision.com`. Bootstrap accepts
`production` and creates isolated paths. Production runtime rendering and bootstrap input checks
were added to the existing deployment validation. ADR 0008 and
[`productionDeploymentPlan.md`](productionDeploymentPlan.md) record decisions, capacity measurement
and launch sequence; PRD, roadmap, and deployment guide now use the confirmed domains.

GitHub Environment `production` exists without reviewers and only branch `main` may deploy to it.
Main branch protection now requires an up-to-date `Release candidate gate` check while preserving
its existing one-review requirement. Its secret-name inventory now matches staging: 15 non-host
values were copied from the current staging
release's runtime env through trusted SSH without logging values; the preserved CI SSH private key
was set directly; `VM_HOST` and `VM_USER` use the production endpoint. `VM_SSH_PORT=22` and a
production-specific bootstrap display name are configured. The production bootstrap username was
then changed to the operator-requested value; no production release or running container exists yet,
so the first bootstrap will consume that value. GitHub does not expose secret values
for reading back. The production ED25519 host key is pinned from a fresh keyscan after its
fingerprint matched prior network observations and the host public-key file over SSH. This is
trust on first use; the provider-console fingerprint has not been independently checked.
The current staging VM was resolved through live DNS rather than the
stale IP in older handoff entries.

All three production DNS A records currently resolve to the production VM. Bootstrap verification
now confirms CI key login, Ubuntu 22.04, four vCPUs, 16 GiB RAM, Docker 29.8.1, Compose 5.5.1,
about 191 GiB free disk, writable production paths, required data ownership, and correct DNS from
the VM. Only SSH currently listens, so public HTTP/HTTPS cannot be judged until Caddy starts.
The production host fingerprint has not yet been compared with the provider console, although
the observed key is pinned in `VM_SSH_KNOWN_HOSTS`. UFW status needs sudo authentication. Therefore the next merge
to `main` cannot yet be claimed deployable. Remaining staging
rehearsal, QA/UAT, PCR, capacity and critical-risk sign-offs remain release prerequisites in the
roadmap.

Checks so far: `pnpm format:check`, `pnpm deployment:validate`, `pnpm test:deployment` on macOS
and Linux (including real `flock` contention), `pnpm migrations:destructive-check origin/main`,
`git diff --check`, pinned Actionlint, pinned ShellCheck, and pinned Ubuntu 22.04 production
bootstrap input check passed. The actual staging secret values rendered a valid production runtime
env and passed production Compose configuration without printing the values; the temporary env file
was removed. Docker was initially stopped and started for these checks; resumed local Compose
containers were shut down and OrbStack was quit afterwards. Full
clean-artifact CI parity, production VM preflight, and first deployment remain outstanding.

Delivery preparation: a disposable clean-artifact worktree at the current staging HEAD plus this
patch passed frozen install under pinned Node 22.23.1/pnpm 11.16.0, format, lint, typecheck, unit,
OpenAPI/client drift, and production application build. A disposable PostgreSQL 18/pgvector
database passed fresh migration and 32 integration tests; it was stopped. The unchanged app code
also passed the six isolated Chromium/Edge E2E journeys on the host. Migration SQL is unchanged
from `origin/staging`. Actionlint, ShellCheck, Hadolint, Ubuntu production bootstrap validation,
environment/Compose validation, Linux `flock` deployment harness, exact security-exception check,
dependency audit, Gitleaks source scan, Trivy filesystem scan, and HIGH/CRITICAL scans of all five
rebuilt images passed. A separate five-service Compose acceptance passed migration, bootstrap and
idempotency, health/routing/release identity, non-root and private database checks, and database/photo
persistence across restart; all test containers were stopped. The first Gitleaks scan traversed a
generated pnpm package cache, which was moved outside the worktree before the clean source scan;
no source exception was added. The host's pnpm attempted to replace Linux node_modules in the
worktree, so shell validation ran directly and the dependency audit ran in the pinned Node image.
No application migration or contract changed in this patch.

Next: deliver the branch as a PR to `staging`; observe its release gate. Production deployment
still requires a later merge to `main`, production external smoke, and the remaining UAT/capacity
and risk sign-offs. Confirm public 80/443 reachability when Caddy starts; independent provider-console
host fingerprint verification remains available to strengthen the current trust-on-first-use pin.

---

# Previous Session Handoff — Scoped QA finding remediation

- Date: 2026-09-24
- Branch: `fix/qa-verif-1`
- Status: F-01–F-09 and F-11–F-12 implemented with automated regressions; F-10 is a product-expectation correction. PR [#20](https://github.com/khalshaqzzy/supplier-henkaten/pull/20) targets `staging`. No staging deployment or complete QA claim.
- Current roadmap position remains Phase 15 / 15.9 `in_progress`.

The full cause and acceptance map is [`docs/qa/qa-verif-finding-remediation-plan-2026-09-24.md`](../docs/qa/qa-verif-finding-remediation-plan-2026-09-24.md). ADR 0036 records the user decision that Supervisor reroute needs no in-app notification; ADR 0037 records implementation boundaries. The original local QA run's 22 PASS / 15 FAIL / 10 BLOCKED outcomes remain unchanged. No “Remaining QA not executed” branch was continued. The fixes have automated regressions, but the original browser observation for every finding was not individually rerun; do not reclassify the historical rows from the tests alone.

Implementation: cutover deactivates the prior Supplier Admin; reverse Preparation defensively revokes any surviving active Admin and rejects reused usernames with a field error. Reset/replace uses Supplier.version. Photo responses use same-site CORP. Clone checks current Line–Shift/Job validity. Account throttling counts failures only, keeps the existing IP limits and five-failure database lockout, and allows six consecutive successful logins. Supplier notification and master-data mutations refresh their actual cache keys; Line Setup retains the newly copied shift; warning detail shows a human-readable Hosted/External identifier; former Supervisor approval controls require current responsibility; the Supplier registry exposes API cursor navigation. OpenAPI and the generated client were regenerated. No migration was added.

Checks completed on a disposable clean-artifact worktree after `pnpm install --frozen-lockfile`: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build` passed. The first clean-worktree lint run caught five new test-mock style errors; they were fixed and the complete sequence passed. The main checkout's `pnpm lint` includes pre-existing ignored `.local/*.mjs` scripts, so the clean-worktree result is the CI-equivalent result. Full API integration passed 32 tests on the disposable Docker test database. `pnpm test:e2e` passed five isolated journeys across Chromium and Edge, and its own Compose projects were removed. Node 22.23.2 and pnpm 11.16.0 were used on the host; production Docker builds used the pinned Node 22.23.1 image.

Staging parity: `docker compose config --quiet`, `pnpm migrations:destructive-check 7ed8d8a5ef515707950c4e8f48ef71b1d2727151`, `pnpm deployment:validate`, `pnpm test:deployment`, `pnpm security:exceptions:check`, `pnpm security:audit`, pinned Actionlint/ShellCheck/Hadolint, `bash -n`, Ubuntu 22.04 bootstrap input validation, Gitleaks v8.24.3 directory scan, and Trivy 0.70.0 filesystem scan passed. The deployment script harness passed in a Linux Docker container with actual `flock` contention. The previous-staging-to-current migration was applied to a temporary database, checked current, and dropped; no migration SQL changed. All five production images built; the isolated staging-like Compose stack passed migration/bootstrap, health, routing, headers, non-root, idempotent bootstrap, and restart persistence checks. Trivy image scans passed for all five images. The first scan of the frontend images encountered cached `apk upgrade` layers containing vulnerable `libexpat` 2.8.4-r0; a `--no-cache` frontend rebuild pulled fixed 2.8.5-r0 and both rescans passed. No Dockerfile change was required.

The local fullstack Compose services on ports 3000, 5173, 5174, and 55432 predated this task and were not stopped or reseeded; `/health` still returned 200 after the checks. The isolated staging-like Compose stack and disposable parity worktree were removed. User explicitly requested pushing this branch and opening a PR to `staging` **without monitoring checks**, overriding the post-push monitoring step in `.agent/rules.md` for this task. The PR was opened without a staging deployment claim.

---

# Previous Session Handoff — Local browser QA execution

- Date: 2026-09-24
- Branch: `feat/qa-verif` at baseline `cf53a62`; report and handoff prepared for delivery on this branch.
- Status: local exploratory QA run documented; no product fixes made. Final report: [`docs/audits/local-browser-qa-2026-09-24.md`](../docs/audits/local-browser-qa-2026-09-24.md).

The run covered the PRD/source inventory and 47 planned A/T/S/H/X/N scenario rows across Supplier and TMMIN Admin/Quality surfaces, with Playwright Chromium and local External API calls. Current overall row outcomes: **22 PASS, 15 FAIL, 10 BLOCKED / partial**; 37/47 (78.7%) have a determinate row outcome, but some PASS/FAIL rows still have untested sub-branches. The report lists evidence, twelve findings, all remaining checks, and run limitations. Push/PWA push permission, subscription, delivery, and revoke tests are excluded per user direction.

The user specifically asked about Admin PCR status correction. TMMIN Admin changed a Closed Henkaten in both No-PCR→PCR and PCR→No-PCR directions. **Simpan keputusan** was disabled until the trimmed reason contained at least 10 characters; valid reasons saved successfully. No product code was changed to address defects.

External X-02/X-04 verification passed: PII payload rejection/isolation, invalid transition, status-only PCR retention, changed-evidence requeue, Approved/Rejected/Cancelled warning closure, and Admin External Health browser rendering. A final `pnpm local:reseed` restored the baseline counts (2 Hosted suppliers, no External test tenant, 240 Henkaten and expected PCR/warning/Line–Shift counts), health/readiness passed, and TMMIN Admin/NPM Supplier Admin browser smoke passed. `pnpm local:down` stopped the stack. Docker services are not running.

Remaining QA is not yet fully verified: line-scope/source-mode security matrix, negative-password lockout, remaining registry validation and pagination/dashboard reconciliation, complete Explorer detail/filter matrix, an assessment-free `expectedVersion: 0` PCR case and pending-assessment reload, Hosted Preparation/reverse source gates, standalone master-data and Line–Shift branches, schedule/off-hours and Tanoko eligibility boundaries, old External credential rejection after cutover, full outbox/audit/photo-cache diagnostics, and physical-device/assistive-technology coverage. The report describes why each remains and records partial checks inside other rows.

No persistent Playwright specs were added; temporary local runners are removed after the run. The ignored `.local/qa-evidence/` retains sanitized summaries and screenshots. The branch changes are documentation only: the QA execution report and this updated handoff. The full scenario plan remains in `docs/qa/browser-local-end-to-end-verification-plan.md`.

---

# Session Handoff — Canvas job-card 4M visibility

Date: 2026-09-23
Branch: `feat/update-mp-card-on-board`
Status: implemented and locally verified; PR #19 to `staging` is open. No deployment claim.
PR: https://github.com/khalshaqzzy/supplier-henkaten/pull/19

The Supplier Canvas `JOB_SLOT` card now centers 26-pixel 4M dots in the white row between the
assignment badge and the portrait. The photo begins lower, while its bottom edge and the MP identity
positions remain unchanged on the default card. The dots retain read-model order, category colors,
and the dark Open outline. Width-based capacity reserves a final `+N` slot when records exceed the
available row; the default Assignment Board still lists all records. Layout JSON, API contracts,
the default Board, and saved card geometry are unchanged. PRD section 16.6 and ADR 0031 record the
visual rule.

Verification: Node 22.23.2/pnpm 11.16.0 host install, formatting, lint, typecheck, OpenAPI/client
drift check, and production build passed. The focused Canvas suite passed 10 tests. The complete
unit suite passed in the rebuilt Linux Supplier container using repository-pinned Node 22.23.1 and
pnpm 11.16.0. The host Windows run failed before `App.test.tsx` executed because Vitest could not
resolve a virtual PWA file URL; the same suite passed in Linux. Edge visual review of the running
local NPM Canvas confirmed the Trimming card's three enlarged dots above the portrait, with Open
outlines visible. Screenshots are in gitignored `.local/board-canvas-after.png` and
`.local/board-canvas-zoomed.png`. The existing local API/database and other running frontend were
not reset; only the Supplier frontend container was rebuilt.

Additional checks: `docker compose config --quiet`, migration SQL check against `origin/staging`,
staging env validation, remote Compose config, and high-severity dependency audit passed (one
existing high-severity exception). The deployment harness and security-exception check require
`jq`, which is unavailable in the host Git Bash environment. Database integration and isolated
browser journeys were not rerun for this Canvas-only rendering change. No PR check monitoring is
requested. The implementation commit passed Gitleaks v8.24.3 commit scanning. Next: review PR #19;
do not claim staging deployment until a separate release action has completed.

---

# Session Handoff — PCR indication for Henkaten

## Local classifier evaluation — 2026-09-23

### Documentation commit checks

The 70-case report and evidence archive were checked in a detached clean-artifact worktree using
Node 22.23.1 and pnpm 11.16.0. `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`,
`pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, and
`VITE_API_ORIGIN=https://api.example.invalid pnpm build` passed. A separate Compose project and
disposable PostgreSQL test database passed `docker compose config --quiet`, `pnpm db:up`,
`pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, and 31 API integration
tests; that project was stopped with `pnpm db:down`. A second isolated project passed fresh and
`origin/staging`-to-current migration deployment and was also stopped. All three Chromium journeys
passed with `pnpm test:e2e:chromium`; local Edge installation remains unavailable on macOS.

`pnpm migrations:destructive-check <origin/staging SHA>`, `pnpm deployment:validate`,
`pnpm test:deployment`, `pnpm security:exceptions:check`, `pnpm security:audit`, and `bash -n` passed.
The macOS deployment harness reported that Linux `flock` contention needs its CI gate. Pinned
Actionlint, ShellCheck, Hadolint, Ubuntu bootstrap validation, Gitleaks v8.24.3 directory scan,
and Trivy v0.70.0 filesystem vulnerability/secret/misconfiguration scan passed with no findings.
The 70 archived messages, input hashes, decisions, and unique record IDs were rechecked. The
already-running demo PostgreSQL restarted during Docker-heavy checks and its API lost the database
connection; only the demo API container was restarted, then `/health` returned 200 and both
containers were healthy. Production container routing and image scans were not rerun locally for
this documentation-only patch; the open PR's staging CI will rerun them after push.

Seventy distinct synthetic Hosted Henkaten were submitted through the running local API in two
batches, using a seeded NPM Line Leader and valid current Line–Shift/checklist data. The live Ling
worker completed all 70. Of 53 clear cases, all 28 PCR and 24 of 25 No-PCR were classified as
expected. One unchanged-lot case with adversarial text became PCR at confidence 1.00. Of 17
deliberately incomplete cases, seven reached Review, eight became PCR, and two became No-PCR;
one unspecified alternative material trial was No-PCR at confidence 1.00. Six Review results had
low-confidence validated output, while one had no validated model output. Several PCR narratives
asserted missing facts or wrong control references; 14 of 37 were outside the approximate
100–150-word target. The complete exact model messages and persisted output for each case are in
`docs/reports/pcr-classifier-70-case-evaluation-2026-09-23/`, with analysis in
`docs/reports/pcr-classifier-70-case-local-evaluation-2026-09-23.md`. No classifier code or
configuration was changed. Seventy Open NPM Henkaten remain in the local demo for inspection;
the pre-existing Compose stack remains running. Next: TMMIN QD adjudication, targeted adversarial
and missing-evidence regression coverage, and grounded explanation checks before production
reliance on automatic No-PCR. Verification: 70/70 HTTP 201 submissions, 70/70 terminal
assessments, database evidence inspection, archive completeness checks, report formatting and
`git diff --check`.

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
Python `urllib` Cloudflare 1010 result. The later 70-case local evaluation above exercised PCR
worker inference end to end. Before activating on staging, evaluate Indonesian cases with TMMIN
QD. Generated OpenAPI/client content is current, and the staged-file drift check passed.

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

## Current Handoff — Portal and master data polish, 2026-09-25

Objective: remove the TMMIN viewport gate, allow an existing line job to be renamed, return to the matching master data list after a successful edit, and include MP/job/line identity in the Tanoko inspector scroll region. This is a frontend-only addition to the ongoing Phase 15 acceptance work; no deployment or UAT status changed.

Changed files: TMMIN layout, CSS, and app test; Supplier master data page, CSS, Tanoko page/CSS, and app test; onboarding and Tanoko browser journeys; PRD, implementation roadmap, and ADR 0039. The attached Tanoko image was used to identify the fixed identity section and scrolling boundary. Job rename uses the existing versioned endpoint and refreshes job, Tanoko, board, and line-shift query views. Edit success invalidates its resource list and navigates there with replace. New-resource behavior remains as before.

Local checks passed: pinned pnpm frozen install; format, lint, typecheck, repository unit tests (Supplier 54, TMMIN 14); OpenAPI and generated client parity; build with `VITE_API_ORIGIN=https://api.example.invalid`; Compose config; no destructive migration changes against `origin/main`; fresh 15-migration disposable PostgreSQL and 34 API integration tests; full Chromium/Edge isolated E2E, plus a focused Chromium/Edge onboarding rerun with TMMIN 390/768/1024 px assertions and screenshots, followed by a Chromium visual rerun after the mobile grid refinement and a Chromium/Edge Tanoko inspector-scroll rerun; deployment env/harness/security exception checks; dependency audit; Actionlint, ShellCheck, Hadolint; production-like five-image build and API/Supplier/TMMIN readiness smoke; Trivy filesystem plus all five image HIGH/CRITICAL scans; Gitleaks directory scan and `git diff --check`. The first Gitleaks scan detected only ignored Playwright diagnostic text; the generated reports were temporarily moved outside the repo for the successful source-tree scan and restored intact afterward. The local deployment harness could not exercise Linux `flock`; PR CI covers that check. No schema or API contract changed, so the previous-SHA migration-upgrade path remains unchanged and will be rechecked by PR CI.

The browser screenshots showed cramped TMMIN filters at 390 px; the final two-column mobile layout was visually checked at 390 px and the three-column tablet layout at 768 px. The primary remaining gate is the PR's required CI jobs, followed by the existing Phase 15 staging/device acceptance. No local dev server or Compose container remains running after the checks. The agent-started OrbStack service should be stopped at task end.

PR #26 first CI run exposed a timing assumption in the new Part return-navigation test: the list heading rendered before its asynchronous rows. The assertion now waits for the updated row, and the Supplier unit suite plus formatting passed again. Recheck all required PR jobs on the follow-up commit before reporting delivery complete.

## Final verification

Final expanded template: all 56 PostgreSQL integration tests/9 files passed after a fresh migration reset; the dedicated 7-test setup suite validates all examples and twelve published checklist items. Final typecheck/lint/format and production build passed. OpenAPI check passed and API-client regeneration was byte-stable; the HEAD-based wrapper gate is intentionally not used to disguise the intended uncommitted generated-client changes. Chromium and Edge setup journeys passed; the full five-journey Chromium run also passed earlier in the session. A generated review copy is available at `.local/artifacts/template-setup-supplier.xlsx` (ignored local artifact); the production download endpoint creates fresh valid example passwords. No actual supplier credentials enter this file.

## PR delivery validation — 30 September 2026

The repository-triggered CI workflows were inspected before preparing the commit. Exact runtime is Node 22.23.1 from the previously checksum-verified official archive and pnpm 11.16.0. Started with `pnpm clean`, removed only ignored generated/build directories, then ran `pnpm install --frozen-lockfile`. All application parity commands passed: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, and `VITE_API_ORIGIN=https://api.example.invalid pnpm build`. The intended generated files were staged before the index-based drift check; no drift was hidden by committing unchecked artifacts.

`docker compose config --quiet`, `pnpm db:up`, `pnpm db:wait`, `pnpm db:verify`, `pnpm db:test:reset`, `pnpm db:test:migrate`, then `NODE_ENV=test DATABASE_URL=<Docker disposable test URL> RELEASE_SHA=ci SESSION_CSRF_SECRET=<test value> AUTH_THROTTLE_SECRET=<test value> OUTBOX_ENABLED=false pnpm test:integration` passed all 56 tests/9 files. An isolated upgrade DB applied `git archive origin/main apps/api/prisma` through `PRISMA_MIGRATIONS_PATH`, then current migrate deploy/status: all 19 migrations are up to date. `pnpm db:down` stopped the stack.

`pnpm migrations:destructive-check origin/main`, `pnpm deployment:validate`, `pnpm security:exceptions:check`, and `pnpm security:audit` passed (10 moderate findings and one existing exact ignored high). Workflow-pinned Actionlint 1.7.7, ShellCheck 0.11.0 and Hadolint 2.14.0 passed. The deployment harness ran under Linux with real flock via Docker 29 CLI, and both staging/production Ubuntu 22.04 bootstrap input checks passed.

Production parity used the committed staging example env and remote Compose: all five production images rebuilt with `--pull`, migration/bootstrap, readiness wait, three-domain routing and release identity, deep links, unauthorized session/realtime behavior, security headers, non-root/no-public-Postgres checks, idempotent bootstrap, and restart/persistence assertions passed. The stack was stopped by the harness. Trivy 0.70.0 HIGH/CRITICAL source (clean staged-source export; vuln/secret/misconfig) and all five current runtime image scans passed using the committed exact ignore file.

Review corrected imported MP assignment audit IDs to use the real upsert result, with an integration assertion. It also corrected the Edge project to select `channel: msedge` by default. The system Edge installer cannot run without sudo on this host; local Edge testing uses the existing signature-verified official Microsoft Edge 154.0.4258.48 package payload through `E2E_EDGE_EXECUTABLE_PATH`. Chromium is installed through Playwright. The full exact-runtime `pnpm test:e2e` run and final post-runtime Gitleaks scan are recorded below after completion.

Final delivery browser result: `E2E_EDGE_EXECUTABLE_PATH=<signature-verified official Edge payload> pnpm test:e2e` passed all **10 isolated journeys: 5 Chromium and 5 actual Microsoft Edge**, using pinned Node/pnpm. The browser harness removed every test server/database/container. A Gitleaks scan performed while Playwright was running found six temporary synthetic credentials in live trace resources; no exception was added. Those transient files were removed by the successful harness, and the final directory scan after runtime cleanup passed with no leaks found. The complete final source/image/deployment/database checks are green; commit-scope scanning and remote PR CI are checked after commit/push.

## PR #37 CodeQL follow-up

PR #37 was created against `main` with a comprehensive description of the workbook, review semantics, reset/retention, migration/rollout, tests and staging acceptance work. Commit `d505c35` passed all Release CI workflow jobs, including the ten Chromium/Edge journeys. The separate CodeQL result check reported two changed-code annotations: fast hashing of a credential-bearing retry request and no origin verification in the dedicated workbook worker. Neither annotation was suppressed.

The retry digest now uses Argon2id with account-password work settings and a secret HMAC-derived salt scoped to supplier/requester/kind/idempotency key. The salt input contains no password. Exact request retries remain deterministic; changed passwords with the same key are rejected. Account password hashes retain their random salts. Digest-secret/work-setting changes invalidate old retry comparisons, while operation-ID receipts remain readable. The dedicated worker verifies its private-port envelope (empty origin, null Window source) and File payload before parsing. ADR 0046 records these decisions.

Correction validation used exact Node 22.23.1/pnpm 11.16.0 after `pnpm clean`, removal of ignored generated/build roots and `pnpm install --frozen-lockfile`. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check` and `VITE_API_ORIGIN=https://api.example.invalid pnpm build` passed. Fresh Docker PostgreSQL reset/migration and the exact integration environment above passed all 56 tests/9 files, including identical retries and changed-password rejection. `E2E_EDGE_EXECUTABLE_PATH=<verified Edge payload> pnpm --filter @tmmin-henkaten/e2e run test:e2e --spec=setup-import` passed both affected Chromium/actual Edge journeys. The earlier ten-journey run covers unchanged journeys. Production Compose images were rebuilt with `--pull`; migrate/bootstrap, routing/headers/non-root/private PostgreSQL and restart/persistence acceptance passed, and both runtime harnesses stopped their resources. The clean tracked-source Trivy HIGH/CRITICAL vulnerability/secret/misconfiguration scan and all five rebuilt runtime image scans passed using the exact committed ignore file. Final secret scans and remote CodeQL results remain delivery gates.
