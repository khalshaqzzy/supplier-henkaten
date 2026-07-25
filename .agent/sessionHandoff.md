# Session Handoff — TMMIN Governance dan Monitoring

Tanggal: 2026-07-25

Branch: `staging`

Status: Phase 13 dan subphase 13.1–13.10 `done`; Phase 14 adalah next

## 1. Outcome

Seluruh TMMIN Admin dan TMMIN Quality workflow telah diimplementasikan pada `tmmin-web`.
GAP-05–12 dan GAP-14 ditutup melalui kontrak read additive; GAP-01–15 sekarang `AVAILABLE`.

- TMMIN Admin dapat mengelola Supplier, Supplier Admin, Quality user, source transition/Hosted
  Preparation, dan External client credential.
- Global Overview, Active Warnings, unified Henkaten Explorer, Hosted support, External ingestion
  health, notifications, audit, System Status, dan account tersedia sebagai production pages.
- TMMIN Quality memakai monitoring dan source-summary presentation yang sama secara read-only.
  Mutation control tidak dirender dan direct source/user/credential/domain mutation tetap `403`.
- Hosted dan External memakai discriminated read contracts. Board hanya tersedia untuk current
  Hosted source; External diagnostics tidak mengekspos raw payload, secret, token, atau Hosted-only
  identity.
- Query/cache keys memuat realm dan principal ID. Logout, expiry, identity change, dan forced reset
  membersihkan cache, CSRF, intended destination, form memory, serta one-time credential.
- Tidak ada migration baru; sembilan migration yang ada cukup untuk read model dan query baru.

## 2. Contract dan Backend

Empat read operation additive:

- `GET /api/v1/tmmin/suppliers/:supplierId/source`;
- `GET /api/v1/tmmin/suppliers/:supplierId/assignment-board`;
- `GET /api/v1/tmmin/henkatens`;
- `GET /api/v1/tmmin/external-health`.

Shared Zod, OpenAPI, NestJS controllers, generated client, dan contract-freeze sekarang reconcile
pada tepat 130 paths/146 operations.

Perubahan backend utama:

- supplier/Quality-user filtering, sorting, cursor, dan paginated server reads;
- Supplier detail dengan monitoring timestamps, current Admin, dan active Preparation; identity
  administration disanitasi dari response Quality;
- source summary dengan computed preflight dan immutable epoch history;
- dashboard filters dan Hosted/External aggregates pada read-model service;
- unified source-aware Henkaten explorer dan source-specific detail;
- current-Hosted TMMIN Board read;
- authoritative accepted/duplicate/rejected External health dan safe correlation lookup;
- duplicate/rejected ingestion audit/notification behavior tanpa payload duplication;
- role-scoped audit default-deny untuk Quality dan Supplier-aware notification deep links;
- privacy acknowledgement, exactly-one Preparation admin, IANA timezone, and current-version
  enforcement.

## 3. Frontend Composition

TMMIN foundation sekarang mempunyai QueryClient, typed browser boundary, session/cache isolation,
safe intended destination, forced-reset/capability/viewport guards, error boundary, skip link,
route-title focus, Not Found/Forbidden states, dan role-aware shell.

Implemented routes mencakup:

- login, forced password reset, logout, account/session;
- Global Overview dengan stats, filters, aging, trends, rankings, freshness, override, External
  activity, dan drill-down;
- Active Warnings list/detail tanpa manual close;
- Hosted/External Henkaten explorer/detail;
- Supplier lifecycle, edit, Supplier Admin replace/reset, dan one-time credential;
- Source Governance preflight/blocker/history/Preparation/cutover;
- External client issue/rotate/revoke dengan one-time secret;
- Hosted master data, Shift reads, dan Assignment Board;
- External Ingestion Health, notifications, Quality-user administration, audit, dan status.

`DataTable` mendukung controlled manual server sorting. Forms memakai React Hook Form/Zod,
optimistic version, duplicate-submit protection, field errors, dan consequence dialogs. Shared
one-time credential value hanya hidup dalam component memory dan hilang setelah acknowledgement,
navigation, atau session cleanup.

## 4. Visual Evidence

Reference yang diinspeksi sebelum implementasi:

- `.agent/design/tmmin-global-overview.png`;
- `.agent/design/source-governance.png`.

Manual audit menggunakan API lokal dan disposable PostgreSQL data:

