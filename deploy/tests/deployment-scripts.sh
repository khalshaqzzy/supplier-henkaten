#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS="${REPOSITORY_ROOT}/deploy/scripts"
EXAMPLE_ENV="${REPOSITORY_ROOT}/deploy/env/runtime.staging.env.example"
COMPOSE_FILE="${REPOSITORY_ROOT}/deploy/compose/docker-compose.remote.yml"
TEST_ROOT="$(mktemp -d /tmp/deployment-scripts.XXXXXX)"
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
  and (.services.api.environment.POSTGRES_PASSWORD == null)
  and (.services["bootstrap-admin"].environment.POSTGRES_PASSWORD == null)
  and (.services.api.environment.DATABASE_URL | startswith("postgresql://supplier_henkaten_app:replace_me_with_32_safe_characters_app@"))
  and (.services["bootstrap-admin"].environment.DATABASE_URL | startswith("postgresql://supplier_henkaten_app:replace_me_with_32_safe_characters_app@"))
  and (.services.migrate.environment.DATABASE_URL | startswith("postgresql://supplier_henkaten:replace_me_with_32_safe_characters@"))
  and (.services.migrate.environment.REQUIRE_APP_DB_ROLE == "true")
' <<<"${config_json}" >/dev/null || fail "Compose topology, exposure policy, or least-privilege DB isolation drifted"

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
PCR_OPENAI_BASE_URL=https://inference.example.invalid/v1 \
PCR_OPENAI_API_KEY=synthetic_gateway_key_for_test_only \
PCR_OPENAI_MODEL=inclusionAI/Ling-3.0-tiny-fp8 \
PCR_CONFIDENCE_THRESHOLD=0.75 \
PCR_INFERENCE_TIMEOUT_MS=90000 \
PCR_WORKER_ENABLED=true \
PCR_WORKER_POLL_MS=1000 \
  "${SCRIPTS}/render-runtime-env.sh" staging aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 42 >"${rendered_env}"
chmod 600 "${rendered_env}"
"${SCRIPTS}/validate-runtime-env.sh" "${rendered_env}" >/dev/null
grep -Fxq 'DEPLOY_RUN_NUMBER=42' "${rendered_env}" || fail "rendered run number is missing"
grep -Fxq 'PCR_OPENAI_API_KEY=synthetic_gateway_key_for_test_only' "${rendered_env}" || fail "PCR gateway key was not rendered"
grep -Fxq 'POSTGRES_APP_USER=supplier_henkaten_app' "${rendered_env}" || fail "derived POSTGRES_APP_USER is missing"
grep -Eq '^POSTGRES_APP_PASSWORD=[0-9a-f]{64}$' "${rendered_env}" || fail "derived POSTGRES_APP_PASSWORD is missing"
if grep -Fxq 'POSTGRES_APP_PASSWORD=0123456789abcdef0123456789abcdef' "${rendered_env}"; then
  fail "derived POSTGRES_APP_PASSWORD matched POSTGRES_PASSWORD"
fi

production_env="${TEST_ROOT}/production.env"
(
  set -a
  # shellcheck disable=SC1090
  source "${EXAMPLE_ENV}"
  set +a
  export PCR_OPENAI_BASE_URL=https://inference.example.invalid/v1
  export PCR_OPENAI_API_KEY=synthetic_gateway_key_for_test_only
  export PRODUCTION_SUPPLIER_DOMAIN=henkaten.qualitydivision.com
  export PRODUCTION_TMMIN_DOMAIN=admin-henkaten.qualitydivision.com
  export PRODUCTION_API_DOMAIN=henkaten-api.qualitydivision.com
  "${SCRIPTS}/render-runtime-env.sh" production bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 43 >"${production_env}"
)
chmod 600 "${production_env}"
"${SCRIPTS}/validate-runtime-env.sh" "${production_env}" >/dev/null
grep -Fxq 'COMPOSE_PROJECT_NAME=supplier-henkaten-production' "${production_env}" || fail "production Compose project drifted"
grep -Fxq 'SHARED_DIR=/opt/supplier-henkaten/production/shared' "${production_env}" || fail "production shared path drifted"
grep -Fxq 'SUPPLIER_DOMAIN=henkaten.qualitydivision.com' "${production_env}" || fail "production supplier domain drifted"
grep -Fxq 'TMMIN_DOMAIN=admin-henkaten.qualitydivision.com' "${production_env}" || fail "production admin domain drifted"
grep -Fxq 'API_DOMAIN=henkaten-api.qualitydivision.com' "${production_env}" || fail "production API domain drifted"

