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
  if [[ -n "${TEST_DOCKER_LOG:-}" ]]; then
    printf 'TAG %s %s\n' "$2" "$3" >>"${TEST_DOCKER_LOG}"
  fi
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
  container_name="${!#}"
  container_base="${container_name%-container}"
  svc_name="${container_base%%--*}"
  container_sha="${RELEASE_SHA:-}"
  if [[ "${container_base}" == *--* ]]; then
    container_sha="${container_base#*--}"
  fi
  if [[ "${svc_name}" == "postgres" ]]; then
    default_ref="supplier-henkaten-postgres:18.4-pgvector-0.8.5"
  else
    default_ref="supplier-henkaten-${svc_name}:${container_sha}"
  fi
  if [[ "${3:-}" == "{{.Image}}" ]]; then
    if [[ -n "${TEST_RUNNING_IMAGES_FILE:-}" && -f "${TEST_RUNNING_IMAGES_FILE}" ]]; then
      awk -v target="${svc_name}" '$1 == target {print $2; exit}' "${TEST_RUNNING_IMAGES_FILE}"
      exit 0
    fi
    get_image_tag "${default_ref}"
    exit $?
  fi
  if [[ "${3:-}" == "{{.Created}}" ]]; then
    created_at=""
    if [[ -n "${TEST_RUNNING_IMAGES_FILE:-}" && -f "${TEST_RUNNING_IMAGES_FILE}" ]]; then
      created_at="$(awk -v target="${svc_name}" '$1 == target {print $4; exit}' "${TEST_RUNNING_IMAGES_FILE}")"
    fi
    if [[ "${created_at}" == "EMPTY" ]]; then
      echo ""
      exit 0
    fi
    printf '%s\n' "${created_at:-2020-01-01T00:00:00.000000000Z}"
    exit 0
  fi
  if [[ "${3:-}" == "{{.Config.Image}}" ]]; then
    config_ref=""
    if [[ -n "${TEST_RUNNING_IMAGES_FILE:-}" && -f "${TEST_RUNNING_IMAGES_FILE}" ]]; then
      config_ref="$(awk -v target="${svc_name}" '$1 == target {print $3; exit}' "${TEST_RUNNING_IMAGES_FILE}")"
    fi
    printf '%s\n' "${config_ref:-${default_ref}}"
    exit 0
  fi
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
  for argument in "$@"; do
    if [[ "${argument}" == "exec" ]]; then
      # Stable PostgreSQL cluster identity for rehearse-staging.sh's pg_control_system() probe.
      echo 7000000000000000001
      exit 0
    fi
  done
  is_build=false
  is_up=false
  for argument in "$@"; do
    if [[ "${argument}" == "build" ]]; then is_build=true; fi
    if [[ "${argument}" == "up" ]]; then is_up=true; fi
    if [[ "${argument}" == "migrate" && "${TEST_MIGRATE_FAIL:-false}" == "true" ]]; then exit 1; fi
  done
  if [[ "${is_build}" == "true" ]]; then
    if [[ -n "${TEST_BUILD_REMOVE_PATH:-}" ]]; then
      rm -f -- "${TEST_BUILD_REMOVE_PATH}"
    fi
    if [[ -n "${TEST_BUILD_ASSERT_EXISTS:-}" && ! -f "${TEST_BUILD_ASSERT_EXISTS}" ]]; then
      printf 'BUILD_PRECONDITION_MISSING %s\n' "${TEST_BUILD_ASSERT_EXISTS}" >>"${TEST_DOCKER_LOG:-/dev/null}"
    fi
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
  if [[ "${is_up}" == "true" && -n "${TEST_IMAGE_STATE_FILE:-}" ]]; then
    for argument in "$@"; do
      case "${argument}" in
        postgres)
          started_id="$(get_image_tag "supplier-henkaten-postgres:18.4-pgvector-0.8.5")"
          if [[ -n "${TEST_DOCKER_LOG:-}" ]]; then
            printf 'STARTED postgres=%s\n' "${started_id}" >>"${TEST_DOCKER_LOG}"
          fi
          if [[ -n "${TEST_RUNNING_IMAGES_FILE:-}" ]]; then
            tmp_run="${TEST_RUNNING_IMAGES_FILE}.tmp"
            grep -Ev '^postgres ' "${TEST_RUNNING_IMAGES_FILE}" >"${tmp_run}" 2>/dev/null || true
            printf 'postgres %s supplier-henkaten-postgres:18.4-pgvector-0.8.5 %s\n' "${started_id}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"${tmp_run}"
            mv "${tmp_run}" "${TEST_RUNNING_IMAGES_FILE}"
          fi
          ;;
        api | supplier-web | tmmin-web | caddy)
          started_id="$(get_image_tag "supplier-henkaten-${argument}:${RELEASE_SHA:-}")"
          if [[ -n "${TEST_DOCKER_LOG:-}" ]]; then
            printf 'STARTED %s=%s\n' "${argument}" "${started_id}" >>"${TEST_DOCKER_LOG}"
          fi
          if [[ -n "${TEST_RUNNING_IMAGES_FILE:-}" ]]; then
            tmp_run="${TEST_RUNNING_IMAGES_FILE}.tmp"
            grep -Ev "^${argument} " "${TEST_RUNNING_IMAGES_FILE}" >"${tmp_run}" 2>/dev/null || true
            printf '%s %s supplier-henkaten-%s:%s %s\n' "${argument}" "${started_id}" "${argument}" "${RELEASE_SHA:-}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"${tmp_run}"
            mv "${tmp_run}" "${TEST_RUNNING_IMAGES_FILE}"
          fi
          ;;
      esac
    done
  fi
  previous=""
  compose_env_file=""
  for argument in "$@"; do
    if [[ "${previous}" == "--env-file" ]]; then
      compose_env_file="${argument}"
    fi
    if [[ "${previous}" == "-q" ]]; then
      ps_sha="$(awk -F= '$1 == "RELEASE_SHA" {print $2; exit}' "${compose_env_file}" 2>/dev/null || true)"
      echo "${argument}--${ps_sha}-container"
      if [[ "${TEST_PS_DUPLICATE_SERVICE:-}" == "${argument}" ]]; then
        echo "${argument}--duplicate-container"
      fi
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
  cp "${SCRIPTS}/remote-rollback.sh" "${incoming}/deploy/scripts/remote-rollback.sh"
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
first_api_tag="$(grep " supplier-henkaten-api:${retry_sha}\$" "${carryover_log}" | head -n 1)"
[[ "${first_api_tag}" == "TAG sha256:good-api supplier-henkaten-api:${retry_sha}" ]] || fail "first api restore on carry-over run did not target sha256:good-api (got: ${first_api_tag})"
if grep -q 'STARTED api=sha256:candidate-api-40' "${carryover_log}"; then
  fail "second same-SHA invocation promoted rejected candidate-api-40 build into rollback"
fi
[[ ! -f "${migration_base}/releases/${retry_sha}/.rollback-unsafe" ]] || fail "successful pinned rollback recovery did not clear .rollback-unsafe"

# Incomplete .activated-images manifest (only postgres pin) must be rejected by manual remote-rollback.sh.
cp "${migration_base}/releases/${retry_sha}/.activated-images" "${TEST_ROOT}/saved-activated-images"
head -n 1 "${TEST_ROOT}/saved-activated-images" >"${migration_base}/releases/${retry_sha}/.activated-images"
incomplete_pin_log="${TEST_ROOT}/incomplete-pin-rollback.log"
if TEST_DOCKER_LOG="${incomplete_pin_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${migration_base}/releases/${retry_sha}/deploy/scripts/remote-rollback.sh" \
  staging "${retry_sha}" "${migration_base}" >/dev/null 2>&1; then
  fail "manual rollback accepted an incomplete .activated-images manifest"
fi
if [[ -f "${incomplete_pin_log}" ]] && grep -q '^STARTED ' "${incomplete_pin_log}"; then
  fail "manual rollback started containers from an incomplete .activated-images manifest"
fi
cp "${TEST_ROOT}/saved-activated-images" "${migration_base}/releases/${retry_sha}/.activated-images"
rm -f "${migration_base}/releases/${retry_sha}/.rollback-unsafe"

# Never-activated failed hardened candidate directory must be rejected by manual remote-rollback.sh (even if .activated-images exists).
unactivated_sha=7777777777777777777777777777777777777777
if TEST_MIGRATE_FAIL=true TEST_IMAGE_STATE_FILE="${same_sha_images}" run_candidate "${migration_base}" "${unactivated_sha}" 43 >/dev/null 2>&1; then
  fail "failing unactivated candidate unexpectedly succeeded"
