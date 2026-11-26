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

for pointer_path in "${BASE_DIR}/current_release" "${RELEASE_DIR}/.activated"; do
  if [[ -d "${pointer_path}" && ! -L "${pointer_path}" ]]; then
    die "${pointer_path} is a directory; repair it before deploying."
  fi
done
if [[ -e "${BASE_DIR}/current" && ! -L "${BASE_DIR}/current" ]]; then
  die "${BASE_DIR}/current is not a symlink; repair it before deploying."
fi
install_hardened_rollback_driver "${RELEASE_DIR}/deploy/scripts" "${BASE_DIR}" || die "Failed to install hardened rollback driver."

saved_image_refs=()
saved_image_ids=()
image_snapshot_complete=true
if [[ -n "${previous_release}" ]]; then
  previous_dir_for_snapshot="${BASE_DIR}/releases/${previous_release}"
  previous_pinned_images="${previous_dir_for_snapshot}/.activated-images"
  # Look up the PREVIOUS release's own PostgreSQL reference so a candidate that bumps the postgres tag
  # still finds (and restores) the previous release's pinned image instead of degrading the snapshot.
  snapshot_candidates=("$(postgres_image_ref_for "${previous_dir_for_snapshot}")")
  if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
    snapshot_candidates+=(
      "supplier-henkaten-api:${REQUESTED_SHA}"
      "supplier-henkaten-supplier-web:${REQUESTED_SHA}"
      "supplier-henkaten-tmmin-web:${REQUESTED_SHA}"
      "supplier-henkaten-caddy:${REQUESTED_SHA}"
    )
  fi
  if [[ ! -f "${previous_pinned_images}" && ! -L "${previous_pinned_images}" && -d "${previous_dir_for_snapshot}" ]] && release_is_hardened "${previous_dir_for_snapshot}"; then
    # Hardened releases record .activated-images at activation. A missing manifest is lost evidence, so the
    # legacy wall-clock backfill must never reconstruct pins from whatever containers are running now.
    if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
      die "Cannot safely redeploy active release ${REQUESTED_SHA}: hardened release is missing .activated-images; legacy pin backfill is not permitted for hardened releases."
    fi
    image_snapshot_complete=false
    mark_rollback_unsafe "${previous_dir_for_snapshot}" "${previous_release}" || die "Cannot safely proceed with build: hardened previous release ${previous_release} is missing .activated-images and .rollback-unsafe could not be persisted."
    echo "Warning: hardened previous release ${previous_release} is missing .activated-images; marked rollback-unsafe instead of backfilling legacy pins." >&2
  elif [[ ! -f "${previous_pinned_images}" && ! -e "${previous_dir_for_snapshot}/.rollback-unsafe" && ! -L "${previous_dir_for_snapshot}/.rollback-unsafe" && -d "${previous_dir_for_snapshot}" ]]; then
    if ! write_activated_images "${previous_dir_for_snapshot}" "${previous_release}" "${previous_dir_for_snapshot}/.runtime.env" "${BASE_DIR}/current_release"; then
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
# Open from the first service mutation until a definitive outcome (activation, or completed automatic
# recovery). If the deploy is interrupted or dies inside this window, the EXIT trap stops the candidate's
# application services (PostgreSQL preserved) so no mixed stack keeps serving traffic.
deploy_mutation_open=false
stop_candidate_on_interrupted_mutation() {
  local status=$?
  if [[ "${deploy_mutation_open}" == "true" ]]; then
    # Cleanup must not be interrupted by a second signal or killed by a broken output pipe.
    trap '' TERM INT HUP PIPE
    failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}" || true
    note_stderr "Deploy of ${REQUESTED_SHA} ended or was interrupted inside its service-mutation window; stopped application services while preserving PostgreSQL."
    # Neither success (0) nor "recovery completed" (3) may ever be reported from an open mutation window.
    if [[ "${status}" -eq 0 || "${status}" -eq "${AUTOMATIC_ROLLBACK_COMPLETED_EXIT}" ]]; then
      status=1
    fi
  fi
  exit "${status}"
}
trap stop_candidate_on_interrupted_mutation EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
forced_smoke_failure_reached=false
# Exit status reserved for "candidate failed, shared hardened driver completed automatic recovery"
# so callers (rehearse-staging.sh) can prove recovery actually ran rather than inferring it from state.
AUTOMATIC_ROLLBACK_COMPLETED_EXIT=3
candidate_deploy() {
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" build --pull postgres api supplier-web tmmin-web caddy || return 1
  deploy_mutation_open=true
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
    forced_smoke_failure_reached=true
    return 1
  fi
  "${RELEASE_DIR}/deploy/scripts/smoke-check.sh" \
    "${REQUESTED_SHA}" \
    "https://${SUPPLIER_DOMAIN}" \
    "https://${TMMIN_DOMAIN}" \
    "https://${API_DOMAIN}" || return 1
  write_activated_images "${RELEASE_DIR}" "${REQUESTED_SHA}" "${RUNTIME_ENV}" || return 1
}

