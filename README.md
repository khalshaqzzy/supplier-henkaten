# Enterprise Digital Henkaten Management

TypeScript monorepo for the TMMIN Supplier Digital Henkaten platform. It contains the
NestJS/Express API, Prisma/PostgreSQL persistence, Supplier and TMMIN React applications, Hosted
Henkaten operations, External supplier ingestion, read models, realtime invalidation, and isolated
full-stack browser journeys.

## Prerequisites

- Node.js 22.23.1
- pnpm 11.16.0
- Docker Desktop with Docker Compose

The repository rejects unsupported Node.js versions. Use `.node-version` or `.nvmrc`, then install
the pinned package manager:

```bash
npm install --global pnpm@11.16.0
```

## Install and validate

```bash
pnpm install --frozen-lockfile
pnpm validate
```

The active workspaces are:

- `@tmmin-henkaten/api` — NestJS API, Prisma client/migrations, OpenAPI, auth, and administration;
- `@tmmin-henkaten/supplier-web` — Hosted Supplier operations and monitoring application;
- `@tmmin-henkaten/tmmin-web` — cross-supplier governance and monitoring application;
- `@tmmin-henkaten/contracts` — shared Zod runtime contracts and TypeScript types;
- `@tmmin-henkaten/api-client` — typed browser API and realtime clients;
- `@tmmin-henkaten/ui` — shared accessible UI primitives;
- `@tmmin-henkaten/test-fixtures` — deterministic test-only builders;
- `@tmmin-henkaten/e2e` — disposable PostgreSQL and Playwright full-stack journeys.

## Local PostgreSQL

Local development uses Docker-managed PostgreSQL 18 with pgvector. A host PostgreSQL installation is
not required.

```bash
pnpm db:up
pnpm db:wait
pnpm db:verify
pnpm db:test:reset
pnpm db:test:migrate
pnpm db:migrate
pnpm db:down
```

Copy `.env.example` to an untracked `.env`, replace the local CSRF/throttle values as needed, then
start the API with `pnpm --filter @tmmin-henkaten/api dev`. Public probes are `GET /health` and
`GET /ready`; the generated contract is `GET /api/v1/openapi.json`.

Hosted member photos are normalized to private WebP derivatives below `PHOTO_STORAGE_ROOT`
(default `.local/uploads/member-photos`). The directory must be writable and persistent. It must
never be exposed as a public static mount; photos are served only through authenticated API routes.

Operator-only bootstrap and recovery use `TMMIN_BOOTSTRAP_USERNAME`,
`TMMIN_BOOTSTRAP_DISPLAY_NAME`, and `TMMIN_BOOTSTRAP_PASSWORD` from the environment:

```bash
pnpm build
pnpm admin:bootstrap
pnpm admin:recover
```

Both commands deliberately keep credentials out of arguments and logs. Bootstrap is idempotent;
recovery rotates the protected administrator password and revokes its sessions.

## Local full stack

Copy `.env.example` to an untracked `.env` and provide the protected TMMIN bootstrap identity and
local secrets. The development-only image and root Compose `fullstack` profile run migrations, API,
and both Vite applications:

```bash
pnpm local:up
pnpm local:wait
pnpm local:bootstrap
pnpm local:logs
```

Open Supplier at `http://localhost:5173`, TMMIN at `http://localhost:5174`, and the API health probe
at `http://localhost:3000/health`. PostgreSQL remains available at `127.0.0.1:55432`.

```bash
pnpm local:down
```

`local:down` preserves the PostgreSQL and private-photo volumes. `local:destroy` is the explicit
destructive command that removes both. The local Dockerfile is a pinned development runtime, not a
production image.

For a ready-to-use synthetic development environment, use one of the explicit destructive commands:

```bash
pnpm local:start:clean
pnpm local:reseed
```

`local:start:clean` removes both local PostgreSQL and member-photo volumes before starting,
migrating, and seeding the stack. `local:reseed` recreates only the main application database and
member-photo volume; the disposable `_test` database is preserved. Both commands finish with
exactly two active Hosted suppliers containing comprehensive live and historical 4M, shift,
approval, warning, assignment, notification, audit, and dashboard data. History is dense in the
latest 30 days and continues through quarterly and approximately one-year trend ranges. The two
suppliers deliberately have different 4M/status profiles, uneven 1-6 Henkaten shift loads,
line/part concentration, operational narratives, and event/decision timing instead of uniform demo
rows.

Passwords are generated independently on every run and written only to the ignored
`.local/seed-credentials.json` file with mode `0600`. The terminal prints the file path but never
the credential values. These commands are guarded for the local Compose project and cannot be used
as staging or production seed operations.

## Full-stack browser journeys

Install the pinned browsers once, then run the complete Chromium suite or the critical Edge smoke:

```bash
pnpm e2e:install
pnpm test:e2e
pnpm test:e2e:edge
```

Each spec receives a unique pgvector Compose project, dynamic loopback ports, fresh migrations, an
operator-CLI bootstrap identity, and isolated application processes. The runner destroys its
containers, network, volumes, photo storage, and processes even after failure. Failure diagnostics
are written to root `test-results/e2e`, `playwright-report`, and `blob-report`.

## Tests and generated contracts

```bash
pnpm test:unit
pnpm db:test:reset
pnpm db:test:migrate
pnpm test:integration
pnpm openapi:check
```

Integration tests require the disposable PostgreSQL database and never use SQLite or a host
PostgreSQL service. Run `pnpm openapi:generate` only when an intentional Zod-backed public contract
change must update `apps/api/openapi/openapi.json`.

`db:down` preserves the local main database volume. `db:destroy` is the only command that removes
the project volume and prints the exact Compose project before deletion.

The v1 product deliberately has no database or member-photo backup, recovery mechanism, RPO/RTO, or
high availability. Local tooling must not be interpreted as a recovery mechanism.

## Source of truth

Read project guidance in this order:

1. `.agent/rules.md`
2. `.agent/PRD.md`
3. `.agent/sessionHandoff.md`
4. `.agent/implementationPhases.md`
5. relevant records in `docs/adr/` and `docs/architecture/`
