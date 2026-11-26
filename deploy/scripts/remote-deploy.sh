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
log_info "[deploy] Acquired deploy lock for env=${REQUESTED_ENV} sha=${REQUESTED_SHA} run=${REQUESTED_RUN} (high-water ${highest_seen} -> ${REQUESTED_RUN})."

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
    log_info "[deploy] Reusing existing activated release directory ${RELEASE_DIR} (immutable .runtime.env verified)."
  else
    install -m 600 "${RUNTIME_ENV_INCOMING}" "${RELEASE_DIR}/.runtime.env.tmp"
    mv -f "${RELEASE_DIR}/.runtime.env.tmp" "${RELEASE_DIR}/.runtime.env"
    log_info "[deploy] Reusing unactivated release directory ${RELEASE_DIR} (refreshed .runtime.env)."
  fi
  rm -rf -- "${INCOMING_DIR}"
else
  install -m 600 "${RUNTIME_ENV_INCOMING}" "${INCOMING_DIR}/.runtime.env"
  printf '%s\n' "${REQUESTED_SHA}" >"${INCOMING_DIR}/.source.sha"
  mv "${INCOMING_DIR}" "${RELEASE_DIR}"
  log_info "[deploy] Staged new release directory ${RELEASE_DIR} (previous_release=${previous_release:-none})."
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
    if parsed_prev_manifest="$(parse_manifest_file "${previous_pinned_images}" "${previous_dir_for_snapshot}" "${previous_release}")"; then
      pin_status=0
      ensure_manifest_pins "${REQUESTED_ENV}" "${previous_dir_for_snapshot}" "${previous_release}" || pin_status=$?
      if (( pin_status == 0 )); then
        while IFS=' ' read -r snap_svc snap_ref snap_id; do
          if [[ "${previous_release}" == "${REQUESTED_SHA}" || "${snap_svc}" == "postgres" ]]; then
            saved_image_refs+=("${snap_ref}")
            saved_image_ids+=("${snap_id}")
          fi
        done <<<"${parsed_prev_manifest}"
        log_info "[deploy] Verified and retained all 5 pre-build pins for previous release ${previous_release} (snapshotted ${#saved_image_refs[@]} tag(s) for rollback restoration)."
      elif (( pin_status == 2 )); then
        if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
          die "Cannot safely redeploy active release ${REQUESTED_SHA}: one or more pinned Docker image IDs in .activated-images are confirmed missing locally."
        fi
        image_snapshot_complete=false
        echo "Warning: previous release ${previous_release} has confirmed-missing pinned image ID(s) locally (any still-present images were retained); automatic rollback will be unavailable." >&2
      elif (( pin_status == 3 )); then
        if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
          die "Cannot safely redeploy active release ${REQUESTED_SHA}: .activated-images manifest is invalid."
        fi
        image_snapshot_complete=false
        echo "Warning: previous release ${previous_release} has an invalid .activated-images manifest before build." >&2
      else
        die "Cannot safely proceed with build: operational Docker error verifying or retaining pins for previous release ${previous_release}; aborting before overwriting runtime tags."
      fi
    else
      if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
        die "Cannot safely redeploy active release ${REQUESTED_SHA}: .activated-images manifest is invalid."
      fi
      image_snapshot_complete=false
      echo "Warning: previous release ${previous_release} has an invalid .activated-images manifest before build." >&2
    fi
  else
    if [[ "${previous_release}" == "${REQUESTED_SHA}" ]]; then
      die "Cannot safely redeploy active release ${REQUESTED_SHA}: release lacks verified .activated-images or is marked rollback-unsafe."
    fi
    image_snapshot_complete=false
    echo "Warning: previous release ${previous_release} lacks verified .activated-images before build." >&2
  fi
fi

# Retain pins for an already-activated target release being redeployed cross-SHA (e.g. staging
# rehearsal roll-forward) so rebuilding its tags never garbage-collects its committed images.
if [[ "${previous_release}" != "${REQUESTED_SHA}" && -f "${RELEASE_DIR}/.activated" && -f "${RELEASE_DIR}/.activated-images" && ! -L "${RELEASE_DIR}/.activated-images" ]]; then
  target_pin_status=0
  ensure_manifest_pins "${REQUESTED_ENV}" "${RELEASE_DIR}" "${REQUESTED_SHA}" || target_pin_status=$?
  if (( target_pin_status == 1 )); then
    die "Cannot safely proceed with build: failed to retain Docker pins for existing activated release ${REQUESTED_SHA}."
  fi
