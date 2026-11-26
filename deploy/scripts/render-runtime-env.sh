#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  render-runtime-env.sh <staging|production> <release-sha> <deploy-run-number>

Required environment:
  CADDY_EMAIL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE
  SESSION_CSRF_SECRET AUTH_THROTTLE_SECRET
  TMMIN_BOOTSTRAP_USERNAME TMMIN_BOOTSTRAP_DISPLAY_NAME TMMIN_BOOTSTRAP_PASSWORD
  PCR_OPENAI_BASE_URL PCR_OPENAI_API_KEY PCR_OPENAI_MODEL
  PCR_CONFIDENCE_THRESHOLD PCR_INFERENCE_TIMEOUT_MS PCR_WORKER_ENABLED PCR_WORKER_POLL_MS

Optional environment (staged zero-touch runtime DB role):
  POSTGRES_APP_USER POSTGRES_APP_PASSWORD

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
    SUPPLIER_DOMAIN="$(printf '%s' "${PRODUCTION_SUPPLIER_DOMAIN}" | tr '[:upper:]' '[:lower:]')"
    TMMIN_DOMAIN="$(printf '%s' "${PRODUCTION_TMMIN_DOMAIN}" | tr '[:upper:]' '[:lower:]')"
    API_DOMAIN="$(printf '%s' "${PRODUCTION_API_DOMAIN}" | tr '[:upper:]' '[:lower:]')"
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

for domain_name in SUPPLIER_DOMAIN TMMIN_DOMAIN API_DOMAIN; do
  validate_fqdn "${!domain_name}" || {
    echo "${domain_name} must be a valid RFC-1123 hostname." >&2
    exit 1
  }
done

require_safe POSTGRES_USER 1
require_safe POSTGRES_PASSWORD 32
require_safe POSTGRES_DATABASE 1

derive_default_app_user() {
  local raw="$1"
  local sanitized
  sanitized="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_' '_')"
  if [[ ! "${sanitized}" =~ ^[a-z_] ]]; then
    sanitized="u_${sanitized}"
  fi
  printf '%s_app' "${sanitized:0:59}"
}

if [[ -n "${POSTGRES_APP_USER:-}" ]]; then
  [[ "${POSTGRES_APP_USER}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || {
    echo "POSTGRES_APP_USER must match ^[a-z_][a-z0-9_]{0,62}$." >&2
    exit 1
  }
else
  POSTGRES_APP_USER="$(derive_default_app_user "${POSTGRES_USER}")"
fi
[[ "${POSTGRES_APP_USER}" != "${POSTGRES_USER}" ]] || {
  echo "POSTGRES_APP_USER must be distinct from POSTGRES_USER." >&2
  exit 1
}

if [[ -n "${POSTGRES_APP_PASSWORD:-}" ]]; then
  require_safe POSTGRES_APP_PASSWORD 32
else
  echo "Warning: POSTGRES_APP_PASSWORD is not set; deriving a one-way HMAC-SHA256 runtime password (staged zero-touch). Provision an independent POSTGRES_APP_PASSWORD secret when ready." >&2
  if command -v python3 >/dev/null 2>&1; then
    POSTGRES_APP_PASSWORD="$(
      APP_ENV="${APP_ENV}" POSTGRES_USER="${POSTGRES_USER}" POSTGRES_APP_USER="${POSTGRES_APP_USER}" POSTGRES_DATABASE="${POSTGRES_DATABASE}" POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
        python3 -c 'import hashlib, hmac, os; msg = ("supplier-henkaten:postgres-app-role:v1:" + os.environ["APP_ENV"] + ":" + os.environ["POSTGRES_USER"] + ":" + os.environ["POSTGRES_APP_USER"] + ":" + os.environ["POSTGRES_DATABASE"]).encode(); print(hmac.new(os.environ["POSTGRES_PASSWORD"].encode(), msg, hashlib.sha256).hexdigest())'
    )"
  elif command -v node >/dev/null 2>&1; then
    POSTGRES_APP_PASSWORD="$(
      APP_ENV="${APP_ENV}" POSTGRES_USER="${POSTGRES_USER}" POSTGRES_APP_USER="${POSTGRES_APP_USER}" POSTGRES_DATABASE="${POSTGRES_DATABASE}" POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
        node -e 'const c=require("node:crypto");const m="supplier-henkaten:postgres-app-role:v1:"+process.env.APP_ENV+":"+process.env.POSTGRES_USER+":"+process.env.POSTGRES_APP_USER+":"+process.env.POSTGRES_DATABASE;process.stdout.write(c.createHmac("sha256",process.env.POSTGRES_PASSWORD).update(m).digest("hex"))'
    )"
  else
    echo "python3 or node is required to derive POSTGRES_APP_PASSWORD when unset." >&2
    exit 1
  fi
  [[ "${POSTGRES_APP_PASSWORD}" =~ ^[0-9a-f]{64}$ ]] || {
    echo "Derived POSTGRES_APP_PASSWORD has an invalid shape." >&2
    exit 1
  }
