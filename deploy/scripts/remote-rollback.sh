#!/usr/bin/env bash
set -euo pipefail

# Resolve the physical directory so a concurrently republished shared driver symlink can never
# mix lib.sh / validate-runtime-env.sh from different driver versions within one run.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

# Deliberate policy refusals (unsafe/unpinned/unverifiable target) exit with a dedicated status so the
# automatic known-good fallback in remote-deploy.sh never overrides them; other failures exit 1.
refuse() {
  printf '%s\n' "$*" >&2
  exit "${ROLLBACK_POLICY_REFUSAL_EXIT}"
}

[[ $# -eq 3 ]] || die "Usage: remote-rollback.sh <app-env> <release-sha> <base-dir>"
REQUESTED_ENV="$1"
REQUESTED_SHA="$2"
BASE_DIR="$3"
require_sha "${REQUESTED_SHA}"
[[ "${REQUESTED_ENV}" =~ ^(staging|production)$ ]] || die "APP_ENV must be staging or production."
RELEASE_DIR="${BASE_DIR}/releases/${REQUESTED_SHA}"
RUNTIME_ENV="${RELEASE_DIR}/.runtime.env"
[[ -d "${RELEASE_DIR}" && -f "${RUNTIME_ENV}" ]] || die "Rollback release or its runtime env is unavailable."
[[ -f "${RELEASE_DIR}/.source.sha" && "$(<"${RELEASE_DIR}/.source.sha")" == "${REQUESTED_SHA}" ]] || die "Rollback release directory failed source identity validation."

if [[ "${DEPLOY_LOCK_HELD:-false}" != "true" ]]; then
  exec 9>"${BASE_DIR}/deploy.lock"
  flock -n 9 || die "Another deploy or rollback is already running."
fi

"${SCRIPT_DIR}/validate-runtime-env.sh" --allow-legacy-db-role "${RUNTIME_ENV}"
load_runtime_env "${RUNTIME_ENV}"
[[ "${REQUESTED_ENV}" == "${APP_ENV:-}" && "${REQUESTED_SHA}" == "${RELEASE_SHA:-}" ]] || die "Rollback environment or release SHA mismatch."

# Pointer destinations must be publishable BEFORE any Docker tag or service changes (a directory left
# by a manual restore would otherwise swallow the pointer or mutate tags before refusing).
for pointer_path in "${BASE_DIR}/current_release" "${RELEASE_DIR}/.activated"; do
  if [[ -d "${pointer_path}" && ! -L "${pointer_path}" ]]; then
    refuse "Rollback aborted: ${pointer_path} is a directory; repair it before rolling back."
  fi
done
if [[ -e "${BASE_DIR}/current" && ! -L "${BASE_DIR}/current" ]]; then
  refuse "Rollback aborted: ${BASE_DIR}/current is not a symlink; repair it before rolling back."
fi

is_hardened_release=false
if [[ -n "${POSTGRES_APP_USER:-}" ]] || release_is_hardened "${RELEASE_DIR}"; then
  is_hardened_release=true
fi
log_info "[rollback] Starting rollback: env=${REQUESTED_ENV} target=${REQUESTED_SHA} hardened=${is_hardened_release} driver=${SCRIPT_DIR}"
if [[ "${is_hardened_release}" == "true" && ! -f "${RELEASE_DIR}/.activated" ]]; then
  refuse "Rollback aborted: release ${REQUESTED_SHA} was never activated."
fi
if [[ -L "${RELEASE_DIR}/.activated-images" || ( -e "${RELEASE_DIR}/.activated-images" && ! -f "${RELEASE_DIR}/.activated-images" ) ]]; then
  refuse "Rollback aborted: ${RELEASE_DIR}/.activated-images is not a regular file."
fi
if [[ -L "${RELEASE_DIR}/.rollback-unsafe" || ( -e "${RELEASE_DIR}/.rollback-unsafe" && ! -f "${RELEASE_DIR}/.rollback-unsafe" ) ]]; then
  refuse "Rollback aborted: ${RELEASE_DIR}/.rollback-unsafe is not a regular file."
fi

# Retain pins for the outgoing active release (when different and pinned) before retagging the shared
# PostgreSQL tag so rolling back never garbage-collects the outgoing release's PostgreSQL image.
if [[ -f "${BASE_DIR}/current_release" && ! -L "${BASE_DIR}/current_release" ]]; then
  outgoing_sha="$(<"${BASE_DIR}/current_release")"
  if [[ "${outgoing_sha}" =~ ^[0-9a-f]{40}$ && "${outgoing_sha}" != "${REQUESTED_SHA}" ]]; then
    outgoing_dir="${BASE_DIR}/releases/${outgoing_sha}"
    if [[ -f "${outgoing_dir}/.activated-images" && ! -L "${outgoing_dir}/.activated-images" ]]; then
      ensure_manifest_pins "${REQUESTED_ENV}" "${outgoing_dir}" "${outgoing_sha}" || note_stderr "Warning: could not retain all pins for outgoing release ${outgoing_sha} before rollback."
    fi
  fi
fi

target_pg_ref=""
target_pg_id=""
target_api_ref=""
target_api_id=""
target_supplier_ref=""
target_supplier_id=""
target_tmmin_ref=""
target_tmmin_id=""
target_caddy_ref=""
target_caddy_id=""

if [[ -f "${RELEASE_DIR}/.activated-images" ]]; then
  if ! parsed_target_manifest="$(parse_manifest_file "${RELEASE_DIR}/.activated-images" "${RELEASE_DIR}" "${REQUESTED_SHA}")"; then
    mark_rollback_unsafe "${RELEASE_DIR}" "${REQUESTED_SHA}" || echo "Warning: failed to persist .rollback-unsafe marker for ${REQUESTED_SHA}." >&2
    refuse "Rollback aborted: ${RELEASE_DIR}/.activated-images failed strict manifest validation."
  fi
  if ! restore_pinned_images_file "${RELEASE_DIR}/.activated-images" "${RELEASE_DIR}" "${REQUESTED_SHA}" "${REQUESTED_ENV}"; then
    mark_rollback_unsafe "${RELEASE_DIR}" "${REQUESTED_SHA}" || echo "Warning: failed to persist .rollback-unsafe marker for ${REQUESTED_SHA}." >&2
    refuse "Rollback aborted: failed to restore and verify pinned activated images for ${REQUESTED_SHA}."
  fi
  while IFS=' ' read -r rb_svc rb_ref rb_id; do
    case "${rb_svc}" in
      postgres) target_pg_ref="${rb_ref}"; target_pg_id="${rb_id}" ;;
      api) target_api_ref="${rb_ref}"; target_api_id="${rb_id}" ;;
      supplier-web) target_supplier_ref="${rb_ref}"; target_supplier_id="${rb_id}" ;;
      tmmin-web) target_tmmin_ref="${rb_ref}"; target_tmmin_id="${rb_id}" ;;
      caddy) target_caddy_ref="${rb_ref}"; target_caddy_id="${rb_id}" ;;
    esac
  done <<<"${parsed_target_manifest}"
