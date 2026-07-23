# Enterprise Digital Henkaten Management

TypeScript monorepo for the TMMIN Supplier Digital Henkaten platform. Phase 0-3 provides the
NestJS/Express API foundation, Prisma/PostgreSQL persistence, authentication, tenant governance,
TMMIN administration, supplier provisioning, and controlled Hosted Preparation. Frontends and
Henkaten operational domains are not implemented yet.

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
- `@tmmin-henkaten/contracts` — shared Zod runtime contracts and TypeScript types;
- `@tmmin-henkaten/test-fixtures` — deterministic test-only builders.

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

Operator-only bootstrap and recovery use `TMMIN_BOOTSTRAP_USERNAME`,
`TMMIN_BOOTSTRAP_DISPLAY_NAME`, and `TMMIN_BOOTSTRAP_PASSWORD` from the environment:

```bash
pnpm build
pnpm admin:bootstrap
pnpm admin:recover
```

Both commands deliberately keep credentials out of arguments and logs. Bootstrap is idempotent;
recovery rotates the protected administrator password and revokes its sessions.

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
