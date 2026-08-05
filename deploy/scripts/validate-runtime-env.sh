#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

[[ $# -eq 1 ]] || die "Usage: validate-runtime-env.sh <runtime-env-file>"
RUNTIME_ENV="$1"
[[ -s "${RUNTIME_ENV}" ]] || die "Runtime env file is missing or empty."
load_runtime_env "${RUNTIME_ENV}"

[[ "${APP_ENV:-}" =~ ^(staging|production)$ ]] || die "APP_ENV must be staging or production."
require_sha "${RELEASE_SHA:-}"
[[ "${DEPLOY_RUN_NUMBER:-}" =~ ^[1-9][0-9]*$ ]] || die "DEPLOY_RUN_NUMBER must be positive."
[[ "${COMPOSE_PROJECT_NAME:-}" == "supplier-henkaten-${APP_ENV}" ]] || die "COMPOSE_PROJECT_NAME does not match APP_ENV."
[[ "${SHARED_DIR:-}" == "/opt/supplier-henkaten/${APP_ENV}/shared" || "${SHARED_DIR:-}" == /tmp/* ]] || die "SHARED_DIR is outside the approved environment path."

for name in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE SESSION_CSRF_SECRET AUTH_THROTTLE_SECRET TMMIN_BOOTSTRAP_USERNAME TMMIN_BOOTSTRAP_PASSWORD; do
  value="${!name:-}"
  [[ "${value}" =~ ^[A-Za-z0-9_-]+$ ]] || die "${name} contains unsupported dotenv or URL characters."
done

(( ${#POSTGRES_PASSWORD} >= 32 )) || die "POSTGRES_PASSWORD must contain at least 32 characters."
(( ${#SESSION_CSRF_SECRET} >= 32 )) || die "SESSION_CSRF_SECRET must contain at least 32 characters."
(( ${#AUTH_THROTTLE_SECRET} >= 32 )) || die "AUTH_THROTTLE_SECRET must contain at least 32 characters."
(( ${#TMMIN_BOOTSTRAP_PASSWORD} >= 12 )) || die "TMMIN_BOOTSTRAP_PASSWORD must contain at least 12 characters."

for name in SUPPLIER_DOMAIN TMMIN_DOMAIN API_DOMAIN; do
  value="${!name:-}"
  [[ "${value}" =~ ^[A-Za-z0-9.-]+$ && "${value}" == *.* ]] || die "${name} is not a valid hostname."
done

[[ "${CADDY_EMAIL:-}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "CADDY_EMAIL is invalid."
[[ "${CADDY_SCHEME:-}" == "" || "${CADDY_SCHEME}" == "http://" ]] || die "CADDY_SCHEME must be empty or http://."
[[ "${PUBLISHED_HTTP_PORT:-}" =~ ^[0-9]+$ && "${PUBLISHED_HTTPS_PORT:-}" =~ ^[0-9]+$ ]] || die "Published Caddy ports must be numeric."
[[ "${PUSH_ENABLED:-false}" =~ ^(true|false)$ ]] || die "PUSH_ENABLED must be true or false."
if [[ "${PUSH_ENABLED:-false}" == "true" ]]; then
  [[ "${PUSH_VAPID_PUBLIC_KEY:-}" =~ ^[A-Za-z0-9_-]{40,512}$ ]] || die "PUSH_VAPID_PUBLIC_KEY is invalid."
  [[ "${PUSH_VAPID_PRIVATE_KEY:-}" =~ ^[A-Za-z0-9_-]{20,512}$ ]] || die "PUSH_VAPID_PRIVATE_KEY is invalid."
  [[ "${PUSH_VAPID_SUBJECT:-}" =~ ^(mailto:|https://) ]] || die "PUSH_VAPID_SUBJECT must use mailto: or https:."
fi
PUSH_ENDPOINT_HOSTS="${PUSH_ENDPOINT_HOSTS:-.googleapis.com,.push.apple.com,.notify.windows.com,.push.services.mozilla.com}"
[[ "${PUSH_ENDPOINT_HOSTS}" =~ ^(\.?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)(,\.?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)*$ ]] || die "PUSH_ENDPOINT_HOSTS must be a comma-separated exact/suffix hostname allowlist."
for name in PUSH_DELIVERY_TTL_SECONDS PUSH_DELIVERY_MAX_ATTEMPTS PUSH_DELIVERY_BATCH_SIZE PUSH_DELIVERY_POLL_MS; do
  case "${name}" in
    PUSH_DELIVERY_TTL_SECONDS) value="${!name:-3600}" ;;
    PUSH_DELIVERY_MAX_ATTEMPTS) value="${!name:-5}" ;;
    PUSH_DELIVERY_BATCH_SIZE) value="${!name:-50}" ;;
    PUSH_DELIVERY_POLL_MS) value="${!name:-1000}" ;;
  esac
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || die "${name} must be a positive integer."
done
if [[ "${SHARED_DIR}" == /opt/* ]]; then
  [[ "${CADDY_SCHEME}" == "" && "${PUBLISHED_HTTP_PORT}" == "80" && "${PUBLISHED_HTTPS_PORT}" == "443" ]] || die "Hosted runtime must use automatic HTTPS on ports 80/443."
fi
printf 'Runtime environment is valid for %s release %s.\n' "${APP_ENV}" "${RELEASE_SHA}"