fi
cp "${SCRIPTS}/remote-rollback.sh" "${migration_base}/releases/${unactivated_sha}/deploy/scripts/remote-rollback.sh"
chmod +x "${migration_base}/releases/${unactivated_sha}/deploy/scripts/remote-rollback.sh"
unactivated_rb_log="${TEST_ROOT}/unactivated-rollback.log"
if TEST_DOCKER_LOG="${unactivated_rb_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${migration_base}/releases/${unactivated_sha}/deploy/scripts/remote-rollback.sh" \
  staging "${unactivated_sha}" "${migration_base}" >/dev/null 2>&1; then
  fail "manual rollback accepted a never-activated candidate release"
fi
# Even if a complete 5-image .activated-images exists without .activated (crash between steps), manual rollback must reject it.
cat >"${migration_base}/releases/${unactivated_sha}/.activated-images" <<EOF
supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:good-postgres
supplier-henkaten-api:${unactivated_sha} sha256:good-api
supplier-henkaten-supplier-web:${unactivated_sha} sha256:good-supplier-web
supplier-henkaten-tmmin-web:${unactivated_sha} sha256:good-tmmin-web
supplier-henkaten-caddy:${unactivated_sha} sha256:good-caddy
EOF
if TEST_DOCKER_LOG="${unactivated_rb_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${migration_base}/releases/${unactivated_sha}/deploy/scripts/remote-rollback.sh" \
  staging "${unactivated_sha}" "${migration_base}" >/dev/null 2>&1; then
  fail "manual rollback accepted a never-activated candidate release carrying .activated-images without .activated"
fi
if [[ -f "${unactivated_rb_log}" ]] && grep -Eq '^(STARTED|TAG) ' "${unactivated_rb_log}"; then
  fail "manual rollback tagged or started containers for a never-activated candidate release"
fi

# write_activated_images must fail cleanly under conditional (errexit suppressed) when unwritable or destination is a directory, preserving .rollback-unsafe.
unwritable_dir="${TEST_ROOT}/unwritable-release"
mkdir -p "${unwritable_dir}"
printf 'dirty\n' >"${unwritable_dir}/.rollback-unsafe"
chmod 500 "${unwritable_dir}"
if PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  if write_activated_images "$2" "$3"; then
    exit 0
  fi
  exit 1
' _ "${SCRIPTS}/lib.sh" "${unwritable_dir}" "${retry_sha}" >/dev/null 2>&1; then
  chmod 700 "${unwritable_dir}"
  fail "write_activated_images succeeded under conditional on an unwritable release directory"
fi
chmod 700 "${unwritable_dir}"
[[ -f "${unwritable_dir}/.rollback-unsafe" ]] || fail "failed write_activated_images removed .rollback-unsafe marker"

dir_dest_release="${TEST_ROOT}/dir-dest-release"
mkdir -p "${dir_dest_release}/.activated-images"
printf 'dirty\n' >"${dir_dest_release}/.rollback-unsafe"
if PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  if write_activated_images "$2" "$3"; then
    exit 0
  fi
  exit 1
' _ "${SCRIPTS}/lib.sh" "${dir_dest_release}" "${retry_sha}" >/dev/null 2>&1; then
  fail "write_activated_images succeeded when .activated-images was a directory"
fi
[[ -f "${dir_dest_release}/.rollback-unsafe" ]] || fail "directory-destination failure removed .rollback-unsafe marker"
[[ ! -e "${dir_dest_release}/.activated-images/.activated-images.tmp" ]] || fail "mv placed temp file inside .activated-images directory"

# If .rollback-unsafe is a directory, write_activated_images must fail AND preserve the existing .activated-images manifest untouched.
unsafe_dir_release="${TEST_ROOT}/unsafe-dir-release"
mkdir -p "${unsafe_dir_release}/.rollback-unsafe"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${retry_sha}/" "${rendered_env}" >"${unsafe_dir_release}/.runtime.env"
printf 'supplier-henkaten-api:%s sha256:original-pinned-api\n' "${retry_sha}" >"${unsafe_dir_release}/.activated-images"
if COMPOSE_PROJECT_NAME=supplier-henkaten-staging PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  if write_activated_images "$2" "$3" "$2/.runtime.env"; then
    exit 0
  fi
  exit 1
' _ "${SCRIPTS}/lib.sh" "${unsafe_dir_release}" "${retry_sha}" >/dev/null 2>&1; then
  fail "write_activated_images succeeded when .rollback-unsafe was a directory"
fi
grep -Fxq "supplier-henkaten-api:${retry_sha} sha256:original-pinned-api" "${unsafe_dir_release}/.activated-images" || fail "failed write_activated_images overwrote previous .activated-images manifest"

# Pre-existing .activated-images.prev directory must NOT break write_activated_images (uses mktemp), AND post-rename rm failure must restore the previous manifest.
prev_dir_release="${TEST_ROOT}/prev-dir-release"
mkdir -p "${prev_dir_release}/.activated-images.prev"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${retry_sha}/" "${rendered_env}" >"${prev_dir_release}/.runtime.env"
printf 'supplier-henkaten-api:%s sha256:prior-pinned-api\n' "${retry_sha}" >"${prev_dir_release}/.activated-images"
if ! COMPOSE_PROJECT_NAME=supplier-henkaten-staging RELEASE_SHA="${retry_sha}" PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  write_activated_images "$2" "$3" "$2/.runtime.env"
' _ "${SCRIPTS}/lib.sh" "${prev_dir_release}" "${retry_sha}" >/dev/null 2>&1; then
  fail "write_activated_images failed due to pre-existing .activated-images.prev directory"
fi
post_rename_release="${TEST_ROOT}/post-rename-restore-release"
mkdir -p "${post_rename_release}"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${retry_sha}/" "${rendered_env}" >"${post_rename_release}/.runtime.env"
printf 'supplier-henkaten-api:%s sha256:preserved-before-post-rename-fail\n' "${retry_sha}" >"${post_rename_release}/.activated-images"
printf 'unsafe\n' >"${post_rename_release}/.rollback-unsafe"
fail_rm_bin="${TEST_ROOT}/fail-rm-bin"
mkdir -p "${fail_rm_bin}"
cat >"${fail_rm_bin}/rm" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "${arg}" == *"/.rollback-unsafe" ]]; then
    exit 1
  fi
done
exec /bin/rm "$@"
EOF
chmod +x "${fail_rm_bin}/rm"
if COMPOSE_PROJECT_NAME=supplier-henkaten-staging RELEASE_SHA="${retry_sha}" PATH="${fail_rm_bin}:${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  if write_activated_images "$2" "$3" "$2/.runtime.env"; then
    exit 0
  fi
  exit 1
' _ "${SCRIPTS}/lib.sh" "${post_rename_release}" "${retry_sha}" >/dev/null 2>&1; then
  fail "write_activated_images succeeded when post-rename .rollback-unsafe removal failed"
fi
grep -Fxq "supplier-henkaten-api:${retry_sha} sha256:preserved-before-post-rename-fail" "${post_rename_release}/.activated-images" || fail "post-rename failure did not restore previous .activated-images manifest"

# Successful cross-SHA upgrade over an unpinned legacy release must backfill .activated-images from the ACTIVE RUNNING containers (even if mutable postgres tag already drifted).
drift_base="${TEST_ROOT}/legacy-drift-upgrade"
prepare_base "${drift_base}"
drift_prev_sha=6161616161616161616161616161616161616161
drift_new_sha=6262626262626262626262626262626262626262
mkdir -p "${drift_base}/releases/${drift_prev_sha}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${drift_prev_sha}/" "${legacy_env}" >"${drift_base}/releases/${drift_prev_sha}/.runtime.env"
printf '%s\n' "${drift_prev_sha}" >"${drift_base}/releases/${drift_prev_sha}/.source.sha"
printf '%s\n' "${drift_prev_sha}" >"${drift_base}/current_release"
drift_images="${TEST_ROOT}/drift-images.state"
cat >"${drift_images}" <<EOF
supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:drifted-postgres-tag
supplier-henkaten-api:${drift_prev_sha} sha256:legacy-api
supplier-henkaten-supplier-web:${drift_prev_sha} sha256:legacy-supplier-web
supplier-henkaten-tmmin-web:${drift_prev_sha} sha256:legacy-tmmin-web
supplier-henkaten-caddy:${drift_prev_sha} sha256:legacy-caddy
EOF
drift_running="${TEST_ROOT}/drift-running.state"
cat >"${drift_running}" <<EOF
postgres sha256:true-running-legacy-postgres
api sha256:legacy-api
supplier-web sha256:legacy-supplier-web
tmmin-web sha256:legacy-tmmin-web
caddy sha256:legacy-caddy
EOF
TEST_BUILD_TAG_SUFFIX=50 TEST_IMAGE_STATE_FILE="${drift_images}" TEST_RUNNING_IMAGES_FILE="${drift_running}" \
  run_candidate "${drift_base}" "${drift_new_sha}" 50 >/dev/null
