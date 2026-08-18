# 0008 Single-VM Environment and Release Constraints

Status: Accepted

Date: 2026-07-23

Scope: staging and production topology, routing, releases, rollback, and accepted reliability limits

## Context

TMMIN will host the platform and requires separate staging and production environments. The product
contract fixes a single-VM Docker Compose architecture and automatic branch deployments. Production
domains are not yet available, and v1 has no backup, disaster recovery, or high availability.

## Decision

Staging and production use separate VMs, Compose projects, databases, volumes, secrets, and Caddy
certificate state. Each VM runs Caddy, supplier web, TMMIN web, API, and PostgreSQL.

Caddy terminates TLS. Each browser frontend proxies same-origin `/api` traffic to the API service.
The public API domain exposes health/readiness and the External REST API under its authorization
rules.

Releases are stored by Git SHA and protected by a remote deployment lock. Deployment performs
preflight, forward migration, idempotent protected-admin bootstrap, ordered startup,
health/readiness checks, and three-domain smoke tests. Five releases are retained, including the
current and immediately previous release. Code rollback is allowed only when the database schema
remains backward compatible.

Only a push to `staging` deploys after all required checks. Pull requests to `staging` run the same
release gates without deployment. A production-capable reusable workflow exists, but no `main`,
manual-dispatch, or production deployment trigger is active. No backup, PITR, replica, failover,
RPO, RTO, or HA claim is made.

## Rationale

The topology matches the operational constraint while keeping environment isolation explicit.
Same-origin proxying provides robust cookie behavior. Release-by-SHA and health-gated activation
make code rollback understandable even though they cannot recover data.

## Alternatives Considered

- **Shared staging/production VM or database:** rejected because it weakens isolation.
- **Kubernetes or multi-node services:** rejected because they are outside v1 scope.
- **Image registry-only deployment:** not required; the release process may build on the target
  according to the future deployment implementation.
- **Manual production approval:** rejected because automatic production deployment is a locked
  product decision.
- **Adding backup implicitly:** rejected because the accepted risk must remain explicit until the
  product contract changes.

## Implementation Details

Staging domains are:

- `supplier-henkaten.qd-tmmin.site`;
- `henkaten.qd-tmmin.site`;
- `supplier-henkaten-api.qd-tmmin.site`.

The staging Compose project is `supplier-henkaten-staging`; its base path is
`/opt/supplier-henkaten/staging`. Persistent bind-mounted paths cover PostgreSQL, member photos,
Caddy data/config, and deployment state. Only Caddy publishes `80/443`; PostgreSQL uses an internal
network. API and both Vite builds carry an OCI release SHA, and each web image serves a non-cached
`/release.json`.

The runtime consists of `postgres`, one-shot `migrate`, one-shot `bootstrap-admin`, `api`,
`supplier-web`, `tmmin-web`, and `caddy`. Base images and third-party workflow actions are pinned by
digest/SHA. The API copies the exact Node 22.23.1 binary into a Debian distroless runtime. The two
static web images use pinned unprivileged Nginx. PostgreSQL 18.4 Alpine builds pgvector 0.8.5 from a
checksum-verified source archive, and Caddy 2.11.4 is rebuilt with a patched Go toolchain and gRPC
dependency plus `golang.org/x/text` 0.39.0 into a distroless runtime. The explicit `x/text` floor
prevents transitive resolution from reintroducing CVE-2026-56852. All five runtime images execute
as non-root, have bounded JSON logging and healthchecks where applicable, and retain shared data
across code releases.

The environment renderer locks staging domains/project/path and accepts secret values only through
a safe dotenv alphabet. Each release stores a mode-`0600` env file. GitHub Environment `staging`
owns VM, SSH, Caddy, database, session, throttle, and bootstrap secrets; only SSH port and bootstrap
display name are environment variables.

The CI release gate includes formatting, lint, typecheck, unit/integration/E2E, OpenAPI drift,
production builds, fresh and previous-SHA migration upgrade, Compose/runtime acceptance,
workflow/shell/Dockerfile checks, Gitleaks, Dependency Review, `pnpm audit`, CodeQL extended queries,
and Trivy filesystem/runtime-image scans. Scanner exceptions must identify one exact finding,
provide rationale, and have an unexpired registry entry.

Patchable transitive JavaScript advisories are resolved centrally with pnpm overrides scoped to
the vulnerable version range. The lockfile is regenerated and verified by both the complete-lockfile
audit and Trivy; an ignore or exception is not accepted when a compatible fixed release exists.

