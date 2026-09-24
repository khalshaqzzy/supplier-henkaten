# Local browser QA verification report — 2026-09-24

- **Status:** FINAL RUN REPORT — 22 PASS, 15 FAIL, 10 BLOCKED across the 47 planned A/T/S/H/X/N scenarios. The broader QA plan remains partially unverified; see “Remaining QA not executed.”
- **Baseline:** branch `feat/qa-verif`, commit `cf53a62` (`docs: add qa verif plan`)
- **Scope:** execution of the QA matrix in [`browser-local-end-to-end-verification-plan.md`](../qa/browser-local-end-to-end-verification-plan.md) and ADR 0035, across the local Supplier and TMMIN portals and External API. Push/PWA push permission, subscription, delivery, and revoke flows are excluded per the user's direction; other PWA checks remain in scope.
- **Rule:** observation and defect reporting only. No application bugs are being fixed and no product source files are being changed.
- **Report cadence:** this report was updated through each final verification group. PASS/FAIL outcomes are recorded for 37 of 47 scenario rows (78.7%); 10 rows remain BLOCKED / partial, and partial checks also remain inside some PASS/FAIL rows.

## Run manifest

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-24, Asia/Jakarta |
| Baseline commit | `cf53a62` |
| Browser | Playwright 1.62.0 from the E2E workspace; Chromium and Edge suites completed; Chromium used for local flows |
| Host runtime | Node.js 22.23.2, pnpm 11.16.0 |
| Local URLs | Supplier `http://localhost:5173`; TMMIN `http://localhost:5174`; API `http://localhost:3000` |
| Evidence directory | `.local/qa-evidence/` (ignored local artifacts; no credentials copied into report) |
| Initial working tree | Clean before the run |

## Progress log

### Supplemental E1 — local Hosted provisioning and Supplier onboarding

After the earlier E5 cleanup, a fresh `pnpm local:reseed` started a new local E1 administration epoch. The direct local browser run initially hit an assumption in the existing test helper: it required the bootstrap TMMIN account to be at `/change-password`, while this reseed had already initialized it with `mustChangePassword=false`. The login itself succeeded and the dashboard rendered. A temporary runner outside the persistent test suite handled either state; no application source or persistent test file was changed.

The Chromium browser flow then passed end to end: TMMIN Admin created a Hosted tenant and acknowledged the one-time Supplier Admin credential; the new Supplier Admin signed in with the temporary password and changed it; the supplier created a line, job, part and shift template; created Supervisor, Line Leader, QC and MP members (MP received no login account); drafted and published MAN, MACHINE, MATERIAL and METHOD checklists; created a Line–Shift and assigned Supervisor, Line Leader and MP; and reached `Siap beroperasi`. Axe checks and the five planned Supplier viewports passed on the login and setup routes. The built PWA check was omitted from this Vite development origin because E4 already checked the production build and offline shell separately.

Post-run API health/readiness both returned ready. Read-only database counts were 3 suppliers, 7 lines, 17 parts, 7 shift templates, 48 members and 12 checklist versions, consistent with one newly provisioned Hosted tenant and this onboarding flow layered on the seeded NPM/GKI data. The temporary one-time credentials were not included in evidence. Evidence: `.local/qa-evidence/e1-onboarding/onboarding-summary.json`, and screenshots under `test-results/e2e/local-e1-onboarding/onboarding-local-onboards--03059-etes-start-ready-setup-edge-chromium/`.

This is positive-path onboarding evidence, not full acceptance for T-01, S-01, S-02, S-04, S-05 or S-07. Registry filters, preparation/cutover gates, member/account edit and deactivation, referenced-data constraints, checklist history/snapshot behavior, and Line–Shift copy/overlap/version branches still need verification.

### Supplemental E1 — TMMIN Quality account lifecycle

Through the TMMIN Admin browser, a Quality account was created and its temporary credential shown once. First login required password change and opened a monitoring session. The Quality user saw the create-supplier route denied, and a direct supplier-create API request carrying that session's valid CSRF token returned 403. Admin deactivation changed the user to INACTIVE and the existing browser session returned to login; reactivation restored login. Password reset required confirmation, revoked the active Quality session, marked the account `Reset required`, and the newly displayed one-time credential opened the forced-password-change page. Temporary credentials are absent from files and screenshots. The lifecycle completed in a fresh reseed epoch after harness retries reached the bootstrap account attempt throttle; those retries were test-runner execution noise and are not counted as a product finding.

- Evidence: `.local/qa-evidence/e1-admin/quality-users-summary.json`, `e1-admin-dashboard.png`, `e1-quality-monitoring.png`, `e1-quality-users-lifecycle.png`.
- T-03 is now PASS when combined with E4's local Quality monitoring/PCR correction and prior role-forbidden checks. Push notification testing is excluded from this QA scope per the user's direction; manifest, service worker, update/offline behavior remain in scope.

### E1 supplemental — Supplier Admin and source governance

Supplier detail edit and confirmed deactivate/reactivate passed in the TMMIN browser. The same tenant then had `Supplier.version=5` while its active Supplier Admin had `User.version=2`. The UI sent the user version for both **Reset temporary password** and **Replace administrator**; each endpoint returned `409 VERSION_CONFLICT`, no one-time credential appeared, and the identity remained unchanged. **F-05 — APP_DEFECT / Medium** records both failures. Evidence: `.local/qa-evidence/e1-admin/supplier-admin-version-conflict.json` and `e1-supplier-admin-version-conflict.png`.

TMMIN issued an External client for the next source epoch. Preflight showed eligible with zero blockers, then Hosted→External cutover succeeded from epoch 1 to 2 and revoked the open Supplier Admin session. The reverse preflight also showed eligible with zero blockers, but starting Hosted Preparation returned `409 STATE_CONFLICT`. PostgreSQL showed no preparation record and the old Supplier Admin still ACTIVE; the partial unique index `User_one_active_supplier_admin_key` allows only one active Supplier Admin per supplier, while the preparation service attempted to create another without deactivating the old one. **F-06 — APP_DEFECT / High**: reverse cutover cannot start through the product flow. The preparation/cancel/Hosted return steps therefore could not be completed. Evidence: `.local/qa-evidence/e1-admin/source-cutover-summary.json`, `preparation-summary.json`, `hosted-preparation-conflict.json`, and `e1-hosted-preparation-start-conflict.png`. No workaround or fix was applied.

This E1 administration epoch adds a second FAIL to T-02 and demonstrates the failed reverse branch in T-04; the inability to enter the required preparation mode also fails the preparation-gate portion of S-01. Other S-01 readiness cases remain unverified.

### E1 supplemental — TMMIN global dashboard filters

Playwright Chromium captured the dashboard default response and verified it against the visible supplier table: three active suppliers (two Hosted, one External), 16 Open Henkaten and 16 affected parts, with eight Open/warnings for each Hosted supplier and none for the External supplier. An External/date/week filter returned only the External tenant with zero Open records and zero affected parts. A combined Hosted/Approved/Material/line/part/aging/freshness/month filter excluded External data, and its query selection survived reload. Reset restored the all-supplier totals. API responses returned 200 throughout.

- Evidence: `.local/qa-evidence/e1-admin/dashboard-filters.json`, `e1-dashboard-external-filter.png`, `e1-dashboard-hosted-multifilter.png`, `e1-dashboard-filter-reset.png`.
- This advances T-06, but KPI/ranking/freshness values were not all reconciled independently to database rows, so the full scenario remains partial.

### E2 supplemental — affected-part warning aggregation

Two synthetic NPM Material Henkaten were submitted through the Supplier browser flow for `NPM-53601-B`, a seeded part that already had one Open warning. The TMMIN affected-part view and API showed the aggregate grow from the existing warning to three source records. Rejecting one synthetic record through QC reduced the group to two; rejecting the second reduced it to the single seeded warning. The part remained affected, matching PRD §17.3. The TMMIN page exposed no manual warning-close action. PostgreSQL confirmed both QA records were REJECTED and their warning instances CLOSED while the seed warning remained OPEN. The local E2 run added two terminal test records; E5 final reseed will remove these.

The warning detail labels every source record with its UUID. Read-only PostgreSQL shows the same records have human identifiers `HEN-NPM-20260924-0121` and `HEN-NPM-20260924-0122`; the TMMIN view therefore fails the PRD's traceability expectation to show the Henkaten ID. **F-07 — APP_DEFECT / Low** records this mismatch. The underlying record links worked, and the aggregate counts/reconciliation passed.

- Evidence: `.local/qa-evidence/e2-warning-flow/warning-flow-summary.json`, `warning-detail-two-open.png`, `warning-detail-baseline-open-remains.png`; read-only database check of QA record status and warning closure.
- T-07 is now FAIL / partial because of F-07; its multi-Open and closure behavior passed.

### E2 supplemental — TMMIN Henkaten Explorer and role boundary

