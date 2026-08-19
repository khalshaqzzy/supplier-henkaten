# 0026 Isolated Local Full-Stack and Browser E2E Runtimes

Status: Accepted

Date: 2026-07-25

## Context

Developers need a durable local stack for interactive work, while browser journeys need repeatable
state, concurrent-safe ports, and guaranteed cleanup. Reusing one database for both purposes makes
tests order-dependent and risks deleting developer data. Supplying default protected credentials or
test-only application endpoints would weaken production boundaries.

## Decision

The repository provides two deliberately separate runtimes:

1. The root Compose `fullstack` profile runs migration, API, Supplier web, and TMMIN web services
   against the normal durable PostgreSQL volume. It uses canonical `localhost` origins and
   loopback-only published ports. Private member photos use a separate durable volume.
2. Each browser journey epoch creates a unique Compose project containing disposable pgvector
   PostgreSQL, selects dynamic loopback ports, applies fresh migrations, starts the API and both Vite
   applications as child processes, and destroys its containers, network, volume, and photo
   directory in `finally` and signal handlers.

The protected TMMIN identity is created only through the production operator CLI. Interactive local
use receives credentials from an untracked `.env`, while clean-seed commands generate an ephemeral
bootstrap value and browser journeys generate epoch-local values. No default credentials, database
fixture endpoint, or production seed behavior is added.

Domain state is provisioned through real browser or public API operations. Direct database use in
the harness is restricted to readiness verification, fresh migrations, and protected bootstrap
mechanics.

The durable developer runtime additionally exposes `local:start:clean` and `local:reseed`. Both are
explicitly destructive, development-only operations. Clean start removes both named volumes;
reseed recreates only the main database and photo volume while preserving the disposable test
database. They provision exactly two synthetic Hosted suppliers through authenticated public APIs.
Both commands rebuild the API and both frontend images from the current working tree before the
interactive stack is considered ready. This prevents a clean database from being audited against a
stale browser bundle.
After the outbox drains, a guarded local-only transaction normalizes historical timestamps and
verifies aggregate invariants. This narrow exception is necessary because production APIs correctly
use server-authoritative current time and immutable terminal records.

The historical planner uses deterministic supplier-specific profiles rather than uniform fixture
rows. Shift load varies from one to six records, category and outcome mixes differ by supplier,
line and part demand are weighted, and event/finalization timing varies within the scheduled shift.
Automotive line, process, part, checklist, and change narratives are synthetic but operationally
plausible. All checklist responses remain affirmative because readiness is a production submission
precondition; rejected records are produced only through the real approval workflow.

Random per-account passwords are stored only in a gitignored, mode-`0600` local manifest. Values
are never tracked or printed. The seed CLI rejects production, CI, non-loopback APIs, nonlocal
databases, missing confirmation, and nonempty targets.

Playwright uses distinct browser contexts for roles and tenants. A deliberate shared-context
journey proves the Supplier and TMMIN cookie names do not overwrite one another. Chromium covers the
complete suite; pinned Microsoft Edge covers tagged critical smoke journeys.

Seeded-runtime QA follows an explicit order: audit a Supplier Admin first, reseed to the verified
baseline, then audit TMMIN Admin. Suspected defects are triangulated against database state, public
API behavior, and UI presentation before changing either seed or application code. External-source
states needed by TMMIN QA are created temporarily through production UI/API operations and removed
by reseed; they are not added to the two-Hosted-supplier baseline fixture. Credential manifests and
one-time values remain excluded from browser artifacts, logs, and audit documents.

Operational seeded QA extends that rule with isolated mutation epochs: reseed before Supervisor
decision scenarios and again before Line Leader lifecycle scenarios so one actor cannot consume the
fixture required by another. Supervisor scope is proven with multi-line and single-line profiles;
Line Leader scope uses one profile per line. Both synthetic suppliers are exercised, while NPM
coverage is intentionally limited to Line Leader Henkaten for tenant-variance evidence.

Completion QA treats QC and TMMIN Quality as primary actors rather than supporting identities. QC
is checked against the shared tenant queue and tenant-wide read models. TMMIN Quality is checked
across every monitoring and Hosted-support route, including direct protected-route denial. A
browser control that is known to end in a role guard must not be presented as an available action;
redacted privileged identity must be described as unavailable to the viewer rather than falsely
described as absent.

Wire-format normalization belongs in the typed API client. The UI receives domain arrays/details
after strict parsing of API envelopes and must not add fallback production data. Board risk
presentation combines authoritative assignment state with Open Man indicators because a reserved
MP can coexist with an assignment whose current state remains `ASSIGNED` until final approval.
Local runtime output reports the canonical `localhost` browser origins accepted by CORS/cookies;
the numeric loopback origin remains appropriate only for readiness probes.

The durable seed also provisions one saved Canvas v1 for every active line through the Hosted
layout PUT endpoint used by Supplier Admin. NPM demonstrates the curated isometric family and GKI
the simple 2D family, while process zones, arrows, labels, and required job slots remain
deterministic. Four tracked, fictional ImageGen operator portraits are normalized to 768×1024 JPEG
and reused by assigned-MP index modulo four. This gives every four-job line distinct faces while
keeping the asset catalog deliberately small; reserve MPs still exercise initials fallback. The
source portraits are copied only into the local developer image context and are not shipped in the
production API or frontend images.

## Rationale

Durable local data makes daily development practical. Per-journey database isolation makes browser
results deterministic and allows parallel invocations without a shared fixed port or schema.
Keeping the real bootstrap path and application boundaries in the loop proves the shipped behavior
instead of a test-only substitute.

## Alternatives Considered