fi

# Materialize missing retention tags for other retained releases (v2 -> v3 upgrade).
# Abort before build if an operational Docker error prevents protecting an older retained release.
for retained_dir in "${BASE_DIR}/releases/"*; do
  [[ -d "${retained_dir}" && "${retained_dir}" != "${RELEASE_DIR}" ]] || continue
  [[ -z "${previous_release}" || "${retained_dir}" != "${BASE_DIR}/releases/${previous_release}" ]] || continue
  [[ -f "${retained_dir}/.activated-images" && ! -L "${retained_dir}/.activated-images" ]] || continue
  retained_sha="$(basename "${retained_dir}")"
  [[ "${retained_sha}" =~ ^[0-9a-f]{40}$ ]] || continue
  retained_pin_status=0
  ensure_manifest_pins "${REQUESTED_ENV}" "${retained_dir}" "${retained_sha}" || retained_pin_status=$?
  if (( retained_pin_status == 1 )); then
    die "Cannot safely proceed with build: operational Docker error retaining pins for older release ${retained_sha}; aborting before overwriting shared tags."
  elif (( retained_pin_status != 0 )); then
    note_stderr "Warning: older release ${retained_sha} had confirmed-missing local image(s) or an invalid manifest (status ${retained_pin_status})."
  fi
done

