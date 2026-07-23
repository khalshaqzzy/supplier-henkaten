# Enterprise Digital Henkaten Management

TypeScript monorepo for the TMMIN Supplier Digital Henkaten platform. The repository is currently at
the architecture and local-tooling foundation: no product API or frontend is running yet.

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

- `@tmmin-henkaten/api` — compile-only API foundation; NestJS runtime begins later;
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
pnpm db:migrate
pnpm db:down
```

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
