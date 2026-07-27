#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

[[ $# -eq 3 ]] || die "Usage: remote-rollback.sh <app-env> <release-sha> <base-dir>"
REQUESTED_ENV="$1"
RELEASE_SHA="$2"
BASE_DIR="$3"
require_sha "${RELEASE_SHA}"
[[ "${REQUESTED_ENV}" =~ ^(staging|production)$ ]] || die "APP_ENV must be staging or production."
RELEASE_DIR="${BASE_DIR}/releases/${RELEASE_SHA}"
RUNTIME_ENV="${RELEASE_DIR}/.runtime.env"
[[ -d "${RELEASE_DIR}" && -f "${RUNTIME_ENV}" ]] || die "Rollback release or its runtime env is unavailable."

if [[ "${DEPLOY_LOCK_HELD:-false}" != "true" ]]; then
  exec 9>"${BASE_DIR}/deploy.lock"
  flock -n 9 || die "Another deploy or rollback is already running."
fi

load_runtime_env "${RUNTIME_ENV}"
[[ "${REQUESTED_ENV}" == "${APP_ENV:-}" ]] || die "Rollback environment mismatch."

printf 'Rolling code back to %s; database schema and shared volumes are not restored.\n' "${RELEASE_SHA}"
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps postgres
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" postgres 180
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps api
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" api 240
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps supplier-web tmmin-web
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" supplier-web 180
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" tmmin-web 180
compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" up -d --no-deps caddy --remove-orphans
wait_for_service "${RELEASE_DIR}" "${RUNTIME_ENV}" caddy 120

"${RELEASE_DIR}/deploy/scripts/smoke-check.sh" \
  "${RELEASE_SHA}" \
  "https://${SUPPLIER_DOMAIN}" \
  "https://${TMMIN_DOMAIN}" \
  "https://${API_DOMAIN}"

activate_symlink "${RELEASE_DIR}" "${BASE_DIR}/current"
printf '%s\n' "${RELEASE_SHA}" >"${BASE_DIR}/current_release.tmp"
mv "${BASE_DIR}/current_release.tmp" "${BASE_DIR}/current_release"
printf 'Rollback completed for %s.\n' "${RELEASE_SHA}"
