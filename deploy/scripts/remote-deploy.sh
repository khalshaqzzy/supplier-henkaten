#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

[[ $# -eq 9 ]] || die "Usage: remote-deploy.sh <app-env> <release-sha> <run-number> <base-dir> <incoming-dir> <runtime-env> <archive> <archive-sha256> <expected-host>"
REQUESTED_ENV="$1"
REQUESTED_SHA="$2"
REQUESTED_RUN="$3"
BASE_DIR="$4"
INCOMING_DIR="$5"
RUNTIME_ENV_INCOMING="$6"
ARCHIVE="$7"
ARCHIVE_SHA256="$8"
EXPECTED_HOST="$9"

[[ "${REQUESTED_ENV}" =~ ^(staging|production)$ ]] || die "APP_ENV must be staging or production."
require_sha "${REQUESTED_SHA}"
[[ "${REQUESTED_RUN}" =~ ^[1-9][0-9]*$ ]] || die "Run number must be positive."
require_safe_path "${INCOMING_DIR}" "${BASE_DIR}"
require_safe_path "${RUNTIME_ENV_INCOMING}" "${BASE_DIR}"
require_safe_path "${ARCHIVE}" "${BASE_DIR}"

exec 9>"${BASE_DIR}/deploy.lock"
flock -n 9 || die "Another deploy or rollback is already running."

HIGH_WATER_FILE="${BASE_DIR}/shared/deployment-state/highest_seen_run"
highest_seen=0
if [[ -f "${HIGH_WATER_FILE}" ]]; then
  highest_seen="$(<"${HIGH_WATER_FILE}")"
  [[ "${highest_seen}" =~ ^[0-9]+$ ]] || die "Remote deployment high-water state is invalid."
fi
(( REQUESTED_RUN >= highest_seen )) || die "Stale deployment run ${REQUESTED_RUN} was rejected; high-water is ${highest_seen}."
printf '%s\n' "${REQUESTED_RUN}" >"${HIGH_WATER_FILE}.tmp"
mv "${HIGH_WATER_FILE}.tmp" "${HIGH_WATER_FILE}"

"${INCOMING_DIR}/deploy/scripts/remote-preflight.sh" \
  "${INCOMING_DIR}" "${RUNTIME_ENV_INCOMING}" "${BASE_DIR}" \
  "${ARCHIVE}" "${ARCHIVE_SHA256}" "${EXPECTED_HOST}"

load_runtime_env "${RUNTIME_ENV_INCOMING}"
[[ "${APP_ENV}" == "${REQUESTED_ENV}" ]] || die "Rendered runtime environment does not match the requested environment."
[[ "${RELEASE_SHA}" == "${REQUESTED_SHA}" ]] || die "Rendered runtime SHA does not match the requested release."
[[ "${DEPLOY_RUN_NUMBER}" == "${REQUESTED_RUN}" ]] || die "Rendered runtime run number does not match the request."

RELEASE_DIR="${BASE_DIR}/releases/${REQUESTED_SHA}"
if [[ -d "${RELEASE_DIR}" ]]; then
  [[ -f "${RELEASE_DIR}/.source.sha" && "$(<"${RELEASE_DIR}/.source.sha")" == "${REQUESTED_SHA}" ]] || die "Existing release directory failed source identity validation."
  rm -rf -- "${INCOMING_DIR}"
else
  install -m 600 "${RUNTIME_ENV_INCOMING}" "${INCOMING_DIR}/.runtime.env"
  printf '%s\n' "${REQUESTED_SHA}" >"${INCOMING_DIR}/.source.sha"
  mv "${INCOMING_DIR}" "${RELEASE_DIR}"
fi
RUNTIME_ENV="${RELEASE_DIR}/.runtime.env"

previous_release=""
if [[ -f "${BASE_DIR}/current_release" ]]; then
  previous_release="$(<"${BASE_DIR}/current_release")"
  require_sha "${previous_release}"
fi

candidate_deploy() {
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" build --pull postgres api supplier-web tmmin-web caddy || return 1
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps postgres || return 1
  wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" postgres 180 || return 1
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" --profile operations run --rm migrate || return 1
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" --profile operations run --rm bootstrap-admin || return 1
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps api || return 1
  wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" api 240 || return 1
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps supplier-web tmmin-web || return 1
  wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" supplier-web 180 || return 1
  wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" tmmin-web 180 || return 1
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps caddy --remove-orphans || return 1
  wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" caddy 120 || return 1
  if [[ "${DEPLOY_FORCE_SMOKE_FAILURE:-false}" == "true" && "${APP_ENV}" == "staging" ]]; then
    echo "A staging-only forced smoke failure was requested." >&2
    return 1
  fi
  "${RELEASE_DIR}/deploy/scripts/smoke-check.sh" \
    "${REQUESTED_SHA}" \
    "https://${SUPPLIER_DOMAIN}" \
    "https://${TMMIN_DOMAIN}" \
    "https://${API_DOMAIN}" || return 1
}

if ! candidate_deploy; then
  echo "Candidate deployment failed. No database down migration will be attempted." >&2
  if [[ -n "${previous_release}" && "${previous_release}" != "${REQUESTED_SHA}" ]]; then
    DEPLOY_LOCK_HELD=true "${BASE_DIR}/releases/${previous_release}/deploy/scripts/remote-rollback.sh" \
      "${REQUESTED_ENV}" "${previous_release}" "${BASE_DIR}" || echo "Automatic code rollback also failed." >&2
  else
    compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" stop caddy supplier-web tmmin-web api || true
    echo "No previous code release was available; failed application services were stopped while persistent PostgreSQL was preserved." >&2
  fi
  exit 1
fi

activate_symlink "${RELEASE_DIR}" "${BASE_DIR}/current"
printf '%s\n' "${REQUESTED_SHA}" >"${BASE_DIR}/current_release.tmp"
mv "${BASE_DIR}/current_release.tmp" "${BASE_DIR}/current_release"

release_directories=()
while IFS= read -r release_entry; do
  release_directories+=("${release_entry}")
done < <(ls -1dt -- "${BASE_DIR}/releases/"*)

kept_releases=("${RELEASE_DIR}")
if [[ -n "${previous_release}" && -d "${BASE_DIR}/releases/${previous_release}" ]]; then
  kept_releases+=("${BASE_DIR}/releases/${previous_release}")
fi
for release_entry in "${release_directories[@]}"; do
  already_kept=false
  for kept_release in "${kept_releases[@]}"; do
    if [[ "${release_entry}" == "${kept_release}" ]]; then
      already_kept=true
      break
    fi
  done
  if [[ "${already_kept}" == "false" && ${#kept_releases[@]} -lt 5 ]]; then
    kept_releases+=("${release_entry}")
  fi
done

for stale_dir in "${release_directories[@]}"; do
  should_keep=false
  for kept_release in "${kept_releases[@]}"; do
    if [[ "${stale_dir}" == "${kept_release}" ]]; then
      should_keep=true
      break
    fi
  done
  [[ "${should_keep}" == "false" ]] || continue
  require_safe_path "${stale_dir}" "${BASE_DIR}/releases"
  stale_sha="$(basename "${stale_dir}")"
  require_sha "${stale_sha}"
  rm -rf -- "${stale_dir}"
  docker image rm \
    "supplier-henkaten-api:${stale_sha}" \
    "supplier-henkaten-supplier-web:${stale_sha}" \
    "supplier-henkaten-tmmin-web:${stale_sha}" \
    "supplier-henkaten-caddy:${stale_sha}" >/dev/null 2>&1 || true
done

rm -f -- "${ARCHIVE}" "${RUNTIME_ENV_INCOMING}"
printf 'Release %s is active; previous release was %s.\n' "${REQUESTED_SHA}" "${previous_release:-none}"
