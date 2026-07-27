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
- The 2026-07-27 seeded application audit exercised Supplier Admin followed by a clean TMMIN Admin
  baseline at 1280×720 and wide desktop viewports. Database/API/UI triangulation found no seed
  defects and seven application/runtime defects; all were fixed with regression coverage. The
  complete evidence is recorded in `.agent/seededAppQaAudit.md`.
- Browser journeys start from fresh PostgreSQL/pgvector, exercise real authentication and domain
  operations, and leave no project container, network, process, or volume behind.
- An intentional browser failure produces a nonzero result and retained diagnostic artifacts while
  teardown still completes.

## Follow-up

Production container and deployment topology require separate records and security validation.
Browser coverage should continue to add only real user journeys and public API probes.