invalid_env="${TEST_ROOT}/invalid.env"
# shellcheck disable=SC2016
sed 's/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=unsafe$password/' "${rendered_env}" >"${invalid_env}"
if "${SCRIPTS}/validate-runtime-env.sh" "${invalid_env}" >/dev/null 2>&1; then
  fail "unsafe dotenv password was accepted"
fi

canary_file="${TEST_ROOT}/env-injection-canary"
for malicious_line in \
  "POSTGRES_PASSWORD=\$(touch ${canary_file})" \
  "POSTGRES_PASSWORD=\`touch ${canary_file}\`" \
  "TMMIN_BOOTSTRAP_DISPLAY_NAME=\"\$(touch ${canary_file})\"" \
  "PATH=/tmp/attacker" \
  "BASH_ENV=${canary_file}" \
  "UNKNOWN_CUSTOM_KEY=value"
do
  malicious_env="${TEST_ROOT}/malicious.env"
  cp "${rendered_env}" "${malicious_env}"
  printf '%s\n' "${malicious_line}" >>"${malicious_env}"
  if "${SCRIPTS}/validate-runtime-env.sh" "${malicious_env}" >/dev/null 2>&1; then
    fail "malicious dotenv line was accepted: ${malicious_line}"
  fi
  [[ ! -e "${canary_file}" ]] || fail "dotenv validation executed embedded shell command for: ${malicious_line}"
done

duplicate_env="${TEST_ROOT}/duplicate.env"
cp "${rendered_env}" "${duplicate_env}"
printf 'LOG_LEVEL=debug\n' >>"${duplicate_env}"
if "${SCRIPTS}/validate-runtime-env.sh" "${duplicate_env}" >/dev/null 2>&1; then
  fail "duplicate dotenv key was accepted"
fi

crlf_env="${TEST_ROOT}/crlf.env"
awk '{printf "%s\r\n", $0}' "${rendered_env}" >"${crlf_env}"
if "${SCRIPTS}/validate-runtime-env.sh" "${crlf_env}" >/dev/null 2>&1; then
  fail "CRLF dotenv file was accepted"
fi

same_app_password_env="${TEST_ROOT}/same-app-password.env"
sed 's/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=0123456789abcdef0123456789abcdef/' "${rendered_env}" >"${same_app_password_env}"
if "${SCRIPTS}/validate-runtime-env.sh" "${same_app_password_env}" >/dev/null 2>&1; then
  fail "identical POSTGRES_APP_PASSWORD and POSTGRES_PASSWORD were accepted"
fi

legacy_env="${TEST_ROOT}/legacy.env"
grep -Ev '^POSTGRES_APP_(USER|PASSWORD)=' "${rendered_env}" >"${legacy_env}"
if "${SCRIPTS}/validate-runtime-env.sh" "${legacy_env}" >/dev/null 2>&1; then
  fail "legacy env without POSTGRES_APP_* passed strict validation"
fi
"${SCRIPTS}/validate-runtime-env.sh" --allow-legacy-db-role "${legacy_env}" >/dev/null || fail "legacy env was rejected under --allow-legacy-db-role"

