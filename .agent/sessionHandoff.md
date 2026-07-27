# Session Handoff — Staging Runtime dan CI/CD

Tanggal: 2026-07-27

Branch: `feat/staging-deployment` dari `staging`

Status: Phase 15 `in_progress`; 15.1-15.8 `done`, 15.9 menunggu evidence VM, 15.10
implementation-ready/activation deferred, dan 15.11 menunggu rehearsal staging

## 1. Objective dan Outcome

Repository sekarang mempunyai staging release pipeline lengkap untuk satu VM Ubuntu 22.04:

- hanya pull request/push ke `staging` yang menjalankan staging CI;
- pull request menjalankan seluruh release gate tanpa deployment;
- hanya push `staging` yang memanggil reusable exact-SHA deployment workflow;
- tidak ada trigger `main`, `workflow_dispatch`, caller production, atau deployment production aktif;
- source, runtime env, pointer, rollback, dan retention dikelola per release SHA dengan race control
  lokal/remote.

Tidak ada public API, OpenAPI, Prisma schema, atau migration baru.

## 2. Runtime dan Build Decisions

- API dibangun dengan Node 22.23.1 dan frozen pnpm, lalu exact Node binary, compiled NestJS,
  production dependencies, Prisma CLI/migrations/engines, dan OCI SHA dipindahkan ke Debian
  distroless UID 65532.
- Supplier/TMMIN dibangun dengan same-origin `VITE_API_ORIGIN`, menghasilkan non-cached
  `/release.json`, dan disajikan oleh pinned unprivileged Nginx UID 101 dengan SPA fallback.
- PostgreSQL memakai image repository-local non-root berdasarkan pinned PostgreSQL 18.4 Alpine.
  pgvector 0.8.5 dibangun dari source archive dengan exact SHA-256; security packages diterapkan dan
  root-switch helper tidak masuk final filesystem.
- Caddy 2.11.4 dibangun pada pinned Go 1.25.12 dengan patched gRPC, lalu dipindahkan ke distroless
  UID 65532.
- Remote Compose mempunyai `postgres`, `migrate`, `bootstrap-admin`, `api`, dua web, dan `caddy`.
  Hanya Caddy memublikasikan `80/443`; database network internal dan seluruh shared state
  bind-mounted.

## 3. Deployment dan Race Behavior

- `bootstrap-vm.sh` hanya menerima Ubuntu 22.04/staging, memasang Docker dari repository resmi,
  membuat deploy user/key, data ownership, UFW, dan mendukung `--check`.
- Env renderer/validator mengunci domain, project, remote path, SHA, run number, dan safe secret
  alphabet; workflow mengirimnya tanpa mencetak value dan file remote bermode `0600`.
- Preflight memvalidasi OS, Docker/Compose minimum, disk, ownership/path, checksum, Compose exposure,
  dan tiga DNS record terhadap VM.
- Satu non-blocking `flock` mencakup high-water stale guard, promotion, build, migration, bootstrap,
  startup, smoke, pointer activation, dan retention.
- GitHub concurrency tidak membatalkan deploy aktif, candidate diverifikasi masih head `staging`
  sebelum SSH, dan remote run number menolak out-of-order workflow.
- Automatic/manual rollback mengganti code/env saja, tidak menjalankan down migration atau
  menghapus PostgreSQL/foto/Caddy state.
- Lima release dipertahankan, termasuk current/previous; hanya exact release image tags yang
  dibuang.

## 4. Quality dan Security Gates

`Staging CI` memisahkan quality/contracts, PostgreSQL integration, migration fresh/upgrade,
Chromium/Edge E2E, deployment tooling, production container acceptance, Gitleaks, dependency
security, dan CodeQL. `release-gate` menolak failed/cancelled/skipped dependency.

Container acceptance mencakup:

- production image build dan Trivy filesystem/semua runtime image;
- three-domain routing, same-origin `/api`, SSE, SPA deep link, exact SHA;
- HSTS/CSP/anti-framing/nosniff/referrer/permissions headers tanpa `Server`/`Via`;
- seluruh runtime non-root, PostgreSQL tanpa published port;
- protected-admin idempotency serta database/photo persistence setelah restart.

Security exceptions berada di `.agent/securityExceptions.json`; setiap entry exact, memiliki
rationale dan expiry. Current exceptions terbatas pada deterministic CI/documentation placeholders,
React Router RSC mode yang tidak digunakan oleh declarative SPA, dan `Dockerfile.local` yang
development-only. Tidak ada broad Trivy suppression.

## 5. Main Files

- workflow: `.github/workflows/ci.yml`, `.github/workflows/deploy-reusable.yml`;
- runtime: application Dockerfiles, `deploy/postgres/Dockerfile`,
  `deploy/caddy/Dockerfile`, Caddyfile, Nginx config, remote Compose, env example;
- operations: seluruh `deploy/scripts/*.sh` dan `deploy/tests/deployment-scripts.sh`;
- security/dependencies: `.gitleaks.toml`, `.trivyignore`, security exception registry,
  pnpm overrides/lockfile, API production dependency split;
- operator memory: `.agent/deploymentGuide.md`, roadmap/rules/handoff, dan ADR 0008.

User-owned `.DS_Store` tetap tidak disentuh dan tidak boleh di-stage.

## 6. Validation Evidence

Completed locally with Node 22.23.1 and pnpm 11.16.0:

- clean frozen install, format, lint, typecheck, 97 unit tests, OpenAPI/client drift, production
  build;
- PostgreSQL 18.4/pgvector 0.8.5, nine fresh migrations, 32 integration tests, and
  previous-staging-SHA-to-current upgrade;
- four Chromium and two `msedge`-project isolated journeys locally (Chrome executable fallback
  karena instalasi Edge system-wide di macOS memerlukan `sudo`); Ubuntu CI tetap memasang dan
  menjalankan Microsoft Edge asli;
- actionlint, ShellCheck, Hadolint, `bash -n`, Ubuntu 22.04 bootstrap check, env/Compose validation;
- Linux deployment harness with real `flock`: first deploy, preflight/build/migration/smoke
  failures, stale rejection, atomic env/pointers, rollback success/failure, and five-release
  retention;
- production-like seven-service stack, routing/headers/exact SHA/non-root/private DB/persistence;
- Gitleaks directory mode, pnpm audit, Trivy filesystem and all five runtime images, security
  exception validation, and `git diff --check`.

The local stack and agent-started containers were removed after validation.

## 7. External Blockers dan Next Action

No repository question is open. External work remains:

1. operator runs `bootstrap-vm.sh` through direct VM access;
2. DNS, verified SSH keyscan, and GitHub Environment `staging` secrets/variables are configured per
   `.agent/deploymentGuide.md`;
3. feature branch is squash-merged into `staging`;
4. first deploy, second release upgrade, close-candidate race, and controlled rollback rehearsal
   evidence are captured.

Only after that evidence may 15.9 and 15.11 become `done`. Phase 15 remains `in_progress`.
Production activation remains prohibited until separately authorized and provisioned.

## 8. Accepted Risks

- There is no backup, PITR, replica, disaster recovery, failover, RPO/RTO, or HA.
- VM/disk/volume loss can permanently remove database and member photos.
- Code rollback cannot restore schema or data.
- PostgreSQL password rotation requires a coordinated database role change; changing only the
  GitHub secret is not rotation.
