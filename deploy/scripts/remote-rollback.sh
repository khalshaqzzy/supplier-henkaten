#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

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

printf 'Rolling code back to %s; database schema and shared volumes are not restored.\n' "${REQUESTED_SHA}"
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

printf '%s\n' "${REQUESTED_SHA}" >"${RELEASE_DIR}/.activated.tmp"
mv "${RELEASE_DIR}/.activated.tmp" "${RELEASE_DIR}/.activated"
activate_symlink "${RELEASE_DIR}" "${BASE_DIR}/current"
printf '%s\n' "${REQUESTED_SHA}" >"${BASE_DIR}/current_release.tmp"
mv "${BASE_DIR}/current_release.tmp" "${BASE_DIR}/current_release"
printf 'Rollback completed for %s.\n' "${REQUESTED_SHA}"
