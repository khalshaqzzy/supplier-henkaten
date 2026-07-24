# Session Handoff — Frontend Page and User-flow Specification

Tanggal: 2026-07-24
Branch: `staging`
Status repository: Phase 0–10 selesai; Phase 11 `planned`

## 1. Current Objective and Outcome

Frontend planning sekarang memiliki spesifikasi keputusan-lengkap untuk dua aplikasi tanpa
mendefinisikan visual design:

- `.agent/PAGES.md` menetapkan fondasi UX, route, role visibility, information/action elements,
  validation, page states, deep links, user flows, API dependency, dan contract gaps;
- Supplier-facing specification mencakup Supplier Admin, Supervisor, Line Leader, QC, dan reduced
  Hosted Preparation session;
- TMMIN-facing specification memisahkan TMMIN Admin mutations dari TMMIN Quality read-only
  monitoring;
- Hosted dan External detail memiliki semantics berbeda dan tidak mencampur identity, PII,
  assignment, atau source-of-truth;
- setiap dependency yang belum tersedia ditandai `ADDITIVE API REQUIRED` atau `POLICY MISMATCH`;
- ADR 0020 mengunci dual-app, role-scoped information architecture dan PRD-first gap handling.

Belum ada frontend source code yang dibuat. Phase 11 tetap `planned`.

## 2. Files Changed

- `.agent/PAGES.md` — new normative frontend page and user-flow specification.
- `docs/adr/0020-role-scoped-frontend-information-architecture.md` — accepted IA decision and
  tradeoffs.
- `.agent/implementationPhases.md` — references `PAGES.md` from Phases 11–14 without changing phase
  status.
- `.agent/sessionHandoff.md` — current session outcome, gaps, validation, and next action.

No public API, shared schema, database, migration, application runtime, or deployment file changed.

## 3. Decisions

- `supplier-web` and `tmmin-web` retain separate session realms and route trees.
- Navigation is capability-aware for usability, while backend authorization remains authoritative.
- Hosted Preparation uses a reduced Supplier shell limited to setup/master data/checklists/default
  assignments/account/logout.
- URL query state preserves safe list/filter context; cursor paging and aggregation remain
  server-authoritative.
- Frontend must implement loading, empty, forbidden, retryable error, conflict, stale, and
  realtime-disconnected behavior where applicable.
- Temporary passwords and external client secrets are one-time response data and are not persisted.
- PRD-complete pages remain specified even when the current API lacks a read model. Missing behavior
  is not removed and may not be replaced with client-only domain policy.
- TMMIN Quality remains read-only for supplier domain; notification read/unread is user-local state
  only.
- External records do not require Hosted member photo, registration number, credential, or
  Assignment Board fields.

## 4. Contract Gaps Identified

Fifteen gaps are registered in `.agent/PAGES.md`. The release-relevant groups are:

1. Supplier session lacks authoritative tenant shell context.
2. Supplier onboarding lacks authoritative Hosted readiness summary.
3. Supplier dashboard lacks full PRD aging, trends, detail, and filters.
4. Supplier audit capability for Supervisor/LL/QC differs from the PRD permission matrix.
5. TMMIN has no read-only Hosted Assignment Board endpoint.
6. TMMIN dashboard has no PRD filter query and lacks several aggregates.
7. No unified cross-supplier Hosted/External Henkaten explorer endpoint exists.
8. Supplier/privileged-user lists lack server search/status/source filters.
9. Warning aggregation lacks full filter/pagination and richer instance context.
10. Supplier detail does not expose current Supplier Admin or reloadable Hosted Preparation state.
11. External ingestion diagnostics lack rejected/duplicate history, error aggregate, and
    correlation lookup.
12. TMMIN Quality lacks a sanitized ingestion-health read model independent of credential
    management.
13. Assignment Board lacks explicit critical override/unresolved summary.
14. Source governance lacks a recoverable summary and dedicated history projection.
15. Hosted and External Henkaten read schemas omit part of the required source mode/epoch
    traceability.

Gap resolution is constrained to backward-compatible optional read fields, filter/pagination
parameters, or read-only endpoints under the backend contract-freeze rules.

## 5. Traceability Completed

The page specification was reconciled against:

- PRD personas, permission matrix, identity lifecycle, master data, assignment, Shift, Henkaten,
  approval, warning, notification, dashboard, IA, accessibility, and acceptance criteria;
- Phase 11–14 frontend and E2E roadmap;
- shared Zod contracts for auth, administration, master data, shifts, Henkaten, read models,
  External API, enums, errors, and health;
- generated OpenAPI with 124 paths and 140 operations;
- backend capability mapping and supplier/TMMIN controller boundaries.

Critical user flows documented:

- realm login, forced reset, expiry, and intended destination;
- HOSTED and EXTERNAL provisioning;
- Hosted Preparation, cancellation, and cutover;
- HOSTED-to-EXTERNAL cutover;
- individual master-data lifecycle and optimistic conflict;
- default assignment and atomic move;
- normal/blocked/override Start Shift and End Shift;
- four-category Henkaten submission;
- parallel approval and reject-fast;
- Withdraw and Clone;
- cross-line Man movement/donor issue;
- notification deep links;
- warning lifecycle;
- external credential rotation/revocation/loss;
- source-correct Hosted/External monitoring.

## 6. Validation

Completed:

- `pnpm format:check` — passed; all matched files use Prettier formatting;
- `git diff --check` — passed;
- targeted heading/label check — 64 page-spec headings detected and GAP-01 through GAP-15 are
  present exactly as registered;
- Phase 11, 12, 13, and 14 references to `.agent/PAGES.md` verified.

The active shell reported Node.js `26.3.1` while the repository requests `>=22.23.1 <23`. This did
not change the documentation-only Prettier result, but frontend implementation and full CI parity
must use the pinned Node.js `22.23.1`.

Application tests were not run because this session changes documentation only.

## 7. Blockers

No blocker exists for beginning Phase 11 frontend foundation.

The registered API gaps block full acceptance of their associated Phase 12/13 pages, but they do
not block workspace scaffold, typed client, session shell, route guards, common failure states, or
initial page routing. They should be resolved during the constrained additive integration work,
with contract and authorization tests, before affected pages are declared complete.

## 8. Next Recommended Action

Begin Phase 11 using `.agent/PAGES.md` as the behavior contract:

1. scaffold `apps/supplier-web`, `apps/tmmin-web`, and `packages/ui`;
2. generate the shared typed API client and realm-specific session bootstrap;
3. implement capability/session-purpose route metadata;
4. implement common loading/error/forbidden/conflict/stale behavior;
5. create route-level tests from the Supplier and TMMIN visibility matrices;
6. prioritize additive GAP-01 and GAP-02 before Supplier application shell/onboarding completion;
7. keep all Phase 12/13 feature pages behind their documented API dependencies.
