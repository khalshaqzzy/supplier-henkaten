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
use receives credentials from an untracked `.env`; browser journeys generate epoch-local values.
No default credentials, database fixture endpoint, or production seed behavior is added.

Domain state is provisioned through real browser or public API operations. Direct database use in
the harness is restricted to readiness verification, fresh migrations, and protected bootstrap
mechanics.

Playwright uses distinct browser contexts for roles and tenants. A deliberate shared-context
journey proves the Supplier and TMMIN cookie names do not overwrite one another. Chromium covers the
complete suite; pinned Microsoft Edge covers tagged critical smoke journeys.

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
- **Containerize the Vite/API processes inside every journey:** rejected for now because child
  processes give faster iteration while PostgreSQL remains environment-faithful.

## Consequences

The local stack preserves volumes on `local:down`; only the explicit `local:destroy` command removes
them. Browser epochs always remove their disposable data. Published ports bind only to loopback.

Failure artifacts include trace, screenshot, video, console and network diagnostics, plus HTML and
blob reports. Intentional failures must return nonzero while cleanup still succeeds.

The developer build definition is not a production image. Reverse proxy, TLS, hardened production
images, remote Compose, deployment automation, backup, and recovery remain separate delivery
concerns.

## Validation Evidence

- Compose configuration validates both the default database service and `fullstack` profile.
- Interactive smoke coverage reaches API readiness and both browser realms through canonical URLs.
- Browser journeys start from fresh PostgreSQL/pgvector, exercise real authentication and domain
  operations, and leave no project container, network, process, or volume behind.
- An intentional browser failure produces a nonzero result and retained diagnostic artifacts while
  teardown still completes.

## Follow-up

Production container and deployment topology require separate records and security validation.
Browser coverage should continue to add only real user journeys and public API probes.
