#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

[[ $# -eq 5 ]] || die "Usage: rehearse-staging.sh <previous-sha> <current-sha> <base-dir> <expected-vm-host> I_ACCEPT_STAGING_INTERRUPTION"
PREVIOUS_SHA="$1"
CURRENT_SHA="$2"
BASE_DIR="$3"
EXPECTED_HOST="$4"
CONFIRMATION="$5"
[[ "${CONFIRMATION}" == "I_ACCEPT_STAGING_INTERRUPTION" ]] || die "Explicit staging interruption confirmation is required."
require_sha "${PREVIOUS_SHA}"
require_sha "${CURRENT_SHA}"
[[ -n "${EXPECTED_HOST}" && ! "${EXPECTED_HOST}" =~ [[:space:]] ]] || die "Expected VM host is invalid."
[[ -f "${BASE_DIR}/current_release" && "$(<"${BASE_DIR}/current_release")" == "${CURRENT_SHA}" ]] || die "The requested current release is not active."

PREVIOUS_DIR="${BASE_DIR}/releases/${PREVIOUS_SHA}"
CURRENT_DIR="${BASE_DIR}/releases/${CURRENT_SHA}"
[[ -d "${PREVIOUS_DIR}" && -f "${PREVIOUS_DIR}/.runtime.env" ]] || die "Previous release is unavailable."
[[ -d "${CURRENT_DIR}" && -f "${CURRENT_DIR}/.runtime.env" ]] || die "Current release is unavailable."

HIGH_WATER_FILE="${BASE_DIR}/shared/deployment-state/highest_seen_run"
[[ -f "${HIGH_WATER_FILE}" ]] || die "Deployment high-water state is unavailable."
highest_seen="$(<"${HIGH_WATER_FILE}")"
[[ "${highest_seen}" =~ ^[0-9]+$ ]] || die "Deployment high-water state is invalid."
REHEARSAL_RUN="$((highest_seen + 1))"

INCOMING_DIR="${BASE_DIR}/incoming/${CURRENT_SHA}.${REHEARSAL_RUN}"
ARCHIVE="${BASE_DIR}/incoming/${CURRENT_SHA}.${REHEARSAL_RUN}.tar.gz"
RUNTIME_ENV="${BASE_DIR}/incoming/${CURRENT_SHA}.${REHEARSAL_RUN}.env"
SENTINEL="${BASE_DIR}/shared/member-photos/.rollback-rehearsal-sentinel"

cleanup() {
  rm -rf -- "${INCOMING_DIR}"
  rm -f -- "${ARCHIVE}" "${RUNTIME_ENV}" "${SENTINEL}"
}
trap cleanup EXIT

database_identity() {
  local release_dir="$1"
  local runtime_env="$2"
  compose_for "${release_dir}" "${runtime_env}" exec -T postgres \
    psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DATABASE}" \
    --tuples-only --no-align --command 'SELECT system_identifier FROM pg_control_system();'
}

load_runtime_env "${CURRENT_DIR}/.runtime.env"
[[ "${APP_ENV}" == "staging" ]] || die "Rehearsal is restricted to staging."
DATABASE_IDENTITY="$(database_identity "${CURRENT_DIR}" "${CURRENT_DIR}/.runtime.env")"
[[ "${DATABASE_IDENTITY}" =~ ^[0-9]+$ ]] || die "Could not capture the PostgreSQL cluster identity."
printf '%s\n' "${CURRENT_SHA}" >"${SENTINEL}"

"${CURRENT_DIR}/deploy/scripts/remote-rollback.sh" staging "${PREVIOUS_SHA}" "${BASE_DIR}"
[[ -f "${SENTINEL}" && "$(<"${SENTINEL}")" == "${CURRENT_SHA}" ]] || die "Photo-volume sentinel was not preserved by rollback."
load_runtime_env "${PREVIOUS_DIR}/.runtime.env"
[[ "$(database_identity "${PREVIOUS_DIR}" "${PREVIOUS_DIR}/.runtime.env")" == "${DATABASE_IDENTITY}" ]] || die "PostgreSQL cluster identity changed during rollback."

mkdir -p "${INCOMING_DIR}"
tar --exclude='.runtime.env' -czf "${ARCHIVE}" -C "${CURRENT_DIR}" .
tar -xzf "${ARCHIVE}" -C "${INCOMING_DIR}"
umask 077
sed "s/^DEPLOY_RUN_NUMBER=.*/DEPLOY_RUN_NUMBER=${REHEARSAL_RUN}/" \
  "${CURRENT_DIR}/.runtime.env" >"${RUNTIME_ENV}"
ARCHIVE_SHA256="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"

if DEPLOY_FORCE_SMOKE_FAILURE=true "${INCOMING_DIR}/deploy/scripts/remote-deploy.sh" \
  staging "${CURRENT_SHA}" "${REHEARSAL_RUN}" "${BASE_DIR}" "${INCOMING_DIR}" \
  "${RUNTIME_ENV}" "${ARCHIVE}" "${ARCHIVE_SHA256}" "${EXPECTED_HOST}"; then
  die "Forced-smoke candidate unexpectedly succeeded."
fi

[[ "$(<"${BASE_DIR}/current_release")" == "${PREVIOUS_SHA}" ]] || die "Automatic rollback did not restore the previous release."
[[ -f "${SENTINEL}" && "$(<"${SENTINEL}")" == "${CURRENT_SHA}" ]] || die "Photo-volume sentinel was not preserved by automatic rollback."
load_runtime_env "${PREVIOUS_DIR}/.runtime.env"
[[ "$(database_identity "${PREVIOUS_DIR}" "${PREVIOUS_DIR}/.runtime.env")" == "${DATABASE_IDENTITY}" ]] || die "PostgreSQL cluster identity changed during automatic rollback."

"${CURRENT_DIR}/deploy/scripts/remote-rollback.sh" staging "${CURRENT_SHA}" "${BASE_DIR}"
[[ "$(<"${BASE_DIR}/current_release")" == "${CURRENT_SHA}" ]] || die "Latest release was not restored."
[[ -f "${SENTINEL}" ]] || die "Photo-volume sentinel was not preserved while restoring the latest release."
load_runtime_env "${CURRENT_DIR}/.runtime.env"
[[ "$(database_identity "${CURRENT_DIR}" "${CURRENT_DIR}/.runtime.env")" == "${DATABASE_IDENTITY}" ]] || die "PostgreSQL cluster identity changed while restoring the latest release."

printf 'Staging forced-smoke rollback preserved PostgreSQL/photos and restored %s.\n' "${CURRENT_SHA}"
