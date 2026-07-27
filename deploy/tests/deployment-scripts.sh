#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS="${REPOSITORY_ROOT}/deploy/scripts"
EXAMPLE_ENV="${REPOSITORY_ROOT}/deploy/env/runtime.staging.env.example"
COMPOSE_FILE="${REPOSITORY_ROOT}/deploy/compose/docker-compose.remote.yml"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

fail() {
  echo "deployment-scripts test failed: $*" >&2
  exit 1
}

for script in "${SCRIPTS}"/*.sh; do
  bash -n "${script}"
done

"${SCRIPTS}/validate-runtime-env.sh" "${EXAMPLE_ENV}" >/dev/null
config_json="$(docker compose --env-file "${EXAMPLE_ENV}" -f "${COMPOSE_FILE}" --profile operations config --format json)"
jq -e '
  (.services | keys | sort) == ["api","bootstrap-admin","caddy","migrate","postgres","supplier-web","tmmin-web"]
  and (.services.postgres.ports // [] | length) == 0
  and ([.services | to_entries[] | select(.key != "caddy") | (.value.ports // []) | length] | add) == 0
  and (.networks.data.internal == true)
' <<<"${config_json}" >/dev/null || fail "Compose topology or exposure policy drifted"

rendered_env="${TEST_ROOT}/rendered.env"
CADDY_EMAIL=operator@example.com \
POSTGRES_USER=supplier_henkaten \
POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef \
POSTGRES_DATABASE=supplier_henkaten \
SESSION_CSRF_SECRET=11111111111111111111111111111111 \
AUTH_THROTTLE_SECRET=22222222222222222222222222222222 \
TMMIN_BOOTSTRAP_USERNAME=bootstrap_admin \
TMMIN_BOOTSTRAP_DISPLAY_NAME="TMMIN Bootstrap Admin" \
TMMIN_BOOTSTRAP_PASSWORD=33333333333333333333333333333333 \
  "${SCRIPTS}/render-runtime-env.sh" staging aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 42 >"${rendered_env}"
chmod 600 "${rendered_env}"
"${SCRIPTS}/validate-runtime-env.sh" "${rendered_env}" >/dev/null
grep -Fxq 'DEPLOY_RUN_NUMBER=42' "${rendered_env}" || fail "rendered run number is missing"

invalid_env="${TEST_ROOT}/invalid.env"
# shellcheck disable=SC2016
sed 's/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=unsafe$password/' "${rendered_env}" >"${invalid_env}"
if "${SCRIPTS}/validate-runtime-env.sh" "${invalid_env}" >/dev/null 2>&1; then
  fail "unsafe dotenv password was accepted"
fi

migration_repo="${TEST_ROOT}/migration-policy"
mkdir -p "${migration_repo}/apps/api/prisma/migrations/0001_initial"
git -C "${migration_repo}" init --quiet
git -C "${migration_repo}" config user.name deployment-harness
git -C "${migration_repo}" config user.email deployment-harness@example.invalid
printf '%s\n' 'CREATE TABLE example (id integer PRIMARY KEY);' \
  >"${migration_repo}/apps/api/prisma/migrations/0001_initial/migration.sql"
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit --quiet -m initial
migration_base="$(git -C "${migration_repo}" rev-parse HEAD)"
mkdir -p "${migration_repo}/apps/api/prisma/migrations/0002_additive"
printf '%s\n' 'ALTER TABLE example ADD COLUMN label text;' \
  >"${migration_repo}/apps/api/prisma/migrations/0002_additive/migration.sql"
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit --quiet -m additive
(
  cd "${migration_repo}"
  "${SCRIPTS}/check-migrations.sh" "${migration_base}" >/dev/null
) || fail "additive migration was rejected"
printf '%s\n' 'ALTER TABLE example DROP CONSTRAINT example_pkey;' \
  >"${migration_repo}/apps/api/prisma/migrations/0002_additive/migration.sql"
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit --quiet -m destructive
if (
  cd "${migration_repo}"
  "${SCRIPTS}/check-migrations.sh" "${migration_base}" >/dev/null 2>&1
); then
  fail "destructive DROP migration was accepted"
fi

fake_bin="${TEST_ROOT}/bin"
mkdir -p "${fake_bin}"
cat >"${fake_bin}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "inspect" ]]; then
  echo healthy
  exit 0
fi
if [[ "${1:-}" == "logs" ]]; then
  exit 0
fi
if [[ "${1:-}" == "compose" ]]; then
  for argument in "$@"; do
    if [[ "${argument}" == "build" && "${TEST_BUILD_FAIL:-false}" == "true" ]]; then exit 1; fi
    if [[ "${argument}" == "migrate" && "${TEST_MIGRATE_FAIL:-false}" == "true" ]]; then exit 1; fi
  done
  previous=""
  for argument in "$@"; do
    if [[ "${previous}" == "-q" ]]; then
      echo "${argument}-container"
      exit 0
    fi
    previous="${argument}"
  done
  exit 0
fi
exit 0
EOF
chmod +x "${fake_bin}/docker"
if ! command -v flock >/dev/null 2>&1; then
  cat >"${fake_bin}/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "${fake_bin}/flock"
fi

prepare_base() {
  local base="$1"
  mkdir -p \
    "${base}/releases" \
    "${base}/incoming" \
    "${base}/shared/deployment-state" \
    "${base}/shared/postgres-data" \
    "${base}/shared/member-photos" \
    "${base}/shared/caddy-data" \
    "${base}/shared/caddy-config"
}

prepare_candidate() {
  local base="$1"
  local sha="$2"
  local run="$3"
  local smoke_exit="${4:-0}"
  local incoming="${base}/incoming/${sha}.${run}"
  mkdir -p "${incoming}/deploy/scripts"
  cp "${SCRIPTS}/lib.sh" "${incoming}/deploy/scripts/lib.sh"
  cat >"${incoming}/deploy/scripts/remote-preflight.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${TEST_PREFLIGHT_FAIL:-false}" != "true" ]]
EOF
  cat >"${incoming}/deploy/scripts/smoke-check.sh" <<EOF
#!/usr/bin/env bash
exit ${smoke_exit}
EOF
  chmod +x "${incoming}/deploy/scripts/"*.sh
  local runtime="${base}/incoming/${sha}.${run}.env"
  sed \
    -e "s/^RELEASE_SHA=.*/RELEASE_SHA=${sha}/" \
    -e "s/^DEPLOY_RUN_NUMBER=.*/DEPLOY_RUN_NUMBER=${run}/" \
    -e "s#^SHARED_DIR=.*#SHARED_DIR=${base}/shared#" \
    "${EXAMPLE_ENV}" >"${runtime}"
  chmod 600 "${runtime}"
  local archive="${base}/incoming/${sha}.${run}.tar.gz"
  printf 'release-%s\n' "${sha}" >"${archive}"
  local checksum
  checksum="$(sha256sum "${archive}" | awk '{print $1}')"
  printf '%s|%s|%s|%s\n' "${incoming}" "${runtime}" "${archive}" "${checksum}"
}

