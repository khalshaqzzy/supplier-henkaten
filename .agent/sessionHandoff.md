# Session Handoff — Phase 11–12 Frontend Foundation dan Hosted Supplier

Tanggal: 2026-07-24

Branch: `staging`

Status: Phase 11 dan Phase 12 `done`; Phase 13 adalah next

## 1. Outcome

Shared application foundation dan seluruh workflow production Hosted Supplier telah selesai sesuai
PRD dan `.agent/PAGES.md`.

- `packages/api-client` menjadi satu-satunya browser HTTP boundary untuk Supplier dan TMMIN.
- Supplier dan TMMIN memiliki session-aware application foundation yang terisolasi per realm.
- Supplier Portal menyediakan authentication, setup, master data, Default Assignment, Shift,
  Henkaten, approval, Assignment Board, Overview, notifications, audit, account, dan logout.
- Hosted Preparation dibatasi oleh capability backend dan hanya menampilkan Setup, Master Data,
  Default Assignment, Account, serta Logout.
- `/design` tetap public, lazy, `noindex,nofollow`, dan tidak menjalankan bootstrap session/API.
- Production UI berbahasa Indonesia, light desktop-only, tanpa fixture fallback, Save Draft, export,
  bulk action, global search, dark mode, atau workflow di luar PRD.

Kontrak backend v1 tetap backward-compatible dan sekarang berisi 126 path/142 operasi. Dua read
operation additive adalah setup readiness dan Henkaten form options.

## 2. Shared Frontend Foundation

`packages/api-client` menyediakan:

- generated OpenAPI `paths` dan runtime Zod validation;
- operation catalog Supplier/TMMIN tanpa URL atau `fetch` ad-hoc di feature code;
- cookie credentials, in-memory CSRF, correlation ID, JSON/204/blob/multipart, abort signal, dan
  idempotency key per user intent;
- typed problem, network, invalid-contract, rate-limit, dan uncertain-mutation errors;
- Supplier EventSource wrapper dengan connection state, native/manual reconnect, invalidation, dan
  authoritative refetch.

Application providers dan guards menyediakan:

- QueryClient retry policy untuk safe read saja;
- scoped cache key berisi realm, user, Supplier, dan session purpose;
- cache/CSRF/intended-path cleanup pada logout, expiry, atau identity change;
- anonymous/authenticated/forced-reset/capability/preparation/not-found/unsupported-viewport
  behavior;
- relative same-realm intended destination sanitization;
- production API-origin validation;
- cursor history, server-owned filter state, duplicate-submit lock, optimistic version, dan
  refresh-only conflict recovery.

TMMIN hanya memiliki login, forced password change, account/logout, dan authenticated foundation
shell. Workflow TMMIN tetap dimiliki Phase 13.

## 3. Supplier API Resolution

Gap Supplier yang ditutup:

- GAP-01: authoritative session capabilities dan Supplier context;
- GAP-02: `GET /api/v1/supplier/setup-readiness` dengan shared source-governance evaluator;
- GAP-03: role-scoped dashboard filters, aging, trends, issues, overrides, rankings, activity, dan
  filter options;
- GAP-04: immutable audit tenant/line scope;
- GAP-13: explicit active override/unresolved Board context;
- GAP-15: immutable Hosted Henkaten `sourceMode` dan `sourceEpoch`.

Henkaten form options ditambahkan untuk Line Leader dengan capability
`SUPPLIER_HENKATEN_SUBMIT`. Response hanya mengekspos:

- current published checklist untuk kategori yang dipilih;
- active part yang dapat dicari;
- active MP replacement candidates beserta reservation dan current-assignment context.

Endpoint ini mencegah Line Leader bergantung pada Admin-only master-data reads dan menyediakan
version/source assignment yang dibutuhkan cross-line atomic movement.

Audit persistence sekarang memiliki nullable `lineId`, safe backfill dari resource relations, dan
cursor index. Supplier Admin/QC membaca tenant scope; Supervisor/Line Leader hanya authorized-line
scope. CORS mengekspos `X-Correlation-ID` dan `Retry-After`.

Migration:

- `apps/api/prisma/migrations/20260724000900_supplier_frontend_audit_scope/migration.sql`

Tidak ada destructive data operation.

## 4. Hosted Supplier Workflows

Implemented production routes:

- authentication, generic failure, rate-limit feedback, forced reset, account/session, logout;
- setup readiness dengan ordered next action dan deep link CRUD;
- member/account/photo lifecycle, one-time password, reset/activate/deactivate, MP tanpa credential;
- line/job nested management dan reorder, part, cross-midnight Shift Template, checklist
  draft/publish/history;
- Default Assignment Supervisor/LL/MP, availability, remove/change, atomic move, active-shift
  notice;
