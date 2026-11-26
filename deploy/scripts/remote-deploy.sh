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

previous_release=""
if [[ -f "${BASE_DIR}/current_release" ]]; then
  previous_release="$(<"${BASE_DIR}/current_release")"
  require_sha "${previous_release}"
fi

normalized_runtime_env() {
  grep -Ev '^[[:space:]]*(#|$|DEPLOY_RUN_NUMBER=)' "$1" | LC_ALL=C sort
}

RELEASE_DIR="${BASE_DIR}/releases/${REQUESTED_SHA}"
if [[ -d "${RELEASE_DIR}" ]]; then
  [[ -f "${RELEASE_DIR}/.source.sha" && "$(<"${RELEASE_DIR}/.source.sha")" == "${REQUESTED_SHA}" ]] || die "Existing release directory failed source identity validation."
  if [[ "${previous_release}" == "${REQUESTED_SHA}" || -f "${RELEASE_DIR}/.activated" ]]; then
    [[ -f "${RELEASE_DIR}/.runtime.env" ]] || die "Existing activated release runtime env is missing."
    "${SCRIPT_DIR}/validate-runtime-env.sh" "${RELEASE_DIR}/.runtime.env"
    if ! diff -q <(normalized_runtime_env "${RELEASE_DIR}/.runtime.env") <(normalized_runtime_env "${RUNTIME_ENV_INCOMING}") >/dev/null 2>&1; then
      die "Existing activated release ${REQUESTED_SHA} has an immutable runtime env that differs from incoming configuration; deploy a new release SHA to apply configuration or secret changes without mutating rollback snapshots."
    fi
  else
    install -m 600 "${RUNTIME_ENV_INCOMING}" "${RELEASE_DIR}/.runtime.env.tmp"
    mv -f "${RELEASE_DIR}/.runtime.env.tmp" "${RELEASE_DIR}/.runtime.env"
  fi
  rm -rf -- "${INCOMING_DIR}"
else
  install -m 600 "${RUNTIME_ENV_INCOMING}" "${INCOMING_DIR}/.runtime.env"
  printf '%s\n' "${REQUESTED_SHA}" >"${INCOMING_DIR}/.source.sha"
  mv "${INCOMING_DIR}" "${RELEASE_DIR}"
fi
RUNTIME_ENV="${RELEASE_DIR}/.runtime.env"
load_runtime_env "${RUNTIME_ENV}"
[[ "${APP_ENV}" == "${REQUESTED_ENV}" && "${RELEASE_SHA}" == "${REQUESTED_SHA}" ]] || die "Stored runtime environment identity mismatch."

install_hardened_rollback_driver "${RELEASE_DIR}/deploy/scripts" "${BASE_DIR}" || die "Failed to install hardened rollback driver."

postgres_image_ref="$(postgres_image_ref_for "${RELEASE_DIR}")"
saved_image_refs=()
saved_image_ids=()
image_snapshot_complete=true
if [[ -n "${previous_release}" ]]; then
  previous_dir_for_snapshot="${BASE_DIR}/releases/${previous_release}"
  previous_pinned_images="${previous_dir_for_snapshot}/.activated-images"
  snapshot_candidates=("${postgres_image_ref}")
  if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
    snapshot_candidates+=(
      "supplier-henkaten-api:${REQUESTED_SHA}"
      "supplier-henkaten-supplier-web:${REQUESTED_SHA}"
      "supplier-henkaten-tmmin-web:${REQUESTED_SHA}"
      "supplier-henkaten-caddy:${REQUESTED_SHA}"
    )
  fi
  if [[ ! -f "${previous_pinned_images}" && ! -e "${previous_dir_for_snapshot}/.rollback-unsafe" && ! -L "${previous_dir_for_snapshot}/.rollback-unsafe" && -d "${previous_dir_for_snapshot}" ]]; then
    if ! write_activated_images "${previous_dir_for_snapshot}" "${previous_release}" "${previous_dir_for_snapshot}/.runtime.env"; then
      if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
        die "Cannot safely redeploy active release ${REQUESTED_SHA}: unable to persist pre-build baseline pins in .activated-images."
      fi
      image_snapshot_complete=false
      mark_rollback_unsafe "${previous_dir_for_snapshot}" "${previous_release}" || die "Cannot safely proceed with build: failed to backfill .activated-images or persist .rollback-unsafe for ${previous_release}."
    fi
  fi
  if [[ -f "${previous_pinned_images}" && ! -L "${previous_pinned_images}" ]]; then
    for image_ref in "${snapshot_candidates[@]}"; do
      pinned_id="$(awk -v target="${image_ref}" '$1 == target {print $2; exit}' "${previous_pinned_images}" 2>/dev/null || true)"
      if [[ -z "${pinned_id}" ]]; then
        if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
          die "Cannot safely redeploy active release ${REQUESTED_SHA}: missing pinned image ID for ${image_ref} in .activated-images."
        fi
        image_snapshot_complete=false
        echo "Warning: missing pinned image ID for ${image_ref} in previous release .activated-images." >&2
        continue
      fi
      resolved_pinned_id="$(docker image inspect --format '{{.Id}}' "${pinned_id}" 2>/dev/null || true)"
      if [[ "${resolved_pinned_id}" != "${pinned_id}" ]]; then
        if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
          die "Cannot safely redeploy active release ${REQUESTED_SHA}: pinned Docker image ID ${pinned_id} for ${image_ref} is unavailable locally."
        fi
        image_snapshot_complete=false
        echo "Warning: pinned Docker image ID ${pinned_id} for ${image_ref} is unavailable locally." >&2
        continue
      fi
      saved_image_refs+=("${image_ref}")
      saved_image_ids+=("${pinned_id}")
    done
  else
    if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
      die "Cannot safely redeploy active release ${REQUESTED_SHA}: release lacks verified .activated-images or is marked rollback-unsafe."
    fi
    image_snapshot_complete=false
    echo "Warning: previous release ${previous_release} lacks verified .activated-images before build." >&2
  fi
