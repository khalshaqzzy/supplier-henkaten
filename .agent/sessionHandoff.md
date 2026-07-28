# Session Handoff — Henkaten Create dan Detail Polish

Tanggal: 2026-07-28

Branch: `feat/henkaten-page-improvement`

Status: targeted refinement untuk Create/Clone dan Detail/Approval Henkaten **done**. Phase 15
tetap `in_progress`; perubahan ini menambah evidence Phase 14.11 tanpa mengubah current phase.

## 1. Objective dan Outcome

`/henkatens/new`, `/henkatens/:id/clone`, dan `/henkatens/:id` dipoles sebagai light enterprise
operational workflow yang konsisten dengan Supplier application. Route, field/payload order, API
contract, idempotency, source epoch, optimistic version, lifecycle, dan capability gates tetap sama.

Outcome utama:

- Create/Clone memakai semantic 4M selector dan satu workflow canvas untuk target operasional serta
  komposisi perubahan, bukan kumpulan generic card.
- Shift Run tampil sebagai compact locked context; job, part search/picker, selected-part
  confirmation, loading/disabled states, serta auto-alignment job ke target assignment tetap
  memakai data aktual.
- Man menampilkan target-to-replacement preview termasuk MP saat ini, availability, reservation,
  dan donor assignment. Non-Man memakai before-to-after affected/replacement composition.
- Penyebab/detail memiliki hierarchy, helper, character count, dan long-text behavior; checklist
  menjadi numbered Yes/No review rows dengan state memenuhi, No, dan belum dijawab.
- Sticky review rail membedakan kelengkapan form dan checklist tanpa mengklaim menggantikan server
  validation.
- Detail memakai change-evidence untuk penyebab/narasi dan object transition atau Man
  reservation/completed movement. Approval timeline menampilkan responsibility, decision
  actor/time/comment, Not Required, dan hasil akhir.
- Approve, Reject, Reroute, dan Withdraw memakai shared accessible `AlertDialog`; action visibility
  tetap berasal dari role, capability, route, dan lifecycle authoritative.

Tidak ada backend, OpenAPI, Prisma schema, migration, public `packages/ui` contract, analytics
identifier, route, atau production fixture yang berubah.

## 2. Files Changed

- `apps/supplier-web/src/pages/HenkatenPages.tsx`
  - composition Create/Clone dan Detail/Approval;
  - compact Shift Run context, readiness model, lifecycle/capability action gating;
  - refresh recovery tetap membersihkan local problem state.
- `apps/supplier-web/src/pages/HenkatenWorkflow.tsx`
  - app-local 4M picker, selected part, Man preview, checklist/readiness, change evidence, object/Man
    transition, dan approval timeline.
- `apps/supplier-web/src/app.css`
  - workflow canvas, semantic variants, evidence, timeline, sticky rail, focus/hover/active states,
    wrapping, serta explicit 1280 px fallback.
- `apps/supplier-web/src/pages/HenkatenWorkflow.test.tsx`
  - regression presentational state 4M, checklist, readiness, movement, transition, dan approval.
- `apps/supplier-web/src/App.test.tsx`
  - detail evidence dan accessible decision-dialog recovery regression.
- `apps/e2e/tests/hosted-lifecycle.spec.ts`
  - Shift Run assertion mengikuti locked read-only context.
- `docs/adr/0024-supplier-application-composition.md`
  - targeted form workspace/change-evidence decision, local boundary, AlertDialog, density
    tradeoff, dan validation.
- `.agent/implementationPhases.md`
  - Phase 14.11 execution/verification evidence diperluas; current Phase 15 tidak berubah.

Generated exploration renders berada di luar repository dan tidak di-commit.

## 3. Decisions

- Reference images adalah quality bar, bukan pixel-perfect contract.
- Target dan composition step disatukan secara visual dalam satu operational workflow surface,
  tetapi urutan input dan payload tetap dipertahankan.