partial_app_env="${TEST_ROOT}/partial-app.env"
grep -Ev '^POSTGRES_APP_PASSWORD=' "${rendered_env}" >"${partial_app_env}"
if "${SCRIPTS}/validate-runtime-env.sh" --allow-legacy-db-role "${partial_app_env}" >/dev/null 2>&1; then
  fail "half-configured POSTGRES_APP_USER without POSTGRES_APP_PASSWORD was accepted"
fi

overlong_app_password="$(printf 'a%.0s' {1..129})"
max_app_password="$(printf 'b%.0s' {1..128})"
overlong_app_env="${TEST_ROOT}/overlong-app-password.env"
sed "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${overlong_app_password}/" "${rendered_env}" >"${overlong_app_env}"
if "${SCRIPTS}/validate-runtime-env.sh" "${overlong_app_env}" >/dev/null 2>&1; then
  fail "129-character POSTGRES_APP_PASSWORD passed validate-runtime-env.sh"
fi
max_app_env="${TEST_ROOT}/max-app-password.env"
sed "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${max_app_password}/" "${rendered_env}" >"${max_app_env}"
"${SCRIPTS}/validate-runtime-env.sh" "${max_app_env}" >/dev/null || fail "128-character POSTGRES_APP_PASSWORD was rejected"

if (
  set -a
  # shellcheck disable=SC1090
  source "${EXAMPLE_ENV}"
  set +a
  PCR_OPENAI_BASE_URL=https://inference.example.invalid/v1 \
  PCR_OPENAI_API_KEY=synthetic_gateway_key_for_test_only \
  POSTGRES_APP_PASSWORD="${overlong_app_password}" \
    "${SCRIPTS}/render-runtime-env.sh" staging cccccccccccccccccccccccccccccccccccccccc 43 >/dev/null 2>&1
); then
  fail "129-character POSTGRES_APP_PASSWORD passed render-runtime-env.sh"
fi

if (
  set -a
  # shellcheck disable=SC1090
  source "${EXAMPLE_ENV}"
  set +a
  PCR_OPENAI_BASE_URL=https://inference.example.invalid/v1 \
  PCR_OPENAI_API_KEY=synthetic_gateway_key_for_test_only \
  PRODUCTION_SUPPLIER_DOMAIN='-invalid..domain' \
  PRODUCTION_TMMIN_DOMAIN=admin-henkaten.qualitydivision.com \
  PRODUCTION_API_DOMAIN=henkaten-api.qualitydivision.com \
    "${SCRIPTS}/render-runtime-env.sh" production cccccccccccccccccccccccccccccccccccccccc 44 >/dev/null 2>&1
); then
  fail "invalid production domain was accepted"
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
printf '%s\n' \
  '-- migration-policy: allow-drop-index WorkingAssignment_one_active_effective_mp_key' \
  'DROP INDEX IF EXISTS "WorkingAssignment_one_active_effective_mp_key";' \
  >"${migration_repo}/apps/api/prisma/migrations/0002_additive/migration.sql"
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit --quiet -m allowed-index-removal
(
  cd "${migration_repo}"
  "${SCRIPTS}/check-migrations.sh" "${migration_base}" >/dev/null
) || fail "explicit exact-name DROP INDEX exception was rejected"
printf '%s\n' \
  '-- migration-policy: allow-drop-index Wrong_index' \
  'DROP INDEX IF EXISTS "WorkingAssignment_one_active_effective_mp_key";' \
  >"${migration_repo}/apps/api/prisma/migrations/0002_additive/migration.sql"
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit --quiet -m mismatched-index-removal
if (
  cd "${migration_repo}"
  "${SCRIPTS}/check-migrations.sh" "${migration_base}" >/dev/null 2>&1
); then
  fail "mismatched DROP INDEX exception was accepted"
