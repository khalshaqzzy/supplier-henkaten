# Session Handoff — Approval, Man Cascade, and Shift Finalization

Tanggal: 2026-07-23
Branch: `staging`
Status repository: Phase 0–7 selesai; Phase 8 `planned`

## 1. Outcome

Hosted operational backend sekarang menyelesaikan approval dan assignment finalization:

- persisted parallel Supervisor/QC routes dengan immutable decision evidence;
- server-derived route authorization, reject-fast, exact idempotency, dan durable failure audit;
- Supplier Admin Supervisor reroute dengan original/current responsibility history;
- atomic Approved Man movement tanpa mengubah Default Assignment;
- linked donor vacancy dan verified Assignment Issue resolution;
- Man submission/resolution terhadap owned planned Shift Run;
- stable referenced Working Assignment IDs saat preflight refresh;
- transactional, idempotent End Shift dengan persisted summary dan preserved inactive assignments;
- expanded contracts/OpenAPI, PostgreSQL constraints/triggers, ADR, roadmap, dan integration coverage.

Frontend, notification persistence/SSE, Assignment Board/dashboard read models, External ingestion,
dan remote deployment tetap deferred ke owning phase.

## 2. Locked Decisions

- Setiap Henkaten memiliki tepat satu route `SUPERVISOR` dan satu route `QC`.
- Role authenticated menentukan route keputusan; client tidak dapat memilih route.
- Supervisor route menyimpan initial/current member snapshot. Missing Supervisor tetap Pending tetapi
  undecidable sampai Supplier Admin reroute.
- First Approve menutup satu route dan Henkaten tetap Open. Second Approve finalizes Approved.
- First Reject finalizes Rejected dan Pending route lain menjadi Not Required.
- Decision/routing/movement evidence append-only dan dilindungi database trigger.
- Decision, reroute, dan End Shift memerlukan `Idempotency-Key` plus payload hash.
- Exact retry mengembalikan committed resource; key reuse berbeda payload menghasilkan
  `IDEMPOTENCY_CONFLICT`.
- Operational write memakai `SERIALIZABLE` dan lock order Supplier → involved Shift Runs UUID order
  → Henkaten → route/reservation → Working Assignment/job → member → issue/warning/audit/outbox.
- Final Approved Man revalidates reservation dan source/target versions sebelum movement.
- Movement membuat donor issue hanya jika source assignment nyata menjadi vacant.
- Issue hanya dapat resolved oleh Approved Man yang membawa explicit `resolutionIssueId` dan
  demonstrably mengisi job/line/shift yang sama.
- Preflight tidak wholesale-delete referenced plan rows. Approved resolution assignment dipertahankan
  ketika defaults di-refresh.
- End Shift cancels Open related Henkaten dengan `SHIFT_ENDED`, releases reservations, marks Pending
  routes Not Required, closes warnings/issues, dan deactivates Working Assignments tanpa menghapus
  terminal history.

## 3. Persistence dan Migration

Migration baru:

- `apps/api/prisma/migrations/20260723000500_approval_man_shift_finalization/migration.sql`

Entity baru:

- `HenkatenApprovalRoute`;
- `ApprovalDecision`;
- `ApprovalRouteRouting`;
- `AssignmentMovement`.

Entity extended:

- `ManHenkatenDetail.resolutionIssueId`;
- explicit `AssignmentIssue` origin/resolution Henkaten dan movement links;
- `WorkingAssignment.includedInPlan`;
- `ShiftRun.endCommandKey`, `endCommandPayloadHash`, dan `endSummary`.

Migration bersifat expand-only dan:

- backfills Open Henkaten menjadi dua Pending routes;
- backfills Cancelled Henkaten menjadi dua Not Required routes;
- aborts bila pre-existing Approved/Rejected evidence tidak dapat direkonstruksi;
- menambah tenant-aware composite foreign keys, unique/partial indexes, positive version/state checks;
- mencegah update/delete decision, routing history, dan movement;
- mencegah delete route dan mutation route yang sudah terminal.

Migration evidence:

- fresh disposable PostgreSQL migration 001→005 lulus;
- isolated 004→005 upgrade dengan legacy Ended Shift Run lulus, menghasilkan empat tabel baru, dan
  backfills valid end-command hash/summary metadata;
- direct database mutation/delete terhadap decision dan movement ditolak.

## 4. Supplier API dan Contract Changes

Endpoint baru:

- `POST /api/v1/supplier/henkatens/{id}/decisions`;
- `POST /api/v1/supplier/henkatens/{id}/approval-routes/supervisor/reroute`;
- `POST /api/v1/supplier/shifts/{id}/end`.

Contract changes:

- MAN submission menerima optional `resolutionIssueId`;
- MAN dapat disubmit terhadap owned `NOT_STARTED` Shift Run;
- pre-start resolution context mengembalikan `supported: true`, assignments, blockers, dan linkable
  Open issues;
- Henkaten detail/list memakai persisted route summaries dan decision evidence;
- list menerima optional `approvalRoute`; `approvalStatus` applies to selected route atau either
  route bila route omitted;
- Shift response mengembalikan `endedAt` dan nullable `endSummary`;
- Assignment Issue response mengembalikan explicit origin/resolution links;
- OpenAPI 3.1 committed artifact sekarang memiliki 98 paths.

Capability changes:

- Supervisor dan QC memperoleh decision capability sesuai derived route;
- Supplier Admin memperoleh Supervisor reroute capability;
- Supplier Admin/TMMIN tetap tidak dapat memutus approval;
- only owning LL dapat End Shift.

