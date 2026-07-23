# Session Handoff — Shift, Working Assignment, and Hosted Henkaten Core

Tanggal: 2026-07-23
Branch: `staging`
Status repository: Phase 0–6 selesai; Phase 7 `planned`

## 1. Outcome

Backend operasional Hosted sekarang mencakup:

- durable `ShiftRun` slot untuk supplier + line + Shift Template + business date;
- IANA/DST-aware UTC boundary, atomic normal Start Shift, dan audited emergency start;
- immutable Default Assignment snapshot menjadi `WorkingAssignment`;
- vacancy/conflict/reserved representation tanpa duplicate effective MP;
- durable `AssignmentIssue` foundation dan pre-start resolution read context;
- persisted preflight check, commit-time recalculation, query scope, reference protection, dan
  operational source-cutover blocker;
- immutable Hosted Henkaten untuk MAN/MACHINE/MATERIAL/METHOD;
- latest published checklist validation dan all-YES evidence snapshot;
- transactional Hosted identifier, idempotency, lifecycle history, warning, audit, dan outbox;
- atomic Man MP reservation tanpa mengubah Working Assignment sebelum final approval;
- warning-instance dan normalized affected-part aggregation;
- scoped list/detail/history, Withdraw, dan Clone prefill;
- read-only Shift/Henkaten/warning APIs untuk TMMIN Admin dan TMMIN Quality.

Approval decision, release reservation saat Reject/End, approved Man movement/cascade, pre-start
Man execution, Assignment Issue resolution melalui verified Man workflow, dan End Shift tetap
milik Phase 7.

## 2. Locked Decisions

- Satu permanent Shift Run row mewakili satu slot. Repeated preflight hanya refresh plan
  `NOT_STARTED`; Active snapshot tidak dibangun ulang.
- Setiap active Job wajib memiliki candidate MP karena v1 belum memiliki optional-job flag.
- PostgreSQL partial uniqueness menjaga satu Active shift per line, satu Active shift per effective
  LL, satu effective MP, satu Open issue per job, dan satu active reservation per replacement/target.
- Emergency start missing default LL wajib membawa active substitute LL. Substitute hanya
  disimpan pada Shift Run dan tidak mengubah Default Assignment.
- Override menyimpan original failed checks. Candidate bermasalah menjadi VACANT/CONFLICTED/RESERVED
  non-effective row dan menghasilkan Open Assignment Issue.
- Start selalu menghitung ulang source epoch, master/account, defaults, assignment availability,
  checklist, issue, Open Henkaten, dan reservation di transaction.
- Henkaten line selalu diturunkan dari Active Shift Run milik authenticated LL.
- Hosted create memerlukan `Idempotency-Key` per supplier + creator dan canonical request hash.
- Man reservation dibuat dalam transaction submission dan menyimpan Shift Run end boundary;
  Working Assignment belum bergerak.
- Withdraw hanya owner LL, hanya Open, version-checked, dan atomically release reservation serta
  close warning instance miliknya.
- Affected-part grouping menggunakan supplier + normalized part-number snapshot.
- Clone tidak membawa accepted answers; latest checklist dan current master/assignment validity
  dikembalikan untuk prefill.

## 3. Persistence dan Migration

Migration baru:

- `apps/api/prisma/migrations/20260723000300_shift_henkaten_core/migration.sql`
- `apps/api/prisma/migrations/20260723000400_operational_tenant_boundaries/migration.sql`

Entity baru:

- `ShiftRun`, `WorkingAssignment`, `AssignmentIssue`;
- `HenkatenDailySequence`, `Henkaten`;
- `HenkatenChecklistSnapshot`, `HenkatenChecklistAnswer`;
- `ManHenkatenDetail`, `MPReservation`, `WarningInstance`, `HenkatenTransition`.

Defense-in-depth:

- supplier-aware composite foreign keys untuk operational master/context references;
- partial unique indexes untuk Active Shift/LL/effective MP/Open issue/active reservation;
- Henkaten evidence dan transition UPDATE/DELETE prevention triggers;
- immutable context dan terminal Henkaten trigger;
- state/check constraints untuk shift snapshot, assignments, issue resolution, Henkaten terminal
  state, Man references, reservations, dan warnings.

Migration evidence:

- upgrade main local database dari schema Phase 4 melalui migration 003 lalu 004 berhasil;
- fresh disposable database dengan migration 001–004 berhasil;
- Prisma client generation dan strict typecheck berhasil.

## 4. Supplier API

Shift:

- `GET /api/v1/supplier/shifts`
- `GET /api/v1/supplier/shifts/current`
- `POST /api/v1/supplier/shifts/preflight`
- `GET /api/v1/supplier/shifts/assignment-issues`
- `GET /api/v1/supplier/shifts/{id}`
- `GET /api/v1/supplier/shifts/{id}/preflight`
- `GET /api/v1/supplier/shifts/{id}/working-assignments`
- `GET /api/v1/supplier/shifts/{id}/assignment-issues`
- `GET /api/v1/supplier/shifts/{id}/resolution-context`
- `POST /api/v1/supplier/shifts/{id}/start`
- `POST /api/v1/supplier/shifts/{id}/emergency-start`

Henkaten:

- `GET|POST /api/v1/supplier/henkatens`
- `GET /api/v1/supplier/henkatens/{id}`
- `GET /api/v1/supplier/henkatens/{id}/history`
- `POST /api/v1/supplier/henkatens/{id}/withdraw`
- `GET /api/v1/supplier/henkatens/{id}/clone-prefill`

Authorization:

