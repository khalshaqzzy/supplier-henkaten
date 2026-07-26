# Session Handoff — TMMIN Visual Refinement

Tanggal: 2026-07-26

Branch: `staging`

Status: Phase 14 dan 14.1–14.10 `done`; Phase 15.1 adalah next

## 1. Objective dan Outcome

Seluruh TMMIN Portal dipoles ulang tanpa mengganti React/Vite, Tailwind v4, shared Henkaten Design
System, typed API client, route, authorization, atau workflow yang sudah ada. Fidelity tertinggi
diberikan pada Ringkasan Global dan Tata Kelola Sumber berdasarkan seluruh referensi
`.agent/design/`, terutama `tmmin-global-overview.png` dan `source-governance.png`.

Hasil utama:

- shell TMMIN memakai navigation group Monitoring, Tata Kelola, Dukungan, dan Sistem;
- sidebar dapat diciutkan tanpa mengubah capability filtering;
- topbar, global context control, breadcrumbs, page header, focus, hover, spacing, dan responsive
  behavior konsisten pada minimum 1280×720;
- TMMIN-only composition tetap berada di `apps/tmmin-web`; Supplier Portal dan shared primitive
  tidak menerima perubahan visual tidak disengaja;
- terminologi antarmuka dinormalisasi ke Bahasa Indonesia, dengan istilah domain Henkaten, 4M,
  Hosted, External, dan Quality tetap dipertahankan;
- Quality tetap read-only dan tidak memperoleh Supplier-domain mutation control.

Tidak ada database migration, endpoint mutation, approval workflow, export, alert configuration,
Docs, atau fake Live state yang ditambahkan.

## 2. Ringkasan Global

Dashboard sekarang mempunyai:

- URL-authoritative filter untuk Supplier, source, tanggal, status, kategori 4M, line, part, aging,
  freshness, dan granularity;
- default 30 hari terakhir dengan granularity harian bila URL tidak menyediakan nilai;
- explicit `Terapkan` dan `Reset`;
- KPI Supplier aktif dengan Hosted/External split, Supplier dengan warning, Open Henkaten, warning
  di atas 24 jam, affected parts, dan masalah freshness;
- time-series volume Hosted/External/total dan outcome Open/Approved/Rejected/Cancelled;
- ranking tabs Supplier/Line/Part, freshness distribution, External ingestion health, recent
  External activity, emergency override, dan supplier-risk table;
- maksimal sepuluh supplier-risk rows dengan source, freshness, aging, last data, dan drill-down;
- layout-matched loading, empty, dan error states.

Delta terhadap periode sebelumnya tidak ditampilkan karena belum authoritative.

## 3. API dan Read Model

`tmminDashboardExtendedSchema` bertambah secara additive:

- `trend[]` dengan bucket timestamp, Hosted, External, total, dan empat lifecycle outcome;
- `freshnessSummary` dengan fresh, warning, stale, dan no-data;
- `supplierOverview[]` dengan Supplier identity/source, Open Henkaten, warning aktif/aged,
  freshness, dan last-data timestamp.

Backend melakukan day/week/month bucketing, zero-fill, source/outcome classification, freshness
aggregation, Supplier aggregation, dan deterministic sort Open Henkaten descending, warning
descending, lalu nama ascending. OpenAPI dan typed API client telah diregenerasi.

Pure unit coverage ditambahkan pada
`apps/api/src/read-models/dashboard-trend.spec.ts`. PostgreSQL integration assertions ditambahkan
untuk Quality/Hosted dan External dashboard projections.

## 4. Halaman TMMIN Lain

- Peringatan Aktif dan Penelusuran Henkaten memakai toolbar, badges, table hierarchy, aging emphasis,
  breadcrumb, dan detail semantics yang source-aware.
- Supplier list/create/detail, one-time credential, destructive confirmation, dan Quality
  presentation mengikuti shell baru.
- Tata Kelola Sumber memakai Supplier/source summary strip, proposed change, preflight metrics,
  blocker table, evidence grouping, source history, preparation section, dan sticky high-risk rail.
  React tidak menyimpulkan readiness baru.
- External credential dan ingestion pages menekankan lifecycle/status hierarchy, sanitized
  diagnostics, correlation lookup, dan one-time secret acknowledgement.
- Hosted support, assignment board, shift evidence, Quality users, audit, notification, system
  status, account, auth, forced reset, 403, 404, dan route error memakai hierarchy dan terminology
  yang konsisten.

## 5. Files Changed

Contracts/read model:

- `packages/contracts/src/tmmin.ts`
- `apps/api/src/read-models/read-model.service.ts`
- `apps/api/src/read-models/dashboard-trend.spec.ts`
- `apps/api/src/henkaten/operational.integration.spec.ts`
- `apps/api/src/external/external.integration.spec.ts`
- generated OpenAPI dan API client

Frontend:

- `apps/tmmin-web/src/components/layout.tsx`
- `apps/tmmin-web/src/pages/MonitoringPages.tsx`
- `apps/tmmin-web/src/pages/AdminPages.tsx`
- `apps/tmmin-web/src/pages/SupportPages.tsx`
- `apps/tmmin-web/src/pages/AuthPages.tsx`
- `apps/tmmin-web/src/pages/StatePages.tsx`
- `apps/tmmin-web/src/app.css`
- `apps/tmmin-web/src/App.test.tsx`
- TMMIN selectors di `apps/e2e/tests/`

Records:

- `.agent/PAGES.md`
- `.agent/implementationPhases.md`
- `.agent/sessionHandoff.md`
- `docs/adr/0025-tmmin-governance-and-monitoring-composition.md`

User-owned `.DS_Store` tetap tidak disentuh.

## 6. Validation dan Environment

Visual QA memakai deterministic mocked API data pada 1672×941 dan 1280×720. Dashboard dan Source
Governance dibandingkan kembali dengan referensi visual sebelum perubahan, setelah context
compaction, dan sebelum final acceptance. Tabel memakai internal overflow dan tidak menimbulkan
page-level horizontal overflow pada viewport minimum.

Seluruh validation dijalankan dengan repository-pinned Node.js 22.23.1 dari pnpm cache dan pnpm
11.16.0:

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
docker compose --profile fullstack config --quiet
pnpm db:up
pnpm db:wait
pnpm db:verify
pnpm db:test:reset
pnpm db:test:migrate
pnpm test:integration
pnpm db:down
pnpm test:e2e
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 \
  dir /repo --config=/repo/.gitleaks.toml --redact --verbose
git diff --check
```

Results:

- format, lint, typecheck, OpenAPI/generated-client drift, and all production builds passed;
- 90 unit/contract/client/UI/API/frontend tests passed;
- PostgreSQL 18.4 and pgvector 0.8.5 verification, nine fresh migrations, and 32 integration tests
  passed;
- four Chromium plus two Microsoft Edge isolated E2E epochs passed, including auth, governance,
  External, direct `403`, focus/keyboard, axe, and cleanup journeys;
- Gitleaks scanned 43.37 MB with no findings; `git diff --check` passed;
- Playwright's attempted Edge reinstall required interactive macOS sudo, but the already installed
  pinned Edge binary successfully ran both required Edge journeys.

The existing shutdown-only `pg@8`/Prisma warning can still appear after a successful E2E journey
while its disposable database is being removed. It does not affect the journey result or leave
containers, networks, or volumes behind.

## 7. Next Action

Phase 15.1 tetap menjadi next action dan memiliki production multi-stage images. Ikuti Phase 15
sequence untuk Caddy/TLS, remote Compose, security/image workflow, rollback, dan staging
deployment.