- **One shared local database for browser tests:** rejected because state and cleanup would be
  order-dependent and destructive to developer data.
- **One long-lived browser database reset between suites:** rejected because process crashes can
  leave contaminated state and prevent safe concurrent runs.
- **Fixed test ports:** rejected because concurrent agents and local services can collide.
- **Test-only bootstrap or fixture HTTP routes:** rejected because they create an application
  behavior that does not exist in production.
- **Tracked shared demo credentials:** rejected because they would create durable, reusable secrets
  and weaken the protected-bootstrap posture.
- **Direct database construction of all domain state:** rejected because it would duplicate
  lifecycle, tenant, approval, warning, and assignment rules outside the shipped API.
- **Randomized faker-style data:** rejected because flaky distributions would make acceptance
  failures difficult to reproduce. Fixed profile seeds provide variance while preserving exact
  replay.
- **Uniform category/status counts and three records per shift:** rejected because dashboards and
  filters looked artificial and did not exercise skewed production workloads.
- **Containerize the Vite/API processes inside every journey:** rejected for now because child
  processes give faster iteration while PostgreSQL remains environment-faithful.
- **Reuse previously built frontend images during clean/reseed:** rejected because the apparent
  seed baseline could be presented by code that is no longer in the working tree.
- **Add a permanent External supplier to the seed for admin QA:** rejected because it would change
  the promised two-Hosted-supplier baseline and bypass real administration/governance workflows.
- **Generate a unique portrait for every seeded MP:** rejected because four deliberately reused
  fictional identities provide sufficient visual coverage without creating an unnecessary asset
  inventory. Reuse is kept out of any one line so duplicate faces do not reduce board clarity.
- **Insert saved layouts directly with Prisma:** rejected because the local seed must exercise
  Hosted authorization, strict contracts, optimistic creation, audit, and outbox behavior through
  the production API.

## Consequences

The local stack preserves volumes on `local:down`; `local:destroy` and `local:start:clean` explicitly
remove both. `local:reseed` preserves the PostgreSQL volume and test database but replaces the main
database and photo volume. Browser epochs always remove their disposable data. Published ports bind
only to loopback.

Failure artifacts include trace, screenshot, video, console and network diagnostics, plus HTML and
blob reports. Intentional failures must return nonzero while cleanup still succeeds.

The developer build definition is not a production image. Reverse proxy, TLS, hardened production
images, remote Compose, deployment automation, backup, and recovery remain separate delivery
concerns.

## Validation Evidence

- Compose configuration validates both the default database service and `fullstack` profile.
- Interactive smoke coverage reaches API readiness and both browser realms through canonical URLs.
- Clean start produces two Hosted suppliers with 240 total Henkaten spanning dense recent and
  approximately one-year history plus a protected credential manifest. SQL evidence confirms
  supplier-specific category/status distributions, distinct shift-load histograms, all jobs/parts
  represented, weighted line/part usage, and dozens of event/resolution timing variants. Reseed
  preserves a test-database sentinel while rotating supplier IDs, credentials, and member-photo
  files.
- The 2026-08-19 Canvas refinement passed both clean start and reseed with six version-1 layouts,
  nineteen current photos per supplier, four MP portrait checksums reused three times per supplier
  and six times globally, exact active-job parity, six layout audits, and a drained outbox. Browser
  review covered 390×844, 768×1024, 1280×720, and 1672×941 with no document overflow; mobile stayed
  read-only and both NPM isometric and GKI 2D compositions rendered as saved layouts.
- The 2026-07-27 seeded application audit exercised Supplier Admin followed by a clean TMMIN Admin
  baseline at 1280×720 and wide desktop viewports. Database/API/UI triangulation found no seed
  defects and seven application/runtime defects; all were fixed with regression coverage. The
  complete evidence is recorded in `docs/audits/seededAppQaAudit.md`.
- The Supervisor/Line Leader continuation exercised approval concurrency, rejection, idempotency,
  immutable terminal state, warning/reservation/assignment effects, Withdraw + Clone, Shift
  cancellation, and negative line/tenant scope. All three NPM Line Leader profiles were checked for
  Henkaten. It found no seed or contract defects and fixed six application defects in local origin
  reporting, API-client detail/envelope mapping, reservation risk presentation, 4M badge
  accessibility, and active-Shift resolution navigation. Evidence is recorded in
  `docs/audits/seededAppSupervisorLineLeaderQaAudit.md`.
- Regression parity after those fixes comprises 115 Vitest tests, two Node planner tests, 33 serial
  PostgreSQL integration tests, four Chromium journeys, and two Edge journeys. The lifecycle E2E
  now asserts current Shift/target-job form hydration; Man concurrency E2E asserts the reservation
  risk rail before approval.
- The 2026-07-28 completion audit exercised every credentialed role and every QC/TMMIN Quality
  route at 1280×720. Database/API/UI triangulation again found no seed or contract defect. Two
  presentation defects were fixed: stale action errors now clear on authoritative record refresh,
  and TMMIN Quality no longer sees a credential-management link or a false statement that an
  intentionally redacted Supplier Admin is absent. Regression parity increased to 117 Vitest tests
  plus two Node tests; 33 integration, four Chromium, and two Edge journeys remain green. Complete
  evidence is recorded in `docs/audits/seededAppAllRolesQaAudit.md`.
- Browser journeys start from fresh PostgreSQL/pgvector, exercise real authentication and domain
  operations, and leave no project container, network, process, or volume behind.
- An intentional browser failure produces a nonzero result and retained diagnostic artifacts while
  teardown still completes.

## Follow-up

Production container and deployment topology require separate records and security validation.
Browser coverage should continue to add only real user journeys and public API probes.