elif [[ -e "${RELEASE_DIR}/.rollback-unsafe" || -L "${RELEASE_DIR}/.rollback-unsafe" ]]; then
  refuse "Rollback aborted: release ${REQUESTED_SHA} is marked rollback-unsafe and has no pinned activated image IDs."
else
  # Never start a retained release from mutable shared tags (e.g. a PostgreSQL tag rebuilt by a later
  # candidate) and never record whatever those tags currently resolve to as the release's pins.
  refuse "Rollback aborted: release ${REQUESTED_SHA} has no verified .activated-images pins; ship the desired code as a new commit (for example a git revert) on the deployment branch so the pipeline builds and pins it."
fi

# Once services start being replaced, any failure (health, smoke, pointer update) must not leave a mixed
# stack serving traffic (e.g. the target API behind the old Caddy/frontends). Fail closed: stop Caddy and the
# application services while preserving PostgreSQL; the release pointer still names the prior release, whose
# verified pins let an operator recover it through this driver.
# The mutation flag alone decides cleanup (it is cleared only after full success), so an interrupted run
# (SIGTERM/SIGINT/SIGHUP, where Bash may enter the EXIT trap with status 0) also fails closed.
rollback_mutating=false
stop_mixed_stack_on_failure() {
  local status=$?
  if [[ "${rollback_mutating}" == "true" ]]; then
    # Cleanup must not be interrupted by a second signal or killed by a broken output pipe.
    trap '' TERM INT HUP PIPE
    if failclosed_stop_app_services "${RELEASE_DIR}" "${RUNTIME_ENV}" "${BASE_DIR}"; then
      note_stderr "Rollback to ${REQUESTED_SHA} failed or was interrupted after services began changing; stopped Caddy and application services while preserving PostgreSQL to avoid serving a mixed release. Re-run this driver for a release with verified pins (for example the release named by current_release)."
    else
      note_stderr "Rollback to ${REQUESTED_SHA} failed or was interrupted after services began changing, and fail-closed stop reported errors; inspect container state immediately."
    fi
    # Exit 4 is reserved for refusals BEFORE any change; a post-mutation failure (e.g. a target smoke-check or
    # migrate container that happens to return 4) must stay retryable by the known-good fallback.
    if [[ "${status}" -eq 0 || "${status}" -eq "${ROLLBACK_POLICY_REFUSAL_EXIT}" ]]; then
      status=1
    fi
  fi
  exit "${status}"
}
trap stop_mixed_stack_on_failure EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

