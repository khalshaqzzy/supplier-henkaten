# 0001 pnpm ESM Monorepo Boundaries

Status: Accepted

Date: 2026-07-23

Scope: repository runtime, workspace boundaries, package publishing model, and shared tooling

## Context

The product requires one TypeScript repository containing a backend, two browser applications,
shared runtime contracts, shared UI primitives, end-to-end tests, and deployment configuration.
The repository must remain reproducible without adding a task orchestrator. Package manifests must
represent real, buildable packages rather than reserve future directories.

## Decision

The repository uses Node.js 22.23.1 and pnpm 11.16.0 workspaces without Turborepo. All JavaScript
packages use ESM with `type: module` and TypeScript `NodeNext` module semantics.

The initial active workspaces are:

- `@tmmin-henkaten/api` in `apps/api`;
- `@tmmin-henkaten/contracts` in `packages/contracts`;
- `@tmmin-henkaten/test-fixtures` in `packages/test-fixtures`.

Internal package dependencies use `workspace:*`. Imports between workspaces use package export
names; filesystem-relative imports that cross a workspace boundary are prohibited. Shared packages
compile to `dist`, publish declaration files, and expose explicit ESM exports. The API workspace is
initially a compile-only shell and does not claim a running HTTP service.

Browser, UI, and E2E workspaces are created only together with runnable implementation.

## Rationale

A single module model avoids CommonJS/ESM dual-build drift and works for both Node.js and Vite.
Explicit workspace dependencies make boundaries visible to pnpm, TypeScript, tests, and future
dependency analysis. Delaying inactive package manifests keeps root commands honest.

## Alternatives Considered

- **npm workspaces:** rejected because pnpm is the locked package manager.
- **Turborepo:** rejected because the repository scale does not justify another orchestration layer.
- **CommonJS API with dual-format shared packages:** rejected because it doubles the export and test
  surface.
- **Source-only cross-workspace imports:** rejected because they bypass package ownership and can
  behave differently between local builds and production artifacts.
- **Placeholder manifests for future applications:** rejected because a manifest must denote a
  buildable package.

## Implementation Details

- `.node-version` and `.nvmrc` pin Node.js 22.23.1.
- Root `package.json` pins pnpm through `packageManager` and constrains Node.js through `engines`.
- Root scripts call recursive pnpm commands in topological order.
- TypeScript shared defaults target ES2022 and use `module` and `moduleResolution` set to `NodeNext`.
- Package exports reference compiled JavaScript and declaration files under `dist`.
- ESLint blocks forbidden cross-boundary imports and production imports of test fixtures.

## Consequences

Node.js 22 is required even if a developer machine has a newer global Node.js version. ESM imports
must follow NodeNext file-extension rules. Package builds must run before consumers execute compiled
output. Adding a new workspace requires a real package implementation and an update to root
validation.

## Validation Plan

- Install from the committed lockfile using Node.js 22.23.1 and pnpm 11.16.0.
- Build, typecheck, lint, and test all active workspaces from the repository root.
- Verify the API shell imports contracts by package name.
- Verify an intentionally forbidden cross-workspace relative import fails lint.

## Risks

- Tooling that assumes CommonJS may need ESM-specific configuration.
- Native dependencies may differ between development and CI platforms.
- A global Node.js version outside 22 can produce a misleading local result unless engine checking
  is enabled.

## Validation Evidence

Validated on 2026-07-23 with Node.js 22.23.1 and pnpm 11.16.0. Frozen installation, formatting,
typed lint, strict typecheck, 18 Vitest tests, and all three workspace builds passed. Negative probes
confirmed that a cross-workspace relative import and an intentional strict type mismatch fail.

## Follow-up

The API workspace will add NestJS runtime configuration without changing the module model.
Frontend and E2E workspaces will be added only when their runnable applications are introduced.
