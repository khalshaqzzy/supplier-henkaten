# Session Handoff — Staging CI Dependency Remediation

Tanggal: 2026-08-04

Branch: `staging`

Status: failed staging CI root cause telah diperbaiki dan local parity **done**. Phase 15.9 tetap
`in_progress` sampai push ini melewati release gate dan automatic staging deployment pada GitHub.

## 1. Objective dan Outcome

Objective sesi ini adalah memperbaiki failure pada run Staging CI `30891976462` untuk SHA
`622cc8f212f728c8defe494f02fc5d4c7c40ee70` tanpa melemahkan scanner atau menambah security
exception.

Root cause:

- Trivy filesystem menemukan `fast-uri 3.1.4` / CVE-2026-18446 (High), fixed di `3.1.5`;
- `pnpm audit --audit-level high` juga menemukan `undici 7.28.0` dan `brace-expansion 5.0.8`
  pada rentang rentan yang memiliki patch tersedia;
- release candidate gate gagal sebagai konsekuensi dari job `Production containers and routing`
  dan `Dependency security` tersebut; quality, migrations, integration, E2E, CodeQL, dan Gitleaks
  pada run yang sama telah lulus.

Outcome:

- root pnpm overrides sekarang memaksa `fast-uri 3.1.5`, `undici 7.29.0`, dan
  `brace-expansion 5.0.9` untuk seluruh dependency graph;
- lockfile tersinkron dan tetap lolos supply-chain policy;
- tidak ada `.trivyignore`, audit ignore, atau security-exception baru;
- clean-worktree Trivy filesystem dan kelima production image melaporkan zero High/Critical;
- auth, API, database schema, migration, OpenAPI, routing, dan application behavior tidak berubah.

## 2. Files Changed

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.agent/implementationPhases.md`
- `.agent/sessionHandoff.md`
- `docs/adr/0008-single-vm-environment-and-release-constraints.md`

## 3. Decisions

- Advisory yang memiliki patched release diselesaikan melalui root pnpm override dan lockfile,
  bukan melalui ignore atau exception.
- Selector override dibatasi ke vulnerable range agar dependency yang kelak sudah memilih versi
  lebih baru tidak diturunkan.
- Existing exact exception registry dipertahankan tanpa perubahan; `pnpm audit` masih melaporkan
  satu High yang sudah di-ignore secara formal dan dua Moderate, tetapi command gate exit 0.
- Tiga local full-stack container yang telah berjalan sebelum sesi tidak dihentikan atau dimutasi.

## 4. QA Commands dan Results

Runtime parity menggunakan Node.js `22.23.1` dan pnpm `11.16.0`.

Semua gate berikut lulus:

- clean-artifact `pnpm clean`, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test:unit`, `pnpm openapi:check`, dan production `pnpm build`;
- `pnpm security:audit`: exit 0; 2 Moderate dan 1 formally ignored High tersisa;
- `pnpm migrations:destructive-check 622cc8f...`: no migration SQL changed;
- `pnpm deployment:validate`, `pnpm test:deployment`, dan
  `pnpm security:exceptions:check`;
- disposable PostgreSQL 18.4 + pgvector verification, fresh nine-migration apply, previous-SHA to
  current upgrade, dan migration status;
- `pnpm test:integration`: 33/33;
- `pnpm test:e2e`: seluruh Chromium dan Microsoft Edge journeys lulus;
- pinned actionlint 1.7.7, ShellCheck 0.11.0, Hadolint 2.14.0, `bash -n`, dan Ubuntu 22.04
  bootstrap input check;
- production-like Compose build/start, idempotent bootstrap, three-domain routing, release
  identity, security headers, non-root/private-database assertions, dan persistence restart;
- Trivy 0.70.0 clean-worktree filesystem: lockfile 0 High/Critical, no secret/misconfiguration;
- Trivy 0.70.0 kelima production images: 0 High/Critical;
- Gitleaks 8.24.3 clean-worktree directory scan: no leaks;
- `git diff --check`.

Playwright browser install helper meminta host sudo untuk Edge, sehingga tidak digunakan; existing
pinned browser binaries tersedia dan full E2E tetap lulus. Vite large-chunk dan PostgreSQL pg@9
deprecation warnings tetap existing, non-blocking, dan tidak terkait perubahan ini.

## 5. Cleanup dan Residual Risk

- Disposable integration/E2E/production-like containers, volumes, networks, staging bind mounts,
  Trivy cache, dan temporary clean worktree sudah dibersihkan.
- Existing ignored `.local/.ssh/supplier-henkaten-staging-ci` terdeteksi hanya ketika scan pertama
  dijalankan pada working directory; file tersebut tidak dibaca, dimutasi, atau di-ignore. Rerun
  dari clean Git worktree setara CI tidak memuat file lokal tersebut dan lulus.
- Existing Supplier/TMMIN/API local containers tetap berjalan seperti sebelum sesi.
- Risiko tersisa adalah validasi hosted run dan deployment staging; local parity tidak menggantikan
  GitHub runner maupun VM evidence.

## 6. Next Action

Commit sebagai `fix: patch vulnerable transitive dependencies`, jalankan Gitleaks commit scan,
push ke `origin/staging`, lalu inspect run baru sampai seluruh required job green sesuai repository
rules. PR staging-to-main tetap tidak boleh dipromosikan sebelum staging CI/deployment berhasil.