# If the candidate's own (unproven) driver fails during recovery, retry once with the bundle of the last
# successfully activated deploy. The parent has already verified restored tags and a complete snapshot of
# a pinned target, so the fallback driver only ever restarts verified pins.
run_known_good_rollback_driver() {
  local good_driver candidate_bundle good_bundle
  good_driver="$(known_good_rollback_driver_path "${BASE_DIR}")"
  [[ -x "${good_driver}" ]] || return 1
  candidate_bundle="$(cd "$(dirname "$(hardened_rollback_driver_path "${BASE_DIR}")")" 2>/dev/null && pwd -P)" || candidate_bundle=""
  good_bundle="$(cd "$(dirname "${good_driver}")" 2>/dev/null && pwd -P)" || return 1
  [[ "${good_bundle}" != "${candidate_bundle}" ]] || return 1
  # Only a strict-contract bundle (refuses unpinned targets) may be retried, and the target's complete
  # five-image manifest is revalidated (every pinned ID present locally, tags restored and re-verified)
  # immediately before the retry, since the failed candidate attempt may have touched tags.
  if ! rollback_driver_bundle_is_strict "${good_bundle}"; then
    echo "Known-good rollback driver ${good_bundle} lacks the strict pin contract; not retrying." >&2
    return 1
  fi
  if [[ ! -f "${previous_dir}/.activated-images" || -L "${previous_dir}/.activated-images" ]] ||
    ! restore_pinned_images_file "${previous_dir}/.activated-images" "${previous_dir}" "${previous_release}"; then
    echo "Target ${previous_release} pins could not be revalidated; not retrying with the known-good driver." >&2
    return 1
  fi
  echo "Candidate rollback driver failed; retrying recovery once with the known-good driver ${good_bundle}." >&2
  DEPLOY_LOCK_HELD=true "${good_driver}" "${REQUESTED_ENV}" "${previous_release}" "${BASE_DIR}"
}

if ! candidate_deploy; then
  # From here on a closed SSH session (cancelled runner) must not kill recovery mid-way via SIGPIPE.
  trap '' PIPE
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
    failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}" || true
    echo "Refusing automatic rollback because pre-build Docker image tags could not be verified as restored or target release ${previous_release} is marked rollback-unsafe; failed application services were stopped while persistent PostgreSQL was preserved." >&2
    exit 1
  fi
  previous_env="${previous_dir}/.runtime.env"
  if [[ -n "${previous_release}" && -f "${previous_env}" ]] &&
    [[ -f "${previous_dir}/.source.sha" && "$(<"${previous_dir}/.source.sha")" == "${previous_release}" ]] &&
    "${RELEASE_DIR}/deploy/scripts/validate-runtime-env.sh" --allow-legacy-db-role "${previous_env}" >/dev/null &&
    (load_runtime_env "${previous_env}" && [[ "${APP_ENV:-}" == "${REQUESTED_ENV}" && "${RELEASE_SHA:-}" == "${previous_release}" ]]); then
    # Always recover through the shared hardened driver (installed from this candidate under the
    # deploy lock) so legacy release scripts that start services from mutable tags are never trusted.
    hardened_rollback_driver="$(hardened_rollback_driver_path "${BASE_DIR}")"
    candidate_driver_status=0
    if [[ -x "${hardened_rollback_driver}" ]] &&
      rollback_driver_bundle_is_strict "$(cd "$(dirname "${hardened_rollback_driver}")" 2>/dev/null && pwd -P)"; then
      DEPLOY_LOCK_HELD=true "${hardened_rollback_driver}" \
        "${REQUESTED_ENV}" "${previous_release}" "${BASE_DIR}" || candidate_driver_status=$?
    else
      echo "Candidate hardened rollback driver is unavailable or lacks the strict pin contract." >&2
      candidate_driver_status=127
    fi
    # A deliberate policy refusal by the candidate driver is final; only crashes/other failures (or a
    # missing candidate driver) may be retried once with the strict known-good driver.
    if (( candidate_driver_status != 0 )) &&
      { (( candidate_driver_status == ROLLBACK_POLICY_REFUSAL_EXIT )) || ! run_known_good_rollback_driver; }; then
      echo "Automatic code rollback failed or was refused (candidate driver exit ${candidate_driver_status}); stopping failed candidate application services while preserving PostgreSQL." >&2
      failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}" || true
    elif [[ ! -f "${BASE_DIR}/current_release" || "$(<"${BASE_DIR}/current_release")" != "${previous_release}" ]] ||
      ! verify_running_matches_manifest "${previous_dir}" "${previous_env}" "${previous_release}"; then
      echo "A rollback driver reported success but ${previous_release} is not verifiably active on its pinned images; stopping application services while preserving PostgreSQL." >&2
      failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}" || true
    else
      # Recovery is verified: close the mutation window BEFORE writing to a possibly broken stdout, so a
      # failed write can never make the trap stop the healthy restored release.
      deploy_mutation_open=false
      { printf 'DEPLOY_RESULT=automatic-rollback-completed forced_smoke_failure=%s restored=%s\n' \
        "${forced_smoke_failure_reached}" "${previous_release}"; } 2>/dev/null || true
      exit "${AUTOMATIC_ROLLBACK_COMPLETED_EXIT}"
    fi
  else
    failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}" || true
    echo "No validated previous code release was available; failed application services were stopped while persistent PostgreSQL was preserved." >&2
  fi
  exit 1
fi

publish_line_file "${REQUESTED_SHA}" "${RELEASE_DIR}/.activated" || die "Failed to publish ${RELEASE_DIR}/.activated."
activate_symlink "${RELEASE_DIR}" "${BASE_DIR}/current" || die "Failed to re-point ${BASE_DIR}/current."
[[ -L "${BASE_DIR}/current" && "$(readlink "${BASE_DIR}/current")" == "${RELEASE_DIR}" ]] || die "Failed to re-point ${BASE_DIR}/current."
publish_line_file "${REQUESTED_SHA}" "${BASE_DIR}/current_release" || die "Failed to publish ${BASE_DIR}/current_release."
deploy_mutation_open=false
promote_rollback_driver "${BASE_DIR}" || echo "Warning: failed to promote the activated release's rollback driver as known-good." >&2

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