The local seeded Explorer returned 25 rows in the first page. The two Open PCR rows occupied positions 1–2, before other Open and terminal rows. The PCR tab showed 8 PCR records and the Review tab showed 4; every returned item matched the selected assessment status. A five-row API page cursor continued with five distinct rows. Hosted returned only Hosted records; External returned zero because this local epoch had no External projection. The External UI empty state rendered. TMMIN Hosted detail displayed the human identifier and exposed no approve/withdraw action. Direct approve and withdraw calls to the Supplier endpoints using the TMMIN session both returned 401, and the record remained Open at the same version.

- Evidence: `.local/qa-evidence/e2-tmmin-explorer/tmmin-explorer-summary.json`, `tmmin-henkaten-open-priority.png`, `tmmin-henkaten-pcr-tab.png`, `tmmin-henkaten-review-tab.png`, `tmmin-hosted-detail-read-only.png`.
- T-08 remains partial: current-epoch External detail is unavailable without an External projection; prior E3 evidence covers External projections. Full filter combinations and all PCR/detail/audit permutations remain unverified.

### E4 supplemental — TMMIN Admin PCR correction on Closed records

TMMIN Admin changed one synthetic, already Rejected Henkaten from PCR to No-PCR through the browser correction form. The form kept **Simpan keputusan** disabled without a reason; the correction saved at PCR version 3 while Henkaten status remained Rejected. Replaying expected PCR version 2 returned `409 VERSION_CONFLICT`. A concurrent pair of different decisions against another synthetic Closed record at the same expected version returned one `200` and one `409`, leaving one authoritative version 3 decision. Read-only PostgreSQL confirmed both successful corrections were audited; each generated access-scoped PCR correction notifications for seven Supplier users. The AI fields and original AI assessment remained persisted; current No-PCR responses did not expose that assessment. Together with E4 Quality's Open/Review correction, this covers Admin/Quality and Open/Closed examples.

The Admin form is rendered only for a session with `TMMIN_PCR_CORRECT`. Its **Simpan keputusan** button is disabled until the trimmed **Alasan keputusan** contains at least 10 characters (`MonitoringPages.tsx:736, 783`); choosing PCR or No-PCR by itself does not enable it. The initial browser screenshot shows the reason empty and the button disabled. This is the observed explanation for why the button could not be clicked; it is form validation, and the subsequent reasoned Admin correction succeeded. If the whole form was missing in the user's attempt, the likely distinction is account capability/role, but that was not the state shown in this test.

In a follow-up Chromium session, Admin changed the same Closed `REJECTED` Henkaten from No-PCR back to PCR. The empty reason and a nine-character reason both kept the button disabled; a reasoned decision enabled it and saved with HTTP `200` at PCR version 4. PCR became authoritative (`decisionSource: TMMIN`) while the Henkaten stayed `REJECTED`. This explicitly verifies the Admin status-change flow and the visible reason threshold.

- Evidence: `.local/qa-evidence/e4-pcr-admin/pcr-admin-summary.json`, `admin-closed-pcr-before.png`, `admin-closed-no-pcr-after.png`; `.local/qa-evidence/e1-admin/admin-pcr-ui-additional-summary.json`, `admin-closed-pcr-restored.png`; audit/notification and PCR-row SQL observations.
- T-09 remains BLOCKED / partial because no local Henkaten lacks a PCR assessment; all 242 current records already have one, so `expectedVersion: 0` first-manual-decision could not be exercised without changing fixture data directly. Other closed-state and race branches passed.

### E0 — baseline reseed and runtime smoke

- The pre-run database differed from the documented fixture: 311 Henkaten records and 311 PCR assessments were present. The authorized `pnpm local:reseed` restored the deterministic local fixture and rotated local seed credentials.
- API health/readiness and all three local services were healthy after reseed.
- Seed invariants observed in PostgreSQL: 2 active Hosted suppliers (NPM, GKI); 120 Henkaten per supplier / 240 total; statuses OPEN 16, APPROVED 124, REJECTED 49, CANCELLED 51; PCR statuses PCR 6, NO_PCR 230, REVIEW 4; 16 open-warning rows; 18 line shifts; 72 job assignments; 6 Canvas layouts; 0 pending outbox rows.
- Playwright route smoke used isolated role contexts at 1280×720: Supplier Admin (15 allowed routes), Supervisor (8), Line Leader (8), QC (8), TMMIN Admin (12), TMMIN Quality (11). All routes allowed by the current route policy rendered; all attempted forbidden routes displayed the forbidden screen. There were no uncaught page errors, server 5xx responses, generic load-error screens, or document overflow at this viewport.
- Evidence: `.local/qa-evidence/e0-browser/route-smoke.json` and screenshots in `.local/qa-evidence/e0-browser/`.

### E3 — local External supplier, ingestion, and TMMIN projections

After the E2 record-level evidence was saved, `pnpm local:reseed` completed and restored the E0 baseline counts; `/ready` reported `ready`. A first read-only count query used a nonexistent `deletedAt` field and failed. The query was corrected to the current schema; it made no data changes.

Using the TMMIN Admin browser session, the UI created a separate inactive External supplier (`QAEXT-260924`), issued its External client credential through the Credential External page, then activated the supplier through the supplier detail confirmation. The first activation attempt before a client existed left the supplier inactive; the UI/API require a client for activation. The retry followed the intended credential-before-activation sequence and passed. One-time secret contents were kept out of screenshots and the report.

Against the same local API, the client token and ingestion matrix returned: single Open `202 ACCEPTED`; identical replay `200 DUPLICATE`; same event ID with changed payload `409 IDEMPOTENCY_CONFLICT`; source version gap `422 SOURCE_VERSION_OUT_OF_ORDER`; terminal Approved, Rejected, and Cancelled events accepted; mixed valid/PII batch `200` with `[ACCEPTED, REJECTED]`. TMMIN projection and External Health reads returned 200. Projection rows showed the external history, and External Health summarized accepted 7, duplicate 1, rejected 3, fresh 1, warning 0, stale 0, no-data 0. Admin browser pages `/external-health` and `/henkatens?sourceMode=EXTERNAL` rendered the new epoch `EXTERNAL · E1` records.

- Evidence: `.local/qa-evidence/e3-browser-flow/e3-external-flow.json`, `e3-external-supplier-created.png`, `e3-external-credentials-form.png`, `e3-external-supplier-active.png`, `e3-external-health-ui.png`, `e3-tmmin-external-explorer.png`.
- Scope limitation: E3 used the pure External create/activate path and ingest lifecycle; Hosted-to-External source cutover remains supported by the passing isolated governance browser suite, but was not repeated on a second local tenant in this epoch.

### Supplemental X-02/X-04 — External validation and lifecycle semantics

A separate External test supplier/client was created in the final local QA epoch. Through the External API, a single invalid PII payload returned `400`; a batch mixing PII and valid content returned `200` with the invalid item `REJECTED / VALIDATION_FAILED` and the valid item `ACCEPTED`. A terminal-to-Open transition returned `422`. An External status-only event retained the existing PCR decision; changing evidence incremented the assessment version and requeued PCR. Approved, Rejected and Cancelled events each closed their corresponding Open warning. Playwright Chromium also rendered the TMMIN Admin **Kesehatan Ingesti External** page.

The first pass reached all API assertions but stopped at a runner selector using the wrong page heading. The application rendered its actual heading; after correcting the one-off locator to the source-defined title, the rerun passed all assertions and saved the health-page screenshot. This was test-runner correction only, not an application defect or code change.

- Evidence: `.local/qa-evidence/e3-browser-flow/x02-x04-external-summary.json`, `x02-x04-external-health.png`.
- X-02 and X-04 are PASS for the combined E3 and supplemental checks. The created tenant and all generated records were removed by final E5 reseed.

### E4 — local PCR correction, Canvas, and offline behavior

After another `pnpm local:reseed`, TMMIN Quality opened seeded `HEN-GKI-20260924-0116`, whose PCR status was `REVIEW` at version 2. The browser form saved a reasoned `NO_PCR` decision; API detail and the visible form showed the corrected state at version 3 with decision source `TMMIN`. Replaying the old expected version returned `409 VERSION_CONFLICT`. PostgreSQL showed successful `PCR_DECISION_CORRECTED` and generated notification audit events. This verified one Open/Review correction path and stale-version protection; closed-record and concurrent-race cases remain unverified.

NPM Supplier Admin opened Canvas for `NPM-L1`. Zoom-in, auto-fit and fullscreen controls were exercised; headless Chromium did not enter fullscreen, so fullscreen behavior is not claimed. The Canvas layout was edited through the width inspector from 2400 to 2500, saved (version 1→2), and remained 2500 after reload. A stale save with expected version 1 returned `409 VERSION_CONFLICT`. The Canvas screenshot showed the seeded member photos in that renderer; this narrows F-01 to the Default Board/photo `<img>` surface observed at E0 rather than all photo renderers.