fi
printf '%s\n' \
  '-- migration-policy: allow-drop-not-null Member.registrationNumber' \
  'ALTER TABLE "Member" ALTER COLUMN "registrationNumber" DROP NOT NULL;' \
  >"${migration_repo}/apps/api/prisma/migrations/0002_additive/migration.sql"
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit --quiet -m allowed-nullability-expansion
(
  cd "${migration_repo}"
  "${SCRIPTS}/check-migrations.sh" "${migration_base}" >/dev/null
) || fail "exact-name DROP NOT NULL exception was rejected"
printf '%s\n' \
  '-- migration-policy: allow-drop-not-null Member.wrongColumn' \
  'ALTER TABLE "Member" ALTER COLUMN "registrationNumber" DROP NOT NULL;' \
  >"${migration_repo}/apps/api/prisma/migrations/0002_additive/migration.sql"
git -C "${migration_repo}" add .
git -C "${migration_repo}" commit --quiet -m mismatched-nullability-expansion
if (
  cd "${migration_repo}"
  "${SCRIPTS}/check-migrations.sh" "${migration_base}" >/dev/null 2>&1
); then
  fail "mismatched DROP NOT NULL exception was accepted"
fi

fake_bin="${TEST_ROOT}/bin"
mkdir -p "${fake_bin}"
cat >"${fake_bin}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
set_image_tag() {
  local ref="$1"
  local id="$2"
  [[ -n "${TEST_IMAGE_STATE_FILE:-}" ]] || return 0
  local tmp="${TEST_IMAGE_STATE_FILE}.tmp"
  grep -Ev "^${ref} " "${TEST_IMAGE_STATE_FILE}" >"${tmp}" 2>/dev/null || true
  printf '%s %s\n' "${ref}" "${id}" >>"${tmp}"
  mv "${tmp}" "${TEST_IMAGE_STATE_FILE}"
}
get_image_tag() {
  local ref="$1"
  if [[ "${TEST_MISSING_IMAGE:-}" == "${ref}" ]]; then
    return 1
  fi
  if [[ "${ref}" == sha256:* ]]; then
    printf '%s\n' "${ref}"
    return 0
  fi
  if [[ -n "${TEST_IMAGE_STATE_FILE:-}" && -f "${TEST_IMAGE_STATE_FILE}" ]]; then
    awk -v target="${ref}" '$1 == target {print $2; exit}' "${TEST_IMAGE_STATE_FILE}"
    return 0
  fi
  printf 'sha256:existing-%s\n' "${ref}"
}
if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
  get_image_tag "${!#}"
  exit $?
fi
if [[ "${1:-}" == "tag" ]]; then
  if [[ "${TEST_TAG_FAIL:-false}" == "true" ]]; then
    exit 1
  fi
  if [[ "${TEST_TAG_SILENT_NOOP:-false}" == "true" ]]; then
    exit 0
  fi
  set_image_tag "$3" "$2"
  exit 0
fi
if [[ "${1:-}" == "inspect" ]]; then
  echo healthy
  exit 0
fi
if [[ "${1:-}" == "logs" ]]; then
  exit 0