- Readiness rail bersifat presentational. Eligibility, checklist publication, reservation conflict,
  optimistic version, dan lifecycle transition tetap server-authoritative.
- Metadata yang tidak tersedia dari response tidak diciptakan. Detail Man tidak mengarang
  line/job label; reservation dan movement hanya berasal dari aggregate response.
- Presentational helper tetap app-local karena tidak ada generic shared primitive yang perlu
  ditambahkan.
- Minimum desktop tetap 1280×720. Pada fallback ini category microcopy nonesensial disembunyikan dan
  workflow canvas ditumpuk vertikal; page-level horizontal scrolling tetap dilarang.

## 4. Visual Evidence Reviewed

Lifecycle API nyata dirender dan diperiksa pada:

- Create Henkaten 1672×941;
- Create Henkaten 1280×720;
- QC-pending Henkaten Detail/Approval 1672×941;
- QC-pending Henkaten Detail/Approval 1280×720.

Capture terakhir berasal dari isolated Chromium journey `hosted-lifecycle-chromium-19704-1`.
Capture menjalankan reduced motion, assertion tanpa page-level horizontal overflow, dan axe pada
1280×720. Iterasi awal menemukan contrast 4M microcopy/movement serta Machine badge; seluruh temuan
diperbaiki dan capture terakhir mempunyai zero axe violations.

## 5. Validation

Runtime acceptance: Node.js `22.23.1`, pnpm `11.16.0`.

- clean snapshot `pnpm install --frozen-lockfile`: lulus;
- format, lint, typecheck: lulus;
- unit: 120 Vitest + 2 Node tests lulus; Supplier 20/20;
- OpenAPI document/generated client byte comparison: no drift;
- production build: lulus; hanya chunk-size warning non-blocking;
- Compose config, PostgreSQL 18.4/vector 0.8.5 verification, disposable reset, dan 9 migrations:
  lulus;
- PostgreSQL integration: 33/33 lulus;
- browser E2E Node 22: Chromium 4/4 dan Edge 2/2 lulus;
- visual capture: 1672×941 dan 1280×720, no horizontal overflow, reduced motion, zero axe
  violations;
- migration destructive check terhadap `origin/staging`: tidak ada migration SQL berubah;
- deployment env/topology, deployment script harness, security exception registry, actionlint,
  ShellCheck, Hadolint, `bash -n`, Ubuntu 22.04 bootstrap inputs, dan Linux real-flock harness:
  lulus;
- production Compose image build/start, fresh migration, bootstrap idempotence, routing, headers,
  non-root services, private PostgreSQL, serta persistence across restart: lulus;
- Trivy filesystem dan lima runtime image: zero HIGH/CRITICAL;
- Gitleaks directory scan: no leaks. Gitignored staging operator key dipindahkan sementara dan
  dikembalikan dengan SHA-256 identik
  `46d068810e6e9984c785c55090a85cb1b759729f9777029c5faa7ca2d2699174`;
- `pnpm audit --audit-level high`: exit 0; melaporkan 1 moderate dan 1 high yang sudah ignored oleh
  registry exact/unexpired;
- seluruh local, E2E, dan production-like container/process dihentikan; durable volumes
  dipertahankan.

## 6. Residual Risk dan Next Action

- Vite masih memberi chunk-size warning non-blocking.
- PostgreSQL driver masih memberi deprecation warning pada overlapping `client.query()` di
  concurrency tests; suite tetap lulus. Refactor async query ownership disarankan sebelum pg 9.
- Dependency audit tetap mencatat satu moderate dan satu high ignored; exception registry saat ini
  exact dan belum expired.
- Mobile operational UI, staging VM, backup/PITR/DR, failover, RPO/RTO, dan HA tetap di luar scope
  perubahan ini.
- Next action: commit dengan subject
  `feat(supplier): polish Henkaten create and detail workflows`, push ke
  `origin/feat/henkaten-page-improvement`, lalu inspect branch workflow. Jangan membuat PR atau
  merge otomatis.