printf 'Rolling code back to %s; database schema and shared volumes are not restored.\n' "${REQUESTED_SHA}"
log_info "[rollback] Pre-mutation checks passed (pointers, activation proof, 5-image manifest restored and pinned); quiescing Caddy and opening mutation window."
rollback_mutating=true
# Quiesce ingress BEFORE replacing anything: with the current Caddy stopped, no request can reach a
# half-replaced stack even if Compose stalls (catchable signals are deferred until it returns). Caddy is
# started again last, only after the API and frontends of the target release are healthy.
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" stop caddy
log_info "[rollback] Caddy quiesced; reconciling postgres to pinned image ${target_pg_id}."
ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" postgres "${target_pg_ref}" "${target_pg_id}" 180
if [[ -n "${POSTGRES_APP_USER:-}" && -n "${POSTGRES_APP_PASSWORD:-}" && -f "${RELEASE_DIR}/apps/api/src/cli/migrate.ts" ]]; then
  rb_api_tag_id="$(docker image inspect --format '{{.Id}}' "${target_api_ref}" 2>/dev/null || true)"
  [[ "${rb_api_tag_id}" == "${target_api_id}" ]] || die "Rollback aborted before role reconciliation: ${target_api_ref} resolved to '${rb_api_tag_id:-<empty>}', expected '${target_api_id}'."
  log_info "[rollback] Reconciling least-privilege PostgreSQL runtime role (--provision-role-only) using ${target_api_ref} (${target_api_id})."
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" --profile operations run --rm --no-deps --pull never --entrypoint node migrate dist/cli/migrate.js --provision-role-only
fi
log_info "[rollback] Reconciling application services (api, supplier-web, tmmin-web, caddy) to pinned images."
ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" api "${target_api_ref}" "${target_api_id}" 240
ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" supplier-web "${target_supplier_ref}" "${target_supplier_id}" 180
ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" tmmin-web "${target_tmmin_ref}" "${target_tmmin_id}" 180
ensure_service_runs_image "${RELEASE_DIR}" "${RUNTIME_ENV}" caddy "${target_caddy_ref}" "${target_caddy_id}" 120 --remove-orphans

log_info "[rollback] Running three-surface smoke checks for ${REQUESTED_SHA} (${SUPPLIER_DOMAIN}, ${TMMIN_DOMAIN}, ${API_DOMAIN})."
"${RELEASE_DIR}/deploy/scripts/smoke-check.sh" \
  "${REQUESTED_SHA}" \
  "https://${SUPPLIER_DOMAIN}" \
  "https://${TMMIN_DOMAIN}" \
  "https://${API_DOMAIN}"

# Independently verify all five running containers, runtime tags, and retention pins match the target
# manifest BEFORE clearing .rollback-unsafe or publishing pointers (protects manual rollbacks too).
log_info "[rollback] Self-verifying all 5 running containers, runtime tags, and retention pins against .activated-images."
verify_running_matches_manifest "${RELEASE_DIR}" "${RUNTIME_ENV}" "${REQUESTED_SHA}" "${REQUESTED_ENV}"

log_info "[rollback] Publishing rollback activation markers and release pointers for ${REQUESTED_SHA}."

rm -f -- "${RELEASE_DIR}/.rollback-unsafe"
publish_line_file "${REQUESTED_SHA}" "${RELEASE_DIR}/.activated" || die "Failed to publish ${RELEASE_DIR}/.activated."
activate_symlink "${RELEASE_DIR}" "${BASE_DIR}/current" || die "Failed to re-point ${BASE_DIR}/current."
[[ -L "${BASE_DIR}/current" && "$(readlink "${BASE_DIR}/current")" == "${RELEASE_DIR}" ]] || die "Failed to re-point ${BASE_DIR}/current."
publish_line_file "${REQUESTED_SHA}" "${BASE_DIR}/current_release" || die "Failed to publish ${BASE_DIR}/current_release."
rollback_mutating=false
printf 'Rollback completed for %s.\n' "${REQUESTED_SHA}"
