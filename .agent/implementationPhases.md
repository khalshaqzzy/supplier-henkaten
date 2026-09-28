# Enterprise Digital Henkaten Management — Implementation Roadmap

Status: active · Updated: 2026-09-26 · Approach: backend first, dependency driven

This file tracks sequence, current state, dependencies, and remaining acceptance gates. The [PRD](PRD.md) defines product behavior; [rules](rules.md) define agent and engineering process; [session handoff](sessionHandoff.md) records recent changes and checks; [ADRs](../docs/adr/) explain durable decisions. Detailed local browser evidence and unresolved checks live in the [QA report](../docs/audits/local-browser-qa-2026-09-24.md) and [scenario plan](../docs/qa/browser-local-end-to-end-verification-plan.md). Do not copy their histories into this roadmap.

## Current position

- Phases **0–14: done** for their original implementation and local acceptance scope. Later defects and amendments are tracked below; “done” does not imply production acceptance.
- Phase **15: in_progress**. **15.9 Automatic Staging Deployment** is done: staging push run `35977992005` completed successfully and independent three-domain smoke returned release SHA `dfc2aa2428b1db5fce407ec2033a1da87b0632bd`. Staging rehearsal and device gates remain.
- Phase **16: planned**. Production deployment and UAT are not complete.
- Current repository branch is not a phase status. Confirm the branch, code, CI, and remote state before acting; historical branch names and run IDs in older handoffs are evidence, not current truth.
- Next dependency: perform 15.11 staging rehearsal and address QA findings before claiming UAT or release readiness.

Status vocabulary: `planned`, `in_progress`, `blocked`, `done`, `deferred`. Use at most one `in_progress` phase and one subphase within it. “Implemented locally; acceptance pending” and “implementation ready; activation deferred” describe evidence, not additional progress states. Mark a subphase `done` only when its listed acceptance gate is met. Preserve blockers and deferred work explicitly.

## Completed implementation index

| Phase | Status | Capability delivered |
| --- | --- | --- |
| 0 Product/architecture | done | PRD, security and domain baseline, ADRs |
| 1 Repository/local tooling | done | Node 22/pnpm workspace, quality scripts, contracts, fixtures, Docker PostgreSQL/pgvector, baseline CI |
| 2 API/persistence | done | NestJS/Prisma, tenant scope, audit, outbox, health/readiness, integration harness |
| 3 Auth/governance | done | Sessions, Argon2id, lockout, RBAC, TMMIN and supplier administration, source epochs |
| 4 Supplier master data | done | Members/photos, line/job/part, shift template, checklist, default assignments, deactivation |
| 5 Shift/assignment foundation | done | Original Shift Run and assignment model; later Line–Shift amendment supersedes operational start/end behavior |
| 6 Henkaten core | done | 4M submission, checklist evidence, identifiers, warnings, queries, withdraw/clone |
| 7 Approval/Man | done | Parallel decisions, reject fast, concurrency, Man movement/restoration, original shift finalization |
| 8 Read models | done | Notifications, board/Canvas, dashboards, audit reads, SSE |
| 9 External API | done | Epoch-bound client/token, strict events, ordering/idempotency, batch, projection, PII controls |
| 10 Backend contract | done | OpenAPI reconciliation, security and performance baseline, integration/concurrency checks |
| 11 Shared frontend | done | React/Vite shells, shared UI, typed client, forms, tables, route guards, page states |
| 12 Supplier frontend | done | Hosted workflows across supplier roles |
| 13 TMMIN frontend | done | Administration, monitoring, warning/Explorer, External health |
| 14 Full-stack integration | done | Local Compose, isolated browser E2E, seeded role QA, accessibility and visual refinement |

The completion index is a navigation aid, not a substitute for the PRD or test evidence. Preserve current behavior from the later amendments:

