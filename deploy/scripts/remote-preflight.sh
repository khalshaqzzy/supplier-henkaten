#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

[[ $# -eq 6 ]] || die "Usage: remote-preflight.sh <release-dir> <runtime-env> <base-dir> <archive> <archive-sha256> <expected-host>"
RELEASE_DIR="$1"
RUNTIME_ENV="$2"
BASE_DIR="$3"
ARCHIVE="$4"
ARCHIVE_SHA256="$5"
EXPECTED_HOST="$6"

require_command docker
require_command jq
require_command curl
require_command getent
require_command sha256sum
require_command stat
require_safe_path "${RELEASE_DIR}" "${BASE_DIR}"
require_safe_path "${ARCHIVE}" "${BASE_DIR}"
[[ -d "${RELEASE_DIR}" ]] || die "Incoming release directory is missing."
[[ -f "${RELEASE_DIR}/deploy/compose/docker-compose.remote.yml" ]] || die "Remote Compose file is missing."
[[ -f "${ARCHIVE}" ]] || die "Release archive is missing."
[[ "${ARCHIVE_SHA256}" =~ ^[0-9a-f]{64}$ ]] || die "Archive checksum has an invalid shape."
printf '%s  %s\n' "${ARCHIVE_SHA256}" "${ARCHIVE}" | sha256sum --check --status || die "Release archive checksum mismatch."

[[ -r /etc/os-release ]] || die "Cannot identify the VM operating system."
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "22.04" ]] || die "The hosted runtime requires Ubuntu 22.04 LTS."

"${SCRIPT_DIR}/validate-runtime-env.sh" "${RUNTIME_ENV}"
load_runtime_env "${RUNTIME_ENV}"

docker info >/dev/null
docker_version="$(docker version --format '{{.Server.Version}}')"
compose_version="$(docker compose version --short)"
version_ge "${docker_version}" "24.0.0" || die "Docker Engine 24.0.0 or newer is required."
version_ge "${compose_version}" "2.20.0" || die "Docker Compose 2.20.0 or newer is required."

for path in "${BASE_DIR}" "${BASE_DIR}/releases" "${BASE_DIR}/incoming" "${BASE_DIR}/shared"; do
  [[ -d "${path}" && -w "${path}" ]] || die "Required writable directory is unavailable: ${path}"
done
for path in member-photos caddy-data caddy-config deployment-state; do
  [[ -d "${BASE_DIR}/shared/${path}" && -w "${BASE_DIR}/shared/${path}" ]] || die "Shared runtime directory is unavailable: ${path}"
done
[[ -d "${BASE_DIR}/shared/postgres-data" ]] || die "PostgreSQL data directory is unavailable."
[[ "$(stat -c '%u' "${BASE_DIR}/shared/postgres-data")" == "70" ]] || die "PostgreSQL data directory must be owned by container UID 70."

available_kib="$(df -Pk "${BASE_DIR}" | awk 'NR==2 {print $4}')"
(( available_kib >= 5 * 1024 * 1024 )) || die "At least 5 GiB free disk is required before deployment."

config_json="$(compose_for "${RELEASE_DIR}" "${RUNTIME_ENV}" --profile operations config --format json)"
jq -e '
  (.services.postgres.ports // [] | length) == 0
  and ([.services | to_entries[] | select(.key != "caddy") | (.value.ports // []) | length] | add) == 0
  and (.services.caddy.ports | length) >= 2
' <<<"${config_json}" >/dev/null || die "Compose exposure policy failed: only Caddy may publish host ports."

expected_addresses="$(resolve_addresses "${EXPECTED_HOST}")"
if [[ -z "${expected_addresses}" && "${EXPECTED_HOST}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  expected_addresses="${EXPECTED_HOST}"
fi
[[ -n "${expected_addresses}" ]] || die "Expected VM host does not resolve."

for domain in "${SUPPLIER_DOMAIN}" "${TMMIN_DOMAIN}" "${API_DOMAIN}"; do
  resolved="$(resolve_addresses "${domain}")"
  [[ -n "${resolved}" ]] || die "DNS does not resolve for ${domain}."
  if ! grep -Fxf <(printf '%s\n' "${expected_addresses}") <(printf '%s\n' "${resolved}") >/dev/null; then
    die "${domain} does not resolve to the expected VM."
  fi
  printf 'DNS preflight passed for %s.\n' "${domain}"
done

printf 'Remote preflight passed for %s.\n' "${RELEASE_SHA}"
