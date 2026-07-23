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
preflight, forward migration, ordered startup, health/readiness checks, and three-domain smoke
tests. Five releases are retained. Code rollback is allowed only when the database schema remains
backward compatible.

Pushes to `staging` and `main` eventually deploy automatically after required checks. No production
manual approval gate is added. No backup, PITR, replica, failover, RPO, RTO, or HA claim is made.

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

Production domain variables remain placeholders. Persistent paths cover PostgreSQL, member photos,
Caddy state, and release/shared deployment state. Destructive database commands are prohibited in
hosted environments.

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

The local PostgreSQL Compose configuration validates and its lifecycle passed start, health,
version/extension verification, isolated test reset, persistence-across-down, and explicit destroy
cleanup. Remote Compose, Caddy, release-by-SHA, and deployment workflows remain intentionally
deferred.

## Follow-up

Production containers, Caddy configuration, release scripts, CI/CD deployment, and staging rehearsal
will be implemented only after full local end-to-end validation.