## 5. Transactional Effects dan Events

Shared operational-finalization boundary sekarang digunakan oleh approval, Withdraw, dan End Shift
untuk terminal transition, route, reservation, warning, audit, dan outbox consistency.

Approval/movement/finalization emits:

- `HENKATEN_APPROVAL_RECORDED`;
- `HENKATEN_APPROVED`, `HENKATEN_REJECTED`, atau `HENKATEN_CANCELLED`;
- `WARNING_CLOSED`;
- `MP_MOVED`;
- `MP_RESERVATION_RELEASED`;
- `ASSIGNMENT_ISSUE_OPENED`;
- `ASSIGNMENT_ISSUE_RESOLVED`;
- recipient-scoped `NOTIFICATION_REQUESTED`;
- `SHIFT_ENDED`.

Notification persistence/delivery sengaja tidak dibuat; Phase 8 akan consume transactional events.

## 6. PostgreSQL Race dan Domain Evidence

Operational integration suite membuktikan:

- concurrent preflight satu durable slot dan concurrent Start satu legal winner;
- Supervisor-first/QC-final approval, first Approve remains Open, dan final Approve closes warning;
- QC reject-fast, other route Not Required, reservation release, dan unchanged assignment;
- exact decision retry dan conflicting command rejection;
- two active QC users race pada satu route menghasilkan `[201, 409]`;
- Supplier Admin reroute preserves initial responsibility, changes current responsibility, dan old
  Supervisor receives `403`;
- Approved active Man applies one movement exactly once;
- direct decision update dan movement delete ditolak trigger;
- approved planned Man preserves Working Assignment ID through refresh dan normal Start succeeds;
- cross-shift MP movement vacates donor, creates linked issue, dan records origin movement/Henkaten;
- explicit linked Man resolution fills donor job dan resolves only that issue;
- End Shift persists summary, exact retry succeeds, Open work closes, dan Working Assignments remain
  as inactive history;
- existing role, source-purpose, tenant, TMMIN read-only, warning aggregation, stale preflight,
  emergency override, immutable Henkaten evidence, identifier, reservation, dan pagination coverage
  tetap green.

Full integration result: 4 files, 23 tests passed. Operational file: 12 tests passed.

## 7. Documentation

- `.agent/PRD.md`: implementation status Phase 0–7.
- `.agent/implementationPhases.md`: Phase 7 dan 7.1–7.10 `done`, no current phase, Phase 8 next.
- ADR 0005: implemented canonical multi-Shift lock order dan race evidence.
- ADR 0013: referenced-plan preservation dan End Shift history.
- ADR 0014: planned Man route creation dan shared terminal finalization.
- ADR 0015: persisted parallel approval, immutable/idempotent decision, reject-fast, reroute.
- ADR 0016: atomic Man movement, cascade resolution, planned execution, End Shift cleanup.

## 8. Intentional Deferrals

- notification persistence, recipient inbox, acknowledgement, dan SSE;
- Assignment Board/current 4M indicators;
- Supplier/TMMIN dashboards, approval inbox, warning explorer, dan audit read APIs;
- Supplier/TMMIN frontend dan Playwright;
- External ingestion/projection;
- remote staging/production deployment, UAT, backup/HA, dan production sign-off.

## 9. Final Local CI Parity

Clean-artifact parity dijalankan dengan official Darwin arm64 Node.js `22.23.1` di ignored
`.local/` dan pnpm `11.16.0`:

- `pnpm clean`;
- `pnpm install --frozen-lockfile`;
- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test:unit` — contracts 19, fixtures 6, API unit 7; 32 passed;
- `pnpm openapi:check`;
- `pnpm build`;
- `docker compose config --quiet`;
- `pnpm db:up`;
- `pnpm db:wait`;
- `pnpm db:verify` — PostgreSQL 18.4, pgvector 0.8.5;
- `pnpm db:test:reset`;
- `pnpm db:test:migrate` — fresh migration 001→005 passed;
- CI environment `pnpm test:integration` — 23 passed;
- isolated 004→005 migration upgrade — passed;
- `pnpm db:down`;
- Gitleaks 8.24.3 directory scan after tooling cleanup — no leaks;
- `git diff --check` — passed.

The first directory scan included the ignored Node distribution and reported a generic V8 header
constant. The agent-provisioned runtime archive/directory was moved to macOS Trash, then the
repository scan was repeated cleanly. No exception or scanner suppression was added.

After documentation updates, formatting, Gitleaks directory mode, dan `git diff --check` were rerun.
Compose is down and no dev server, watcher, test process, or agent-started container remains.

## 10. Delivery

Target commit:

- `feat: add hosted approval and shift finalization`

Post-commit requirements:

- Gitleaks 8.24.3 `detect --log-opts=-1`;
- push `staging` to `origin`;
- inspect the new GitHub Actions run;
- delivery is complete only after `quality`, `database-integration`, dan `secret-scan` are green.

## 11. Next Recommended Batch

Mulai Phase 8 notification/read-model batch:

1. consume stable operational outbox events idempotently;
2. persist recipient-scoped notifications dan expose unread/read/acknowledgement APIs;
3. build Assignment Board/current 4M read model;
4. add approval inbox, Supplier/TMMIN dashboards, warning, dan audit reads;
5. add SSE resume/reconnect only after durable notification/read models are proven.
