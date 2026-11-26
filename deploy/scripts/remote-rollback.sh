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

is_hardened_release=false
if [[ -n "${POSTGRES_APP_USER:-}" || -f "${RELEASE_DIR}/apps/api/src/cli/migrate.ts" ]]; then
  is_hardened_release=true
fi
if [[ "${is_hardened_release}" == "true" && ! -f "${RELEASE_DIR}/.activated" ]]; then
  refuse "Rollback aborted: release ${REQUESTED_SHA} was never activated."
fi
if [[ -L "${RELEASE_DIR}/.activated-images" || ( -e "${RELEASE_DIR}/.activated-images" && ! -f "${RELEASE_DIR}/.activated-images" ) ]]; then
  refuse "Rollback aborted: ${RELEASE_DIR}/.activated-images is not a regular file."
fi
if [[ -L "${RELEASE_DIR}/.rollback-unsafe" || ( -e "${RELEASE_DIR}/.rollback-unsafe" && ! -f "${RELEASE_DIR}/.rollback-unsafe" ) ]]; then
  refuse "Rollback aborted: ${RELEASE_DIR}/.rollback-unsafe is not a regular file."
fi
if [[ -f "${RELEASE_DIR}/.activated-images" ]]; then
  if ! restore_pinned_images_file "${RELEASE_DIR}/.activated-images" "${RELEASE_DIR}" "${REQUESTED_SHA}"; then
    mark_rollback_unsafe "${RELEASE_DIR}" "${REQUESTED_SHA}" || echo "Warning: failed to persist .rollback-unsafe marker for ${REQUESTED_SHA}." >&2
    refuse "Rollback aborted: failed to restore and verify pinned activated images for ${REQUESTED_SHA}."
  fi
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
    trap - TERM INT HUP
    compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" stop caddy supplier-web tmmin-web api || true
    echo "Rollback to ${REQUESTED_SHA} failed or was interrupted after services began changing; stopped Caddy and application services while preserving PostgreSQL to avoid serving a mixed release. Re-run this driver for a release with verified pins (for example the release named by current_release)." >&2
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

# Pointer destinations must be publishable BEFORE any service changes (a directory left by a manual restore
# would otherwise swallow the pointer while the rollback reports success).
for pointer_path in "${BASE_DIR}/current_release" "${RELEASE_DIR}/.activated"; do
  if [[ -d "${pointer_path}" && ! -L "${pointer_path}" ]]; then
    refuse "Rollback aborted: ${pointer_path} is a directory; repair it before rolling back."
  fi
done
if [[ -e "${BASE_DIR}/current" && ! -L "${BASE_DIR}/current" ]]; then
  refuse "Rollback aborted: ${BASE_DIR}/current is not a symlink; repair it before rolling back."
fi

printf 'Rolling code back to %s; database schema and shared volumes are not restored.\n' "${REQUESTED_SHA}"
rollback_mutating=true
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps postgres
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" postgres 180
if [[ -n "${POSTGRES_APP_USER:-}" && -n "${POSTGRES_APP_PASSWORD:-}" && -f "${RELEASE_DIR}/apps/api/src/cli/migrate.ts" ]]; then
  compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" --profile operations run --rm --entrypoint node migrate dist/cli/migrate.js --provision-role-only
fi
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps api
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" api 240
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps supplier-web tmmin-web
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" supplier-web 180
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" tmmin-web 180
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps caddy --remove-orphans
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" caddy 120

"${RELEASE_DIR}/deploy/scripts/smoke-check.sh" \
  "${REQUESTED_SHA}" \
  "https://${SUPPLIER_DOMAIN}" \
  "https://${TMMIN_DOMAIN}" \
  "https://${API_DOMAIN}"

rm -f -- "${RELEASE_DIR}/.rollback-unsafe"
publish_line_file "${REQUESTED_SHA}" "${RELEASE_DIR}/.activated" || die "Failed to publish ${RELEASE_DIR}/.activated."
activate_symlink "${RELEASE_DIR}" "${BASE_DIR}/current" || die "Failed to re-point ${BASE_DIR}/current."
[[ -L "${BASE_DIR}/current" && "$(readlink "${BASE_DIR}/current")" == "${RELEASE_DIR}" ]] || die "Failed to re-point ${BASE_DIR}/current."
publish_line_file "${REQUESTED_SHA}" "${BASE_DIR}/current_release" || die "Failed to publish ${BASE_DIR}/current_release."
rollback_mutating=false
printf 'Rollback completed for %s.\n' "${REQUESTED_SHA}"