[[ "$(<"${drift_base}/current_release")" == "${drift_new_sha}" ]] || fail "cross-SHA upgrade over legacy release did not activate"
grep -Fxq 'supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:true-running-legacy-postgres' "${drift_base}/releases/${drift_prev_sha}/.activated-images" || fail "legacy backfill used drifted tag instead of active running postgres container image"
grep -Fxq 'supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:candidate-postgres-50' "${drift_base}/releases/${drift_new_sha}/.activated-images" || fail "new release did not record its own running postgres image ID"
[[ -x "${drift_base}/shared/deployment-state/rollback-driver/remote-rollback.sh" ]] || fail "hardened rollback driver was not installed in shared/deployment-state/rollback-driver"
# An OLDER retained legacy release (never current during a hardened deploy) has neither pins nor an unsafe
# marker; the shared driver must refuse it rather than start PostgreSQL from the candidate-rebuilt tag and
# record that image as the legacy release's pin.
drift_older_sha=6060606060606060606060606060606060606061
mkdir -p "${drift_base}/releases/${drift_older_sha}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${drift_older_sha}/" "${legacy_env}" >"${drift_base}/releases/${drift_older_sha}/.runtime.env"
printf '%s\n' "${drift_older_sha}" >"${drift_base}/releases/${drift_older_sha}/.source.sha"
printf '#!/usr/bin/env bash\nexit 0\n' >"${drift_base}/releases/${drift_older_sha}/deploy/scripts/smoke-check.sh"
chmod +x "${drift_base}/releases/${drift_older_sha}/deploy/scripts/smoke-check.sh"
drift_older_log="${TEST_ROOT}/drift-older-unpinned-rollback.log"
if TEST_DOCKER_LOG="${drift_older_log}" TEST_IMAGE_STATE_FILE="${drift_images}" TEST_RUNNING_IMAGES_FILE="${drift_running}" \
  PATH="${fake_bin}:${PATH}" "${drift_base}/shared/deployment-state/rollback-driver/remote-rollback.sh" \
  staging "${drift_older_sha}" "${drift_base}" >/dev/null 2>&1; then
  fail "shared rollback driver accepted an older retained release without verified pins"
fi
if [[ -f "${drift_older_log}" ]] && grep -Eq '^(STARTED|TAG) ' "${drift_older_log}"; then
  fail "shared rollback driver started or tagged containers for an unpinned older release"
fi
[[ ! -e "${drift_base}/releases/${drift_older_sha}/.activated-images" ]] || fail "shared rollback driver recorded pins for an unpinned older release"
[[ "$(<"${drift_base}/current_release")" == "${drift_new_sha}" ]] || fail "refused rollback to unpinned older release changed current_release"

# Pre-build cross-SHA abort when NEITHER backfill NOR mark_rollback_unsafe can succeed (unwritable legacy dir).
unwritable_prev_base="${TEST_ROOT}/unwritable-prev-cross-sha"
prepare_base "${unwritable_prev_base}"
unwritable_prev_sha=6060606060606060606060606060606060606060
mkdir -p "${unwritable_prev_base}/releases/${unwritable_prev_sha}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${unwritable_prev_sha}/" "${legacy_env}" >"${unwritable_prev_base}/releases/${unwritable_prev_sha}/.runtime.env"
printf '%s\n' "${unwritable_prev_sha}" >"${unwritable_prev_base}/releases/${unwritable_prev_sha}/.source.sha"
printf '%s\n' "${unwritable_prev_sha}" >"${unwritable_prev_base}/current_release"
chmod 500 "${unwritable_prev_base}/releases/${unwritable_prev_sha}"
unwritable_prev_log="${TEST_ROOT}/unwritable-prev-cross-sha.log"
if TEST_DOCKER_LOG="${unwritable_prev_log}" run_candidate "${unwritable_prev_base}" 5959595959595959595959595959595959595959 10 >/dev/null 2>&1; then
  chmod 700 "${unwritable_prev_base}/releases/${unwritable_prev_sha}"
  fail "cross-SHA deploy proceeded despite failing both legacy backfill and .rollback-unsafe persistence"
fi
chmod 700 "${unwritable_prev_base}/releases/${unwritable_prev_sha}"
if [[ -f "${unwritable_prev_log}" ]] && grep -q ' build ' "${unwritable_prev_log}"; then
  fail "cross-SHA deploy ran docker compose build after failing both backfill and .rollback-unsafe persistence"
fi

# Deploy-level failure when .rollback-unsafe is a directory must NOT skip stopping mutated candidate app services.
dir_marker_base="${TEST_ROOT}/dir-marker-cleanup"
prepare_base "${dir_marker_base}"
dir_marker_prev=6464646464646464646464646464646464646464
mkdir -p "${dir_marker_base}/releases/${dir_marker_prev}/deploy/scripts" "${dir_marker_base}/releases/${dir_marker_prev}/.rollback-unsafe"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${dir_marker_prev}/" "${legacy_env}" >"${dir_marker_base}/releases/${dir_marker_prev}/.runtime.env"
printf '%s\n' "${dir_marker_prev}" >"${dir_marker_base}/releases/${dir_marker_prev}/.source.sha"
printf '%s\n' "${dir_marker_prev}" >"${dir_marker_base}/current_release"
dir_marker_log="${TEST_ROOT}/dir-marker-cleanup.log"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_DOCKER_LOG="${dir_marker_log}" \
  run_candidate "${dir_marker_base}" 6363636363636363636363636363636363636363 10 >/dev/null 2>&1; then
  fail "deploy against directory .rollback-unsafe marker unexpectedly succeeded"
fi
grep -q ' stop ' "${dir_marker_log}" || fail "directory .rollback-unsafe marker write failure skipped stopping mutated candidate services"

# Deploy-level pin persistence failure must route through recovery/stop and NOT advance current_release.
pinfail_base="${TEST_ROOT}/pinfail"
prepare_base "${pinfail_base}"
pinfail_sha=9999999999999999999999999999999999999999
pinfail_log="${TEST_ROOT}/pinfail-deploy.log"
IFS='|' read -r pinfail_incoming pinfail_runtime pinfail_archive pinfail_checksum < <(
  prepare_candidate "${pinfail_base}" "${pinfail_sha}" 10
)
mkdir -p "${pinfail_incoming}/.activated-images"
if TEST_DOCKER_LOG="${pinfail_log}" PATH="${fake_bin}:${PATH}" "${pinfail_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${pinfail_sha}" 10 "${pinfail_base}" "${pinfail_incoming}" "${pinfail_runtime}" \
  "${pinfail_archive}" "${pinfail_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "deploy with unwritable/directory .activated-images unexpectedly succeeded"
fi
[[ ! -f "${pinfail_base}/current_release" ]] || fail "pin persistence failure advanced current_release"
grep -q ' stop ' "${pinfail_log}" || fail "pin persistence failure left candidate services running"

# Restored-ID mismatch branch: docker tag exits 0 without updating the tag -> inspect mismatch must refuse rollback.
mismatch_log="${TEST_ROOT}/same-sha-tag-mismatch.log"
IFS='|' read -r mismatch_incoming mismatch_runtime mismatch_archive mismatch_checksum < <(
  prepare_candidate "${migration_base}" "${retry_sha}" 44
)
sed -i.bak "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=${updated_app_password}/" "${mismatch_runtime}"
rm -f "${mismatch_runtime}.bak"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_TAG_SILENT_NOOP=true TEST_BUILD_TAG_SUFFIX=44 TEST_DOCKER_LOG="${mismatch_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  PATH="${fake_bin}:${PATH}" "${mismatch_incoming}/deploy/scripts/remote-deploy.sh" \
  staging "${retry_sha}" 44 "${migration_base}" "${mismatch_incoming}" "${mismatch_runtime}" \
  "${mismatch_archive}" "${mismatch_checksum}" 127.0.0.1 >/dev/null 2>&1; then
  fail "same-SHA smoke failure with silent tag mismatch unexpectedly succeeded"
fi
grep -q ' stop ' "${mismatch_log}" || fail "restored-ID mismatch did not stop failed candidate services"
[[ "$(grep -c '^STARTED api=' "${mismatch_log}")" == "1" ]] || fail "restored-ID mismatch invoked rollback with unverified candidate image"
[[ -f "${migration_base}/releases/${retry_sha}/.rollback-unsafe" ]] || fail "restored-ID mismatch did not write .rollback-unsafe marker"