fi

restore_saved_images() {
  local idx restored_id status=0
  for ((idx = 0; idx < ${#saved_image_refs[@]}; idx++)); do
    if ! docker tag "${saved_image_ids[idx]}" "${saved_image_refs[idx]}" >/dev/null 2>&1; then
      echo "Failed to restore Docker image tag ${saved_image_refs[idx]} to ${saved_image_ids[idx]}." >&2
      status=1
      continue
    fi
    restored_id="$(docker image inspect --format '{{.Id}}' "${saved_image_refs[idx]}" 2>/dev/null || true)"
    if [[ "${restored_id}" != "${saved_image_ids[idx]}" ]]; then
      echo "Restored Docker image tag ${saved_image_refs[idx]} resolved to '${restored_id}', expected '${saved_image_ids[idx]}'." >&2
      status=1
    fi
  done
  return "${status}"
}

services_mutated=false
candidate_deploy() {
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" build --pull postgres api supplier-web tmmin-web caddy || return 1
  services_mutated=true
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
  write_activated_images "${RELEASE_DIR}" "${REQUESTED_SHA}" "${RUNTIME_ENV}" || return 1
}

if ! candidate_deploy; then
  echo "Candidate deployment failed. No database down migration will be attempted." >&2
  previous_dir="${BASE_DIR}/releases/${previous_release}"
  images_restored=true
  if ! restore_saved_images; then
    images_restored=false
  fi
  if [[ "${images_restored}" != "true" || "${image_snapshot_complete}" != "true" ]]; then
    if [[ -n "${previous_release}" && -d "${previous_dir}" ]]; then
      mark_rollback_unsafe "${previous_dir}" "${REQUESTED_SHA}" || echo "Warning: failed to persist .rollback-unsafe marker for ${previous_release}." >&2
    fi
  fi
  if [[ -n "${previous_release}" && "${services_mutated}" == "false" ]]; then
    echo "Failure occurred before modifying running services; active release ${previous_release} was preserved untouched." >&2
    exit 1
  fi
  if [[ -n "${previous_release}" && ( "${images_restored}" != "true" || "${image_snapshot_complete}" != "true" || ( ( -e "${previous_dir}/.rollback-unsafe" || -L "${previous_dir}/.rollback-unsafe" ) && ! -f "${previous_dir}/.activated-images" ) ) ]]; then
    compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" stop caddy supplier-web tmmin-web api || true
    echo "Refusing automatic rollback because pre-build Docker image tags could not be verified as restored or target release ${previous_release} is marked rollback-unsafe; failed application services were stopped while persistent PostgreSQL was preserved." >&2
    exit 1
  fi
  previous_env="${previous_dir}/.runtime.env"
  if [[ -n "${previous_release}" && -f "${previous_env}" ]] &&
    [[ -f "${previous_dir}/.source.sha" && "$(<"${previous_dir}/.source.sha")" == "${previous_release}" ]] &&
    "${RELEASE_DIR}/deploy/scripts/validate-runtime-env.sh" --allow-legacy-db-role "${previous_env}" >/dev/null &&
    (load_runtime_env "${previous_env}" && [[ "${APP_ENV:-}" == "${REQUESTED_ENV}" && "${RELEASE_SHA:-}" == "${previous_release}" ]]); then
    if ! DEPLOY_LOCK_HELD=true "${previous_dir}/deploy/scripts/remote-rollback.sh" \
      "${REQUESTED_ENV}" "${previous_release}" "${BASE_DIR}"; then
      echo "Automatic code rollback also failed; stopping failed candidate application services while preserving PostgreSQL." >&2
      compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" stop caddy supplier-web tmmin-web api || true
    fi
  else
    compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" stop caddy supplier-web tmmin-web api || true
    echo "No validated previous code release was available; failed application services were stopped while persistent PostgreSQL was preserved." >&2
  fi
  exit 1
fi

printf '%s\n' "${REQUESTED_SHA}" >"${RELEASE_DIR}/.activated.tmp"
mv "${RELEASE_DIR}/.activated.tmp" "${RELEASE_DIR}/.activated"
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