run_candidate() {
  local base="$1"
  local sha="$2"
  local run="$3"
  local smoke_exit="${4:-0}"
  local incoming runtime archive checksum
  IFS='|' read -r incoming runtime archive checksum < <(prepare_candidate "${base}" "${sha}" "${run}" "${smoke_exit}")
  PATH="${fake_bin}:${PATH}" "${SCRIPTS}/remote-deploy.sh" \
    staging "${sha}" "${run}" "${base}" "${incoming}" "${runtime}" \
    "${archive}" "${checksum}" 127.0.0.1
}

success_base="${TEST_ROOT}/success"
prepare_base "${success_base}"
for index in 1 2 3 4 5 6; do
  old_sha="$(printf '%040x' "${index}")"
  mkdir -p "${success_base}/releases/${old_sha}"
  touch -t "20260${index}010000" "${success_base}/releases/${old_sha}"
done
success_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
run_candidate "${success_base}" "${success_sha}" 10 >/dev/null
[[ "$(<"${success_base}/current_release")" == "${success_sha}" ]] || fail "successful release was not activated atomically"
[[ "$(readlink "${success_base}/current")" == "${success_base}/releases/${success_sha}" ]] || fail "current symlink was not activated"
[[ ! -e "${success_base}/current.tmp" ]] || fail "temporary current symlink remained after activation"
[[ ! -e "${success_base}/current_release.tmp" ]] || fail "temporary current pointer remained after activation"
grep -Fxq "RELEASE_SHA=${success_sha}" "${success_base}/releases/${success_sha}/.runtime.env" || fail "active runtime env does not match its release"
[[ "$(find "${success_base}/releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" == "5" ]] || fail "release retention did not keep five directories"
if stat -c '%a' "${success_base}/releases/${success_sha}/.runtime.env" >/dev/null 2>&1; then
  runtime_mode="$(stat -c '%a' "${success_base}/releases/${success_sha}/.runtime.env")"
else
  runtime_mode="$(stat -f '%Lp' "${success_base}/releases/${success_sha}/.runtime.env")"
fi
[[ "${runtime_mode}" == "600" ]] || fail "runtime env mode is not 0600"

stale_base="${TEST_ROOT}/stale"
prepare_base "${stale_base}"
printf '20\n' >"${stale_base}/shared/deployment-state/highest_seen_run"
IFS='|' read -r stale_incoming stale_runtime stale_archive stale_checksum < <(
  prepare_candidate "${stale_base}" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 19
)
if PATH="${fake_bin}:${PATH}" "${SCRIPTS}/remote-deploy.sh" \
  staging bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 19 "${stale_base}" \
  "${stale_incoming}" "${stale_runtime}" "${stale_archive}" \
  "${stale_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "stale deployment run was accepted"
fi

failure_base="${TEST_ROOT}/failure"
prepare_base "${failure_base}"
failure_sha=cccccccccccccccccccccccccccccccccccccccc
if DEPLOY_FORCE_SMOKE_FAILURE=true run_candidate "${failure_base}" "${failure_sha}" 30 >/dev/null 2>&1; then
  fail "forced smoke failure activated a release"
fi
[[ ! -f "${failure_base}/current_release" ]] || fail "failed first release changed current_release"
[[ -d "${failure_base}/shared/postgres-data" && -d "${failure_base}/shared/member-photos" ]] || fail "failed deploy removed persistent storage"

preflight_base="${TEST_ROOT}/preflight-failure"
prepare_base "${preflight_base}"
if TEST_PREFLIGHT_FAIL=true run_candidate "${preflight_base}" 1111111111111111111111111111111111111111 31 >/dev/null 2>&1; then
  fail "failed preflight returned success"
fi
[[ ! -f "${preflight_base}/current_release" ]] || fail "failed preflight changed current_release"
[[ ! -d "${preflight_base}/releases/1111111111111111111111111111111111111111" ]] || fail "failed preflight promoted its source"

build_base="${TEST_ROOT}/build-failure"
prepare_base "${build_base}"
if TEST_BUILD_FAIL=true run_candidate "${build_base}" 2222222222222222222222222222222222222222 32 >/dev/null 2>&1; then
  fail "failed image build returned success"
fi
[[ ! -f "${build_base}/current_release" ]] || fail "failed image build changed current_release"
[[ -d "${build_base}/shared/postgres-data" && -d "${build_base}/shared/member-photos" ]] || fail "failed image build removed persistent storage"

migration_base="${TEST_ROOT}/migration-failure"
prepare_base "${migration_base}"
if TEST_MIGRATE_FAIL=true run_candidate "${migration_base}" 3333333333333333333333333333333333333333 33 >/dev/null 2>&1; then
  fail "failed migration returned success"
fi
[[ ! -f "${migration_base}/current_release" ]] || fail "failed migration changed current_release"
[[ -d "${migration_base}/shared/postgres-data" && -d "${migration_base}/shared/member-photos" ]] || fail "failed migration removed persistent storage"

rollback_base="${TEST_ROOT}/rollback"
prepare_base "${rollback_base}"
previous_sha=dddddddddddddddddddddddddddddddddddddddd
mkdir -p "${rollback_base}/releases/${previous_sha}/deploy/scripts"
printf '%s\n' "${previous_sha}" >"${rollback_base}/current_release"
cat >"${rollback_base}/releases/${previous_sha}/deploy/scripts/remote-rollback.sh" <<EOF
#!/usr/bin/env bash
touch "${rollback_base}/rollback-called"
exit 0
EOF
chmod +x "${rollback_base}/releases/${previous_sha}/deploy/scripts/remote-rollback.sh"
if DEPLOY_FORCE_SMOKE_FAILURE=true run_candidate "${rollback_base}" eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee 40 >/dev/null 2>&1; then
  fail "failed candidate returned success after rollback"
fi
[[ -f "${rollback_base}/rollback-called" ]] || fail "automatic rollback was not invoked"
[[ "$(<"${rollback_base}/current_release")" == "${previous_sha}" ]] || fail "failed candidate changed the active pointer"

rollback_failure_base="${TEST_ROOT}/rollback-failure"
prepare_base "${rollback_failure_base}"
rollback_failure_previous=4444444444444444444444444444444444444444
mkdir -p "${rollback_failure_base}/releases/${rollback_failure_previous}/deploy/scripts"
printf '%s\n' "${rollback_failure_previous}" >"${rollback_failure_base}/current_release"
cat >"${rollback_failure_base}/releases/${rollback_failure_previous}/deploy/scripts/remote-rollback.sh" <<EOF
#!/usr/bin/env bash
touch "${rollback_failure_base}/rollback-failure-called"
exit 1
EOF
chmod +x "${rollback_failure_base}/releases/${rollback_failure_previous}/deploy/scripts/remote-rollback.sh"
if DEPLOY_FORCE_SMOKE_FAILURE=true run_candidate "${rollback_failure_base}" 5555555555555555555555555555555555555555 41 >/dev/null 2>&1; then
  fail "candidate returned success when automatic rollback failed"
fi
[[ -f "${rollback_failure_base}/rollback-failure-called" ]] || fail "failing automatic rollback was not invoked"
[[ "$(<"${rollback_failure_base}/current_release")" == "${rollback_failure_previous}" ]] || fail "rollback failure changed the previous pointer"

lock_base="${TEST_ROOT}/lock"
prepare_base "${lock_base}"
if command -v flock >/dev/null 2>&1; then
  flock "${lock_base}/deploy.lock" -c 'sleep 2' &
  lock_pid=$!
  sleep 0.2
  IFS='|' read -r lock_incoming lock_runtime lock_archive lock_checksum < <(
    prepare_candidate "${lock_base}" ffffffffffffffffffffffffffffffffffffffff 50
  )
  if PATH="${fake_bin}:${PATH}" "${SCRIPTS}/remote-deploy.sh" \
    staging ffffffffffffffffffffffffffffffffffffffff 50 "${lock_base}" \
    "${lock_incoming}" "${lock_runtime}" "${lock_archive}" \
    "${lock_checksum}" 127.0.0.1 >/dev/null 2>&1; then
    fail "deployment lock allowed concurrent execution"
  fi
  wait "${lock_pid}"
else
  echo "flock is unavailable locally; lock contention remains mandatory on Ubuntu CI."
fi

printf 'Deployment script, env, topology, first deploy, failure, lock, stale-run, rollback, atomic activation, and retention tests passed.\n'