fi
if [[ "${1:-}" == "compose" ]]; then
  if [[ -n "${TEST_DOCKER_LOG:-}" ]]; then
    printf '%s\n' "$*" >>"${TEST_DOCKER_LOG}"
  fi
  is_build=false
  is_up=false
  for argument in "$@"; do
    if [[ "${argument}" == "build" ]]; then is_build=true; fi
    if [[ "${argument}" == "up" ]]; then is_up=true; fi
    if [[ "${argument}" == "migrate" && "${TEST_MIGRATE_FAIL:-false}" == "true" ]]; then exit 1; fi
  done
  if [[ "${is_build}" == "true" ]]; then
    if [[ -n "${TEST_IMAGE_STATE_FILE:-}" ]]; then
      build_suffix="${TEST_BUILD_TAG_SUFFIX:-${DEPLOY_RUN_NUMBER:-0}}"
      set_image_tag "supplier-henkaten-postgres:18.4-pgvector-0.8.5" "sha256:candidate-postgres-${build_suffix}"
      if [[ -n "${RELEASE_SHA:-}" ]]; then
        for svc in api supplier-web tmmin-web caddy; do
          set_image_tag "supplier-henkaten-${svc}:${RELEASE_SHA}" "sha256:candidate-${svc}-${build_suffix}"
        done
      fi
    fi
    if [[ "${TEST_BUILD_FAIL:-false}" == "true" ]]; then exit 1; fi
  fi
  if [[ "${is_up}" == "true" && -n "${TEST_IMAGE_STATE_FILE:-}" && -n "${TEST_DOCKER_LOG:-}" ]]; then
    for argument in "$@"; do
      case "${argument}" in
        postgres)
          printf 'STARTED postgres=%s\n' "$(get_image_tag "supplier-henkaten-postgres:18.4-pgvector-0.8.5")" >>"${TEST_DOCKER_LOG}"
          ;;
        api | supplier-web | tmmin-web | caddy)
          printf 'STARTED %s=%s\n' "${argument}" "$(get_image_tag "supplier-henkaten-${argument}:${RELEASE_SHA:-}")" >>"${TEST_DOCKER_LOG}"
          ;;
      esac
    done
  fi
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
cat >"${fake_bin}/getent" <<'EOF'
#!/usr/bin/env bash
exit 2
EOF
chmod +x "${fake_bin}/getent"
if ! PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  [[ -z "$(resolve_addresses does-not-resolve.example.invalid)" ]]
' _ "${SCRIPTS}/lib.sh"; then
  fail "failed DNS lookup escaped the guarded resolver"
fi
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
  cp "${SCRIPTS}/remote-deploy.sh" "${incoming}/deploy/scripts/remote-deploy.sh"
  cp "${SCRIPTS}/validate-runtime-env.sh" "${incoming}/deploy/scripts/validate-runtime-env.sh"
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
  PATH="${fake_bin}:${PATH}" "${incoming}/deploy/scripts/remote-deploy.sh" \
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
[[ ! -f "${migration_base}/releases/3333333333333333333333333333333333333333/.activated" ]] || fail "failed migration created .activated marker"
[[ -d "${migration_base}/shared/postgres-data" && -d "${migration_base}/shared/member-photos" ]] || fail "failed migration removed persistent storage"

# Same-SHA retry after a failed candidate refreshes .runtime.env with the updated config.
retry_sha=3333333333333333333333333333333333333333
updated_app_password="$(printf 'c%.0s' {1..40})"
IFS='|' read -r retry_incoming retry_runtime retry_archive retry_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 34
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${retry_runtime}"
rm -f "${retry_runtime}.bak"
PATH="${fake_bin}:${PATH}" "${retry_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 34 "${migration_base}" "${retry_incoming}" "${retry_runtime}" \
  "${retry_archive}" "${retry_checksum}" 127.0.0.1 >/dev/null
[[ "$(<"${migration_base}/current_release")" == "${retry_sha}" ]] || fail "same-SHA retry after failure did not activate"
[[ -f "${migration_base}/releases/${retry_sha}/.activated" ]] || fail "activated release is missing .activated marker"
grep -Fxq "POSTGRES_APP_PASSWORD=${updated_app_password}" "${migration_base}/releases/${retry_sha}/.runtime.env" || fail "same-SHA retry after failure kept stale .runtime.env"

# Re-deploying an already-activated release with identical config (only run number incremented) succeeds.
IFS='|' read -r idempotent_incoming idempotent_runtime idempotent_archive idempotent_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 35
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${idempotent_runtime}"
rm -f "${idempotent_runtime}.bak"
PATH="${fake_bin}:${PATH}" "${idempotent_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 35 "${migration_base}" "${idempotent_incoming}" "${idempotent_runtime}" \
  "${idempotent_archive}" "${idempotent_checksum}" 127.0.0.1 >/dev/null