Deployment verifies that the candidate is still branch head before SSH. GitHub deployment
concurrency never cancels an active release; remote `flock` covers the complete critical section,
and a high-water GitHub run number rejects late workflows. Source is an exact checksummed
`git archive`. `current`, `current_release`, and the effective per-release env change only after
smoke success. Removed release directories have only their exact API, web, and Caddy release image
tags removed; shared volumes are never pruned.

Migrations are forward-only. Build/preflight failure leaves runtime untouched, migration failure
does not run a down migration, and automatic rollback switches code/env only. Changing a GitHub
database-password secret is not considered PostgreSQL role rotation. Destructive database commands
remain prohibited in hosted environments.

## Consequences

Each VM is a shared failure domain. Automatic production deployment increases the importance of
mandatory CI and schema compatibility. Release rollback does not restore database or photo data.

## Validation Plan

- Validate Compose configuration and environment separation.
- Rehearse fresh and upgrade migrations.
- Rehearse deployment lock, health failure, smoke failure, and schema-compatible rollback.
- Confirm all three domains and same-origin API paths.
- Require written acceptance of critical risks before production launch.

## Risks

- VM, disk, or volume loss can permanently destroy data.
- A destructive migration can be unrecoverable.
- Automatic production deployment can propagate a passing but harmful change.
- In-app-only warning delivery does not reach offline users.

## Validation Evidence

On 2026-07-27, the final remote Compose configuration validated with all seven services and no
published application/PostgreSQL port. The three application images and release-specific Caddy
image built for the pinned release SHA; PostgreSQL 18.4/pgvector 0.8.5 built from its pinned
base/source contract. Trivy reported zero unexcepted High/Critical findings in all five runtime
images. A fresh database applied all nine migrations offline from the API image, created the
protected administrator, and proved repeated bootstrap was a no-op.

On 2026-07-30, the PR release gate detected CVE-2026-56852 in the custom Caddy binary through the
transitive `golang.org/x/text` 0.37.0 module. The builder now selects the fixed 0.39.0 module
explicitly, and the filesystem scan passes its exact exception registry through the supported
`trivyignores` action input.

On 2026-08-04, staging run `30891976462` detected CVE-2026-18446 in `fast-uri 3.1.4`; the complete
lockfile audit additionally detected patched advisories affecting `undici 7.28.0` and
`brace-expansion 5.0.8`. Vulnerable-range overrides now resolve `fast-uri 3.1.5`, `undici 7.29.0`,
and `brace-expansion 5.0.9`. Clean-worktree Trivy filesystem, `pnpm audit`, production-like
acceptance, and all five rebuilt runtime image scans passed without adding an exception.

On 2026-08-18, PR CI run `32101378423` detected Go stdlib vulnerabilities (CVE-2026-33818, CVE-2026-39821,
CVE-2026-56853, CVE-2026-56858, CVE-2026-56859, CVE-2026-56860, CVE-2026-56862) in the Go 1.25.12
stdlib of the custom Caddy binary. The builder base image was updated to `golang:1.25.13-alpine@sha256:1e0126852075c9c60731c8ba49088448b91f63e2aed97ca9d1a9791622a05946`
with `go mod tidy` dependency resolution, restoring clean Trivy scans across all runtime images without exceptions.

The production-like stack passed exact-SHA API readiness and both `/release.json` checks,
three-domain Host routing, supplier SPA deep-link fallback, same-origin session and SSE routing,
surface-specific CSP/HSTS/anti-framing/nosniff policy, removal of `Server`/`Via`, non-root runtime
UIDs, pgvector 0.8.5 availability, and private PostgreSQL exposure. PostgreSQL cluster identity and
a member-photo sentinel survived a PostgreSQL/API restart. The deployment harness passed first deployment,
preflight/build/migration/smoke failures, atomic activation/env mode, stale-run rejection, rollback
success/failure, lock behavior (mandatory on Ubuntu CI), and five-release retention.

Remote DNS/TLS, actual GitHub Environment deployment, race rehearsal, and controlled staging
rollback still require the bootstrapped VM. Therefore 15.9 and 15.11 remain incomplete.

## Follow-up

After the operator bootstraps Ubuntu 22.04 and configures GitHub Environment `staging`, capture
first/upgrade deployment, close-candidate race, and forced-smoke rollback evidence from the real VM.
Production activation remains deferred until Phase 16 authorization and real production domains,
VM, environment secrets, and acceptance evidence exist.