- Shift list/current/history, prepare, preflight, resolution, normal/admin emergency Start, End
  consequence review, terminal summary;
- Henkaten full-filter list, four-category create/clone, all-Yes gate, reservation/movement,
  immutable detail, source traceability, Withdraw, reroute, parallel decision/reject-fast refresh;
- realtime Assignment Board dengan vacancy/reservation/conflict, Open/Approved 4M, override context,
  scoped filter, SSE invalidation, stale banner, dan accessible status names;
- Overview dengan server aggregates, URL filters, charts/tables, drill-down, section failures, dan
  generated time;
- notification unread/list/read/deep link, role-scoped audit cursor timeline, account/password.

## 5. Visual Evidence

Reference berikut diinspeksi secara visual sebelum implementasi page terkait:

- `.agent/design/supplier-overview.png`;
- `.agent/design/supplier-assignment-board.png`;
- `.agent/design/create-henkaten.png`;
- `.agent/design/henkaten-detail-approval.png`;
- `.agent/design/blocked-shift.png`;
- `.agent/design/default-assignments.png`.

Manual in-app browser audit:

- `/design` pada 1440×900: public showcase, `noindex,nofollow`, tanpa page-level horizontal
  overflow;
- `/login` pada 1280×720: exact viewport fit, polished focus-visible state, tanpa overflow;
- `/design#patterns` pada 1280×720: critical patterns tetap terbaca tanpa page-level overflow;
- viewport di bawah 1280×720 menampilkan unsupported message dengan Logout tetap tersedia.

Visual direction mempertahankan compact sidebar/header, near-white canvas, thin borders, low
elevation, 36 px controls, dense tables, selective orange, contextual rail, short motion, dan
icon+labeled status. Official TMMIN logo tidak ditebak atau diunduh.

## 6. Validation Evidence

Runtime lokal memakai Node.js `22.23.1` dan pnpm `11.16.0`.

Local GitHub Actions parity:

```text
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
NODE_ENV=test \
DATABASE_URL=postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten_test \
RELEASE_SHA=ci \
SESSION_CSRF_SECRET=integration-test-csrf-secret-at-least-32 \
AUTH_THROTTLE_SECRET=integration-test-throttle-secret-32 \
OUTBOX_ENABLED=false pnpm test:integration
pnpm db:down
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.24.3 \
  dir /repo --config=/repo/.gitleaks.toml --redact --verbose
git diff --check
```

Results:

- contracts: 24 unit tests passed;
- API client: 7 unit tests passed;
- shared UI: 14 unit/accessibility tests passed;
- API: 16 unit/policy/contract tests passed;
- Supplier foundation: 6 route/session/viewport tests passed;
- test fixtures: 6 tests passed;
- PostgreSQL integration: 32/32 passed from a fresh nine-migration database;
- runtime/OpenAPI reconciliation: 126 paths and 142 operations;
- Supplier/TMMIN/API production build passed with explicit API origin;
- format, lint, typecheck, OpenAPI drift, Compose/pgvector, Gitleaks directory/commit scan, and
  `git diff --check` passed.

The generated showcase is a separate lazy production chunk. Vite reports the existing main bundle
size advisory; it is non-failing and route-level workflow splitting may be addressed as a measured
performance refinement.

## 7. Documentation and Commits

Architecture records:

- ADR 0019 and backend contract-freeze architecture updated for 126 paths/142 operations;
- ADR 0020 updated with additive Supplier gap resolution;
- ADR 0022: typed browser API boundary;
- ADR 0023: purpose-aware session and cache boundaries;
- ADR 0024: Supplier application composition.

Progress records:

- `.agent/PAGES.md`: GAP-01/02/03/04/13/15 `AVAILABLE`;
- `.agent/implementationPhases.md`: Phase 11–12 and all subphases `done`, Phase 13 next.

Delivery commit subjects:

1. `d7b1213` — `feat(frontend): add typed session-aware application foundation`
2. `7d6e42e` — `feat(api): complete supplier frontend read contracts`
3. `feat(supplier): deliver hosted supplier workflows` — commit containing this handoff.

The exact self-referential SHA of the third commit is recorded in the delivery response and
`git log`. Existing `.DS_Store` remains unstaged and belongs to the user.

## 8. Open Scope and Next Action

No Supplier Phase 11–12 gap remains open. TMMIN GAP-05–12 dan GAP-14 tetap explicit Phase 13
dependencies and must not be simulated client-side.

Next action:

1. begin Phase 13 TMMIN capability navigation and route composition;
2. close only the TMMIN additive API gaps listed in `.agent/PAGES.md`;
3. preserve Hosted/External traceability and TMMIN Quality read-only boundaries;
4. retain full cross-realm Playwright ownership for Phase 14.

No production VM/domain/credential was required. No long-running dev process should remain after
delivery; the local Compose stack is stopped at task completion.