# Re-deploying an already-activated release with mutated secrets must fail explicitly and preserve the snapshot.
IFS='|' read -r mutated_incoming mutated_runtime mutated_archive mutated_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 36
)
if PATH="${fake_bin}:${PATH}" "${mutated_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 36 "${migration_base}" "${mutated_incoming}" "${mutated_runtime}" \
  "${mutated_archive}" "${mutated_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "same-SHA redeploy of an activated release with changed config was accepted"
fi
grep -Fxq "POSTGRES_APP_PASSWORD=${updated_app_password}" "${migration_base}/releases/${retry_sha}/.runtime.env" || fail "rejected same-SHA redeploy mutated activated rollback snapshot"

# Same-SHA build failure on an active release must NOT stop running services and must restore pre-build image tags.
same_sha_images="${TEST_ROOT}/same-sha-images.state"
cat >"${same_sha_images}" <<EOF
supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:good-postgres
supplier-henkaten-api:${retry_sha} sha256:good-api
supplier-henkaten-supplier-web:${retry_sha} sha256:good-supplier-web
supplier-henkaten-tmmin-web:${retry_sha} sha256:good-tmmin-web
supplier-henkaten-caddy:${retry_sha} sha256:good-caddy
EOF
cp "${same_sha_images}" "${migration_base}/releases/${retry_sha}/.activated-images"
chmod 600 "${migration_base}/releases/${retry_sha}/.activated-images"
same_sha_docker_log="${TEST_ROOT}/same-sha-build-fail.log"
IFS='|' read -r buildfail_incoming buildfail_runtime buildfail_archive buildfail_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 37
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${buildfail_runtime}"
rm -f "${buildfail_runtime}.bak"
if TEST_BUILD_FAIL=true TEST_DOCKER_LOG="${same_sha_docker_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${buildfail_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 37 "${migration_base}" "${buildfail_incoming}" "${buildfail_runtime}" \
  "${buildfail_archive}" "${buildfail_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "same-SHA build failure unexpectedly succeeded"
fi
if grep -q ' stop ' "${same_sha_docker_log}"; then
  fail "same-SHA build failure stopped running active services"
fi
grep -Fxq "supplier-henkaten-api:${retry_sha} sha256:good-api" "${same_sha_images}" || fail "same-SHA partial build failure did not restore pre-build api image tag"
grep -Fxq "supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:good-postgres" "${same_sha_images}" || fail "same-SHA partial build failure did not restore pre-build postgres image tag"
[[ "$(<"${migration_base}/current_release")" == "${retry_sha}" ]] || fail "same-SHA build failure altered current_release"

# Same-SHA post-mutation failure runs the real remote-rollback.sh and restarts the restored pre-build image IDs.
cp "${SCRIPTS}/remote-rollback.sh" "${migration_base}/releases/${retry_sha}/deploy/scripts/remote-rollback.sh"
chmod +x "${migration_base}/releases/${retry_sha}/deploy/scripts/remote-rollback.sh"
same_sha_smoke_log="${TEST_ROOT}/same-sha-smoke-fail.log"
IFS='|' read -r smokefail_incoming smokefail_runtime smokefail_archive smokefail_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 38
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${smokefail_runtime}"
rm -f "${smokefail_runtime}.bak"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_DOCKER_LOG="${same_sha_smoke_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${smokefail_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 38 "${migration_base}" "${smokefail_incoming}" "${smokefail_runtime}" \
  "${smokefail_archive}" "${smokefail_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "same-SHA forced smoke failure unexpectedly succeeded"
fi
if grep -q ' stop ' "${same_sha_smoke_log}"; then
  fail "same-SHA post-mutation failure stopped application services instead of recovering"
fi
grep -Fxq 'STARTED postgres=sha256:good-postgres' "${same_sha_smoke_log}" || fail "same-SHA rollback did not restart pre-build postgres image"
grep -Fxq 'STARTED api=sha256:good-api' "${same_sha_smoke_log}" || fail "same-SHA rollback did not restart pre-build api image"
grep -Fxq 'STARTED supplier-web=sha256:good-supplier-web' "${same_sha_smoke_log}" || fail "same-SHA rollback did not restart pre-build supplier-web image"
grep -Fxq 'STARTED tmmin-web=sha256:good-tmmin-web' "${same_sha_smoke_log}" || fail "same-SHA rollback did not restart pre-build tmmin-web image"
grep -Fxq 'STARTED caddy=sha256:good-caddy' "${same_sha_smoke_log}" || fail "same-SHA rollback did not restart pre-build caddy image"

# Missing pre-build image on same-SHA active redeploy must abort BEFORE building.
missing_img_log="${TEST_ROOT}/same-sha-missing-image.log"
IFS='|' read -r missing_incoming missing_runtime missing_archive missing_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 39
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${missing_runtime}"
rm -f "${missing_runtime}.bak"
if TEST_MISSING_IMAGE="sha256:good-api" TEST_DOCKER_LOG="${missing_img_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${missing_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 39 "${migration_base}" "${missing_incoming}" "${missing_runtime}" \
  "${missing_archive}" "${missing_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "same-SHA active redeploy succeeded with missing pre-build image snapshot"
fi
if [[ -f "${missing_img_log}" ]] && grep -q ' build ' "${missing_img_log}"; then
  fail "same-SHA active redeploy ran docker compose build despite missing image snapshot"
fi

# Failed image tag restoration must refuse rollback, stop failed candidate, and durably mark .rollback-unsafe.
tag_fail_log="${TEST_ROOT}/same-sha-tag-fail.log"
IFS='|' read -r tagfail_incoming tagfail_runtime tagfail_archive tagfail_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 40
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${tagfail_runtime}"
rm -f "${tagfail_runtime}.bak"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_TAG_FAIL=true TEST_BUILD_TAG_SUFFIX=40 TEST_DOCKER_LOG="${tag_fail_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${tagfail_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 40 "${migration_base}" "${tagfail_incoming}" "${tagfail_runtime}" \
  "${tagfail_archive}" "${tagfail_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "same-SHA smoke failure with failed tag restore unexpectedly succeeded"
fi
grep -q ' stop ' "${tag_fail_log}" || fail "failed image tag restore did not stop failed candidate services"
[[ "$(grep -c '^STARTED api=' "${tag_fail_log}")" == "1" ]] || fail "failed image tag restore invoked rollback and restarted the broken candidate api image"
[[ -f "${migration_base}/releases/${retry_sha}/.rollback-unsafe" ]] || fail "failed image tag restore did not write .rollback-unsafe marker"
# At this point same_sha_images STILL holds the rejected candidate-*-40 tags!
grep -Fxq "supplier-henkaten-api:${retry_sha} sha256:candidate-api-40" "${same_sha_images}" || fail "expected dirty rejected candidate tag to remain after failed restore"

# Manual rollback while tag restoration still fails must refuse to start the rejected candidate build.
manual_rb_fail_log="${TEST_ROOT}/manual-rollback-tag-fail.log"
if TEST_TAG_FAIL=true TEST_DOCKER_LOG="${manual_rb_fail_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${migration_base}/releases/${retry_sha}/deploy/scripts/remote-rollback.sh" \
  staging "${retry_sha}" "${migration_base}" >/dev/null 2>&1; then
  fail "manual rollback succeeded despite failed pinned image restoration"
fi
if [[ -f "${manual_rb_fail_log}" ]] && grep -q '^STARTED ' "${manual_rb_fail_log}"; then
  fail "manual rollback started rejected candidate images after failed pinned restoration"
fi

# Carrying dirty candidate-*-40 tags into a SECOND same-SHA deploy (run 41) that also fails must restore the pinned sha256:good-* images, NEVER candidate-*-40.
carryover_log="${TEST_ROOT}/same-sha-carryover-41.log"
IFS='|' read -r carry_incoming carry_runtime carry_archive carry_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 41
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${carry_runtime}"
rm -f "${carry_runtime}.bak"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_BUILD_TAG_SUFFIX=41 TEST_DOCKER_LOG="${carryover_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${carry_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 41 "${migration_base}" "${carry_incoming}" "${carry_runtime}" \
  "${carry_archive}" "${carry_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "second same-SHA smoke failure unexpectedly succeeded"
fi
grep -Fxq 'STARTED api=sha256:good-api' "${carryover_log}" || fail "second same-SHA invocation did not restore pinned sha256:good-api image"
if grep -q 'STARTED api=sha256:candidate-api-40' "${carryover_log}"; then
  fail "second same-SHA invocation promoted rejected candidate-api-40 build into rollback"
fi
[[ ! -f "${migration_base}/releases/${retry_sha}/.rollback-unsafe" ]] || fail "successful pinned rollback recovery did not clear .rollback-unsafe"

# Restored-ID mismatch branch: docker tag exits 0 without updating the tag -> inspect mismatch must refuse rollback.
mismatch_log="${TEST_ROOT}/same-sha-tag-mismatch.log"
IFS='|' read -r mismatch_incoming mismatch_runtime mismatch_archive mismatch_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 42
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${mismatch_runtime}"
rm -f "${mismatch_runtime}.bak"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_TAG_SILENT_NOOP=true TEST_BUILD_TAG_SUFFIX=42 TEST_DOCKER_LOG="${mismatch_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${mismatch_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 42 "${migration_base}" "${mismatch_incoming}" "${mismatch_runtime}" \
  "${mismatch_archive}" "${mismatch_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "same-SHA smoke failure with silent tag mismatch unexpectedly succeeded"
fi
grep -q ' stop ' "${mismatch_log}" || fail "restored-ID mismatch did not stop failed candidate services"
[[ "$(grep -c '^STARTED api=' "${mismatch_log}")" == "1" ]] || fail "restored-ID mismatch invoked rollback with unverified candidate image"
[[ -f "${migration_base}/releases/${retry_sha}/.rollback-unsafe" ]] || fail "restored-ID mismatch did not write .rollback-unsafe marker"

# Legacy release marked .rollback-unsafe without .activated-images must block manual rollback.
rm -f "${migration_base}/releases/${retry_sha}/.activated-images"
legacy_unsafe_log="${TEST_ROOT}/legacy-rollback-unsafe.log"
if TEST_DOCKER_LOG="${legacy_unsafe_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${migration_base}/releases/${retry_sha}/deploy/scripts/remote-rollback.sh" \
  staging "${retry_sha}" "${migration_base}" >/dev/null 2>&1; then
  fail "manual rollback succeeded on a rollback-unsafe release lacking .activated-images"
fi
if [[ -f "${legacy_unsafe_log}" ]] && grep -q '^STARTED ' "${legacy_unsafe_log}"; then
  fail "manual rollback started containers for a rollback-unsafe release lacking .activated-images"
fi

rollback_base="${TEST_ROOT}/rollback"
prepare_base "${rollback_base}"
previous_sha=dddddddddddddddddddddddddddddddddddddddd
mkdir -p "${rollback_base}/releases/${previous_sha}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${previous_sha}/" "${legacy_env}" >"${rollback_base}/releases/${previous_sha}/.runtime.env"
printf '%s\n' "${previous_sha}" >"${rollback_base}/releases/${previous_sha}/.source.sha"
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
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${rollback_failure_previous}/" "${rendered_env}" >"${rollback_failure_base}/releases/${rollback_failure_previous}/.runtime.env"
printf '%s\n' "${rollback_failure_previous}" >"${rollback_failure_base}/releases/${rollback_failure_previous}/.source.sha"
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