The `local:reseed` frontend is Vite development mode, so its origin does not serve the generated service worker. To test the built PWA against the same local database, the supplier-web production build was run with `VITE_API_ORIGIN=http://localhost:3000`, and its preview temporarily served on the API-allowed Supplier origin `http://localhost:5173`. Browser evidence showed one active service-worker registration controlling the page, `/manifest.webmanifest` and `/sw.js` both 200, with a standalone manifest. After logout, offline navigation loaded the app shell's “Koneksi tidak tersedia” state and explicitly said operational data is not stored offline; no seeded line or record data appeared. Push permission, subscription, delivery, and revoke were excluded from this QA run per user direction.

- Evidence: `.local/qa-evidence/e4-browser-flow/e4-pcr-correction.json`, `e4-pcr-audit.json`, `e4-pcr-review-before.png`, `e4-pcr-corrected-no-pcr.png`, `e4-canvas-offline.json`, `e4-canvas-viewer.png`, `e4-canvas-edit.png`, `e4-canvas-after-save-reload.png`, `e4-pwa-offline.json`, `e4-pwa-online-built-preview.png`, `e4-pwa-offline-after-logout.png`.
- Production build completed. It emitted the current deprecated PWA `inlineDynamicImports` warning and main bundle size warning (about 1.21 MB minified). This run does not claim production performance.

### E5 — earlier baseline restore (superseded by supplemental QA)

An earlier `pnpm local:reseed` completed. Read-only PostgreSQL checks matched the baseline exactly: 2 suppliers (both active Hosted; no External test tenant), 240 Henkaten (OPEN 16, APPROVED 124, REJECTED 49, CANCELLED 51), PCR 6/230/4 for PCR/NO_PCR/REVIEW, 16 open warnings, 18 Line–Shift rows, 72 Line–Shift job assignments, 6 Canvas layouts, and 0 pending outbox events. API `/health` was `ok`; `/ready` was `ready` with database, migrations, and photo storage ready.

Using the newly rotated E5 credentials, the TMMIN Admin login opened **Ringkasan Global** and the NPM Supplier Admin login opened **Overview Supplier**; that intermediate stack was stopped with `pnpm local:down`. Supplemental QA later restarted it, so this earlier cleanup was superseded by the Final E5 reseed and shutdown below. Evidence: `.local/qa-evidence/e5-final/final-smoke.json`, `tmmin-admin-dashboard.png`, and `npm-admin-overview.png`.

### Final E5 — clean baseline, readiness, and browser smoke

After the final External verification, `pnpm local:reseed` removed all External QA tenants and restored the baseline. Database checks matched the seed invariants: 2 active Hosted suppliers (NPM/GKI), 0 External suppliers, 240 Henkaten (OPEN 16, APPROVED 124, REJECTED 49, CANCELLED 51), PCR 6/230/4 (PCR/NO_PCR/REVIEW), 16 open warnings, 18 Line–Shift rows, 72 assignments, 6 Board layouts, and 0 pending outbox events. `/health` returned `ok`; `/ready` returned `ready` for database, migrations and photo storage.

Final Playwright Chromium smoke logged in as TMMIN Admin and opened **Ringkasan Global**, then as NPM Supplier Admin and opened **Overview Supplier**. Both passed. The local runtime was stopped with `pnpm local:down`; `docker compose --profile fullstack ps` showed no running services afterward. Final evidence: `.local/qa-evidence/e5-final/final-smoke.json`, `tmmin-admin-dashboard.png`, and `npm-admin-overview.png`.

No product source code was changed. The report and handoff are the only intended tracked changes; temporary Playwright runners are removed after verification. Browser screenshots and sanitized summaries remain in ignored `.local/qa-evidence/`.

### Supplemental E4 — PWA update, cache exclusion, and reconnect

The production build was served on the API-allowed Supplier origin. Chromium confirmed the standalone manifest, active controlling service worker, 27 precached shell entries including hashed assets and `offline.html`, and no `/api/`, authentication, or photo entries in CacheStorage. The authenticated Assignment Board and API calls worked online. A byte-only change to the generated worker produced the in-app **Muat versi baru** prompt; the waiting worker activated only after clicking the button. While offline, the protected Board was replaced by the offline status page, an authenticated API fetch failed instead of returning cached data, and **Coba lagi** restored the authenticated Board when connectivity returned. Generated worker bytes were restored after the probe. Push was not tested, per scope.

- Evidence: `.local/qa-evidence/e4-browser-flow/e4-pwa-cache-update-summary.json`. Production build warnings are recorded above; no source files were edited.
- N-04 is now PASS for its in-scope manifest, worker update prompt, offline fallback, network-only operational data, and reconnect behavior. Push is not part of this status.

### Supplemental TMMIN Admin — notification read/unread

TMMIN Admin started with 12 unread notifications. The browser toggled one notification through **Mark read**; the returned state, notification row/action label, and unread count updated without a reload. The browser/API then restored the notification's original unread state and count. This provides read/unread evidence for the Admin surface. The separate Supplier QC stale-row behavior remains F-04; Quality-user notification read/unread and Hosted support photo/layout detail checks are still outstanding.

- Evidence: `.local/qa-evidence/e1-admin/tmmin-notification-ui-summary.json`.

### Supplemental TMMIN support — photos, layouts, Quality scope, and notifications

TMMIN Admin read both seeded Hosted suppliers' member lists, WebP thumbnail/full photos, active lines, saved/generated Canvas layouts, and Assignment Boards. Both photo variants returned `200 image/webp` with private cache policy; every active line layout read returned `200` with layout nodes. The support Board showed current jobs and rendered no mutating controls. TMMIN Quality read the corresponding Hosted members, photos, lines, layouts, Boards, and supplier details; sensitive Supplier Admin identity remained redacted. Quality direct access to Quality-user administration, External-client administration, Supplier Admin reset, and replacement actions returned `403` for both tenants. Quality opened Notifications, changed read/unread state in the UI, observed the updated row/action without reload, and the test restored its original notification state. Empty test Hosted tenants had zero members/lines and were recorded as empty read models; verification of populated support data used NPM and GKI.

- Evidence: `.local/qa-evidence/e1-admin/tmmin-support-complete-summary.json`, `tmmin-support-summary.json`, `quality-readonly-summary.json`, `tmmin-notification-ui-summary.json`.
- T-11 is now PASS for scoped Admin/Quality read-only support, photo/layout access, audit/status and notification checks. This does not assert that the separate Supplier QC notification defect F-04 affects TMMIN.

### Supplemental TMMIN Admin — registry pagination

In the same authenticated Admin browser session used for the PCR correction, the Supplier registry API returned 25 first-page rows with `hasNextPage=true`; its cursor returned one additional, distinct supplier. The registry UI rendered exactly the first 25 rows and showed no next button, page link, or cursor in the URL. Server-side search did find the page-two supplier by its code, and the External source filter showed only External rows, so those filters pass while ordinary browsing cannot reach the additional row. No tenant needed to be created in this supplemental run because the existing QA epoch already had enough records.

**F-12 — APP_DEFECT / Low:** the Supplier registry discards the API's available cursor pagination and has no UI control to reach records beyond the first 25. PRD §§20.12 and 21 require cursor pagination for lists. Search is a workaround but does not provide the missing page navigation.

- Evidence: `.local/qa-evidence/e1-admin/supplier-registry-pagination-summary.json`, `supplier-registry-page-one-no-next-control.png`; `.local/qa-evidence/e1-admin/admin-pcr-ui-additional-summary.json`.
- T-01 changes to FAIL / partial: API pagination, no-overlap, search-to-page-two, and source filtering passed; registry UI page navigation is F-12. Other supplier validation combinations remain unverified.

### Supplemental Supplier Admin — account switch and cache isolation

Using one Chromium browser context, NPM Supplier Admin opened the Assignment Board, logged out through the UI, and GKI Supplier Admin signed in. The new session reported GKI; the Board API contained only line IDs belonging to GKI, and filtering with a saved NPM line ID returned no NPM row. The NPM member thumbnail URL returned `404` under GKI authorization, and the NPM line name was absent from the switched page. This verifies the tested account-switch path did not display prior-tenant Board or photo data.

- Evidence: `.local/qa-evidence/e2-supplier/account-switch-cache-summary.json`, `a06-npm-board-before-switch.png`, `a06-gki-board-after-switch.png`, `a06-gki-view-after-npm-line-route.png`.
- The cache/account-switch branch of A-06 now passes. A-06 remains FAIL / partial because F-01 affects the Default Board thumbnail image rendering; other cache-refresh permutations are not claimed.

### Supplemental H-12 — PCR state and lifecycle matrix

The read-only TMMIN Explorer API traversal covered 251 Hosted records in the current epoch, including synthetic records added during prior QA. Status counts were OPEN 24, APPROVED 125, REJECTED 51, CANCELLED 51; assessment counts were PCR 6, NO_PCR 233, REVIEW 12. Each of PCR, NO_PCR, and REVIEW appeared with both Open and at least one Closed lifecycle state. For one representative of each PCR assessment, Explorer list status and assessment matched the corresponding detail response. Earlier E2/E4 runs had already confirmed first-submit wait redirect, a Quality Open/Review correction, an Admin Closed correction, and that correction leaves Henkaten lifecycle unchanged.