# Incomplete pre-build snapshot on a legacy unpinned release must durably write .rollback-unsafe BEFORE build, so even after build recreates the postgres tag, the hardened rollback driver refuses it (even without hardened scripts inside the legacy release dir).
incomplete_snap_base="${TEST_ROOT}/incomplete-snap"
prepare_base "${incomplete_snap_base}"
incomplete_prev_sha=6666666666666666666666666666666666666666
mkdir -p "${incomplete_snap_base}/releases/${incomplete_prev_sha}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${incomplete_prev_sha}/" "${legacy_env}" >"${incomplete_snap_base}/releases/${incomplete_prev_sha}/.runtime.env"
printf '%s\n' "${incomplete_prev_sha}" >"${incomplete_snap_base}/releases/${incomplete_prev_sha}/.source.sha"
printf '%s\n' "${incomplete_prev_sha}" >"${incomplete_snap_base}/current_release"
incomplete_snap_images="${TEST_ROOT}/incomplete-snap-images.state"
cat >"${incomplete_snap_images}" <<EOF
supplier-henkaten-api:${incomplete_prev_sha} sha256:legacy-api
supplier-henkaten-supplier-web:${incomplete_prev_sha} sha256:legacy-supplier-web
supplier-henkaten-tmmin-web:${incomplete_prev_sha} sha256:legacy-tmmin-web
supplier-henkaten-caddy:${incomplete_prev_sha} sha256:legacy-caddy
EOF
incomplete_snap_log="${TEST_ROOT}/incomplete-snap.log"
if TEST_BUILD_FAIL=true TEST_BUILD_TAG_SUFFIX=10 \
  TEST_BUILD_ASSERT_EXISTS="${incomplete_snap_base}/releases/${incomplete_prev_sha}/.rollback-unsafe" \
  TEST_DOCKER_LOG="${incomplete_snap_log}" TEST_IMAGE_STATE_FILE="${incomplete_snap_images}" \
  run_candidate "${incomplete_snap_base}" 6565656565656565656565656565656565656565 10 >/dev/null 2>&1; then
  fail "candidate with missing postgres snapshot unexpectedly succeeded"
fi
if grep -q '^BUILD_PRECONDITION_MISSING ' "${incomplete_snap_log}"; then
  fail ".rollback-unsafe was NOT written before docker compose build on incomplete legacy snapshot"
fi
[[ -f "${incomplete_snap_base}/releases/${incomplete_prev_sha}/.rollback-unsafe" ]] || fail "incomplete snapshot on failed build did not mark legacy target .rollback-unsafe"
# The candidate build recreated the shared postgres tag, yet subsequent manual rollback through the documented hardened rollback driver must STILL refuse the untouched legacy target.
grep -Fxq "supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:candidate-postgres-10" "${incomplete_snap_images}" || fail "expected build to recreate shared postgres tag in incomplete-snapshot test"
incomplete_snap_rb_log="${TEST_ROOT}/incomplete-snap-rollback.log"
if TEST_DOCKER_LOG="${incomplete_snap_rb_log}" TEST_IMAGE_STATE_FILE="${incomplete_snap_images}" \
  PATH="${fake_bin}:${PATH}" "${incomplete_snap_base}/shared/deployment-state/rollback-driver/remote-rollback.sh" \
  staging "${incomplete_prev_sha}" "${incomplete_snap_base}" >/dev/null 2>&1; then
  fail "subsequent rollback through hardened driver accepted legacy target after incomplete snapshot recreated postgres tag"
fi
if [[ -f "${incomplete_snap_rb_log}" ]] && grep -Eq '^(STARTED|TAG) ' "${incomplete_snap_rb_log}"; then
  fail "subsequent rollback started or tagged containers for marked incomplete-snapshot legacy target"
fi

# Legacy release marked .rollback-unsafe without .activated-images must block manual rollback AND cross-SHA automatic rollback.
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
cross_sha_unsafe_log="${TEST_ROOT}/cross-sha-legacy-unsafe.log"
cross_sha_target=8888888888888888888888888888888888888888
cat >"${migration_base}/releases/${retry_sha}/deploy/scripts/remote-rollback.sh" <<EOF
#!/usr/bin/env bash
touch "${migration_base}/unsafe-cross-sha-rollback-called"
exit 0
EOF
chmod +x "${migration_base}/releases/${retry_sha}/deploy/scripts/remote-rollback.sh"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_DOCKER_LOG="${cross_sha_unsafe_log}" TEST_IMAGE_STATE_FILE="${same_sha_images}" \
  run_candidate "${migration_base}" "${cross_sha_target}" 45 >/dev/null 2>&1; then
  fail "cross-SHA smoke failure against unsafe legacy release unexpectedly succeeded"
fi
[[ ! -f "${migration_base}/unsafe-cross-sha-rollback-called" ]] || fail "cross-SHA failure invoked legacy rollback script despite .rollback-unsafe without pins"
grep -q ' stop ' "${cross_sha_unsafe_log}" || fail "cross-SHA refusal against unsafe legacy release did not stop failed candidate services"

# Cross-SHA automatic rollback must go through the shared hardened driver (never the legacy target's own
# remote-rollback.sh, which starts services from mutable tags) and must restart all five pinned image IDs
# even though the candidate build already re-pointed the shared PostgreSQL tag.
rollback_base="${TEST_ROOT}/rollback"
prepare_base "${rollback_base}"
previous_sha=dddddddddddddddddddddddddddddddddddddddd
mkdir -p "${rollback_base}/releases/${previous_sha}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${previous_sha}/" "${legacy_env}" >"${rollback_base}/releases/${previous_sha}/.runtime.env"
printf '%s\n' "${previous_sha}" >"${rollback_base}/releases/${previous_sha}/.source.sha"
printf '%s\n' "${previous_sha}" >"${rollback_base}/current_release"
printf '#!/usr/bin/env bash\ntouch "%s/legacy-rollback-called"\nexit 0\n' "${rollback_base}" \
  >"${rollback_base}/releases/${previous_sha}/deploy/scripts/remote-rollback.sh"
printf '#!/usr/bin/env bash\nexit 0\n' >"${rollback_base}/releases/${previous_sha}/deploy/scripts/smoke-check.sh"
chmod +x "${rollback_base}/releases/${previous_sha}/deploy/scripts/"*.sh
rollback_images="${TEST_ROOT}/rollback-images.state"
{
  printf 'supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:legacy-postgres\n'
  for svc in api supplier-web tmmin-web caddy; do
    printf 'supplier-henkaten-%s:%s sha256:legacy-%s\n' "${svc}" "${previous_sha}" "${svc}"
  done
} >"${rollback_images}"
rollback_running="${TEST_ROOT}/rollback-running.state"
{
  printf 'postgres sha256:legacy-postgres\n'
  for svc in api supplier-web tmmin-web caddy; do
    printf '%s sha256:legacy-%s\n' "${svc}" "${svc}"
  done
} >"${rollback_running}"
rollback_log="${TEST_ROOT}/rollback-auto.log"
rollback_stdout="${TEST_ROOT}/rollback-auto.stdout"
rollback_status=0
DEPLOY_FORCE_SMOKE_FAILURE=true TEST_BUILD_TAG_SUFFIX=40 TEST_DOCKER_LOG="${rollback_log}" \
  TEST_IMAGE_STATE_FILE="${rollback_images}" TEST_RUNNING_IMAGES_FILE="${rollback_running}" \
  run_candidate "${rollback_base}" eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee 40 >"${rollback_stdout}" 2>/dev/null || rollback_status=$?
[[ "${rollback_status}" == "3" ]] || fail "completed hardened automatic recovery did not exit with the dedicated status 3 (got ${rollback_status})"
grep -Fxq "DEPLOY_RESULT=automatic-rollback-completed forced_smoke_failure=true restored=${previous_sha}" "${rollback_stdout}" || fail "automatic recovery result line did not prove the forced smoke failure and restored SHA"
[[ ! -f "${rollback_base}/legacy-rollback-called" ]] || fail "automatic rollback trusted the legacy target's own remote-rollback.sh instead of the shared hardened driver"
grep -Fxq 'STARTED postgres=sha256:legacy-postgres' "${rollback_log}" || fail "automatic rollback did not restart the pinned legacy postgres image after the build moved the shared tag"
for svc in api supplier-web tmmin-web caddy; do
  grep -Fxq "STARTED ${svc}=sha256:legacy-${svc}" "${rollback_log}" || fail "automatic rollback did not restart pinned legacy ${svc} image"
done
if grep -q ' stop ' "${rollback_log}"; then
  fail "successful hardened automatic rollback stopped application services"
fi
[[ "$(<"${rollback_base}/current_release")" == "${previous_sha}" ]] || fail "failed candidate changed the active pointer"
[[ "$(readlink "${rollback_base}/current")" == "${rollback_base}/releases/${previous_sha}" ]] || fail "hardened automatic rollback did not re-point current at the previous release"