- Supplier Admin: all-line read dan emergency start; tidak dapat submit/withdraw/approve.
- LL: own snapshotted line plan/start/read serta submit/withdraw.
- Supervisor: supervised snapshotted-line read.
- QC: tenant-wide read.
- Hosted Preparation dan stale/wrong source epoch tidak dapat melakukan operational write.

## 5. TMMIN Read-only API

- `GET /api/v1/tmmin/suppliers/{supplierId}/shifts`
- `GET /api/v1/tmmin/suppliers/{supplierId}/shifts/{id}`
- `GET /api/v1/tmmin/suppliers/{supplierId}/henkatens`
- `GET /api/v1/tmmin/suppliers/{supplierId}/henkatens/{id}`
- `GET /api/v1/tmmin/suppliers/{supplierId}/henkatens/warnings`
- `GET /api/v1/tmmin/suppliers/{supplierId}/henkatens/warnings/{warningId}`
- `GET /api/v1/tmmin/warnings/affected-parts`
- `GET /api/v1/tmmin/warnings/affected-parts/{supplierId}/{partNumber}`

TMMIN Admin dan TMMIN Quality hanya memperoleh read capability; tidak ada submission, withdrawal,
shift operation, atau approval authority.

## 6. Preflight Checks

Persisted/returned check codes:

- `ACTIVE_SHIFT_EXISTS`
- `LINE_INACTIVE`
- `SHIFT_TEMPLATE_INACTIVE`
- `SUPERVISOR_MISSING`
- `LINE_LEADER_MISSING`
- `LINE_LEADER_CONFLICT`
- `REQUIRED_JOB_VACANT`
- `DUPLICATE_MP`
- `MP_INACTIVE`
- `MP_ACTIVE_ELSEWHERE`
- `MP_RESERVED`
- `ASSIGNMENT_ISSUE_OPEN`
- `OPEN_HENKATEN_CARRY_OVER`
- `CHECKLIST_INVALID`
- `STALE_PLANNED_ASSIGNMENT`
- `SOURCE_EPOCH_STALE`

Emergency override tidak dapat melewati source validity, inactive line/template, slot/Active line,
Active LL uniqueness, stale plan, atau stale source epoch.

## 7. Validation Evidence

Targeted checks yang sudah lulus:

- strict shared-contract dan API typecheck;
- lint setelah Prisma/shared generation;
- migration 003 upgrade path;
- migration 004 upgrade path;
- migration 001–004 fresh disposable path;
- operational PostgreSQL/Supertest suite: 9 tests.

Operational suite membuktikan:

- concurrent preflight menghasilkan satu durable slot;
- concurrent Start menghasilkan satu winner;
- snapshot Active tidak berubah setelah default update;
- stale plan diblokir pada commit dan blocked audit tetap tersimpan;
- substitute-LL override membuat visible vacancy issue;
- keempat category 4M, all-YES, idempotency, dan concurrent sequence;
- stable filtered keyset pagination setelah concurrent insert;
- Man reservation conflict dan unchanged Working Assignment;
- Withdraw release reservation dan close warning secara atomik;
- multiple Open warning mempertahankan affected-part state;
- immutable evidence/context/terminal database guards;
- role, source-purpose, tenant, dan TMMIN read-only boundary;
- reference deactivation dan operational source cutover blocker.

Full clean-artifact CI parity command/result dicatat setelah final validation pada section 10.

## 8. Documentation

- PRD implementation status menjadi Phase 0–6 dan substitute-LL/idempotency rules dinormalkan.
- Roadmap Phase 5–6 `done`; reservation creation + Withdraw release dipindah ke Phase 6.
- Phase 7.4 sekarang hanya melengkapi Reject/End/final-approval reservation integration.
- ADR 0013 mencatat durable shift slot/preflight/Working Assignment.
- ADR 0014 mencatat Henkaten aggregate/reservation/warning transaction boundary.
- ADR 0005/0010/0011/0012 diperbarui dengan lock, cutover, reference, dan snapshot evidence.

## 9. Intentional Deferrals

- approval decision dan persisted approval routes;
- reject-fast/final Approved lifecycle;
- approved Man movement dan movement ledger;
- cross-line cascade vacancy dan verified issue resolution;
- pre-start Man execution;
- End Shift;
- notification delivery, SSE, Assignment Board, dashboard, dan audit UI/read views;
- frontend, External ingestion, deployment, dan UAT.

## 10. Final CI Parity

Clean-artifact parity dijalankan dengan Node.js `22.23.1` dan pnpm `11.16.0`:

- `pnpm clean`
- `pnpm install --frozen-lockfile`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit` — contracts 17, fixtures 6, API unit 7; semuanya lulus
- `pnpm openapi:check` — lulus; committed OpenAPI 3.1 memiliki 95 paths
- `pnpm build` — seluruh workspace lulus
- `docker compose config --quiet`
- `pnpm db:up && pnpm db:wait && pnpm db:verify`
- `pnpm db:test:reset && pnpm db:test:migrate` — fresh migration 001–004 lulus
- full `pnpm test:integration` — 20 tests lulus
- `pnpm db:down`
- Gitleaks `8.24.3` working-tree directory scan — no leaks
- `git diff --check` — lulus

Compose stack telah dihentikan dan tidak ada dev server, watcher, test process, atau container yang
ditinggalkan.

## 11. Next Recommended Batch

Mulai Phase 7.1:

1. add immutable Supervisor/QC approval decision persistence;
2. implement parallel route decision dan reject-fast finalization;
3. integrate existing reservation dengan Reject, End Shift, dan final Approved;
4. apply approved Man movement atomically tanpa mengubah Default Assignment;
5. create cascade Assignment Issue dan resolve hanya melalui verified Man workflow;
6. implement pre-start resolution execution dan End Shift;
7. complete approval/withdraw/end/movement race suite.