- login dan Global Overview pada 1440×900;
- Source Governance blocked state dan Supplier Detail pada 1440×900;
- one-time Supplier Admin credential pada 1440×900;
- External Ingestion Health dan Quality read-only Source Governance pada 1280×720;
- unsupported viewport pada 1100×650.

Semua page yang diaudit memiliki `scrollWidth === clientWidth`; tabel lebar berada dalam scroll
container. Audit menemukan dan menutup dua visual/interaction defects: privacy acknowledgement
yang sebelumnya default checked, serta inherited heading line-height yang membuat unsupported
viewport overlap. Quality Source Governance terbukti tidak mempunyai submit/mutation control.

Visual composition mempertahankan compact sidebar, 60 px topbar, near-white canvas, thin border,
low elevation, dense table, tabular numbers, selective orange, visible focus, dan contextual rail.
UI tidak menambah fake live indicator, global search, export, alert configuration, Docs control,
dark mode, bulk action, mobile workflow, atau manual warning lifecycle.

## 5. Validation Evidence

Runtime delivery: Node.js `22.23.1`, pnpm `11.16.0`.

Local GitHub Actions parity:

```text
pnpm clean
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm openapi:check
VITE_API_ORIGIN=https://api.example.invalid pnpm build
docker compose config --quiet
pnpm db:up
pnpm db:wait
pnpm db:verify
pnpm db:test:reset
pnpm db:test:migrate
NODE_ENV=test DATABASE_URL=<disposable-test-url> RELEASE_SHA=ci \
  SESSION_CSRF_SECRET=<safe-test-value> AUTH_THROTTLE_SECRET=<safe-test-value> \
  OUTBOX_ENABLED=false pnpm test:integration
pnpm db:test:reset
pnpm db:test:migrate
NODE_ENV=test DATABASE_URL=<disposable-test-url> RELEASE_SHA=ci \
  SESSION_CSRF_SECRET=<safe-test-value> AUTH_THROTTLE_SECRET=<safe-test-value> \
  OUTBOX_ENABLED=false pnpm test:baseline
pnpm db:down
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 \
  dir /repo --config=/repo/.gitleaks.toml --redact --verbose
git diff --check
```

Results:

- contracts: 27 unit tests passed;
- API client: 8 unit tests passed;
- shared UI: 14 unit/accessibility tests passed;
- API: 16 unit/policy/contract tests passed;
- Supplier foundation: 6 tests passed;
- TMMIN foundation: 5 tests passed;
- test fixtures: 6 tests passed;
- PostgreSQL integration: 32/32 passed from a fresh nine-migration database;
- Compact baseline: 2/2 passed; dashboard p95 89.72 ms against 3,000 ms target, all measured error
  rates zero, and bounded reads retained index/index-only plans;
- runtime/OpenAPI reconciliation: 130 paths/146 operations;
- production builds passed with explicit API origin; the existing non-failing Vite chunk-size
  advisory remains;
- format, lint, typecheck, OpenAPI/client drift, Compose/pgvector, Gitleaks directory/commit scan,
  and `git diff --check` passed.

## 6. Documentation dan Delivery

Architecture records:

- ADR 0019: executable contract count updated to 130/146;
- ADR 0020: TMMIN additive gap resolution;
- ADR 0022: schema-validated accepted `503` browser response;
- ADR 0023: TMMIN realm/principal cache isolation;
- ADR 0025: source-aware TMMIN governance and monitoring composition.

Progress records:

- `.agent/PAGES.md`: GAP-01–15 `AVAILABLE`;
- `.agent/implementationPhases.md`: Phase 13 and 13.1–13.10 `done`, Phase 14 next.

Delivery uses one behavior-based commit:

`feat(tmmin): deliver governance and monitoring workflows`

The exact self-referential SHA is available in `git log` and the delivery response. Existing
`.DS_Store` remains unstaged and belongs to the user.

## 7. Open Scope dan Next Action

Phase 14 owns full Playwright cross-realm/full-stack E2E, including deterministic fixture bootstrap,
two-realm cookie isolation, realtime Board/notification propagation, and source transition journeys.

Phase 15 retains deployment automation. This handoff does not claim a staging deployment URL or
runtime deployment; only the `staging` branch delivery and required GitHub Actions are verified.

No long-running local API/web process or Compose stack remains after delivery.