- **Tanoko:** GL/Admin job proficiency mapping and history; level 3 minimum for Man replacement. No production proficiency backfill. See [ADR 0032](../docs/adr/0032-tanoko-job-proficiency-matrix.md).
- **Recurring Line–Shift:** shift-specific Supervisor/Line Leader/MP, clock-derived occurrence, immediate qualified Man replacement, duplicate MP support, rejection/withdraw restoration. The former Shift Run start/end, reservation, and exclusive MP assumptions are superseded. See [PRD amendment](PRD.md) and [ADR 0033](../docs/adr/0033-recurring-line-shift-assignment-without-shift-run-lifecycle.md).
- **MP registration and Other part:** MP profile numbers are removed, while non-MP registration remains required. Hosted Henkaten may select `Other` without part identity or master creation; TMMIN retains one warning per Other Henkaten. See [PRD amendment](PRD.md) and [ADR 0038](../docs/adr/0038-mp-registration-and-private-other-part.md). Staging acceptance must check nullable migration, rollback compatibility, supplier form, TMMIN warning detail, and privacy copy before UAT sign-off.
- **Supplier setup readiness:** The supplier endpoint now emits contract-valid blockers for incomplete configuration. Empty tenants show actionable setup progress; partial Line–Shift configuration reports the missing assignment rather than treating the shift as absent. API integration and first-login browser coverage were added; staging acceptance remains pending. See [ADR 0033](../docs/adr/0033-recurring-line-shift-assignment-without-shift-run-lifecycle.md).
- **PCR indication:** independent advisory assessment from Hosted submit or changed External evidence; versioned Admin/Quality correction; failures/low confidence go to Review. It does not submit or approve a PCR. Local 70-case classifier evaluation requires TMMIN QD adjudication and missing-evidence/adversarial regression before production reliance on automatic No-PCR. See [ADR 0034](../docs/adr/0034-durable-local-pcr-screening-and-human-correction.md) and [evaluation](../docs/reports/pcr-classifier-70-case-local-evaluation-2026-09-23.md).
- **Local browser QA, 2026-09-24:** 47 rows: 22 PASS, 15 FAIL, 10 BLOCKED/partial. Some PASS/FAIL rows retain untested branches. No product fixes were made during that run. Baseline was restored to two Hosted suppliers and 240 Henkaten; containers were stopped. Push permission/subscription/delivery/revoke were excluded by user direction for that local QA run, without removing the separate staging device gate. See [QA report](../docs/audits/local-browser-qa-2026-09-24.md) and [ADR 0035](../docs/adr/0035-isolated-local-qa-epochs-and-browser-evidence.md).
- **Portal and master data polish, 2026-09-25:** TMMIN viewport gate removed with compact navigation, job rename added to Line & Job, successful master edits return to their lists, and Tanoko inspector identity scrolls with level controls. See [ADR 0039](../docs/adr/0039-responsive-tmmin-and-master-edit-flow.md). Local verification and PR CI are recorded in the handoff; staging/device acceptance remains part of Phase 15.
- **Supplier Admin flow improvement, 2026-09-26:** Supplier and TMMIN login visibility controls, reviewed Part CSV/Excel import, Member archive workflow and username, current/other shift board filter, saved-change feedback, explicit Master Data back links, and responsive Checklist 4M editor. See [ADR 0040](../docs/adr/0040-supplier-master-data-import-and-navigation.md). Local implementation and verification are recorded in the handoff; staging/device acceptance remains part of Phase 15.
- **Part import mapping and scale refinement, 2026-09-26:** CSV/Excel files up to 50 MB and 50,000 data rows can use arbitrary source headers and additional columns. Supplier Admin maps the two required fields with a ten-row preview; the paginated review displays only conflicting names and shows processing states. The API contract limit and import transaction changed without a database schema or seed edit. See [ADR 0040](../docs/adr/0040-supplier-master-data-import-and-navigation.md). Phase 15 staging/device acceptance remains in progress.

## Cross-cutting gates

- Tenant/object/role scoping stays server-side. Supplier frontends never access PostgreSQL directly. Protected resources need negative authorization tests; cross-tenant reads and writes must be denied.
- Zod shared contracts and OpenAPI/client output must agree. API changes after backend freeze need additive compatibility or an explicit migration plan.
- Local and automated persistence/concurrency tests use Docker-managed PostgreSQL with pgvector, not host PostgreSQL or in-memory substitutes. Schema changes require forward-only Prisma migrations and fresh/upgrade tests. Staging/production never run `prisma migrate reset`.
- Hosted PII and secrets stay out of logs/audit and external event payloads. Keep external client credentials bound to supplier, source epoch, and scope.
- Transactional outbox is durable; SSE and Web Push are delivery mechanisms. Notification Center is authoritative, Web Push best effort.
- A task is complete only when relevant code/contracts/migrations, lint/typecheck, focused unit and PostgreSQL/authorization tests, API documentation, ADR, handoff, and acceptance checks pass. Follow [rules](rules.md) for exact pre-commit CI parity and process/container cleanup.
- Release topology remains single VM per environment, Compose/Caddy, forward migration, and schema-compatible **code-only** rollback. There is no database/photo backup, RPO/RTO, or HA in v1. No release document may imply recovery that does not exist.