restore_saved_images() {
  local idx restored_id tag_err status=0
  for ((idx = 0; idx < ${#saved_image_refs[@]}; idx++)); do
    if ! tag_err="$(docker tag "${saved_image_ids[idx]}" "${saved_image_refs[idx]}" 2>&1)"; then
      note_stderr "Failed to restore Docker image tag ${saved_image_refs[idx]} to ${saved_image_ids[idx]} (${tag_err:-docker tag failed})."
      status=1
      continue
    fi
    restored_id="$(docker image inspect --format '{{.Id}}' "${saved_image_refs[idx]}" 2>/dev/null || true)"
    if [[ "${restored_id}" != "${saved_image_ids[idx]}" ]]; then
      note_stderr "Restored Docker image tag ${saved_image_refs[idx]} resolved to '${restored_id:-<empty>}', expected '${saved_image_ids[idx]}'."
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
candidate_manifest="${RELEASE_DIR}/.activated-images.candidate.${REQUESTED_RUN}"
staged_manifest="${RELEASE_DIR}/.activated-images.staged.${REQUESTED_RUN}"
stop_candidate_on_interrupted_mutation() {
  local status=$?
  rm -f -- "${candidate_manifest}" "${staged_manifest}" >/dev/null 2>&1 || true
  if [[ "${deploy_mutation_open}" == "true" ]]; then
    # Cleanup must not be interrupted by a second signal or killed by a broken output pipe.
    trap '' TERM INT HUP PIPE
    if failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}"; then
      note_stderr "Deploy of ${REQUESTED_SHA} ended or was interrupted inside its service-mutation window; stopped application services while preserving PostgreSQL."
    else
      note_stderr "Deploy of ${REQUESTED_SHA} ended or was interrupted inside its service-mutation window, and fail-closed stop reported errors; inspect container state immediately."
    fi
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
trap 'exit 141' PIPE
forced_smoke_failure_reached=false
# Exit status reserved for "candidate failed, shared hardened driver completed automatic recovery"
# so callers (rehearse-staging.sh) can prove recovery actually ran rather than inferring it from state.
AUTOMATIC_ROLLBACK_COMPLETED_EXIT=3
candidate_deploy() {
  local pg_ref svc ref built_id api_tag_id
  local candidate_pg_id="" candidate_api_id="" candidate_supplier_id="" candidate_tmmin_id="" candidate_caddy_id=""
  local api_ref="supplier-henkaten-api:${REQUESTED_SHA}"

  # Disable BuildKit default provenance attestations so unchanged rebuilds (especially postgres) keep
  # stable image IDs across deploys instead of churning OCI manifest-list digests. Correctness does not
  # depend on this opt-out; retention pins and exact-image reconciliation handle changed IDs regardless.
  log_info "[deploy] Building 5 release images for ${REQUESTED_SHA} (BUILDX_NO_DEFAULT_ATTESTATIONS=1)."
  if ! BUILDX_NO_DEFAULT_ATTESTATIONS=1 compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" build --pull postgres api supplier-web tmmin-web caddy; then
    note_stderr "Candidate deploy failed during docker compose build for ${REQUESTED_SHA}."
    return 1
  fi

  pg_ref="$(postgres_image_ref_for "${RELEASE_DIR}")"
  rm -f -- "${candidate_manifest}" "${staged_manifest}"
  install -m 600 /dev/null "${candidate_manifest}" || {
    note_stderr "Candidate deploy failed creating staged candidate manifest ${candidate_manifest}."
    return 1
  }
  for svc in "${DEPLOY_SERVICES[@]}"; do
    ref="$(service_image_ref_for "${RELEASE_DIR}" "${REQUESTED_SHA}" "${svc}")"
    if ! built_id="$(docker image inspect --format '{{.Id}}' "${ref}" 2>&1)"; then
      note_stderr "Candidate deploy failed capturing built image ID for ${svc} (${ref}): ${built_id:-inspect failed}."
      return 1
    fi
    if ! validate_image_id "${built_id}"; then
      note_stderr "Candidate deploy failed: built image ID '${built_id:-<empty>}' for ${svc} (${ref}) is invalid."
      return 1
    fi
    if ! pin_image_id "${REQUESTED_ENV}" "${svc}" "${built_id}"; then
      note_stderr "Candidate deploy failed retaining built image ID ${built_id} for ${svc}."
      return 1
    fi
    log_info "[deploy] Built and pinned ${svc}: ref='${ref}' id='${built_id}'."
    printf '%s %s\n' "${ref}" "${built_id}" >>"${candidate_manifest}" || {
      note_stderr "Candidate deploy failed writing staged candidate manifest ${candidate_manifest}."
      return 1
    }
    case "${svc}" in
      postgres) candidate_pg_id="${built_id}" ;;
      api) candidate_api_id="${built_id}" ;;
      supplier-web) candidate_supplier_id="${built_id}" ;;
      tmmin-web) candidate_tmmin_id="${built_id}" ;;
      caddy) candidate_caddy_id="${built_id}" ;;
    esac
  done

  log_info "[deploy] Opening service mutation window; reconciling postgres before migrations."
  deploy_mutation_open=true
  services_mutated=true
  if ! ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" postgres "${pg_ref}" "${candidate_pg_id}" 180; then
    note_stderr "Candidate deploy failed reconciling postgres for ${REQUESTED_SHA}."
    return 1
  fi

  api_tag_id="$(docker image inspect --format '{{.Id}}' "${api_ref}" 2>/dev/null || true)"
  if [[ "${api_tag_id}" != "${candidate_api_id}" ]]; then
    note_stderr "Candidate deploy failed before migrate: ${api_ref} resolved to '${api_tag_id:-<empty>}', expected '${candidate_api_id}'."
    return 1
  fi
  log_info "[deploy] Running database migrations and runtime role provisioning (migrate --no-deps --pull never) using ${api_ref} (${candidate_api_id})."
  if ! compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" --profile operations run --rm --no-deps --pull never migrate; then
    note_stderr "Candidate deploy failed during database migration / runtime role provisioning for ${REQUESTED_SHA}."
    return 1
  fi
  api_tag_id="$(docker image inspect --format '{{.Id}}' "${api_ref}" 2>/dev/null || true)"
  if [[ "${api_tag_id}" != "${candidate_api_id}" ]]; then
    note_stderr "Candidate deploy failed before bootstrap-admin: ${api_ref} resolved to '${api_tag_id:-<empty>}', expected '${candidate_api_id}'."
    return 1
  fi
  log_info "[deploy] Running idempotent bootstrap-admin (--no-deps --pull never) using ${api_ref} (${candidate_api_id})."
  if ! compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" --profile operations run --rm --no-deps --pull never bootstrap-admin; then
    note_stderr "Candidate deploy failed during bootstrap-admin for ${REQUESTED_SHA}."
    return 1
  fi

  log_info "[deploy] Reconciling application services (api, supplier-web, tmmin-web, caddy)."
  if ! ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" api "${api_ref}" "${candidate_api_id}" 240; then
    note_stderr "Candidate deploy failed reconciling api for ${REQUESTED_SHA}."
    return 1
  fi
  if ! ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" supplier-web "supplier-henkaten-supplier-web:${REQUESTED_SHA}" "${candidate_supplier_id}" 180; then
    note_stderr "Candidate deploy failed reconciling supplier-web for ${REQUESTED_SHA}."
    return 1
  fi
  if ! ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" tmmin-web "supplier-henkaten-tmmin-web:${REQUESTED_SHA}" "${candidate_tmmin_id}" 180; then
    note_stderr "Candidate deploy failed reconciling tmmin-web for ${REQUESTED_SHA}."
    return 1
  fi
  if ! ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" caddy "supplier-henkaten-caddy:${REQUESTED_SHA}" "${candidate_caddy_id}" 120 --remove-orphans; then
    note_stderr "Candidate deploy failed reconciling caddy for ${REQUESTED_SHA}."
    return 1
  fi

  if [[ "${DEPLOY_FORCE_SMOKE_FAILURE:-false}" == "true" && "${APP_ENV}" == "staging" ]]; then
    echo "A staging-only forced smoke failure was requested." >&2
    forced_smoke_failure_reached=true
    return 1
  fi
  log_info "[deploy] Running three-surface smoke checks for ${REQUESTED_SHA} (${SUPPLIER_DOMAIN}, ${TMMIN_DOMAIN}, ${API_DOMAIN})."
  if ! "${RELEASE_DIR}/deploy/scripts/smoke-check.sh" \
    "${REQUESTED_SHA}" \
    "https://${SUPPLIER_DOMAIN}" \
    "https://${TMMIN_DOMAIN}" \
    "https://${API_DOMAIN}"; then
    note_stderr "Candidate deploy failed during three-surface smoke checks for ${REQUESTED_SHA}."
    return 1
  fi
  log_info "[deploy] Smoke checks passed; verifying all 5 running containers and staging .activated-images."
  if ! write_activated_images "${RELEASE_DIR}" "${REQUESTED_SHA}" "${RUNTIME_ENV}" "" "${candidate_manifest}" "${staged_manifest}"; then
    note_stderr "Candidate deploy failed verifying/staging pinned image manifest for ${REQUESTED_SHA}."
    return 1
  fi
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
    note_stderr "Known-good rollback driver ${good_bundle} lacks the strict pin contract; not retrying."
    return 1
  fi
  if [[ ! -f "${previous_dir}/.activated-images" || -L "${previous_dir}/.activated-images" ]] ||
    ! restore_pinned_images_file "${previous_dir}/.activated-images" "${previous_dir}" "${previous_release}" "${REQUESTED_ENV}"; then
    note_stderr "Target ${previous_release} pins could not be revalidated; not retrying with the known-good driver."
    return 1
  fi
  note_stderr "Candidate rollback driver failed; retrying recovery once with the known-good driver ${good_bundle}."
  DEPLOY_LOCK_HELD=true "${good_driver}" "${REQUESTED_ENV}" "${previous_release}" "${BASE_DIR}"
}

