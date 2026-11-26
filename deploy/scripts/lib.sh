#!/usr/bin/env bash
set -euo pipefail

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

require_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "Expected a full lowercase Git SHA, received an invalid value."
}

require_safe_path() {
  local path="$1"
  local base="$2"
  [[ -n "${path}" && "${path}" == "${base}"/* ]] || die "Path is outside the deployment base directory: ${path}"
}

validate_fqdn() {
  local host="$1"
  [[ "${#host}" -ge 4 && "${#host}" -le 253 && "${host}" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]
}

version_ge() {
  local current="$1"
  local minimum="$2"
  [[ "$(printf '%s\n%s\n' "${minimum}" "${current}" | sort -V | head -n 1)" == "${minimum}" ]]
}

resolve_addresses() {
  local hostname="$1"
  getent ahosts "${hostname}" 2>/dev/null | awk '{print $1}' | sort -u || true
}

compose_for() {
  local release_dir="$1"
  local runtime_env="$2"
  shift 2
  docker compose \
    --project-name "${COMPOSE_PROJECT_NAME}" \
    --env-file "${runtime_env}" \
    -f "${release_dir}/deploy/compose/docker-compose.remote.yml" \
    "$@"
}

wait_for_service() {
  local release_dir="$1"
  local runtime_env="$2"
  local service="$3"
  local timeout_seconds="${4:-240}"
  local started_at container_id status
  started_at="$(date +%s)"

  while true; do
    container_id="$(compose_for "${release_dir}" "${runtime_env}" ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      case "${status}" in
        healthy)
          printf 'Service %s is healthy.\n' "${service}"
          return 0
          ;;
        unhealthy | exited | dead)
          printf 'Service %s entered bad state: %s\n' "${service}" "${status}" >&2
          docker inspect --format '{{json .State.Health}}' "${container_id}" >&2 || true
          docker logs "${container_id}" --tail 150 >&2 || true
          return 1
          ;;
      esac
    fi

    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      printf 'Timed out waiting for %s.\n' "${service}" >&2
      if [[ -n "${container_id:-}" ]]; then
        docker logs "${container_id}" --tail 150 >&2 || true
      fi
      return 1
    fi
    sleep 5
  done
}

RUNTIME_ENV_ALLOWLIST=(
  APP_ENV
  RELEASE_SHA
  DEPLOY_RUN_NUMBER
  COMPOSE_PROJECT_NAME
  SHARED_DIR
  SUPPLIER_DOMAIN
  TMMIN_DOMAIN
  API_DOMAIN
  CADDY_EMAIL
  CADDY_SCHEME
  PUBLISHED_HTTP_PORT
  PUBLISHED_HTTPS_PORT
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_APP_USER
  POSTGRES_APP_PASSWORD
  POSTGRES_DATABASE
  SESSION_CSRF_SECRET
  AUTH_THROTTLE_SECRET
  TMMIN_BOOTSTRAP_USERNAME
  TMMIN_BOOTSTRAP_DISPLAY_NAME
  TMMIN_BOOTSTRAP_PASSWORD
  LOG_LEVEL
  DB_POOL_MAX
  DB_CONNECTION_TIMEOUT_MS
  DB_IDLE_TIMEOUT_MS
  OUTBOX_POLL_MS
  OUTBOX_BATCH_SIZE
  OUTBOX_LOCK_LEASE_MS
  OUTBOX_MAX_ATTEMPTS
  PCR_OPENAI_BASE_URL
  PCR_OPENAI_API_KEY
  PCR_OPENAI_MODEL
  PCR_CONFIDENCE_THRESHOLD
  PCR_INFERENCE_TIMEOUT_MS
  PCR_WORKER_ENABLED
  PCR_WORKER_POLL_MS
  REALTIME_POLL_MS
  SSE_MAX_PER_SESSION
  SSE_MAX_PER_USER
  SSE_MAX_PER_SUPPLIER
  SSE_MAX_GLOBAL
  SSE_REVALIDATION_CACHE_MS
  PUSH_ENABLED
  PUSH_VAPID_PUBLIC_KEY
  PUSH_VAPID_PRIVATE_KEY
  PUSH_VAPID_SUBJECT
  PUSH_ENDPOINT_HOSTS
  PUSH_DELIVERY_TTL_SECONDS
  PUSH_DELIVERY_MAX_ATTEMPTS
  PUSH_DELIVERY_BATCH_SIZE
  PUSH_DELIVERY_POLL_MS
  AUTH_IP_LOGIN_LIMIT
  AUTH_GLOBAL_LIMIT_PER_MINUTE
  ARGON2_MEMORY_KIB
  ARGON2_ITERATIONS
  ARGON2_PARALLELISM
)

is_allowed_runtime_env_key() {
  local candidate="$1"
  local allowed
  for allowed in "${RUNTIME_ENV_ALLOWLIST[@]}"; do
    if [[ "${candidate}" == "${allowed}" ]]; then
      return 0
    fi
  done
  return 1
}

load_runtime_env() {
  local runtime_env="$1"
  [[ -f "${runtime_env}" ]] || die "Runtime env file does not exist: ${runtime_env}"

  local -a parsed_keys=()
  local -a parsed_values=()
  local seen_keys=" "
  local line key raw_value value line_no=0

  # Pass 1: strictly parse and validate the entire file without shell evaluation.
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line_no=$((line_no + 1))
    if [[ "${line}" == *$'\r'* ]]; then
      die "Runtime env contains unsupported CRLF at line ${line_no}."
    fi
    if [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]]; then
      continue
    fi
    if [[ ! "${line}" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
      die "Runtime env has invalid assignment syntax at line ${line_no}."
    fi
    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"

    is_allowed_runtime_env_key "${key}" || die "Runtime env contains unsupported key: ${key}"
    if [[ "${seen_keys}" == *" ${key} "* ]]; then
      die "Runtime env contains duplicate key: ${key}"
    fi
    seen_keys+="${key} "

    if [[ "${raw_value}" == \"* ]]; then
      if [[ "${#raw_value}" -lt 2 || "${raw_value}" != *\" ]]; then
        die "Runtime env has unterminated double-quoted value for ${key} at line ${line_no}."
      fi
      value="${raw_value:1:${#raw_value}-2}"
      if [[ "${value}" =~ [\"\`\$\\] ]]; then
        die "Runtime env contains unsafe characters in quoted value for ${key} at line ${line_no}."
      fi
    else
      if [[ -n "${raw_value}" && ! "${raw_value}" =~ ^[A-Za-z0-9._:/@+,%=-]+$ ]]; then
        die "Runtime env contains unsupported characters in value for ${key} at line ${line_no}."
      fi
      value="${raw_value}"
    fi

    parsed_keys+=("${key}")
    parsed_values+=("${value}")
  done < "${runtime_env}"

  # Pass 2: reset all allowlisted keys so prior loads cannot leak across files,
  # then assign validated values safely without eval or source.
  local allowed i
  for allowed in "${RUNTIME_ENV_ALLOWLIST[@]}"; do
    unset "${allowed}" || true
  done
  for ((i = 0; i < ${#parsed_keys[@]}; i++)); do
    key="${parsed_keys[i]}"
    value="${parsed_values[i]}"
    printf -v "${key}" '%s' "${value}"
    export "${key?}"
  done
}

activate_symlink() {
  local target="$1"
  local link_path="$2"
  local temporary_link="${link_path}.tmp"

  rm -f -- "${temporary_link}"
  ln -s "${target}" "${temporary_link}"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    mv -hf "${temporary_link}" "${link_path}"
  else
    mv -Tf "${temporary_link}" "${link_path}"
  fi
}

postgres_image_ref_for() {
  local release_dir="$1"
  local ref
  ref="$(awk '/^[[:space:]]*image:[[:space:]]*supplier-henkaten-postgres:/ {print $2; exit}' "${release_dir}/deploy/compose/docker-compose.remote.yml" 2>/dev/null || true)"
  printf '%s\n' "${ref:-supplier-henkaten-postgres:18.4-pgvector-0.8.5}"
}

write_activated_images() {
  local release_dir="$1"
  local release_sha="$2"
  local pg_ref image_ref image_id tmp_file dest_file
  dest_file="${release_dir}/.activated-images"
  if [[ -e "${dest_file}" && ( ! -f "${dest_file}" || -L "${dest_file}" ) ]]; then
    echo "Refusing to publish pinned image manifest: ${dest_file} is not a regular file." >&2
    return 1
  fi
  pg_ref="$(postgres_image_ref_for "${release_dir}")"
  tmp_file="${release_dir}/.activated-images.tmp"
  : >"${tmp_file}" || return 1
  chmod 600 "${tmp_file}" || {
    rm -f -- "${tmp_file}"
    return 1
  }
  for image_ref in \
    "${pg_ref}" \
    "supplier-henkaten-api:${release_sha}" \
    "supplier-henkaten-supplier-web:${release_sha}" \
    "supplier-henkaten-tmmin-web:${release_sha}" \
    "supplier-henkaten-caddy:${release_sha}"; do
    image_id="$(docker image inspect --format '{{.Id}}' "${image_ref}" 2>/dev/null || true)"
    if [[ -z "${image_id}" ]]; then
      rm -f -- "${tmp_file}"
      return 1
    fi
    printf '%s %s\n' "${image_ref}" "${image_id}" >>"${tmp_file}" || {
      rm -f -- "${tmp_file}"
      return 1
    }
  done
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -d "${dest_file}" || -L "${dest_file}" ]] || ! mv -f "${tmp_file}" "${dest_file}"; then
      rm -f -- "${tmp_file}"
      return 1
    fi
  else
    if ! mv -Tf "${tmp_file}" "${dest_file}"; then
      rm -f -- "${tmp_file}"
      return 1
    fi
  fi
  if [[ ! -f "${dest_file}" || -L "${dest_file}" ]]; then
    return 1
  fi
  rm -f -- "${release_dir}/.rollback-unsafe"
}

restore_pinned_images_file() {
  local pinned_file="$1"
  local release_dir="$2"
  local release_sha="$3"
  local pg_ref expected_ref ref expected_id restored_id resolved_id extra
  local -a expected_refs parsed_refs parsed_ids
  local seen_refs=" "
  local i found_count=0 status=0

  [[ -s "${pinned_file}" ]] || return 1
  pg_ref="$(postgres_image_ref_for "${release_dir}")"
  expected_refs=(
    "${pg_ref}"
    "supplier-henkaten-api:${release_sha}"
    "supplier-henkaten-supplier-web:${release_sha}"
    "supplier-henkaten-tmmin-web:${release_sha}"
    "supplier-henkaten-caddy:${release_sha}"
  )

  parsed_refs=()
  parsed_ids=()
  while IFS=' ' read -r ref expected_id extra || [[ -n "${ref:-}" ]]; do
    [[ -n "${ref}" && -n "${expected_id}" && -z "${extra:-}" ]] || return 1
    if [[ "${seen_refs}" == *" ${ref} "* ]]; then
      echo "Duplicate pinned image entry for ${ref} in ${pinned_file}." >&2
      return 1
    fi
    local allowed=false
    for expected_ref in "${expected_refs[@]}"; do
      if [[ "${ref}" == "${expected_ref}" ]]; then
        allowed=true
        break
      fi
    done
    if [[ "${allowed}" != "true" ]]; then
      echo "Unexpected pinned image entry ${ref} in ${pinned_file}." >&2
      return 1
    fi
    seen_refs+="${ref} "
    parsed_refs+=("${ref}")
    parsed_ids+=("${expected_id}")
    found_count=$((found_count + 1))
  done <"${pinned_file}"

  if (( found_count != ${#expected_refs[@]} )); then
    echo "Incomplete pinned image manifest ${pinned_file}: found ${found_count}/${#expected_refs[@]} required images." >&2
    return 1
  fi

  # Pass 1: verify every pinned image ID exists locally before modifying any tag.
  for ((i = 0; i < ${#parsed_refs[@]}; i++)); do
    resolved_id="$(docker image inspect --format '{{.Id}}' "${parsed_ids[i]}" 2>/dev/null || true)"
    if [[ "${resolved_id}" != "${parsed_ids[i]}" ]]; then
      echo "Pinned Docker image ID ${parsed_ids[i]} for ${parsed_refs[i]} is unavailable locally." >&2
      return 1
    fi
  done

  # Pass 2: restore every tag and re-verify it resolves to its exact pinned ID.
  for ((i = 0; i < ${#parsed_refs[@]}; i++)); do
    if ! docker tag "${parsed_ids[i]}" "${parsed_refs[i]}" >/dev/null 2>&1; then
      echo "Failed to restore pinned Docker image tag ${parsed_refs[i]} to ${parsed_ids[i]}." >&2
      status=1
      continue
    fi
    restored_id="$(docker image inspect --format '{{.Id}}' "${parsed_refs[i]}" 2>/dev/null || true)"
    if [[ "${restored_id}" != "${parsed_ids[i]}" ]]; then
      echo "Restored pinned Docker image tag ${parsed_refs[i]} resolved to '${restored_id}', expected '${parsed_ids[i]}'." >&2
      status=1
    fi
  done
  return "${status}"
}