## Phase 15 — Containers, CI/CD, staging (`in_progress`)

Depends on Phase 14. Exit: automated exact-SHA staging deploy, CI/security gates, staging rehearsal, and responsive/PWA/Web Push device acceptance complete. Production workflow activation remains subject to Phase 16.

| Subphase | Status | Remaining exit evidence |
| --- | --- | --- |
| 15.1 Production Dockerfiles | done | Three pinned, non-root-capable application images build and start. |
| 15.2 Remote Compose | done | Isolated PostgreSQL, API, both webs, and Caddy; private DB and persistent volumes. |
| 15.3 Caddy routing | done | Three-domain TLS routing, headers, CORS/CSRF origin configuration. |
| 15.4 Runtime environment | done | Required names validated; no secret values committed or echoed. |
| 15.5 CI/security workflows | done | Frozen install, quality, tests, migration, image, dependency and secret gates. |
| 15.6 Release-by-SHA | done | Exact archive, lock, secure env, migration, retention and traceable release pointer. |
| 15.7 Smoke/readiness | done | All three surfaces, semantic API readiness and release SHA gate deployment. |
| 15.8 Compatible rollback | done | Failed validation returns to previous code when schema permits; volumes retained. |
| 15.9 Automatic staging deployment | done | Staging push run `35977992005` passed all release jobs and deployment; independent public three-domain smoke confirmed exact SHA `dfc2aa2428b1db5fce407ec2033a1da87b0632bd`. Recheck this evidence for each later candidate. |
| 15.10 Automatic production workflow | planned (caller implemented locally; activation pending) | `main` push caller and production bootstrap support are prepared. Merge only after production VM SSH identity, 80/443 reachability, runtime secrets, staging rehearsal, and Phase 16 release gates are satisfied; then verify the exact-SHA remote deployment. |
| 15.11 Staging rehearsal | planned | After 15.9: fresh and upgrade deploy, controlled failed readiness, compatible rollback, DB/photo persistence, release race and core staging browser/API smoke; retain diagnostics. |
| 15.12 Responsive Supplier | planned (implemented locally) | Staging matrix: 360–767 mobile, 768–1279 tablet, desktop ≥1280; roles and major workflows; no overflow/clipped action; 44 px targets, keyboard/focus, non-color status, Axe, desktop regression. |
| 15.13 Supplier PWA | planned (implemented locally) | HTTPS staging install/update/offline/reconnect and rollback recovery; only shell assets cached; API/session/photo/domain data and mutations network-only. |
| 15.14 Web Push and Line Leader enforcement | planned (locally integrated) | Staging VAPID/vendor delivery, subscription lifecycle, multi-device, redaction, retry/expiry and API/UI activation gate. Additive schema, no down migration. |
| 15.15 Real-device rehearsal | planned | After 15.9 and 15.11–15.14: Android Chrome/Edge and iOS/iPadOS 16.4+ Home Screen PWA; foreground/background/closed delivery, permission/revoke, shared browser, delayed/expired delivery, worker recovery, offline, Line Leader before/after activation, supplier acceptance. |

### Open QA disposition before release

The [QA report](../docs/audits/local-browser-qa-2026-09-24.md) is the finding ledger. Follow the [scoped remediation plan](../docs/qa/qa-verif-finding-remediation-plan-2026-09-24.md) for **F-01–F-12** and rerun each affected journey only. The highest-priority observed blocker is **F-06 (High)**: reverse External→Hosted Preparation fails after a cutover. **F-01, F-05, F-08 (Medium)** affect board photos, Supplier Admin reset/replacement, and post-edit member/part actions. Remaining Low defects and F-03 account-throttle risk cover clone validity, stale notification UI, warning identifier, copied Line–Shift selection, stale reroute action, and registry pagination. F-10 is disposed as no defect: product owner decided reroute needs no in-app notification (ADR 0036); the S-08 oracle was corrected. No application finding is marked fixed by the QA run or this planning session. Remaining QA branches are outside this remediation scope.