if ! candidate_deploy; then
  # From here on a closed SSH session (cancelled runner) must not kill recovery mid-way via SIGPIPE
  # or via an EPIPE write error under `set -e` (all writes use note_stderr / log_info / `|| true`).
  trap '' PIPE
  rm -f -- "${candidate_manifest}" "${staged_manifest}" >/dev/null 2>&1 || true
  note_stderr "Candidate deployment failed. No database down migration will be attempted."
  previous_dir="${BASE_DIR}/releases/${previous_release}"
  images_restored=true
  if ! restore_saved_images; then
    images_restored=false
  fi
  if [[ "${images_restored}" != "true" || "${image_snapshot_complete}" != "true" ]]; then
    if [[ -n "${previous_release}" && -d "${previous_dir}" ]]; then
      mark_rollback_unsafe "${previous_dir}" "${REQUESTED_SHA}" || note_stderr "Warning: failed to persist .rollback-unsafe marker for ${previous_release}."
    fi
  fi
  if [[ -n "${previous_release}" && "${services_mutated}" == "false" ]]; then
    note_stderr "Failure occurred before modifying running services; active release ${previous_release} was preserved untouched."
    exit 1
  fi
  if [[ -n "${previous_release}" && ( "${images_restored}" != "true" || "${image_snapshot_complete}" != "true" || ( ( -e "${previous_dir}/.rollback-unsafe" || -L "${previous_dir}/.rollback-unsafe" ) && ! -f "${previous_dir}/.activated-images" ) ) ]]; then
    refuse_reasons=()
    if [[ "${images_restored}" != "true" ]]; then
      refuse_reasons+=("pre-build Docker image tags could not be verified as restored")
    fi
    if [[ "${image_snapshot_complete}" != "true" ]]; then
      refuse_reasons+=("pre-build baseline pin snapshot for ${previous_release} was incomplete")
    fi
    if [[ ( -e "${previous_dir}/.rollback-unsafe" || -L "${previous_dir}/.rollback-unsafe" ) && ! -f "${previous_dir}/.activated-images" ]]; then
      refuse_reasons+=("target release ${previous_release} is marked rollback-unsafe without .activated-images")
    fi
    stop_note="failed application services were stopped while persistent PostgreSQL was preserved"
    if ! failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}"; then
      stop_note="fail-closed stop of application services reported errors; inspect container state immediately"
    fi
    note_stderr "Refusing automatic rollback because $(IFS='; '; printf '%s' "${refuse_reasons[*]}"); ${stop_note}."
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
      log_info "[deploy] Invoking shared hardened rollback driver ${hardened_rollback_driver} to recover ${previous_release}."
      DEPLOY_LOCK_HELD=true "${hardened_rollback_driver}" \
        "${REQUESTED_ENV}" "${previous_release}" "${BASE_DIR}" || candidate_driver_status=$?
      log_info "[deploy] Candidate rollback driver exited with status ${candidate_driver_status}."
    else
      note_stderr "Candidate hardened rollback driver is unavailable or lacks the strict pin contract."
      candidate_driver_status=127
    fi
    # A deliberate policy refusal by the candidate driver is final; only crashes/other failures (or a
    # missing candidate driver) may be retried once with the strict known-good driver.
    if (( candidate_driver_status != 0 )) &&
      { (( candidate_driver_status == ROLLBACK_POLICY_REFUSAL_EXIT )) || ! run_known_good_rollback_driver; }; then
      note_stderr "Automatic code rollback failed or was refused (candidate driver exit ${candidate_driver_status}); stopping failed candidate application services while preserving PostgreSQL."
      failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}" || true
    elif [[ ! -f "${BASE_DIR}/current_release" || "$(<"${BASE_DIR}/current_release")" != "${previous_release}" ]] ||
      ! verify_running_matches_manifest "${previous_dir}" "${previous_env}" "${previous_release}" "${REQUESTED_ENV}"; then
      note_stderr "A rollback driver reported success but ${previous_release} is not verifiably active on its pinned images; stopping application services while preserving PostgreSQL."
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
    note_stderr "No validated previous code release was available; failed application services were stopped while persistent PostgreSQL was preserved."
  fi
  exit 1
