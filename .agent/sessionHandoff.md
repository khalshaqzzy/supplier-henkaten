# Session Handoff — Phase 14 Local Full-stack Integration dan E2E

Tanggal: 2026-07-25

Branch: `staging`

Status: Phase 14 dan 14.1–14.9 `done`; Phase 15.1 adalah next

## 1. Outcome

Phase 14 selesai sebagai satu local full-stack delivery:

- root Compose mempunyai profile `fullstack` untuk migration, API, Supplier web, dan TMMIN web,
  sementara PostgreSQL tetap dapat dipakai sendiri oleh command `db:*`;
- development-only `Dockerfile.local` memakai Node.js 22.23.1 dan pnpm 11.16.0, terpisah dari
  production image yang tetap menjadi Phase 15;
- canonical developer origins adalah Supplier `http://localhost:5173`, TMMIN
  `http://localhost:5174`, API `http://localhost:3000`, dan PostgreSQL
  `127.0.0.1:55432`;
- migration one-shot harus sukses sebelum API start, dan readiness API harus sukses sebelum kedua
  Vite service start;
- PostgreSQL dan private member photo memakai volume lokal terpisah;
- protected TMMIN bootstrap tetap operator-driven melalui `.env` dan production CLI. Tidak ada
  credential default, production seed, test-only endpoint, atau fixture fallback;
- `apps/e2e` menjalankan setiap spec/browser sebagai journey epoch PostgreSQL/pgvector yang
  disposable dengan dynamic loopback ports dan unconditional cleanup;
- Chromium menjalankan seluruh journey; Microsoft Edge menjalankan critical authentication,
  governance, External, dan accessibility smoke bertanda `@edge`.

Production Dockerfile, Caddy/TLS, remote Compose, deployment automation, backup/recovery, dan staging
runtime deployment tetap Phase 15.

## 2. Integration dan Realtime

Kontrak HTTP tetap tepat 130 paths/146 operations. Tidak ada schema migration atau breaking API
change pada Phase 14.

Perbaikan integration yang dilakukan:

- default API origin kedua frontend disamakan ke `http://localhost:3000`;
- CORS, CSRF, cookie posture, dan E2E dynamic `127.0.0.1` origins memakai host yang konsisten;
- create flow master data kembali ke list yang authoritative;
- shared form, heading, contrast, label/error association, dan non-color status semantics
  diperbaiki dari executable accessibility evidence;
- Man movement outbox membawa aggregate/line evidence yang benar agar notification dan Board
  invalidation tidak hilang.

Per-connection polling 15 detik diganti oleh satu API-local `RealtimeEventPump`:

- ordered outbox dipoll global dengan default satu detik melalui validated `REALTIME_POLL_MS`;
- event disanitasi dan di-fan-out menurut tenant serta authorized line;
- replay memakai `Last-Event-ID`, REST refetch tetap authoritative, dan heartbeat tetap 15 detik;
- cursor yang tidak tersedia menghasilkan additive `resync`;
- browser client menandai state `resyncing`/stale dan melakukan authoritative refetch.

Tidak ada Redis, frontend policy workaround, direct frontend database access, atau test-only
application behavior.

## 3. Local Developer Commands

```text
pnpm local:up
pnpm local:wait
pnpm local:bootstrap
pnpm local:logs
pnpm local:down
pnpm local:destroy
```

`local:down` menghentikan stack dan mempertahankan normal database/photo volumes.
`local:destroy` bersifat eksplisit dan destruktif terhadap kedua volume tersebut. Variable dan
operator bootstrap procedure terdokumentasi di `.env.example` dan `README.md`; credential nyata
tidak dilacak Git.

Compose checks:

```text
docker compose config --quiet
docker compose --profile fullstack config --quiet
```

Keduanya lulus. Interactive smoke mencapai API health/readiness dan kedua realm pada canonical
Compose URL. Stack kemudian dihentikan dengan `local:down`.

## 4. Deterministic Browser Harness

Root commands:

```text
pnpm test:e2e
pnpm test:e2e:chromium
pnpm test:e2e:edge
```

Setiap journey/browser pair:

1. membuat unique Compose project dan named PostgreSQL volume;
2. memilih dynamic PostgreSQL/API/Supplier/TMMIN loopback ports;
3. memverifikasi PostgreSQL 18 dan pgvector 0.8.5;
4. menerapkan sembilan migration dari database kosong;
5. membuat satu protected TMMIN bootstrap identity melalui operator CLI;
6. menjalankan API dan kedua Vite application;
7. menunggu API readiness dan web reachability;
8. menjalankan scenario serial dalam isolated browser contexts;
9. menghentikan child processes dan menghapus container, network, volume, serta private-photo
   directory melalui `finally` dan signal handlers.

Domain data dibuat melalui browser dan public API. Database hanya disentuh untuk disposable
lifecycle, migration, readiness, dan protected bootstrap mechanics.

Failure diagnostics mencakup Playwright trace, screenshot, video, console/page error, network
failure, HTML report, dan blob report. Intentional failure telah terbukti menghasilkan nonzero exit
dan artifacts, lalu tetap membersihkan seluruh runtime.