# A failing hardened automatic rollback (here: hardened target never proven .activated) must stop the
# failed candidate application services and never invoke the target's own script.
rollback_failure_base="${TEST_ROOT}/rollback-failure"
prepare_base "${rollback_failure_base}"
rollback_failure_previous=4444444444444444444444444444444444444444
mkdir -p "${rollback_failure_base}/releases/${rollback_failure_previous}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${rollback_failure_previous}/" "${rendered_env}" >"${rollback_failure_base}/releases/${rollback_failure_previous}/.runtime.env"
printf '%s\n' "${rollback_failure_previous}" >"${rollback_failure_base}/releases/${rollback_failure_previous}/.source.sha"
printf '%s\n' "${rollback_failure_previous}" >"${rollback_failure_base}/current_release"
printf '#!/usr/bin/env bash\ntouch "%s/rollback-failure-called"\nexit 0\n' "${rollback_failure_base}" \
  >"${rollback_failure_base}/releases/${rollback_failure_previous}/deploy/scripts/remote-rollback.sh"
chmod +x "${rollback_failure_base}/releases/${rollback_failure_previous}/deploy/scripts/remote-rollback.sh"
rollback_failure_log="${TEST_ROOT}/rollback-failure.log"
rollback_failure_status=0
DEPLOY_FORCE_SMOKE_FAILURE=true TEST_DOCKER_LOG="${rollback_failure_log}" run_candidate "${rollback_failure_base}" 5555555555555555555555555555555555555555 41 >/dev/null 2>&1 || rollback_failure_status=$?
[[ "${rollback_failure_status}" == "1" ]] || fail "failed automatic rollback must exit 1, never the recovery-completed status (got ${rollback_failure_status})"
[[ ! -f "${rollback_failure_base}/rollback-failure-called" ]] || fail "automatic rollback invoked the target's own remote-rollback.sh"
grep -q ' stop ' "${rollback_failure_log}" || fail "failed hardened automatic rollback left candidate services running"
[[ "$(<"${rollback_failure_base}/current_release")" == "${rollback_failure_previous}" ]] || fail "rollback failure changed the previous pointer"

# Backfill must verify release ownership: if an interrupted legacy rollout left a candidate container running
# while current_release still names the previous SHA, the mixed baseline must NOT be pinned; the previous
# release must instead be durably marked .rollback-unsafe before build.
mixed_base="${TEST_ROOT}/mixed-baseline"
prepare_base "${mixed_base}"
mixed_prev=7171717171717171717171717171717171717171
mixed_stray=7272727272727272727272727272727272727272
mkdir -p "${mixed_base}/releases/${mixed_prev}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${mixed_prev}/" "${legacy_env}" >"${mixed_base}/releases/${mixed_prev}/.runtime.env"
printf '%s\n' "${mixed_prev}" >"${mixed_base}/releases/${mixed_prev}/.source.sha"
printf '%s\n' "${mixed_prev}" >"${mixed_base}/current_release"
mixed_running="${TEST_ROOT}/mixed-running.state"
{
  printf 'postgres sha256:legacy-postgres supplier-henkaten-postgres:18.4-pgvector-0.8.5\n'
  printf 'api sha256:stray-candidate-api supplier-henkaten-api:%s\n' "${mixed_stray}"
  for svc in supplier-web tmmin-web caddy; do
    printf '%s sha256:legacy-%s supplier-henkaten-%s:%s\n' "${svc}" "${svc}" "${svc}" "${mixed_prev}"
  done
} >"${mixed_running}"
mixed_log="${TEST_ROOT}/mixed-baseline.log"
if TEST_BUILD_FAIL=true TEST_RUNNING_IMAGES_FILE="${mixed_running}" TEST_DOCKER_LOG="${mixed_log}" \
  TEST_BUILD_ASSERT_EXISTS="${mixed_base}/releases/${mixed_prev}/.rollback-unsafe" \
  run_candidate "${mixed_base}" 7373737373737373737373737373737373737373 10 >/dev/null 2>&1; then
  fail "candidate build failure unexpectedly succeeded in mixed-baseline test"
fi
[[ ! -e "${mixed_base}/releases/${mixed_prev}/.activated-images" ]] || fail "backfill pinned a mixed baseline containing another release's container"
[[ -f "${mixed_base}/releases/${mixed_prev}/.rollback-unsafe" ]] || fail "mixed baseline was not durably marked .rollback-unsafe"
grep -q ' build ' "${mixed_log}" || fail "mixed-baseline test never reached the build step"
if grep -q '^BUILD_PRECONDITION_MISSING ' "${mixed_log}"; then
  fail "mixed baseline .rollback-unsafe marker was not written before build"
fi
# Multiple running containers for one service are an unverifiable baseline.
dup_release="${TEST_ROOT}/dup-container-release"
mkdir -p "${dup_release}"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${retry_sha}/" "${rendered_env}" >"${dup_release}/.runtime.env"
if TEST_PS_DUPLICATE_SERVICE=api COMPOSE_PROJECT_NAME=supplier-henkaten-staging PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  if write_activated_images "$2" "$3" "$2/.runtime.env"; then
    exit 0
  fi
  exit 1
' _ "${SCRIPTS}/lib.sh" "${dup_release}" "${retry_sha}" >/dev/null 2>&1; then
  fail "write_activated_images pinned a service with more than one running container"
fi
[[ ! -e "${dup_release}/.activated-images" ]] || fail "duplicate-container failure published .activated-images"
# Control: the same fixture without the duplicate succeeds, so the refusal above is attributable to it.
COMPOSE_PROJECT_NAME=supplier-henkaten-staging PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  write_activated_images "$2" "$3" "$2/.runtime.env"
' _ "${SCRIPTS}/lib.sh" "${dup_release}" "${retry_sha}" >/dev/null 2>&1 || fail "write_activated_images control case without duplicate container failed"

# The rollback driver is published as one versioned bundle behind an atomically swapped symlink; a failed
# install keeps the previous bundle intact, and a pre-versioning real directory is migrated.
driver_base="${TEST_ROOT}/driver-bundle"
prepare_base "${driver_base}"
mkdir -p "${driver_base}/shared/deployment-state/rollback-driver"
printf 'old\n' >"${driver_base}/shared/deployment-state/rollback-driver/remote-rollback.sh"
install_driver() {
  PATH="${fake_bin}:${PATH}" bash -c 'set -euo pipefail; source "$1"; install_hardened_rollback_driver "$2" "$3"' \
    _ "${SCRIPTS}/lib.sh" "$1" "$2"
}
install_driver "${SCRIPTS}" "${driver_base}" || fail "hardened rollback driver install failed"
driver_link="${driver_base}/shared/deployment-state/rollback-driver"
[[ -L "${driver_link}" ]] || fail "rollback driver was not published behind a symlink"
first_driver_target="$(readlink "${driver_link}")"
for script_name in lib.sh validate-runtime-env.sh remote-rollback.sh; do
  cmp -s "${SCRIPTS}/${script_name}" "${driver_link}/${script_name}" || fail "published rollback driver bundle is missing or stale: ${script_name}"
done
broken_source="${TEST_ROOT}/broken-driver-source"
mkdir -p "${broken_source}"
cp "${SCRIPTS}/lib.sh" "${SCRIPTS}/validate-runtime-env.sh" "${broken_source}/"
if install_driver "${broken_source}" "${driver_base}" >/dev/null 2>&1; then
  fail "rollback driver install succeeded with an incomplete source bundle"
fi
[[ "$(readlink "${driver_link}")" == "${first_driver_target}" ]] || fail "failed rollback driver install changed the published bundle"
cp "${SCRIPTS}/remote-rollback.sh" "${broken_source}/remote-rollback.sh"
printf 'if then\n' >>"${broken_source}/remote-rollback.sh"
if install_driver "${broken_source}" "${driver_base}" >/dev/null 2>&1; then
  fail "rollback driver install published a syntactically invalid script"