fi

# Atomic activation commit:
# - Brand-new release: commit .activated-images BEFORE publishing .activated/current/current_release so
#   current_release can never point at a new release lacking its manifest.
# - Already-activated release (same-SHA or retained-SHA redeploy): back up its committed .activated-images
#   and publish pointers first, then swap .activated-images last so an interrupted pointer write never
#   corrupts the prior committed generation.
already_activated=false
if [[ -f "${RELEASE_DIR}/.activated" ]]; then
  already_activated=true
fi
prev_manifest_backup=""
if [[ -f "${RELEASE_DIR}/.activated-images" && ! -L "${RELEASE_DIR}/.activated-images" ]]; then
  prev_manifest_backup="$(mktemp "${RELEASE_DIR}/.activated-images.prev.XXXXXX")" || die "Failed to create backup before committing ${RELEASE_DIR}/.activated-images."
  cp -p "${RELEASE_DIR}/.activated-images" "${prev_manifest_backup}" || {
    rm -f -- "${prev_manifest_backup}"
    die "Failed to back up ${RELEASE_DIR}/.activated-images before commit."
  }
fi
commit_manifest_file() {
  if ! rename_exact "${staged_manifest}" "${RELEASE_DIR}/.activated-images" ||
    [[ ! -f "${RELEASE_DIR}/.activated-images" || -L "${RELEASE_DIR}/.activated-images" ]] ||
    ! rm -f -- "${RELEASE_DIR}/.rollback-unsafe" ||
    [[ -e "${RELEASE_DIR}/.rollback-unsafe" || -L "${RELEASE_DIR}/.rollback-unsafe" ]]; then
    if [[ -n "${prev_manifest_backup}" ]]; then
      rename_exact "${prev_manifest_backup}" "${RELEASE_DIR}/.activated-images" >/dev/null 2>&1 || true
    else
      rm -f -- "${RELEASE_DIR}/.activated-images" >/dev/null 2>&1 || true
    fi
    return 1
  fi
}
if [[ "${already_activated}" == "false" ]]; then
  log_info "[deploy] Committing .activated-images and publishing activation pointers for new release ${REQUESTED_SHA}."
  commit_manifest_file || die "Failed to commit ${RELEASE_DIR}/.activated-images or clear .rollback-unsafe."