## 5. Scenario Results

Seluruh scenario berikut lulus dari clean disposable state:

- onboarding: kedua forced password reset, Hosted Supplier/Admin, shifts, member/account, line, job,
  part, empat checklist category, defaults, duplicate/conflict/deactivation/readiness;
- Hosted lifecycle: valid/blocked/override Start Shift, empat 4M, failed checklist, kedua approval
  order, Supervisor/QC reject-fast, stale simultaneous decisions, Withdraw + Clone, warning
  open/close, End Shift cancellation/reset;
- Man/concurrency: cross-line replacement, duplicate reservation race `201/409`, donor
  vacancy/notification, pre-start resolution, stale decisions, dan Board propagation di bawah
  target lima detik;
- realm isolation: distinct contexts dan shared-context proof bahwa Supplier/TMMIN cookies tidak
  saling overwrite;
- TMMIN: dashboard, warning/Henkaten drill-down, Hosted/External badges, Quality read-only UI dan
  direct `403`, source transition, credential rotation/revocation, audit, notifications, status;
- External: token, Open/Approved/Rejected/Cancelled, identical retry, conflicting duplicate,
  out-of-order/gap, mixed batch, forbidden PII/over-posting, client/epoch/IP/rate isolation, warning
  dan dashboard projection;
- desktop/accessibility: route console diagnostics, 1280×720 overflow, keyboard/focus
  trap/restore, labels/errors, non-color semantics, disconnected/resync SSE, dan axe scans;
- Edge smoke: clean onboarding/authentication dan governance/External/accessibility journeys.

Exact default `pnpm test:e2e` lulus dalam enam independent epochs: empat Chromium plus dua Edge.

## 6. Validation Evidence

Runtime delivery: Node.js `22.23.1`, pnpm `11.16.0`.

Clean CI-parity sequence:

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
pnpm db:test:reset
pnpm db:test:migrate
pnpm test:baseline
pnpm db:down
pnpm test:e2e
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 \
  dir /repo --config=/repo/.gitleaks.toml --redact --verbose
git diff --check
```

Results:

- 86 unit/contract/client/UI/API/frontend tests passed;
- 32 PostgreSQL integration tests passed from fresh migrations;
- Compact baseline 2/2 passed; dashboard p95 142.05 ms, External projection 5.19 ms, audit
  14.78 ms, notification 1.85 ms, mutation 4.44 ms, dan ingest 7.56 ms;
- OpenAPI/generated-client drift, format, lint, typecheck, builds, both Compose configurations,
  PostgreSQL/pgvector verification, migrations, full Chromium + Edge E2E, dan cleanup passed;
- directory Gitleaks and `git diff --check` are rerun immediately before staging;
- post-commit Gitleaks is required before push.

## 7. Files dan Architecture Records

Runtime/config:

- `compose.yaml`, `Dockerfile.local`, `.dockerignore`, `.env.example`;
- `scripts/local-stack.mjs`, root package/workspace/lock files;
- frontend API origins and CI workflow.

Realtime/contracts:

- API config, pump, realtime service/module/tests, outbox/Man evidence;
- shared read contract and typed API realtime client/tests;
- Supplier Board resync presentation.

Browser/UI:

- complete `apps/e2e` workspace, four journey specs, support utilities, Compose, orchestrator, dan
  Playwright config;
- Supplier navigation/form repairs and shared UI/TMMIN accessibility repairs.

Records:

- ADR 0006 records centralized outbox polling, replay, resync, and REST authority;
- ADR 0026 records developer/E2E separation, bootstrap boundary, ports, contexts, diagnostics, dan
  cleanup;
- `docs/architecture/read-models-and-realtime.md`;
- `docs/architecture/local-full-stack-and-e2e.md`;
- `.agent/PAGES.md`, `.agent/implementationPhases.md`, `.agent/rules.md`, dan this handoff.

## 8. Delivery dan Cleanup

Primary delivery commit message:

`build: add validated local full-stack workflow`

At this handoff snapshot, the exact SHA, push result, and GitHub Actions URL/status are pending the
final commit/push gate. They must be replaced with observed values after `origin/staging` completes;
success must not be inferred before all required jobs are green.

The user-owned `.DS_Store` modification remains unstaged. All agent-started application processes,
root Compose services, E2E containers, E2E networks, and E2E volumes are stopped/removed. Normal
developer PostgreSQL and private-photo volumes are intentionally preserved by `local:down`.

Known non-blocking limitation: some API shutdowns emit the existing `pg@8` deprecation warning about
`client.query()` already executing while the process is terminating. It does not occur as a test
failure, runtime data leak, or leftover process. Production container shutdown hardening remains
Phase 15 evidence.

## 9. Next Action

Phase 15.1 owns production multi-stage images. It must not reuse the development-only image as a
production artifact. Caddy/TLS, remote Compose, security/image workflows, rollback, and actual
staging deployment follow the Phase 15 sequence.