- Evidence: `.local/qa-evidence/e2-supplier/h12-pcr-lifecycle-matrix-summary.json`, `.local/qa-evidence/e4-browser-flow/e4-pcr-correction.json`, `.local/qa-evidence/e4-pcr-admin/pcr-admin-summary.json`.
- H-12 remains BLOCKED / partial: a genuine `PENDING` assessment was not held in flight long enough to reload the Supplier wait page and confirm it resumes after refresh. No database rows were changed by this matrix traversal.

### Existing isolated browser suites

`pnpm test:e2e:chromium` completed successfully. All three isolated specs passed: External governance, onboarding, and Tanoko. Each spec provisioned and removed its own disposable database/network/volume; the local seeded runtime was not used as the suite database.

`pnpm test:e2e:edge` also completed successfully: all three tagged specs passed on Playwright's Edge channel. Playwright 1.62.0 is the suite's actual runtime; a root-level CLI probe resolved a different 1.61.1 binary and is not used as test evidence.

Across these suites, observed browser coverage includes Hosted tenant onboarding from both portals, temporary credential/password change, member/line/job/part/shift/checklist setup, Line Setup readiness, TMMIN read-only governance, Hosted-to-External cutover, External credential and ingest/idempotency/error paths, keyboard login flow, Axe checks on tested routes, supplier responsive viewports, service worker/manifest/offline shell, and Tanoko matrix/history/role/version checks. This is regression evidence for these tested paths, not a pass for every row in the larger QA matrix.

The UI build emitted a warning that the main minified JavaScript chunk is about 1.55 MB and also emitted the current PWA plugin's deprecated `inlineDynamicImports` option warning. This was recorded as a follow-up performance/build-tool observation; no load target was asserted by these suites.

### API integration verification

The disposable `supplier_henkaten_test` database was explicitly reset and migrated before starting `pnpm test:integration`. The shell `DATABASE_URL` was unset so integration tests used their repository-defined `_test` target. **Result: 6 files passed, 31 tests passed.** Coverage includes administration/source governance, master data and private photos, Hosted line-shift/Henkaten decisions and PCR corrections, External ingestion/idempotency/batch/cutover, persistence/tenant constraints/append-only audit, and push/outbox behavior. These integration tests did not mutate the main reseeded database.

`pnpm test:unit` passed: 190 Vitest tests across 48 files plus 2 Node local-stack plan tests (192 tests total). This includes API, contracts, frontend, UI, API-client, push/PWA policy, PCR screening, time/line-shift, and board-layout units.

`pnpm test:baseline` passed after resetting the disposable test database to satisfy its empty-database precondition: 2 tests passed. The benchmark generated a 42-supplier/20-line/300-member/500-job/projection/audit profile; all sampled endpoints had 0 errors and were within the suite's local p95 targets (TMMIN dashboard 195 ms, External projection list 6 ms, audit list 23 ms, notification list 4 ms, mutation 7 ms, External ingest 13 ms). These figures are local synthetic-baseline evidence only, not a production capacity claim. The first attempt was stopped at the documented empty `_test` precondition because the preceding integration suite left test rows behind; it passed after the isolated database was reset. Main local data was not touched.

### E2 — seeded Hosted UI workflow

Through Chromium against the reseeded NPM Supplier portal, a seeded Line Leader created a `MATERIAL` Henkaten with line/job/part selected and all four checklist responses set to Yes. The record was opened by its route owner Supervisor, approved with a comment, then approved by a seeded QC user. The API detail read after each UI decision showed the final record `APPROVED`, both routes `APPROVED`, and PCR `PCR`. The PCR wait route redirected to detail once evaluation completed. Browser screenshots and a sanitized result ledger are in `.local/qa-evidence/e2-browser-flow/`; identifier `HEN-NPM-20260924-0121`.

The Supervisor owner was matched from the current route snapshot. The QC route has no individual responsible member in this fixture (`currentResponsibleName` is null); a seeded QC account completed the QC route. This is consistent with the route representation and its role-level decision rule. A first temporary harness attempt tried to select the single current Line–Shift selector even though the UI disables it when only one shift is valid; the rerun kept the selected value and passed. This harness-only adjustment did not change application data beyond the created QA record.

After the QC action, the QC portal opened Notification Center. The limited first-20 query returned 20 items both before and after, so it did not establish total-count synchronization. The Henkaten notification deep link was subsequently verified; the stale read/unread row state is documented under F-04.

### E2 — withdraw and clone

A second seeded Line Leader created a `METHOD` record and withdrew it through the detail action rail. The API and PostgreSQL showed `CANCELLED` and the supplied withdrawal reason. Clone created a new `OPEN` record linked back through `clonedFromHenkatenId`; cause/detail/object values and current checklist were available, and the clone was accepted after manually selecting its still-active Job.

**F-02 — APP_DEFECT / Low: clone prefill drops a still-valid Job under the recurring Line–Shift model.** API `clone-prefill` returns `shiftStillValid=false` and `jobStillValid=false` for the original `HEN-NPM-20260924-0122`; PostgreSQL confirms its source ShiftRun is `NOT_STARTED`, while its Job and Part are active and the Job is assigned to the current Line–Shift. The form therefore clears Job and disables submission until the user selects it again. This path treats the superseded ShiftRun lifecycle as validity oracle, even though a manual Job selection allows the clone to work.

- Evidence: `.local/qa-evidence/e2-browser-flow/e2-method-clone-prefill.png`, `e2-method-clone-manual-job-selection.png`, `e2-method-clone-prefill-api.json`, `e2-method-withdraw-clone.json`; read-only SQL showed the original ShiftRun `NOT_STARTED` and the source Line–Shift Job assignment present.

### E2 — MAN movement and reject restoration

On GKI, Supplier Admin set an unassessed Tanoko cell to level 4 through the matrix UI. A GKI Line Leader then created a MAN Henkaten using a level-3 MP for the current Line–Shift Job. The assignment board changed from MP 9 to MP 1 immediately while the Henkaten remained OPEN. Supervisor rejected through the UI; the final API and database state was `REJECTED`, the QC route was `NOT_REQUIRED`, and the board/WorkingAssignment restored MP 9. No reservation was created. This covers qualified replacement, immediate effectiveness, and reject restoration across UI, API, and PostgreSQL.

- Evidence: `.local/qa-evidence/e2-browser-flow/e2-gki-tanoko-editor.png`, `e2-gki-tanoko-saved.png`, `e2-gki-man-before-submit.png`, `e2-gki-board-current.png`, `e2-gki-man-open-detail.png`, `e2-gki-man-after-reject.png`, `e2-gki-man-reject-board.json`.

### Authentication throttle observation

The NPM Line Leader account succeeded five times in separate legitimate UI contexts within the 15-minute window. Its next valid login returned the generic 401 `AUTHENTICATION_FAILED`; the local User row remained ACTIVE with `failedLoginCount=0`, and the hash in the reseed credential manifest matched the database password hash. Code inspection confirms the account-key limiter counts every login attempt before password verification, including successful logins. This is recorded as **F-03 — PRODUCT_RISK / Low: repeated successful sign-ins consume the same five-attempt account throttle used to limit failures**. It is transient for that account/window and did not affect other NPM roles or GKI. PRD explicitly describes five failed logins as a 15-minute lockout and separately says login is rate limited per account and IP, so this is a behavior/clarity risk rather than a demonstrated authentication bypass or credential defect.

### E2 — MACHINE creation and approval order

A NPM Line Leader created a `MACHINE` record with all checklist answers Yes. QC approved first; API/database state remained OPEN with QC `APPROVED` and Supervisor `PENDING`. Supervisor NPM 2 then approved and the record became `APPROVED` with both routes complete. This exercises the second parallel decision order through the browser and authoritative API detail. Evidence: `.local/qa-evidence/e2-browser-flow/e2-machine-before-submit.png`, `e2-machine-open-detail.png`, `e2-machine-after-qc-first.png`, `e2-machine-final-approved.png`, `e2-machine-qc-first.json`.

### Notifications and deep links

QC opened the notification for `HEN-NPM-20260924-0124` and clicked **Tandai dibaca**. The PATCH returned 200 and PostgreSQL/API changed `readAt` and version 1→2, but the visible row stayed `is-unread` and the button remained **Tandai dibaca** until full page reload. After reload, UI matched the read state. Toggling back to unread returned 200 and changed the API/DB version 2→3; again the visible row stayed read until reload, then showed unread. The same row's **Buka** deep link resolves to the authorized Henkaten detail. This is **F-04 — APP_DEFECT / Low: notification read/unread controls leave the list and badge view stale until reload**.

- Evidence: `.local/qa-evidence/e2-browser-flow/e2-qc-notification-read-immediate.png`, `e2-qc-notification-read-reload.png`, `e2-qc-notification-unread-reload.png`, `e2-notifications-qc.json`.

### TMMIN viewport check