else
  log_info "[deploy] Publishing activation pointers and updating .activated-images for already-activated release ${REQUESTED_SHA}."
fi
if ! publish_line_file "${REQUESTED_SHA}" "${RELEASE_DIR}/.activated"; then
  if [[ "${already_activated}" == "false" && -z "${prev_manifest_backup}" ]]; then
    rm -f -- "${RELEASE_DIR}/.activated-images" >/dev/null 2>&1 || true
  fi
  rm -f -- "${prev_manifest_backup}" >/dev/null 2>&1 || true
  die "Failed to publish ${RELEASE_DIR}/.activated."
fi
if ! activate_symlink "${RELEASE_DIR}" "${BASE_DIR}/current" ||
  [[ ! -L "${BASE_DIR}/current" || "$(readlink "${BASE_DIR}/current")" != "${RELEASE_DIR}" ]]; then
  rm -f -- "${prev_manifest_backup}" >/dev/null 2>&1 || true
  die "Failed to re-point ${BASE_DIR}/current."
fi
if ! publish_line_file "${REQUESTED_SHA}" "${BASE_DIR}/current_release"; then
  rm -f -- "${prev_manifest_backup}" >/dev/null 2>&1 || true
  die "Failed to publish ${BASE_DIR}/current_release."
fi
if [[ "${already_activated}" == "true" ]]; then
  commit_manifest_file || die "Failed to commit ${RELEASE_DIR}/.activated-images or clear .rollback-unsafe."
fi
rm -f -- "${candidate_manifest}" "${staged_manifest}" "${prev_manifest_backup}" >/dev/null 2>&1 || true
deploy_mutation_open=false
trap '' PIPE
promote_rollback_driver "${BASE_DIR}" || note_stderr "Warning: failed to promote the activated release's rollback driver as known-good."

release_directories=()
while IFS= read -r release_entry; do
  release_directories+=("${release_entry}")
done < <(ls -1dt -- "${BASE_DIR}/releases/"*)

kept_releases=("${RELEASE_DIR}")
if [[ -n "${previous_release}" && "${previous_release}" != "${REQUESTED_SHA}" && -d "${BASE_DIR}/releases/${previous_release}" ]]; then
  kept_releases+=("${BASE_DIR}/releases/${previous_release}")
fi
# Prioritize locally verified rollback-capable activated releases over broken or unactivated
# directories so a recent malformed/missing-image release cannot evict a healthy rollback target
# from the 5-release retention budget. If Docker cannot determine the local image inventory,
# fail safe by skipping destructive release and retention-tag cleanup for this run.
retention_inventory_indeterminate=false
for pass in verified_activated activated other; do
  [[ "${retention_inventory_indeterminate}" == "false" ]] || break
  for release_entry in "${release_directories[@]}"; do
    (( ${#kept_releases[@]} < 5 )) || break
    already_kept=false
    for kept_release in "${kept_releases[@]}"; do
      if [[ "${release_entry}" == "${kept_release}" ]]; then
        already_kept=true
        break
      fi
    done
    [[ "${already_kept}" == "false" ]] || continue
    if [[ "${pass}" == "verified_activated" ]]; then
      ver_rc=0
      release_is_verified_rollback_target "${release_entry}" || ver_rc=$?
      if (( ver_rc == 1 )); then
        retention_inventory_indeterminate=true
        note_stderr "Warning: indeterminate Docker inspection error while ranking retained release ${release_entry}; skipping destructive release and pin-tag cleanup for this run."
        break
      fi
      (( ver_rc == 0 )) || continue
    elif [[ "${pass}" == "activated" ]]; then
      [[ -f "${release_entry}/.activated" && -f "${release_entry}/.activated-images" ]] || continue
    fi
    kept_releases+=("${release_entry}")
  done
done

if [[ "${retention_inventory_indeterminate}" == "false" ]]; then
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
    log_info "[prune] Removing stale release directory ${stale_sha} and its application runtime tags."
    rm -rf -- "${stale_dir}"
    for stale_svc in api supplier-web tmmin-web caddy; do
      docker image rm --no-prune "supplier-henkaten-${stale_svc}:${stale_sha}" >/dev/null 2>&1 || true
    done
  done

  prune_unreferenced_pin_tags "${REQUESTED_ENV}" "${kept_releases[@]}"
fi

rm -f -- "${ARCHIVE}" "${RUNTIME_ENV_INCOMING}"
printf 'Release %s is active; previous release was %s.\n' "${REQUESTED_SHA}" "${previous_release:-none}"