fi
[[ "${POSTGRES_APP_PASSWORD}" != "${POSTGRES_PASSWORD}" ]] || {
  echo "POSTGRES_APP_PASSWORD must be distinct from POSTGRES_PASSWORD." >&2
  exit 1
}
require_safe SESSION_CSRF_SECRET 32
require_safe AUTH_THROTTLE_SECRET 32
require_safe TMMIN_BOOTSTRAP_USERNAME 1
require_safe TMMIN_BOOTSTRAP_PASSWORD 12
require_value TMMIN_BOOTSTRAP_DISPLAY_NAME
require_value CADDY_EMAIL
for name in PCR_OPENAI_BASE_URL PCR_OPENAI_API_KEY PCR_OPENAI_MODEL PCR_CONFIDENCE_THRESHOLD PCR_INFERENCE_TIMEOUT_MS PCR_WORKER_ENABLED PCR_WORKER_POLL_MS; do
  require_value "${name}"
done
[[ "${PCR_OPENAI_BASE_URL}" =~ ^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._/-]*)?$ ]] || {
  echo "PCR_OPENAI_BASE_URL must be a safe HTTPS URL." >&2
  exit 1
}
[[ "${PCR_OPENAI_API_KEY}" =~ ^[A-Za-z0-9_+/=-]{16,}$ ]] || {
  echo "PCR_OPENAI_API_KEY contains unsupported dotenv characters." >&2
  exit 1
}
[[ "${PCR_OPENAI_MODEL}" =~ ^[A-Za-z0-9._/-]+$ ]] || {
  echo "PCR_OPENAI_MODEL contains unsupported characters." >&2
  exit 1
}
[[ "${PCR_CONFIDENCE_THRESHOLD}" =~ ^(0(\.[0-9]+)?|1(\.0+)?)$ ]] || {
  echo "PCR_CONFIDENCE_THRESHOLD must be between 0 and 1." >&2
  exit 1
}
[[ "${PCR_INFERENCE_TIMEOUT_MS}" =~ ^[1-9][0-9]*$ && "${PCR_WORKER_POLL_MS}" =~ ^[1-9][0-9]*$ && "${PCR_WORKER_ENABLED}" =~ ^(true|false)$ ]] || {
  echo "PCR worker settings are invalid." >&2
  exit 1
}

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
printf 'POSTGRES_APP_USER=%s\n' "${POSTGRES_APP_USER}"
printf 'POSTGRES_APP_PASSWORD=%s\n' "${POSTGRES_APP_PASSWORD}"
printf 'POSTGRES_DATABASE=%s\n' "${POSTGRES_DATABASE}"
printf 'SESSION_CSRF_SECRET=%s\n' "${SESSION_CSRF_SECRET}"
printf 'AUTH_THROTTLE_SECRET=%s\n' "${AUTH_THROTTLE_SECRET}"
printf 'TMMIN_BOOTSTRAP_USERNAME=%s\n' "${TMMIN_BOOTSTRAP_USERNAME}"
printf 'TMMIN_BOOTSTRAP_DISPLAY_NAME="%s"\n' "${TMMIN_BOOTSTRAP_DISPLAY_NAME}"
printf 'TMMIN_BOOTSTRAP_PASSWORD=%s\n' "${TMMIN_BOOTSTRAP_PASSWORD}"
printf 'PCR_OPENAI_BASE_URL=%s\n' "${PCR_OPENAI_BASE_URL}"
printf 'PCR_OPENAI_API_KEY=%s\n' "${PCR_OPENAI_API_KEY}"
printf 'PCR_OPENAI_MODEL=%s\n' "${PCR_OPENAI_MODEL}"
printf 'PCR_CONFIDENCE_THRESHOLD=%s\n' "${PCR_CONFIDENCE_THRESHOLD}"
printf 'PCR_INFERENCE_TIMEOUT_MS=%s\n' "${PCR_INFERENCE_TIMEOUT_MS}"
printf 'PCR_WORKER_ENABLED=%s\n' "${PCR_WORKER_ENABLED}"
printf 'PCR_WORKER_POLL_MS=%s\n' "${PCR_WORKER_POLL_MS}"
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