TMMIN Admin overview and supplier registry had no horizontal document overflow at 1280×720 or 1672×941. At 390×844, 768×1024, and 1024×768, each route intentionally showed “Gunakan layar desktop minimal 1280 × 720.” with no horizontal overflow. Evidence: `.local/qa-evidence/e0-browser/tmmin-responsive.json` and viewport screenshots. Narrow-view TMMIN content is therefore gated by current design; narrow responsive behavior is not claimed as supported.

### E2 supplemental — Supplier member edit and lifecycle

Using the Supplier Admin browser, creating a Material Planner produced a member without a login account; the form had no username field. A duplicate registration request returned `409`. Editing the member returned `200` and incremented member version from 2 to 3. Before reloading the detail page, clicking **Nonaktifkan member** sent the stale version and returned `409 VERSION_CONFLICT`; the same deactivation and subsequent reactivation each returned `201` after reload. **F-08 — APP_DEFECT / Medium** records that the detail page keeps the old member version after save, so a follow-up lifecycle action fails until reload. This is a UI state issue; the deactivation service passed once given the current version. Evidence: `.local/qa-evidence/e2-supplier/member-stale-version-summary.json`, `.local/qa-evidence/e2-supplier/member-edit-then-stale-deactivate.png`.

The independent S-02 account lifecycle checks also completed. UI creation of a Supervisor produced a one-time temporary credential; first login required a change, after which normal login succeeded. Duplicate username returned `409`. Account deactivation revoked the current session; reactivation issued a new one-time credential that again required change, followed by normal login. TMMIN-style reset through the Supplier UI displayed a new one-time credential and revoked the current session; its login opened the forced-change page. Member deactivation also made the login account INACTIVE and revoked its session; reactivating the member left the account INACTIVE. MP creation omitted account fields, duplicate registration returned `409`, MP edit and deactivate/reactivate passed after reload, and the hard-delete request returned `404`. A QA Line Leader assigned to an active Line–Shift could not be deactivated (`409`); the member remained active. **S-02 is FAIL / partial** because F-08 remains. The old password was not retried after the final reset because the account limiter's five-attempt window had been exhausted by the needed lifecycle logins; password reset/session revocation and the new forced-change credential were verified. No temporary credentials were retained in evidence. Summary: `.local/qa-evidence/e2-supplier/members-admin-summary.json`, `line-setup-summary.json`; screenshot: `npm-admin-member-lifecycle.png`.

### E2 supplemental — versioned 4M checklist lifecycle

Supplier Admin edited and published a new draft for MAN, MACHINE, MATERIAL and METHOD through the browser. Each category created the next immutable published version; the immediately prior published version and an existing record's complete checklist snapshot remained unchanged. Duplicate labels showed the UI error and did not increment the draft version. Each category's deactivate/reactivate actions returned `201`, restoring the active state. A newly created Line Leader completed forced password change; the Supplier form-options API and the visible create form used the latest published version/item for all four categories. Evidence: `.local/qa-evidence/e2-supplier/checklist-history-summary.json`, `checklist-material-version-history.png`, `checklist-material-new-henkaten.png`. S-05 acceptance steps for all categories passed in this local epoch.

### E2 supplemental — member photo lifecycle

For a synthetic MP member, invalid SVG MIME and a file larger than 2 MiB were rejected in the browser before any upload request. A valid JPEG upload returned `201`; both full and thumbnail URLs returned private `image/webp` assets. Removal returned `204`, cleared the API photo reference, and restored the initials fallback. Evidence: `.local/qa-evidence/e2-supplier/member-photo-summary.json`, `member-photo-uploaded.png`, `member-photo-removed-initials.png`. S-03 still fails overall because the separate F-01 Default Board thumbnail rendering defect remains; Canvas rendering had passed in E4.

### E2 supplemental — Part edit and lifecycle

Supplier Admin created and edited an unreferenced Part, filtered it by inactive status, deactivated and reactivated it. The first deactivation immediately after edit returned `409 VERSION_CONFLICT`; reloading the detail made the same action return `201`. This reproduces F-08 beyond member details: `ResourceLifecycle` also submits a stale row version after edit. Evidence: `.local/qa-evidence/e2-supplier/master-part-lifecycle-summary.json`, `master-part-stale-version-after-edit.png`, `master-part-reactivated.png`.

### E1 supplemental — Supplier registry and new Hosted readiness

In the TMMIN Admin browser, registry search, active status, source filter, and server sort matched the URL and returned only the selected source/status rows. Duplicate supplier code returned `409`; invalid IANA timezone returned `400`; creating External and Hosted suppliers each returned `201` with the expected source. The Hosted Admin's one-time temporary credential was visible once and absent from the registry response; first login required a password change, subsequent login succeeded, and the empty Hosted supplier's readiness remained blocked by 10 setup items. The registry only had five rows, so a second cursor page was unavailable. Evidence: `.local/qa-evidence/e1-admin/supplier-registry-summary.json`, `tmmin-supplier-registry-filters.png`, `tmmin-new-hosted-admin-setup-readiness.png`.

### E1 supplemental — TMMIN Hosted support and Quality read-only boundary

TMMIN Admin opened Hosted support shifts, Assignment Board, a historical Shift detail, audit, notifications and System Status. Hosted support/Board pages exposed no mutating actions, and `/health` and `/ready` returned `ok` and `ready`. A new TMMIN Quality account completed forced password change and normal login. Quality could read supplier monitoring and open Hosted support, notifications, audit and System Status, while Quality-user administration and External-client administration returned `403`; supplier list responses did not include the temporary password. Evidence: `.local/qa-evidence/e1-admin/tmmin-support-summary.json`, `quality-readonly-summary.json`, `tmmin-hosted-support-shifts.png`, `tmmin-hosted-assignment-board.png`, `tmmin-hosted-shift-detail.png`, `tmmin-system-status.png`, `tmmin-quality-system-status.png`.

### E2 supplemental — operational master data and Line Setup

Supplier Admin created a QA line with two jobs, a part, and three Shift Templates through the UI. A duplicate part number was rejected with `409`. A `22:00–06:00` template was represented as cross-midnight in `Asia/Jakarta`; `06:00–14:00` did not overlap, while adding a `02:00–05:00` active Line–Shift on the same line returned `409` and created no row. The Line Setup copy path created the second shift and copied Supervisor, Line Leader, and both job MP assignments. One MP was accepted on both jobs. Assignment save with the old version returned `409`; deactivate/reactivate of the copied shift each returned `201`.

**F-09 — APP_DEFECT / Low:** after the copied shift is created, the new shift appears in the tab list but the old shift remains selected in the editor. The assignment form and status action still target the old selected shift until the user manually switches tabs. The runner observed the stale selection before taking action, selected the Day tab explicitly, and avoided mutating the wrong shift. Evidence: `.local/qa-evidence/e2-supplier/line-setup-summary.json`, `line-setup-copy-selection.png`, `line-setup-two-shifts-copy-shared-mp.png`, `line-setup-overlap-conflict.png`.

A new QA Line Leader logged in and submitted a Material Henkaten against its assigned current Line–Shift. It was `OPEN`, used the latest Material checklist version (7), and stored all answers as Yes. Deactivation attempts against its Open Henkaten part, referenced Shift Template, line with jobs/shifts, assigned job, and Line Leader all returned `409`; every resource remained active. Evidence: `line-setup-summary.json`, `line-setup-new-material-submission.png`, `line-setup-new-henkaten-created.png`. The test record is synthetic and will be removed by the final reseed.

### E2 supplemental — Supervisor reroute and approval ownership

Supplier Admin rerouted a new Open Henkaten through the UI. It remained Open with a Pending Supervisor route, its version advanced, and `HENKATEN_SUPERVISOR_REROUTED` audit evidence recorded the action. The assigned Supervisor could log in, open the detail, and approve; first approval left QC Pending and the record Open, and QC's second approval finalized it Approved. Stale intent returned `409 VERSION_CONFLICT`; a repeated Supervisor decision and a terminal decision returned `409 STATE_CONFLICT`; the former Supervisor and Supplier Admin decision requests returned `403`. A terminal record created by seeded LL could not be withdrawn (`404`) and remained Approved. Evidence: `.local/qa-evidence/e2-supplier/reroute-summary.json`, `approval-negative-summary.json`, `admin-approval-denial-summary.json`, `terminal-withdraw-summary.json`, and associated screenshots.

Two route-owner gaps remain. The new Supervisor had no notification for the rerouted record, and a former Supervisor still saw an enabled **Approve** button even though the API rejected the action with `403`. The first is a gap against the S-08 acceptance oracle; the PRD does not explicitly define notification delivery on reroute. The second is **F-11 — APP_DEFECT / Low**: the detail UI exposes an action to a user who is no longer the persisted route owner. Neither caused unauthorized state mutation.

## Final local epoch state

The final E5 reseed restored the deterministic baseline after the External test tenant was created. Seed counts, health/readiness and both role logins passed; `pnpm local:down` then stopped the runtime. No QA-created External tenant or supplemental Henkaten remains in the local seeded database.

### Confirmed finding

