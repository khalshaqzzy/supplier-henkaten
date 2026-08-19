#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 4 ]] || {
  echo "Usage: smoke-check.sh <release-sha> <supplier-origin> <tmmin-origin> <api-origin>" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_SHA="$1"
SUPPLIER_ORIGIN="${2%/}"
TMMIN_ORIGIN="${3%/}"
API_ORIGIN="${4%/}"
RETRY_COUNT="${SMOKE_RETRY_COUNT:-60}"
RETRY_DELAY="${SMOKE_RETRY_DELAY:-5}"

fetch() {
  curl --fail --silent --show-error --location \
    --connect-timeout 10 --max-time 30 \
    --retry "${RETRY_COUNT}" --retry-delay "${RETRY_DELAY}" \
    --retry-connrefused --retry-all-errors "$1"
}

supplier_release="$(fetch "${SUPPLIER_ORIGIN}/release.json")"
tmmin_release="$(fetch "${TMMIN_ORIGIN}/release.json")"
fetch "${SUPPLIER_ORIGIN}/" | grep -F '<div id="root">' >/dev/null
supplier_manifest="$(fetch "${SUPPLIER_ORIGIN}/manifest.webmanifest")"
fetch "${SUPPLIER_ORIGIN}/sw.js" | grep -F 'offline.html' >/dev/null
fetch "${SUPPLIER_ORIGIN}/icons/icon-192.png" >/dev/null
fetch "${SUPPLIER_ORIGIN}/icons/icon-512.png" >/dev/null
jq -e '.id == "/" and .start_url == "/" and .scope == "/" and .display == "standalone"' <<<"${supplier_manifest}" >/dev/null
fetch "${TMMIN_ORIGIN}/" | grep -F '<div id="root">' >/dev/null
fetch "${API_ORIGIN}/health" | jq -e --arg sha "${RELEASE_SHA}" '.status == "ok" and .releaseSha == $sha' >/dev/null

jq -e --arg sha "${RELEASE_SHA}" '.application == "supplier-web" and .releaseSha == $sha' <<<"${supplier_release}" >/dev/null
jq -e --arg sha "${RELEASE_SHA}" '.application == "tmmin-web" and .releaseSha == $sha' <<<"${tmmin_release}" >/dev/null
"${SCRIPT_DIR}/assert-ready.sh" "${API_ORIGIN}/ready" "${RELEASE_SHA}"

for url in "${SUPPLIER_ORIGIN}/" "${TMMIN_ORIGIN}/" "${API_ORIGIN}/health"; do
  headers="$(curl --fail --silent --show-error --head "${url}")"
  grep -Eiq '^strict-transport-security:' <<<"${headers}" || {
    echo "HSTS header is missing from ${url}." >&2
    exit 1
  }
  grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' <<<"${headers}" || {
    echo "nosniff header is missing from ${url}." >&2
    exit 1
  }
done

for path in / /manifest.webmanifest /sw.js; do
  headers="$(curl --fail --silent --show-error --head "${SUPPLIER_ORIGIN}${path}")"
  grep -Eiq '^cache-control:.*(no-store|no-cache)' <<<"${headers}" || {
    echo "Non-stale cache policy is missing from ${SUPPLIER_ORIGIN}${path}." >&2
    exit 1
  }
done

printf 'Three-surface smoke checks passed for %s.\n' "${RELEASE_SHA}"
