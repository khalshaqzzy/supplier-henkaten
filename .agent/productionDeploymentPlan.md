# Production deployment preparation — 2026-09-24

Status: workflow preparation in progress; production release has not run.

Bootstrap verification on 2026-09-24: the CI key authenticated as the deploy user; Ubuntu 22.04,
four vCPUs, 16 GiB RAM, Docker 29.8.1, Compose 5.5.1, writable release/shared paths, and required
PostgreSQL/photo ownership were observed. The VM had about 191 GiB free disk. Its resolver returned
the production VM address for all three hostnames. Only SSH was listening; HTTP/HTTPS reachability
must be checked after Caddy starts. The ED25519 fingerprint matched repeated keyscans and the
host public-key file read over SSH; that observed key is pinned in GitHub `VM_SSH_KNOWN_HOSTS`.
This is trust on first use, not independent provider-console verification. Checking UFW status
requires sudo authentication.

## Locked routing and trigger

| Surface | Production hostname |
| --- | --- |
| Supplier | `henkaten.qualitydivision.com` |
| TMMIN Admin/Quality | `admin-henkaten.qualitydivision.com` |
| API | `henkaten-api.qualitydivision.com` |

The user confirmed the spelling `qualitydivision.com`. A push to `main` must run the same release
gate as `staging` and call the reusable deploy with `production`, exact `github.sha`, production
domains, `/opt/supplier-henkaten/production`, and GitHub Environment `production`. Pull requests
to `main` run CI without deployment. No reviewer gate is configured. Staging remains isolated.

## External readiness before merging to main

1. Verify the production VM is Ubuntu 22.04, has four vCPUs and 16 GiB RAM, has sufficient disk
   for two image builds/releases plus persistent data, and exposes SSH/TCP 80/TCP 443/UDP 443.
2. Bootstrap the production VM with the already-used CI SSH public key. Verify the deploy user,
   Docker/Compose versions, GID 2000 data permissions, and the production shared paths.
3. Confirm all three public DNS A records point to the production VM. Confirm public 80/443
   reachability and automatic TLS before claiming the first deploy can pass.
4. `VM_SSH_KNOWN_HOSTS` contains the ED25519 key observed by repeated keyscan and by reading the
   host public-key file over SSH. Compare its fingerprint with the VPS console/provider control
   plane for independent identity assurance before release. `VM_HOST`, `VM_USER`, and `VM_SSH_PORT`
   use the production endpoint; the staging CI SSH private key is reused as requested.
   The CI public key file is `.local/.ssh/supplier-henkaten-staging-ci.pub`; its fingerprint is
   `SHA256:YwwAViIpZDOfV9A5VT2QmzktqKAEL2PTA4lrHVRejcY`. The observed production ED25519 host
   fingerprint is `SHA256:Wka0YzEsdKTReWwRJXFurJkr1Bi/jhO+lTdSHFEINAs`; the pin is trust on
   first use until independently confirmed in the VPS console.
5. Copy all staging GitHub environment secret **values** to production, except `VM_HOST` and
   `VM_SSH_KNOWN_HOSTS`, with the subsequently requested production bootstrap username override.
   GitHub does not return secret values through its API: use the original
   vault or the active staging runtime env over trusted SSH, plus the preserved local CI key.
   Transfer values through stdin/file descriptors without echoing, logs, or repository files.
   Compare secret-name inventories afterwards. The target environment currently has no reviewer
   protection. Verify PCR inference URL/key and worker settings, because a missing key makes
   automatic assessments resolve to Review.
6. Keep database, media, Caddy certificate, and release-state paths on the production VM only.
   Equal credentials across environments do not imply shared data, but they increase blast radius;
   rotate independently later after initial parity. Bootstrap password is consumed only for a new
   admin and changing its GitHub secret does not rotate the existing account.
7. Complete staging rehearsal, the remaining QA/UAT/capacity/security gates and named acceptance
   of the PRD critical risks before production go-live. Document any explicit waiver separately.

GitHub Environment `production` is restricted to branch `main` and has no manual reviewer gate.
`main` branch protection requires an up-to-date `Release candidate gate` check and retains its
existing one-review requirement. The environment branch rule is separate from CI's `main` push
condition; both must remain in place.

## Capacity and performance plan for 4 vCPU / 16 GiB

The current runtime has one Node API process, one PostgreSQL instance, two static Nginx frontends,
and Caddy. `DB_POOL_MAX=20` applies to the API; migrations and bootstrap are one-shot. All images
build on the VM during deployment, so peak build memory and disk are part of the capacity budget.
Do not claim all four cores are serving requests or increase API replicas until session behavior,
outbox leasing, PCR work, PostgreSQL connections, and Caddy routing are load-tested together.

Measure actual VM `nproc`, memory, swap, free disk/inodes, Docker build peak, PostgreSQL active
connections/cache, API CPU and heap/GC, outbox/PCR latency, and p50/p95/p99/error rates under the
PRD 42-supplier Compact profile. Target the PRD latency thresholds: board/warning p95 5 s,
External ingest p95 2 s, projection p95 10 s, dashboard p95 3 s, error rate below 1%. Reserve
headroom for PostgreSQL cache and Docker build; tune pool, PostgreSQL memory, API process count,
and worker concurrency only from the measured bottleneck, then repeat functional and rollback
checks. The current default is a safe baseline, not proof of maximum throughput.

## Exact release verification

Before commit, run the branch's local CI-equivalent checks from a clean-artifact checkout,
including Linux `flock`, both bootstrap modes, production env rendering, actionlint, ShellCheck,
Hadolint, migrations, integration/E2E, Compose routing, Gitleaks, audit, CodeQL-equivalent review,
and Trivy. Before merge, require the PR-to-`main` release gate green. After merge, inspect the
`main` push run: every gate, `Deploy production`, remote preflight, migration, internal smoke,
external three-domain smoke, and exact release SHA must pass. A workflow definition alone cannot
guarantee success when the VM, ports, host key, or secret source remains unresolved.

Production has no database/photo backup, PITR, or HA under the accepted v1 contract. Code rollback
does not restore data and is safe only while migrations remain backward compatible.
