#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  render-runtime-env.sh <staging|production> <release-sha> <deploy-run-number>

Required environment:
  CADDY_EMAIL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE
  SESSION_CSRF_SECRET AUTH_THROTTLE_SECRET
  TMMIN_BOOTSTRAP_USERNAME TMMIN_BOOTSTRAP_DISPLAY_NAME TMMIN_BOOTSTRAP_PASSWORD

The rendered dotenv content is written to stdout. Redirect it to a mode-0600 file
or pipe it directly to SSH. The script never writes or logs secret values itself.
EOF
}

[[ $# -eq 3 ]] || {
  usage
  exit 1
}

APP_ENV="$1"
RELEASE_SHA="$2"
DEPLOY_RUN_NUMBER="$3"

case "${APP_ENV}" in
  staging)
    COMPOSE_PROJECT_NAME="supplier-henkaten-staging"
    SHARED_DIR="/opt/supplier-henkaten/staging/shared"
    SUPPLIER_DOMAIN="supplier-henkaten.qd-tmmin.site"
    TMMIN_DOMAIN="henkaten.qd-tmmin.site"
    API_DOMAIN="supplier-henkaten-api.qd-tmmin.site"
    ;;
  production)
    : "${PRODUCTION_SUPPLIER_DOMAIN:?PRODUCTION_SUPPLIER_DOMAIN is required}"
    : "${PRODUCTION_TMMIN_DOMAIN:?PRODUCTION_TMMIN_DOMAIN is required}"
    : "${PRODUCTION_API_DOMAIN:?PRODUCTION_API_DOMAIN is required}"
    COMPOSE_PROJECT_NAME="supplier-henkaten-production"
    SHARED_DIR="/opt/supplier-henkaten/production/shared"
    SUPPLIER_DOMAIN="${PRODUCTION_SUPPLIER_DOMAIN}"
    TMMIN_DOMAIN="${PRODUCTION_TMMIN_DOMAIN}"
    API_DOMAIN="${PRODUCTION_API_DOMAIN}"
    ;;
  *)
    echo "APP_ENV must be staging or production." >&2
    exit 1
    ;;
esac

[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "release-sha must be a full lowercase Git SHA." >&2
  exit 1
}
[[ "${DEPLOY_RUN_NUMBER}" =~ ^[1-9][0-9]*$ ]] || {
  echo "deploy-run-number must be a positive integer." >&2
  exit 1
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || {
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  }
}

require_safe() {
  local name="$1"
  local minimum="${2:-1}"
  local value
  require_value "${name}"
  value="${!name}"
  [[ "${value}" =~ ^[A-Za-z0-9_-]+$ && "${#value}" -ge "${minimum}" ]] || {
    echo "${name} must use only A-Z, a-z, 0-9, underscore, or hyphen and contain at least ${minimum} characters." >&2
    exit 1
  }
}

require_safe POSTGRES_USER 1
require_safe POSTGRES_PASSWORD 32
require_safe POSTGRES_DATABASE 1
require_safe SESSION_CSRF_SECRET 32
require_safe AUTH_THROTTLE_SECRET 32
require_safe TMMIN_BOOTSTRAP_USERNAME 1
require_safe TMMIN_BOOTSTRAP_PASSWORD 12
require_value TMMIN_BOOTSTRAP_DISPLAY_NAME
require_value CADDY_EMAIL

[[ "${CADDY_EMAIL}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || {
  echo "CADDY_EMAIL must be a valid email address." >&2
  exit 1
}
[[ "${TMMIN_BOOTSTRAP_DISPLAY_NAME}" =~ ^[A-Za-z0-9._\ -]+$ ]] || {
  echo "TMMIN_BOOTSTRAP_DISPLAY_NAME contains unsupported characters." >&2
  exit 1
}

printf 'APP_ENV=%s\n' "${APP_ENV}"
printf 'RELEASE_SHA=%s\n' "${RELEASE_SHA}"
printf 'DEPLOY_RUN_NUMBER=%s\n' "${DEPLOY_RUN_NUMBER}"
printf 'COMPOSE_PROJECT_NAME=%s\n' "${COMPOSE_PROJECT_NAME}"
printf 'SHARED_DIR=%s\n' "${SHARED_DIR}"
printf 'SUPPLIER_DOMAIN=%s\n' "${SUPPLIER_DOMAIN}"
printf 'TMMIN_DOMAIN=%s\n' "${TMMIN_DOMAIN}"
printf 'API_DOMAIN=%s\n' "${API_DOMAIN}"
printf 'CADDY_EMAIL=%s\n' "${CADDY_EMAIL}"
printf '%s\n' 'CADDY_SCHEME=' 'PUBLISHED_HTTP_PORT=80' 'PUBLISHED_HTTPS_PORT=443'
printf 'POSTGRES_USER=%s\n' "${POSTGRES_USER}"
printf 'POSTGRES_PASSWORD=%s\n' "${POSTGRES_PASSWORD}"
printf 'POSTGRES_DATABASE=%s\n' "${POSTGRES_DATABASE}"
printf 'SESSION_CSRF_SECRET=%s\n' "${SESSION_CSRF_SECRET}"
printf 'AUTH_THROTTLE_SECRET=%s\n' "${AUTH_THROTTLE_SECRET}"
printf 'TMMIN_BOOTSTRAP_USERNAME=%s\n' "${TMMIN_BOOTSTRAP_USERNAME}"
printf 'TMMIN_BOOTSTRAP_DISPLAY_NAME="%s"\n' "${TMMIN_BOOTSTRAP_DISPLAY_NAME}"
printf 'TMMIN_BOOTSTRAP_PASSWORD=%s\n' "${TMMIN_BOOTSTRAP_PASSWORD}"
printf '%s\n' \
  'LOG_LEVEL=info' \
  'DB_POOL_MAX=20' \
  'DB_CONNECTION_TIMEOUT_MS=5000' \
  'DB_IDLE_TIMEOUT_MS=30000' \
  'OUTBOX_POLL_MS=1000' \
  'OUTBOX_BATCH_SIZE=50' \
  'OUTBOX_LOCK_LEASE_MS=30000' \
  'OUTBOX_MAX_ATTEMPTS=10' \
  'REALTIME_POLL_MS=1000' \
  'AUTH_IP_LOGIN_LIMIT=50' \
  'AUTH_GLOBAL_LIMIT_PER_MINUTE=300' \
  'ARGON2_MEMORY_KIB=19456' \
  'ARGON2_ITERATIONS=2' \
  'ARGON2_PARALLELISM=1'