**F-01 — APP_DEFECT / Medium: Default Board member thumbnails are blocked cross-origin in Chromium.** The Supplier UI is served from port 5173 and the API from 3000. Authenticated thumbnail requests return 200 `image/webp`, but include `Cross-Origin-Resource-Policy: same-origin`; Chromium blocks the Default Board image element with `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, so it renders initials despite available photos. E4 Canvas displayed those member photos through its separate credentialed image renderer, narrowing this finding to the Default Board image surface. No fix was applied.

- Evidence: `.local/qa-evidence/e0-browser/npm-admin-board-investigation.png`, `.local/qa-evidence/e0-browser/npm-admin-board-images.json`.
- Request/response metadata was inspected through an authenticated Playwright request; secrets and image contents are not included in this report.

## Scenario status snapshot

| Group | Status | Evidence / current limitation |
| --- | --- | --- |
| Baseline, health, final clean reseed and two-role smoke | PASS | Seed invariants, `/health`, `/ready`, TMMIN Admin and NPM Supplier Admin browser smoke passed; stack stopped |
| Governance, onboarding and Tanoko E2E suites | PASS with recorded findings | Chromium and Edge suites passed; local exploratory findings F-01–F-12 remain documented |
| Hosted Henkaten and Supplier workflows | FAIL / partial | Most creation, checklist, decision, approval and withdrawal paths passed; F-01/F-02/F-04/F-08/F-09/F-11 plus the explicit remaining branches apply |
| TMMIN administration and governance | FAIL / partial | PCR correction passed both decision directions. F-05/F-06/F-12 are recorded; remaining gates and registry/dashboard detail checks are listed below |
| External ingestion and monitoring | PASS on tested branches | Token, replay, idempotency, version ordering, PII isolation, evidence requeue, warning closure and Admin health view passed; X-05 remains |
| PCR, notifications and operational diagnostics | FAIL / partial | Admin and Quality correction passed; Supplier QC read/unread defect F-04 remains; first-decision fixture, pending reload and N-05 diagnostics remain |
| Accessibility, responsive and PWA | PASS within browser scope | Tested browser routes/viewports and built offline/update/reconnect passed; physical-device and assistive-technology validation is not claimed; push is excluded |

## Scenario matrix

The complete functionality inventory is in [`browser-local-end-to-end-verification-plan.md`](../qa/browser-local-end-to-end-verification-plan.md) (I-01–I-24). The following execution matrix applies the plan's A/T/S/H/X/N IDs. `BLOCKED` means the full row's acceptance steps were not exercised in this run; it does not imply an application defect.

| ID | Status | Evidence and limit |
| --- | --- | --- |
| A-01 | PASS | E0 role login/route contexts and E2 actor changes across both portals; `.local/qa-evidence/e0-browser/route-smoke.json`, E2 browser flow evidence |
| A-02 | PASS | Local Supplier Admin lifecycle covered one-time credential, forced password change, reset, prior-session revocation, replacement, and secret omission from registry; TMMIN Quality create/reset/forced change/session revoke also passed. `.local/qa-evidence/e1-admin/quality-users-summary.json`, `supplier-registry-summary.json` |
| A-03 | FAIL | F-03: five successful sign-ins consumed the account throttle and the next valid sign-in was rejected; incorrect-password lockout path was not independently completed |
| A-04 | BLOCKED / partial | E0 route policy covered all six roles; Quality mutation and External-client admin access returned 403; NPM cross-tenant GKI member read/deactivate/photo returned 404 without changing the member. Supplier line-scope and remaining source-mode matrix are not complete. `.local/qa-evidence/e0-browser/route-smoke.json`, `quality-readonly-summary.json`, `cross-tenant-scope-summary.json` |
| A-05 | PASS | Isolated E2E missing-CSRF and foreign-origin mutations returned 403; local protected mutations used CSRF. Integration suite covered version and idempotency constraints |
| A-06 | FAIL / partial | F-01 remains on Default Board thumbnails. NPM→GKI account switch in one browser context showed only GKI lines; prior NPM line selection had no rows, and the previous tenant's photo returned 404. Additional cache-refresh permutations remain untested. `.local/qa-evidence/e2-supplier/account-switch-cache-summary.json`, `cross-tenant-scope-summary.json`, `.local/qa-evidence/e0-browser/npm-admin-board-images.json` |
| T-01 | FAIL / partial | Search/status/source/sort matched UI filters; duplicate code `409`, invalid timezone `400`, External and Hosted create `201`. Hosted Admin one-time credential/forced change passed and registry omitted the secret. API page two exists, but UI renders only the first 25 with no next/page control (F-12); searching still finds a page-two supplier. Other validation combinations remain. `.local/qa-evidence/e1-admin/supplier-registry-summary.json`, `supplier-registry-pagination-summary.json` |
| T-02 | FAIL | Supplier detail edit and activation lifecycle passed, but UI reset and replace both returned `409 VERSION_CONFLICT`: supplier version 5, active Supplier Admin user version 2. F-05; `.local/qa-evidence/e1-admin/supplier-admin-version-conflict.json` |
| T-03 | PASS | E1 local create, one-time credential, forced change, read-only API/UI denial, deactivate/session revocation, reactivate and reset/session revocation; E4 Quality PCR correction. `.local/qa-evidence/e1-admin/quality-users-summary.json`, `.local/qa-evidence/e4-browser-flow/e4-pcr-correction.json` |
| T-04 | FAIL | Local Hosted→External cutover passed at epoch 1→2. Reverse preflight was eligible, but Hosted Preparation returned `409 STATE_CONFLICT` because the old Supplier Admin remained active under the unique one-active-admin constraint (F-06); cancel and reverse cutover could not start. `.local/qa-evidence/e1-admin/hosted-preparation-conflict.json` |
| T-05 | PASS | Local one-time External credential issue and token; isolated E2E covered rotation, revocation, IP allowlist and rate limiting |
| T-06 | BLOCKED / partial | Local baseline KPI/source counts reconciled to visible/API supplier totals; External and combined Hosted filters, date/granularity, query persistence and reset passed. Ranking and full trend/freshness-to-DB reconciliation remain. `.local/qa-evidence/e1-admin/dashboard-filters.json` |
| T-07 | FAIL / partial | Two same-part Open records raised the aggregate to 3; terminal transitions decremented to 2 then left the seeded warning at 1. No manual close action. F-07: detail shows UUID instead of human Henkaten identifier. `.local/qa-evidence/e2-warning-flow/warning-flow-summary.json` |
| T-08 | BLOCKED / partial | Local Open-PCR priority, PCR/Review tabs, source separation, five-row cursor, Hosted detail and TMMIN approve/withdraw denial passed. Current E2 has no External projection; prior E3 External display evidence exists. Full filter combinations and detail/audit permutations remain. `.local/qa-evidence/e2-tmmin-explorer/tmmin-explorer-summary.json` |
| T-09 | BLOCKED / partial | Quality Open/Review and Admin Closed correction passed; required reason, stale 409, concurrent one-winner/one-conflict, AI retention, audit and notification fan-out passed. No assessment-free local fixture exists for expectedVersion 0. `.local/qa-evidence/e4-pcr-admin/pcr-admin-summary.json` |
| T-10 | PASS | E3 External Health UI and API totals matched local ingestion outcomes; `.local/qa-evidence/e3-browser-flow/e3-external-flow.json` |
| T-11 | PASS | Admin/Quality read-only support shifts/Board/historical Shift, both seeded Hosted suppliers' master data, private full/thumbnail photos, active Canvas layouts, audit, and System Status passed. Admin/Quality notification read/unread updated in place and original state was restored. Quality-user, External-client, Supplier Admin reset, and replacement actions returned 403; privileged Supplier Admin identity stayed redacted. `.local/qa-evidence/e1-admin/tmmin-support-complete-summary.json`, `tmmin-support-summary.json`, `tmmin-notification-ui-summary.json`, `quality-readonly-summary.json` |
| S-01 | FAIL / partial | New Hosted Admin login/readiness showed 10 setup blockers; earlier onboarding reached `Siap beroperasi`. Local reverse Hosted Preparation still failed with F-06 before the preparation-user gate and operational block could be exercised. `.local/qa-evidence/e1-admin/supplier-registry-summary.json`, `hosted-preparation-conflict.json` |
| S-02 | FAIL / partial | F-08: member edit saves and increments version, but immediate lifecycle action uses stale version and returns `409`; reload allows deactivate/reactivate. MP/account creation, duplicate registration/username, forced change, account reset/deactivation/reactivation, session revocation, member/account activation coupling, and active Line–Shift reference protection passed. `.local/qa-evidence/e2-supplier/members-admin-summary.json`, `member-stale-version-summary.json`, `line-setup-summary.json` |
| S-03 | FAIL / partial | Invalid MIME and >2 MiB files were rejected client-side; valid JPEG upload returned WebP full/thumbnail; removal restored initials. F-01 remains on Default Board; cross-tenant photo denial returned 404 and account-switch cache isolation passed. Board refresh behavior remains. `.local/qa-evidence/e2-supplier/member-photo-summary.json`, `cross-tenant-scope-summary.json`, `account-switch-cache-summary.json` |
| S-04 | FAIL / partial | UI created line/jobs/part and cross-midnight Shift Template; duplicate part number and reference-protected deactivation returned 409. Part edit/filter/deactivate/reactivate worked, but immediate post-edit deactivate returned `409 VERSION_CONFLICT` (F-08) until reload. Standalone line/job/shift lifecycle, reorder and remaining duplicate branches remain. `.local/qa-evidence/e2-supplier/line-setup-summary.json`, `master-part-lifecycle-summary.json` |
| S-05 | PASS | Browser draft edits/publishes, append-only version history, duplicate-label rejection, activate/deactivate, current Line Leader form options for all 4M categories, and unchanged existing Henkaten snapshots passed. `.local/qa-evidence/e2-supplier/checklist-history-summary.json` |
| S-06 | PASS | GKI Tanoko edit, saved level and Man eligibility/rejection path passed locally; isolated Tanoko suite covered matrix/history/role/version cases |
| S-07 | FAIL / partial | Copy, shared MP across two jobs, stale assignment 409, overlap 409, and copied-shift deactivate/reactivate passed. F-09: new copied shift is not selected automatically; selecting its tab manually worked. Next-occurrence behavior and role-boundary checks remain. `.local/qa-evidence/e2-supplier/line-setup-summary.json`, `line-setup-copy-selection.png` |
| S-08 | FAIL / partial | Legacy redirect, Admin reroute/version/audit, new owner detail/approval, and terminal flow passed. New route owner received no in-app notice; former owner still sees an enabled Approve action (F-11). Plan expects reroute notification; PRD trigger is unspecified. `.local/qa-evidence/e2-supplier/reroute-summary.json`, `approval-negative-summary.json` |
| H-01 | PASS | E0 role-route policy and E2 LL/Supervisor/QC decisions/deep links matched current role flow |
| H-02 | PASS | Default Board and Canvas were reviewed at 390×844, 768×1024, 1024×768, 1280×720, and 1672×941 without document overflow. A synthetic active line verified an unassigned/vacant current job; Canvas verified six simultaneous Open 4M indicators with overflow summarized as `+2`, outlined Open cues, legend, and Canvas accessible name. `.local/qa-evidence/e2-supplier/board-viewports-summary.json`, `board-vacancy-fixture-summary.json`, `h04-overflow-summary.json`, `canvas-overflow-zoom-summary.json` |
| H-03 | PASS | Admin line-switch, dirty Cancel/reset, Line Leader text and machine-asset add/edit/save/reload, automatic placement of a new Job, cleanup, zoom/auto-fit/wheel/pan and headed fullscreen resize/exit all passed. Supervisor editor is absent and the mutation endpoint returned 403; stale-version save returned 409. `.local/qa-evidence/e2-supplier/canvas-vacancy-editor-summary.json`, `canvas-fullscreen-summary.json`, `canvas-gestures-headed-summary.json` |
| H-04 | BLOCKED / partial | Part-number/name search worked; all-Yes Machine, Material and Method submissions were created. Missing and “No” checklist answers disabled submit; identical idempotency replay returned the same record; six Open 4M indicators appeared on Board/Canvas with `+2` overflow. Schedule-boundary/off-hours cases remain. `.local/qa-evidence/e2-supplier/h04-overflow-summary.json`, `canvas-overflow-zoom-summary.json` |
| H-05 | BLOCKED | Qualified GKI level-3 MAN replacement applied immediately and restored after reject; inactive/low-level and shared-MP branches remain |
| H-06 | BLOCKED | Off-schedule next-occurrence and recurrence-boundary timing was not exercised |
| H-07 | PASS | Material Supervisor→QC and Machine QC→Supervisor approval orders passed; Supervisor rejection ended the GKI MAN flow |
| H-08 | FAIL / partial | Stale `409`, double/terminal `409`, previous-owner and Supplier Admin `403`, and terminal withdraw `404` passed. Former Supervisor still sees enabled Approve in UI before API denies it (F-11). `.local/qa-evidence/e2-supplier/approval-negative-summary.json`, `admin-approval-denial-summary.json`, `terminal-withdraw-summary.json` |
| H-09 | FAIL | Withdraw and clone produced correct terminal/new linked records; F-02 clone prefill dropped the still-valid Job until manually reselected |
| H-10 | PASS | Supplier API/UI list filters (status, category, PCR, line, part, date), stable 5+5 cursor pages without overlap, detail checklist snapshot/history, PCR tab, and Supervisor pending queue API/UI row count (2/2) reconciled. `.local/qa-evidence/e2-supplier/henkaten-list-filters-summary.json` |
| H-11 | FAIL | F-04 notification read/unread API state changed but visible UI remained stale until reload |
| H-12 | BLOCKED / partial | All 251 current Hosted Explorer rows were paged; PCR, NO_PCR, and REVIEW each occurred in both Open and Closed lifecycle states, with representative detail matching list. E2/E4 covered submission wait redirect, Open/Review Quality correction, Closed Admin correction, audit and unchanged Henkaten status. A pending assessment was not held during page reload/resume. `.local/qa-evidence/e2-supplier/h12-pcr-lifecycle-matrix-summary.json`, E4 PCR evidence |
| X-01 | PASS | E3 valid token; isolated E2E invalid, rate-limited, rotated and revoked credentials/IP cases |
| X-02 | PASS | E3 Open/replay/conflict/version-gap plus final local External run: single PII returned 400; mixed PII/valid batch isolated `REJECTED/VALIDATION_FAILED` from `ACCEPTED`; invalid terminal→reopen returned 422; status-only update retained PCR decision and evidence update requeued assessment. `.local/qa-evidence/e3-browser-flow/x02-x04-external-summary.json` |
| X-03 | PASS | Local mixed batch returned `[ACCEPTED, REJECTED]`; aggregate accepted/duplicate/rejected totals shown in External Health |
| X-04 | PASS | Local External events closed warnings for Approved, Rejected, and Cancelled; status-only retained PCR and changed evidence requeued the assessment. Admin External Health heading and screen rendered in Playwright Chromium. `.local/qa-evidence/e3-browser-flow/x02-x04-external-summary.json`, `x02-x04-external-health.png` |
| X-05 | BLOCKED | Isolated Hosted source cutover revoked the old session and local External data appeared as EXTERNAL E1; External client-token revocation caused by post-ingest source cutover was not tested |
| N-01 | PASS | Existing E2E Axe checks and keyboard dialog trap/restore passed on tested routes; no device/screen-reader claim |
| N-02 | PASS | Supplier responsive viewports in isolated E2E; local TMMIN desktop/narrow behavior observed, with narrow-screen desktop gate documented |
| N-03 | PASS | Built PWA after logout/offline showed connection error and no protected line/record data; `.local/qa-evidence/e4-browser-flow/e4-pwa-offline.json` |
| N-04 | PASS (scoped; push excluded) | Built manifest/worker and update prompt passed; only shell assets/offline page were precached, API/auth/photo data were absent, API fetch failed offline, offline fallback hid the protected Board, and retry restored the authenticated Board online. `.local/qa-evidence/e4-browser-flow/e4-pwa-cache-update-summary.json`, `e4-pwa-offline.json`. |
| N-05 | BLOCKED | Local health/readiness and synthetic baseline benchmark passed; complete outbox-lag, audit-coverage and photo-cache-header matrix remains |

## Detailed results

## Findings and residual risk

| Finding | Class / severity | Observed impact | Evidence |
| --- | --- | --- | --- |
| F-01 | APP_DEFECT / Medium | Authenticated member thumbnails are blocked on the Default Board by the cross-origin response policy; initials render despite available photos. E4 Canvas did render the same seeded photos. | `.local/qa-evidence/e0-browser/npm-admin-board-investigation.png`, `.local/qa-evidence/e0-browser/npm-admin-board-images.json`, `.local/qa-evidence/e4-browser-flow/e4-canvas-viewer.png` |
| F-02 | APP_DEFECT / Low | Clone prefill marks the current Shift and active Job invalid when the historical ShiftRun is NOT_STARTED. The clone can be submitted after manually reselecting the same active Job. | `.local/qa-evidence/e2-browser-flow/e2-method-clone-prefill-api.json`, `e2-method-clone-prefill.png`, `e2-method-clone-manual-job-selection.png` |
| F-03 | PRODUCT_RISK / Low | Five successful logins in the 15-minute window consume the account attempt limit; the next valid login is rejected generically even though the account remains active and password hash matches. | E2 authentication observation and local DB/hash comparison described above |
| F-04 | APP_DEFECT / Low | In the Supplier QC Notification Center, read/unread changes persist in API/DB but that row's state and action label remain stale until a full reload. A separate TMMIN Admin notification updated in place, so this finding is scoped to the observed Supplier QC surface. | `.local/qa-evidence/e2-browser-flow/e2-qc-notification-read-immediate.png`, `e2-qc-notification-read-reload.png`, `e2-qc-notification-unread-reload.png`, `e2-notifications-qc.json`, `.local/qa-evidence/e1-admin/tmmin-notification-ui-summary.json` |
| F-05 | APP_DEFECT / Medium | Supplier Admin reset and replacement send the current User version, but the API checks Supplier.version. After supplier edit and active-state changes the versions diverge (5 vs 2); both UI actions return `409 VERSION_CONFLICT`, leaving the credential unchanged. | `.local/qa-evidence/e1-admin/supplier-admin-version-conflict.json`, `e1-supplier-admin-version-conflict.png` |
| F-06 | APP_DEFECT / High | Hosted→External cutover leaves the previous Supplier Admin ACTIVE. Hosted Preparation then tries to create another active Supplier Admin and fails the partial unique constraint; reverse cutover cannot begin despite eligible preflight. | `.local/qa-evidence/e1-admin/hosted-preparation-conflict.json`, `e1-hosted-preparation-start-conflict.png`, `source-cutover-summary.json` |
| F-07 | APP_DEFECT / Low | TMMIN warning details display the linked Henkaten row's UUID where the PRD expects its human identifier. Database identifiers for the two QA records are `HEN-NPM-20260924-0121` and `HEN-NPM-20260924-0122`; the UI shows UUIDs. The links still open the correct source records. | `.local/qa-evidence/e2-warning-flow/warning-detail-two-open.png`, `.local/qa-evidence/e2-warning-flow/warning-detail-baseline-open-remains.png`, `.local/qa-evidence/e2-warning-flow/warning-flow-summary.json` |
| F-08 | APP_DEFECT / Medium | Supplier Admin can edit a member or Part, but the detail page retains the old row version. The next deactivate/reactivate action fails with `409 VERSION_CONFLICT` until reload; lifecycle actions pass after the page fetches the updated version. | `.local/qa-evidence/e2-supplier/member-stale-version-summary.json`, `member-edit-then-stale-deactivate.png`, `master-part-lifecycle-summary.json`, `master-part-stale-version-after-edit.png` |
| F-09 | APP_DEFECT / Low | After adding a copied Line–Shift, the new shift appears in the selector but the page continues to display the previously selected shift's assignments and status action. A follow-up action targets the old shift unless the user manually selects the new tab. | `.local/qa-evidence/e2-supplier/line-setup-summary.json`, `.local/qa-evidence/e2-supplier/line-setup-copy-selection.png` |
| F-10 | PRODUCT_RISK / Low | Rerouting a Pending Supervisor route updates persisted responsibility and audit but sends no in-app notification to the new route owner. S-08 expects a notification; the PRD does not explicitly specify this reroute trigger, so product expectation needs confirmation. | `.local/qa-evidence/e2-supplier/reroute-summary.json`, `reroute-new-supervisor-notifications.png`; `approval.service.ts` emits no reroute outbox event |
| F-11 | APP_DEFECT / Low | A former Supervisor still sees and can click the enabled Approve action after reroute. The API correctly returns `403`, so no state change occurs, but the stale UI action leads to a failed approval attempt. | `.local/qa-evidence/e2-supplier/approval-negative-summary.json`, `reroute-old-supervisor-forbidden-ui.png` |
| F-12 | APP_DEFECT / Low | Supplier registry requests 25 rows and omits the API cursor controls. Rows after the first 25 cannot be reached through normal list navigation, although search can locate them. | `.local/qa-evidence/e1-admin/supplier-registry-pagination-summary.json`, `supplier-registry-page-one-no-next-control.png`; PRD §§20.12 and 21 |

## Remaining QA not executed

`BLOCKED / partial` means a planned acceptance branch was not verified in this run; it does not by itself mean that a product feature is absent. The function inventory I-01–I-24 and full scenario steps remain in [`browser-local-end-to-end-verification-plan.md`](../qa/browser-local-end-to-end-verification-plan.md). These are the concrete verification gaps to close before claiming full scenario coverage:

| Area | QA still not verified | Why it remains |
| --- | --- | --- |
| Access and tenant isolation (A-04, A-06) | Complete Supplier line-scope authorization across Admin, Supervisor, Line Leader, QC and MP; finish the source-mode access matrix; exercise remaining same-browser cache refresh permutations. | Existing tests covered cross-tenant read denial and NPM→GKI account switch, but not the full line-role/source matrix. Default Board photos already show F-01. |
| Login throttle (A-03) | Independently complete the incorrect-password lockout/recovery path. | The observed five-successful-login limit produced F-03 before the intended negative-password case could be isolated. |
| Supplier registry/dashboard (T-01, T-06) | Finish the remaining registry field-validation combinations; verify UI cursor navigation after the observed pagination gap; independently reconcile every ranking, trend, granularity and freshness aggregate against database rows. | Registry pagination is F-12; only selected validation/filter branches and dashboard aggregates were reconciled. |
| Henkaten Explorer (T-08) | Complete every planned filter combination and source/detail/audit permutation, including a current-epoch External projection with detail and history checks. | Open/PCR/Review, Hosted, cursor and earlier E3 External display checks passed, but the entire cross-product was not covered. |
| Manual PCR creation and pending lifecycle (T-09, H-12) | Create a record with no assessment and verify `expectedVersion: 0`; hold inference pending while navigating away/reloading, then verify resume/refresh behavior and the resulting authoritative decision. | The reseeded fixture already had an assessment for every Henkaten; local inference completed too quickly to hold a pending case during reload. A deterministic unassessed/slow-inference fixture is needed. |
| Source transition and setup gates (T-04, S-01) | Exercise Hosted Preparation creation, its preparation-user and operational-blocker gates, cancellation, and full External→Hosted return. | The reverse path stopped at `409 STATE_CONFLICT` (F-06) before those states could be reached. |
| Supplier master data (S-04) | Complete standalone Line, Job and Shift Template lifecycle; reorder; remaining duplicate/reference combinations. | The positive creation/reference-protection branches passed, but the full lifecycle/validation matrix did not. |
| Line–Shift operations (S-07) | Verify next-occurrence selection and all role-boundary checks after copy. | Copy, assignment sharing, stale version and overlap checks passed; the newly copied shift required manual selection (F-09). |
| Henkaten schedule/eligibility (H-04, H-05, H-06) | Verify off-hours and schedule-boundary submissions; inactive and below-level Man eligibility; shared-MP constraints; next-occurrence selection and recurrence-boundary timing. | Qualified replacement and core required-answer checks passed, but these boundary and negative branches were not fully exercised. |
| External credential after cutover (X-05) | Verify an old External credential is rejected after the source epoch changes, including the expected token/session behavior after ingestion and cutover. | Hosted→External cutover and epoch display passed; old-client credential rejection after cutover was not tested. |
| Operational diagnostics (N-05) | Finish outbox-lag, audit-coverage and photo-cache-header checks as one reconciled matrix. | Health/readiness, synthetic baseline and representative photo headers passed; complete operational thresholds/coverage were not measured. |
| Device/accessibility limits (N-01, N-02) | Native device and assistive-technology validation remain outside this browser run. | Desktop browser Axe and responsive emulation passed only on the tested routes/viewports; no screen-reader or physical-device claim is made. |

Other partial rows have a recorded outcome rather than a wholly blocked state: T-02 Supplier Admin reset/replacement fail with F-05; T-04/S-01 setup is blocked by F-06; S-02/S-04 lifecycle actions need reload after edit (F-08); S-03 Board refresh remains; S-08 reroute notification expectation remains ambiguous (F-10); H-08 former-owner UI action remains enabled despite API denial (F-11); H-09 clone loses a valid Job until reselected (F-02); H-11 Supplier QC notification row remains stale until reload (F-04). T-01 pagination fails with F-12 and A-06 Default Board thumbnails fail with F-01. These defects were recorded only; none was fixed.

### Explicit exclusions and test artifacts

- PWA push permission, subscription, delivery and revoke were explicitly excluded by the user. Manifest, service-worker update, offline shell, protected-data exclusion and reconnect checks were run under N-03/N-04.
- No persistent Playwright specs or product source changes were added. One-off local Playwright runners were used for exploratory flows and will be removed before push; the report and sanitized evidence are retained. The blocked acceptance branches above therefore do not have newly implemented reusable automated tests in the repository.
- Twelve findings are documented above (ten APP_DEFECT observations and two PRODUCT_RISK observations). Verification recorded actual behavior and did not repair defects.

### Completion summary

The 47 planned A/T/S/H/X/N scenario rows now reconcile to **22 PASS, 15 FAIL, and 10 BLOCKED / partial**. A PASS or FAIL gives a determinate overall row outcome; some rows still have the untested sub-branches listed above. **37 of 47 rows (78.7%)** therefore have a determinate outcome, not full sub-step coverage. The application QA plan is not fully verified. The TMMIN Admin PCR correction was exercised in both No-PCR→PCR and PCR→No-PCR directions on a Closed record; the save button remained disabled until the trimmed reason contained at least 10 characters.

This Markdown report is the comprehensive report for the QA performed in this run, including findings, evidence, and remaining work. **After every item under “Remaining QA not executed” is verified, update or publish a complete final QA report in Markdown under `docs/audits/` with the final evidence and counts.** No product bug fixes were made.