fi
[[ "$(readlink "${driver_link}")" == "${first_driver_target}" ]] || fail "syntactically invalid rollback driver install changed the published bundle"
install_driver "${SCRIPTS}" "${driver_base}" || fail "second hardened rollback driver install failed"
[[ "$(readlink "${driver_link}")" != "${first_driver_target}" ]] || fail "second rollback driver install did not publish a new bundle"
[[ ! -e "${driver_base}/shared/deployment-state/rollback-driver.good" && ! -L "${driver_base}/shared/deployment-state/rollback-driver.good" ]] || fail "an unproven install (or the non-strict legacy driver) was designated known-good before any activation"
[[ -d "${first_driver_target}" ]] || fail "an unproven candidate install pruned the previous bundle"
[[ "$(find "${driver_base}/shared/deployment-state" -mindepth 1 -maxdepth 1 -name 'rollback-driver.legacy.*' | wc -l | tr -d ' ')" == "1" ]] || fail "the migrated legacy driver was pruned before any activation"
grep -Fxq 'strict-five-image-pins-v1' "${driver_link}/.driver-contract" || fail "published rollback driver bundle lacks the strict pin contract marker"
PATH="${fake_bin}:${PATH}" bash -c 'set -euo pipefail; source "$1"; promote_rollback_driver "$2"' _ "${SCRIPTS}/lib.sh" "${driver_base}" || fail "promoting the activated rollback driver failed"
[[ "$(readlink "${driver_base}/shared/deployment-state/rollback-driver.good")" == "$(readlink "${driver_link}")" ]] || fail "promotion did not make the activated bundle the known-good fallback"
[[ "$(find "${driver_base}/shared/deployment-state" -mindepth 1 -maxdepth 1 -name 'rollback-driver.*' | wc -l | tr -d ' ')" == "2" ]] || fail "promotion did not prune superseded rollback driver bundles (expected only the live bundle and the .good link)"

# Promotion refuses a live bundle that lacks the strict pin contract marker.
nonstrict_promote_base="${TEST_ROOT}/nonstrict-promote"
prepare_base "${nonstrict_promote_base}"
install_driver "${SCRIPTS}" "${nonstrict_promote_base}" || fail "nonstrict-promote fixture install failed"
rm -f -- "$(readlink "${nonstrict_promote_base}/shared/deployment-state/rollback-driver")/.driver-contract"
if PATH="${fake_bin}:${PATH}" bash -c 'set -euo pipefail; source "$1"; promote_rollback_driver "$2"' _ "${SCRIPTS}/lib.sh" "${nonstrict_promote_base}" >/dev/null 2>&1; then
  fail "promotion designated a bundle without the strict pin contract as known-good"
fi
[[ ! -L "${nonstrict_promote_base}/shared/deployment-state/rollback-driver.good" ]] || fail "refused promotion still published rollback-driver.good"

# Nanosecond precision + strict ordering: a container recreated later within the SAME second as activation
# must be refused; one created strictly earlier passes.
ns_release="${TEST_ROOT}/ns-provenance-release"
mkdir -p "${ns_release}"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${retry_sha}/" "${rendered_env}" >"${ns_release}/.runtime.env"
touch -d "2026-01-01T09:00:00.100Z" "${ns_release}/activated-at"
ns_pin() {
  local pg_created="$1"
  {
    printf 'postgres sha256:pg supplier-henkaten-postgres:18.4-pgvector-0.8.5 %s\n' "${pg_created}"
    for svc in api supplier-web tmmin-web caddy; do
      printf '%s sha256:%s supplier-henkaten-%s:%s\n' "${svc}" "${svc}" "${svc}" "${retry_sha}"
    done
  } >"${TEST_ROOT}/ns-running.state"
  TEST_RUNNING_IMAGES_FILE="${TEST_ROOT}/ns-running.state" COMPOSE_PROJECT_NAME=supplier-henkaten-staging PATH="${fake_bin}:${PATH}" bash -c '
    set -euo pipefail
    source "$1"
    if write_activated_images "$2" "$3" "$2/.runtime.env" "$2/activated-at"; then
      exit 0
    fi
    exit 1
  ' _ "${SCRIPTS}/lib.sh" "${ns_release}" "${retry_sha}" >/dev/null 2>&1
}
if ns_pin 2026-01-01T09:00:00.900000000Z; then
  fail "backfill accepted a postgres container recreated later within the same second as activation"
fi
if ns_pin 2026-01-01T09:00:00.100000000Z; then
  fail "backfill accepted a postgres container created at exactly the activation instant (must be strictly before)"
fi
ns_pin 2026-01-01T09:00:00.050000000Z || fail "backfill rejected a container created strictly before activation"

# A failed first hardened candidate's driver must never become known-good on a later attempt.
firstfail_base="${TEST_ROOT}/first-candidate-driver"
prepare_base "${firstfail_base}"
install_driver "${SCRIPTS}" "${firstfail_base}" || fail "first candidate driver install failed"
install_driver "${SCRIPTS}" "${firstfail_base}" || fail "second candidate driver install failed"
[[ ! -e "${firstfail_base}/shared/deployment-state/rollback-driver.good" && ! -L "${firstfail_base}/shared/deployment-state/rollback-driver.good" ]] || fail "an unactivated earlier candidate's driver was designated known-good"

# If the candidate's own (unproven) rollback driver fails during automatic recovery, the bundle of the last
# successfully activated deploy is retried once and completes recovery of the verified pins.
fallback_base="${TEST_ROOT}/driver-fallback"
prepare_base "${fallback_base}"
fallback_prev=7878787878787878787878787878787878787878
mkdir -p "${fallback_base}/releases/${fallback_prev}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${fallback_prev}/" "${legacy_env}" >"${fallback_base}/releases/${fallback_prev}/.runtime.env"
printf '%s\n' "${fallback_prev}" >"${fallback_base}/releases/${fallback_prev}/.source.sha"
printf '%s\n' "${fallback_prev}" >"${fallback_base}/current_release"
printf '#!/usr/bin/env bash\nexit 0\n' >"${fallback_base}/releases/${fallback_prev}/deploy/scripts/smoke-check.sh"
chmod +x "${fallback_base}/releases/${fallback_prev}/deploy/scripts/smoke-check.sh"
{
  printf 'supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:fb-postgres\n'
  for svc in api supplier-web tmmin-web caddy; do
    printf 'supplier-henkaten-%s:%s sha256:fb-%s\n' "${svc}" "${fallback_prev}" "${svc}"
  done
} >"${fallback_base}/releases/${fallback_prev}/.activated-images"
cp "${fallback_base}/releases/${fallback_prev}/.activated-images" "${fallback_base}/images.state"
PATH="${fake_bin}:${PATH}" bash -c 'set -euo pipefail; source "$1"; install_hardened_rollback_driver "$2" "$3"; promote_rollback_driver "$3"' \
  _ "${SCRIPTS}/lib.sh" "${SCRIPTS}" "${fallback_base}" || fail "fallback fixture could not establish a known-good driver"
IFS='|' read -r fb_incoming fb_runtime fb_archive fb_checksum < <(prepare_candidate "${fallback_base}" 7979797979797979797979797979797979797979 10)
printf '#!/usr/bin/env bash\ntouch "%s/broken-candidate-driver-ran"\nexit 1\n' "${fallback_base}" >"${fb_incoming}/deploy/scripts/remote-rollback.sh"
chmod +x "${fb_incoming}/deploy/scripts/remote-rollback.sh"
fb_log="${TEST_ROOT}/driver-fallback.log"
fb_status=0
DEPLOY_FORCE_SMOKE_FAILURE=true TEST_BUILD_TAG_SUFFIX=10 TEST_DOCKER_LOG="${fb_log}" TEST_IMAGE_STATE_FILE="${fallback_base}/images.state" \
  PATH="${fake_bin}:${PATH}" "${fb_incoming}/deploy/scripts/remote-deploy.sh" \
  staging 7979797979797979797979797979797979797979 10 "${fallback_base}" "${fb_incoming}" "${fb_runtime}" \
  "${fb_archive}" "${fb_checksum}" 127.0.0.1 >/dev/null 2>&1 || fb_status=$?
[[ -f "${fallback_base}/broken-candidate-driver-ran" ]] || fail "automatic recovery did not try the candidate's driver first"
[[ "${fb_status}" == "3" ]] || fail "known-good driver fallback did not complete automatic recovery (exit ${fb_status})"
grep -Fxq 'STARTED postgres=sha256:fb-postgres' "${fb_log}" || fail "known-good driver fallback did not restart the pinned postgres image"
[[ "$(<"${fallback_base}/current_release")" == "${fallback_prev}" ]] || fail "known-good driver fallback changed the active pointer"

# A deliberate policy refusal (exit 4) by the candidate driver is final: the known-good driver must NOT
# override it.
IFS='|' read -r pr_incoming pr_runtime pr_archive pr_checksum < <(prepare_candidate "${fallback_base}" 7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b 12)
printf '#!/usr/bin/env bash\nexit 4\n' >"${pr_incoming}/deploy/scripts/remote-rollback.sh"
chmod +x "${pr_incoming}/deploy/scripts/remote-rollback.sh"
pr_log="${TEST_ROOT}/driver-fallback-policy-refusal.log"
pr_status=0
DEPLOY_FORCE_SMOKE_FAILURE=true TEST_BUILD_TAG_SUFFIX=12 TEST_DOCKER_LOG="${pr_log}" TEST_IMAGE_STATE_FILE="${fallback_base}/images.state" \
  PATH="${fake_bin}:${PATH}" "${pr_incoming}/deploy/scripts/remote-deploy.sh" \
  staging 7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b 12 "${fallback_base}" "${pr_incoming}" "${pr_runtime}" \
  "${pr_archive}" "${pr_checksum}" 127.0.0.1 >/dev/null 2>&1 || pr_status=$?