Complete or explicitly disposition the report's remaining matrix: line/source authorization, negative-password lockout, registry validation and pagination, dashboard reconciliation, Explorer filters/details, historical PCR `expectedVersion: 0` and pending-reload, Hosted Preparation/reverse gates, master-data/Line–Shift branches, time/Tanoko boundaries, old External credential rejection, outbox/audit/photo-cache diagnostics, and physical-device/assistive-technology coverage. Local Chromium/Edge evidence is not a claim about mobile OS push or full device coverage.

PCR release gate: obtain TMMIN QD adjudication of the 70-case evaluation, add missing-evidence/adversarial cases and grounded explanation/control references, configure the inference endpoint/key in the target runtime, and verify Review fallback during inference failure. Do not rely on automatic No-PCR in production before this gate is resolved.

## Phase 16 — Hardening, UAT, release (`planned`)

Depends on Phase 15 staging/device gates. Complete in order where dependencies require it; UAT streams may run in parallel after the shared quality gates.

| Subphase | Status | Acceptance gate |
| --- | --- | --- |
| 16.1 Capacity/performance | planned | Staging 42-supplier Compact profile; p50/p95/p99/errors for critical reads, writes, ingest and SSE; meet PRD targets or record a blocker. |
| 16.2 Security closure | planned | Tenant/auth/session/CSRF/CORS/photo/External reviews, secret/PII log checks, scans and negative tests; no unresolved Critical/High finding. |
| 16.3 Migration/rollback | planned | Fresh and previous-release upgrade on staging, compatible code rollback, readiness/index checks; document no-backup limit. |
| 16.4 Hosted Supplier UAT | planned | Supplier Admin, Supervisor, Line Leader, QC workflows and signed PRD acceptance, including recurring Line–Shift, Tanoko, PCR and device gates. |
| 16.5 External Supplier UAT | planned | Representative supplier validates OpenAPI, credential, single/batch/retry/order/error, PII and TMMIN projection; signed result. |
| 16.6 TMMIN Admin/Quality UAT | planned | Tenant/source/credential governance, dashboards, warnings, Explorer, PCR correction, audit and read-only limits; signed result. |
| 16.7 Production readiness | planned | Three domains/DNS/TLS, VM/deploy identity, GitHub/runtime secrets, owners and isolation pass remote preflight. |
| 16.8 Critical-risk acceptance | planned | Written named approval, date and reference for no DB/photo backup or RPO/RTO/HA, automatic production deployment, permanent PII retention, and best-effort push with authoritative in-app notifications. |
| 16.9 Production release | planned | Only after 16.1–16.8: activate approved `main` caller, observe CI/exact-SHA deployment, validate domains/readiness/SHA and bounded smoke; code rollback if safe. |
| 16.10 Handoff | planned | Record production state, release/rollback limits, known issues, metrics/logs and post-release checks; update PRD, roadmap, handoff and operator docs. |

Phase 16 is `done` only when all applicable PRD acceptance gates, UAT and risk sign-offs, deployment, and post-release checks pass. Do not infer production readiness from local seed, synthetic load, or staging alone.

## Dependencies, scope, and next execution

Critical path: **15.11 rehearsal → 15.12–15.15 staging/device acceptance + QA disposition → 16.1–16.3 quality gates → 16.4–16.6 UAT → 16.7–16.8 production prerequisites/sign-off → 16.9 release → 16.10 handoff**. Product defects and PCR classification evidence may be worked in parallel, but must close before their affected acceptance gate.

External prerequisites: staging/production DNS and TLS, VMs/SSH, GitHub and runtime secrets, target push services/devices, designated UAT users, representative External supplier, governance approval, and written risk acceptance. Their presence must be verified at the gate; a historical handoff does not prove current availability.

Explicit v1 exclusions remain in [PRD §§34–36](PRD.md): backup/recovery/PITR, HA, MFA/SSO, native mobile, integrations outside the External API, and other listed scope. The PCR amendment is an approved exception to the older “AI/ML out of scope” roadmap text; it is implemented as advisory screening with the production gate above. Update the PRD and roadmap together for any future scope change.

**Next action:** inspect current branch/remote/CI and staging configuration, reproduce or resolve F-06 and the other QA findings as separate tracked work, then run 15.11 staging rehearsal. Record the exact checks and outcomes in [sessionHandoff.md](sessionHandoff.md). Before a commit, run the workflow-equivalent local checks required by [rules.md](rules.md); before reporting delivery after a push, verify required GitHub jobs are green.
