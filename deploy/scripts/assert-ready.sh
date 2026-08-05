#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 2 ]] || {
  echo "Usage: assert-ready.sh <ready-url> <expected-release-sha>" >&2
  exit 1
}

READY_URL="$1"
EXPECTED_SHA="$2"
RETRY_COUNT="${SMOKE_RETRY_COUNT:-60}"
RETRY_DELAY="${SMOKE_RETRY_DELAY:-5}"

payload="$(
  curl --fail --silent --show-error --location \
    --connect-timeout 10 --max-time 30 \
    --retry "${RETRY_COUNT}" --retry-delay "${RETRY_DELAY}" \
    --retry-connrefused --retry-all-errors \
    "${READY_URL}"
)"

jq -e \
  --arg sha "${EXPECTED_SHA}" \
  '.status == "ready"
   and .releaseSha == $sha
   and ([.checks[] | select(.name == "database" and .status == "ready")] | length == 1)
   and ([.checks[] | select(.name == "migrations" and .status == "ready")] | length == 1)
   and ([.checks[] | select(.name == "photo_storage" and .status == "ready")] | length == 1)' \
  <<<"${payload}" >/dev/null || {
    echo "Readiness payload did not match the expected release and checks." >&2
    exit 1
  }