[[ "${pr_status}" == "1" ]] || fail "candidate driver policy refusal was overridden (exit ${pr_status})"
if grep -Fxq 'STARTED postgres=sha256:fb-postgres' "${pr_log}"; then
  fail "known-good driver overrode the candidate driver's deliberate policy refusal"
fi
grep -q ' stop ' "${pr_log}" || fail "policy-refused recovery left candidate services running"

# A missing candidate driver (link vanished between install and recovery) falls back to the known-good driver.
IFS='|' read -r md_incoming md_runtime md_archive md_checksum < <(prepare_candidate "${fallback_base}" 7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c 13)
md_log="${TEST_ROOT}/driver-fallback-missing.log"
md_status=0
DEPLOY_FORCE_SMOKE_FAILURE=true TEST_BUILD_TAG_SUFFIX=13 TEST_DOCKER_LOG="${md_log}" TEST_IMAGE_STATE_FILE="${fallback_base}/images.state" \
  TEST_BUILD_REMOVE_PATH="${fallback_base}/shared/deployment-state/rollback-driver" \
  PATH="${fake_bin}:${PATH}" "${md_incoming}/deploy/scripts/remote-deploy.sh" \
  staging 7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c 13 "${fallback_base}" "${md_incoming}" "${md_runtime}" \
  "${md_archive}" "${md_checksum}" 127.0.0.1 >/dev/null 2>&1 || md_status=$?
[[ "${md_status}" == "3" ]] || fail "missing candidate driver did not fall back to the known-good driver (exit ${md_status})"
grep -Fxq 'STARTED postgres=sha256:fb-postgres' "${md_log}" || fail "known-good fallback for a missing candidate driver did not restart pinned postgres"

# A known-good link to a bundle WITHOUT the strict pin contract (e.g. the pre-versioning driver that could
# start unpinned releases from mutable tags) must never be used as the fallback.
nonstrict_good="${fallback_base}/shared/deployment-state/rollback-driver.legacy.nonstrict"
mkdir -p "${nonstrict_good}"
printf '#!/usr/bin/env bash\ntouch "%s/nonstrict-driver-ran"\nexit 0\n' "${fallback_base}" >"${nonstrict_good}/remote-rollback.sh"
chmod +x "${nonstrict_good}/remote-rollback.sh"
ln -sfn "${nonstrict_good}" "${fallback_base}/shared/deployment-state/rollback-driver.good"
printf '%s\n' "${fallback_prev}" >"${fallback_base}/current_release"
IFS='|' read -r ns_incoming ns_runtime ns_archive ns_checksum < <(prepare_candidate "${fallback_base}" 7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a 14)
printf '#!/usr/bin/env bash\nexit 1\n' >"${ns_incoming}/deploy/scripts/remote-rollback.sh"
chmod +x "${ns_incoming}/deploy/scripts/remote-rollback.sh"
ns_log="${TEST_ROOT}/driver-fallback-nonstrict.log"
ns_status=0
DEPLOY_FORCE_SMOKE_FAILURE=true TEST_BUILD_TAG_SUFFIX=14 TEST_DOCKER_LOG="${ns_log}" TEST_IMAGE_STATE_FILE="${fallback_base}/images.state" \
  PATH="${fake_bin}:${PATH}" "${ns_incoming}/deploy/scripts/remote-deploy.sh" \
  staging 7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a 14 "${fallback_base}" "${ns_incoming}" "${ns_runtime}" \
  "${ns_archive}" "${ns_checksum}" 127.0.0.1 >/dev/null 2>&1 || ns_status=$?
[[ ! -f "${fallback_base}/nonstrict-driver-ran" ]] || fail "automatic recovery fell back to a known-good driver lacking the strict pin contract"
[[ "${ns_status}" == "1" ]] || fail "failed recovery without an eligible strict fallback must exit 1 (got ${ns_status})"
grep -q ' stop ' "${ns_log}" || fail "failed recovery without an eligible strict fallback left candidate services running"


# A candidate that bumps the postgres tag must still snapshot/restore the PREVIOUS release's own pinned
# postgres reference (not the candidate's) so automatic recovery is not needlessly refused.
pgbump_base="${TEST_ROOT}/pg-tag-bump"
prepare_base "${pgbump_base}"
pgbump_prev=7474747474747474747474747474747474747474
pgbump_old_ref=supplier-henkaten-postgres:17.9-pgvector-0.8.0
mkdir -p "${pgbump_base}/releases/${pgbump_prev}/deploy/scripts" "${pgbump_base}/releases/${pgbump_prev}/deploy/compose"
sed "s#^\([[:space:]]*image:[[:space:]]*\)supplier-henkaten-postgres:.*#\1${pgbump_old_ref}#" "${COMPOSE_FILE}" \
  >"${pgbump_base}/releases/${pgbump_prev}/deploy/compose/docker-compose.remote.yml"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${pgbump_prev}/" "${legacy_env}" >"${pgbump_base}/releases/${pgbump_prev}/.runtime.env"
printf '%s\n' "${pgbump_prev}" >"${pgbump_base}/releases/${pgbump_prev}/.source.sha"
printf '%s\n' "${pgbump_prev}" >"${pgbump_base}/current_release"
{
  printf '%s sha256:old-postgres\n' "${pgbump_old_ref}"
  for svc in api supplier-web tmmin-web caddy; do
    printf 'supplier-henkaten-%s:%s sha256:old-%s\n' "${svc}" "${pgbump_prev}" "${svc}"
  done
} >"${pgbump_base}/releases/${pgbump_prev}/.activated-images"
pgbump_images="${TEST_ROOT}/pg-tag-bump-images.state"
cp "${pgbump_base}/releases/${pgbump_prev}/.activated-images" "${pgbump_images}"
pgbump_log="${TEST_ROOT}/pg-tag-bump.log"
if DEPLOY_FORCE_SMOKE_FAILURE=true TEST_BUILD_TAG_SUFFIX=60 TEST_DOCKER_LOG="${pgbump_log}" TEST_IMAGE_STATE_FILE="${pgbump_images}" \
  run_candidate "${pgbump_base}" 7575757575757575757575757575757575757575 60 >/dev/null 2>&1; then
  fail "pg-tag-bump candidate with forced smoke failure unexpectedly succeeded"
fi
grep -Fxq "TAG sha256:old-postgres ${pgbump_old_ref}" "${pgbump_log}" || fail "previous release's own postgres pin was not restored when the candidate bumped the postgres tag"
[[ ! -e "${pgbump_base}/releases/${pgbump_prev}/.rollback-unsafe" ]] || fail "postgres tag bump degraded the previous release's snapshot to rollback-unsafe"

# PostgreSQL's Config.Image is a shared tag with no release identity: if only the postgres container was
# replaced after the previous release became current (interrupted later rollout), backfill must refuse the
# ambiguous baseline and durably mark it .rollback-unsafe before build instead of pinning a mixed set.
pgprov_base="${TEST_ROOT}/pg-provenance"
prepare_base "${pgprov_base}"
pgprov_prev=7676767676767676767676767676767676767676
mkdir -p "${pgprov_base}/releases/${pgprov_prev}/deploy/scripts"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${pgprov_prev}/" "${legacy_env}" >"${pgprov_base}/releases/${pgprov_prev}/.runtime.env"
printf '%s\n' "${pgprov_prev}" >"${pgprov_base}/releases/${pgprov_prev}/.source.sha"
printf '%s\n' "${pgprov_prev}" >"${pgprov_base}/current_release"
pgprov_running="${TEST_ROOT}/pg-provenance-running.state"
{
  printf 'postgres sha256:interrupted-candidate-postgres supplier-henkaten-postgres:18.4-pgvector-0.8.5 2099-01-01T00:00:00.000000000Z\n'
  for svc in api supplier-web tmmin-web caddy; do
    printf '%s sha256:legacy-%s supplier-henkaten-%s:%s\n' "${svc}" "${svc}" "${svc}" "${pgprov_prev}"
  done
} >"${pgprov_running}"
pgprov_log="${TEST_ROOT}/pg-provenance.log"
if TEST_BUILD_FAIL=true TEST_RUNNING_IMAGES_FILE="${pgprov_running}" TEST_DOCKER_LOG="${pgprov_log}" \
  TEST_BUILD_ASSERT_EXISTS="${pgprov_base}/releases/${pgprov_prev}/.rollback-unsafe" \
  run_candidate "${pgprov_base}" 7777777777777777777777777777777777777770 10 >/dev/null 2>&1; then
  fail "candidate build failure unexpectedly succeeded in postgres-provenance test"
fi
[[ ! -e "${pgprov_base}/releases/${pgprov_prev}/.activated-images" ]] || fail "backfill pinned a postgres container that was replaced after the release became current"
[[ -f "${pgprov_base}/releases/${pgprov_prev}/.rollback-unsafe" ]] || fail "ambiguous postgres provenance was not durably marked .rollback-unsafe"
grep -q ' build ' "${pgprov_log}" || fail "postgres-provenance test never reached the build step"
if grep -q '^BUILD_PRECONDITION_MISSING ' "${pgprov_log}"; then
  fail "ambiguous postgres provenance .rollback-unsafe marker was not written before build"
fi
# An empty/unparseable Created timestamp must also fail closed (GNU date maps "" to today's midnight).
pgempty_release="${TEST_ROOT}/pg-empty-created-release"
mkdir -p "${pgempty_release}"
sed "s/^RELEASE_SHA=.*/RELEASE_SHA=${retry_sha}/" "${rendered_env}" >"${pgempty_release}/.runtime.env"
touch "${pgempty_release}/activated-at"
pgempty_running="${TEST_ROOT}/pg-empty-created-running.state"
{
  printf 'postgres sha256:pg supplier-henkaten-postgres:18.4-pgvector-0.8.5 EMPTY\n'
  for svc in api supplier-web tmmin-web caddy; do
    printf '%s sha256:%s supplier-henkaten-%s:%s\n' "${svc}" "${svc}" "${svc}" "${retry_sha}"
  done
} >"${pgempty_running}"
if TEST_RUNNING_IMAGES_FILE="${pgempty_running}" COMPOSE_PROJECT_NAME=supplier-henkaten-staging PATH="${fake_bin}:${PATH}" bash -c '
  set -euo pipefail
  source "$1"
  if write_activated_images "$2" "$3" "$2/.runtime.env" "$2/activated-at"; then
    exit 0
  fi
  exit 1
' _ "${SCRIPTS}/lib.sh" "${pgempty_release}" "${retry_sha}" >/dev/null 2>&1; then
  fail "write_activated_images accepted an unparseable container Created timestamp"
fi

# Legacy rollback-driver directory migration must be undone if symlink publication fails, so the
# documented shared path keeps working.
mig_base="${TEST_ROOT}/driver-migration-failure"
prepare_base "${mig_base}"
mkdir -p "${mig_base}/shared/deployment-state/rollback-driver"
printf 'legacy-driver\n' >"${mig_base}/shared/deployment-state/rollback-driver/remote-rollback.sh"
fail_mv_bin="${TEST_ROOT}/fail-mv-bin"
mkdir -p "${fail_mv_bin}"
cat >"${fail_mv_bin}/mv" <<'FAKEMV'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "${arg}" == *"/.rollback-driver.link."* ]]; then
    exit 1
  fi
done
exec /bin/mv "$@"
FAKEMV
chmod +x "${fail_mv_bin}/mv"
if PATH="${fail_mv_bin}:${fake_bin}:${PATH}" bash -c 'set -euo pipefail; source "$1"; install_hardened_rollback_driver "$2" "$3"' \
  _ "${SCRIPTS}/lib.sh" "${SCRIPTS}" "${mig_base}" >/dev/null 2>&1; then
  fail "rollback driver install reported success although symlink publication failed"
fi
mig_link="${mig_base}/shared/deployment-state/rollback-driver"
[[ -d "${mig_link}" && ! -L "${mig_link}" ]] || fail "failed driver publication did not restore the legacy rollback-driver directory"
grep -Fxq 'legacy-driver' "${mig_link}/remote-rollback.sh" || fail "restored legacy rollback-driver directory lost its contents"
[[ "$(find "${mig_base}/shared/deployment-state" -mindepth 1 -maxdepth 1 -name 'rollback-driver.*' -o -mindepth 1 -maxdepth 1 -name '.rollback-driver.link.*' | wc -l | tr -d ' ')" == "0" ]] || fail "failed driver publication left staged bundles, temporary links, or a stranded legacy directory"

# End-to-end staging rehearsal: succeeds only with positive proof that the forced smoke failure was reached
# and the shared driver completed automatic recovery; a candidate that fails earlier (here: build) must
# fail the rehearsal even though the first manual rollback already left the expected pointer/sentinel state.
setup_rehearsal_base() {
  local base="$1" sha
  prepare_base "${base}"
  for sha in "${rehearsal_prev}" "${rehearsal_cur}"; do
    local dir="${base}/releases/${sha}"
    mkdir -p "${dir}/deploy/scripts" "${dir}/deploy/compose"
    cp "${SCRIPTS}/lib.sh" "${SCRIPTS}/remote-deploy.sh" "${SCRIPTS}/remote-rollback.sh" "${SCRIPTS}/validate-runtime-env.sh" "${dir}/deploy/scripts/"
    printf '#!/usr/bin/env bash\nexit 0\n' >"${dir}/deploy/scripts/remote-preflight.sh"
    printf '#!/usr/bin/env bash\nexit 0\n' >"${dir}/deploy/scripts/smoke-check.sh"
    chmod +x "${dir}/deploy/scripts/"*.sh
    cp "${COMPOSE_FILE}" "${dir}/deploy/compose/docker-compose.remote.yml"
    sed -e "s/^RELEASE_SHA=.*/RELEASE_SHA=${sha}/" -e "s/^DEPLOY_RUN_NUMBER=.*/DEPLOY_RUN_NUMBER=70/" \
      -e "s#^SHARED_DIR=.*#SHARED_DIR=${base}/shared#" "${rendered_env}" >"${dir}/.runtime.env"
    chmod 600 "${dir}/.runtime.env"
    printf '%s\n' "${sha}" >"${dir}/.source.sha"
    printf '%s\n' "${sha}" >"${dir}/.activated"
    {
      printf 'supplier-henkaten-postgres:18.4-pgvector-0.8.5 sha256:%s-postgres\n' "${sha:0:6}"
      for svc in api supplier-web tmmin-web caddy; do
        printf 'supplier-henkaten-%s:%s sha256:%s-%s\n' "${svc}" "${sha}" "${sha:0:6}" "${svc}"
      done
    } >"${dir}/.activated-images"
  done
  printf '%s\n' "${rehearsal_cur}" >"${base}/current_release"
  ln -s "${base}/releases/${rehearsal_cur}" "${base}/current"
  printf '70\n' >"${base}/shared/deployment-state/highest_seen_run"
  PATH="${fake_bin}:${PATH}" bash -c 'set -euo pipefail; source "$1"; install_hardened_rollback_driver "$2" "$3"' \
    _ "${SCRIPTS}/lib.sh" "${SCRIPTS}" "${base}" || fail "rehearsal fixture driver install failed"
  cat "${base}/releases/${rehearsal_cur}/.activated-images" >"${base}/images.state"
}
rehearsal_prev=8181818181818181818181818181818181818181
rehearsal_cur=8282828282828282828282828282828282828282
rehearsal_base="${TEST_ROOT}/rehearsal-ok"
setup_rehearsal_base "${rehearsal_base}"
TEST_IMAGE_STATE_FILE="${rehearsal_base}/images.state" TEST_DOCKER_LOG="${TEST_ROOT}/rehearsal-ok.log" PATH="${fake_bin}:${PATH}" \
  "${SCRIPTS}/rehearse-staging.sh" "${rehearsal_prev}" "${rehearsal_cur}" "${rehearsal_base}" 127.0.0.1 I_ACCEPT_STAGING_INTERRUPTION \
  >/dev/null 2>&1 || fail "staging rehearsal failed although automatic recovery completed after the forced smoke failure"
[[ "$(<"${rehearsal_base}/current_release")" == "${rehearsal_cur}" ]] || fail "staging rehearsal did not restore the latest release"
rehearsal_bad_base="${TEST_ROOT}/rehearsal-build-fail"
setup_rehearsal_base "${rehearsal_bad_base}"
if TEST_BUILD_FAIL=true TEST_IMAGE_STATE_FILE="${rehearsal_bad_base}/images.state" PATH="${fake_bin}:${PATH}" \
  "${SCRIPTS}/rehearse-staging.sh" "${rehearsal_prev}" "${rehearsal_cur}" "${rehearsal_bad_base}" 127.0.0.1 I_ACCEPT_STAGING_INTERRUPTION \
  >/dev/null 2>&1; then
  fail "staging rehearsal reported success although the candidate failed before the forced smoke failure and no automatic recovery ran"
fi

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
