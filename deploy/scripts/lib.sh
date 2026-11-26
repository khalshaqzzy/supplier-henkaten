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

mark_rollback_unsafe() {
  local release_dir="$1"
  local reason_sha="$2"
  local dest_file="${release_dir}/.rollback-unsafe"
  local tmp_file="${release_dir}/.rollback-unsafe.tmp"
  [[ -d "${release_dir}" ]] || return 1
  if [[ -L "${dest_file}" || ( -e "${dest_file}" && ! -f "${dest_file}" ) ]]; then
    echo "Refusing to overwrite non-regular rollback-unsafe marker at ${dest_file}." >&2
    return 1
  fi
  printf '%s\n' "${reason_sha}" >"${tmp_file}" || return 1
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
  [[ -f "${dest_file}" && ! -L "${dest_file}" ]] || return 1
}

# Rename SRC onto DEST exactly (never into DEST when DEST is a directory).
rename_exact() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    [[ ! -d "$2" || -L "$2" ]] || return 1
    mv -hf -- "$1" "$2"
  else
    mv -Tf -- "$1" "$2"
  fi
}

# v2: strict five-image pins + mutation-flag EXIT/signal cleanup + ingress quiesced during rollback. Bumped
# from v1 so bundles from earlier PR iterations (strict pins but no mutation cleanup) are never trusted.
ROLLBACK_DRIVER_CONTRACT="strict-five-image-pins-v2"
# Exit status remote-rollback.sh uses for deliberate policy refusals (never retried by any fallback).
# shellcheck disable=SC2034 # consumed by remote-rollback.sh and remote-deploy.sh, which source lib.sh
ROLLBACK_POLICY_REFUSAL_EXIT=4

rollback_driver_bundle_is_strict() {
  [[ -d "$1" && -x "$1/remote-rollback.sh" && -f "$1/.driver-contract" && "$(<"$1/.driver-contract")" == "${ROLLBACK_DRIVER_CONTRACT}" ]]
}

# Verify that every running service container of a release runs exactly the image ID pinned in its
# .activated-images manifest (used to double-check a driver that reported a successful recovery).
verify_running_matches_manifest() {
  local release_dir="$1"
  local compose_env="$2"
  local pin_sha="$3"
  local manifest="${release_dir}/.activated-images"
  local pg_ref svc image_ref expected_id container_ids running_id
  [[ -f "${manifest}" && ! -L "${manifest}" ]] || return 1
  pg_ref="$(postgres_image_ref_for "${release_dir}")"
  for svc in postgres api supplier-web tmmin-web caddy; do
    if [[ "${svc}" == "postgres" ]]; then
      image_ref="${pg_ref}"
    else
      image_ref="supplier-henkaten-${svc}:${pin_sha}"
    fi
    expected_id="$(awk -v target="${image_ref}" '$1 == target {print $2; exit}' "${manifest}")"
    container_ids="$(compose_for "${release_dir}" "${compose_env}" ps -q "${svc}" 2>/dev/null || true)"
    [[ -n "${expected_id}" && -n "${container_ids}" && "${container_ids}" != *$'\n'* ]] || return 1
    running_id="$(docker inspect --format '{{.Image}}' "${container_ids}" 2>/dev/null || true)"
    if [[ "${running_id}" != "${expected_id}" ]]; then
      echo "Post-recovery check: ${svc} runs '${running_id}', expected pinned '${expected_id}'." >&2
      return 1
    fi
  done
}

# Fail-closed stop of Caddy + application services (PostgreSQL preserved) that survives a broken SSH session:
# Compose output goes to a durable log instead of the (possibly closed) stdout/stderr pipe, so a cancelled CI
# runner cannot make the stop itself die of SIGPIPE before stopping anything.
failclosed_stop_app_services() {
  local release_dir="$1"
  local compose_env="$2"
  local base_dir="$3"
  local log="${base_dir}/shared/deployment-state/failclosed.log"
  if ! compose_for "${release_dir}" "${compose_env}" stop caddy supplier-web tmmin-web api >>"${log}" 2>&1; then
    compose_for "${release_dir}" "${compose_env}" stop caddy supplier-web tmmin-web api >/dev/null 2>&1 || return 1
  fi
}

# Best-effort message to stderr that can never abort a cleanup path when the pipe is gone.
note_stderr() {
  { printf '%s\n' "$*" >&2; } 2>/dev/null || true
}

# Atomically publish a one-line text file (refusing to place it inside a directory at the destination).
publish_line_file() {
  local value="$1"
  local dest="$2"
  local tmp
  if [[ -d "${dest}" && ! -L "${dest}" ]]; then
    echo "Refusing to publish ${dest}: destination is a directory." >&2
    return 1
  fi
  tmp="$(mktemp "${dest}.tmp.XXXXXX")" || return 1
  if ! printf '%s\n' "${value}" >"${tmp}" || ! rename_exact "${tmp}" "${dest}"; then
    rm -f -- "${tmp}"
    return 1
  fi
  [[ -f "${dest}" && ! -L "${dest}" && "$(<"${dest}")" == "${value}" ]]
}

hardened_rollback_driver_path() {
  printf '%s\n' "$1/shared/deployment-state/rollback-driver/remote-rollback.sh"
}

# Publish lib.sh, validate-runtime-env.sh and remote-rollback.sh as ONE immutable bundle: stage them in a
# fresh versioned directory, then atomically repoint the rollback-driver symlink. A failed or interrupted
# install leaves the previous bundle (or no bundle) in place, never a mixture of versions.
install_hardened_rollback_driver() {
  local source_scripts_dir="$1"
  local base_dir="$2"
  local state_dir="${base_dir}/shared/deployment-state"
  local driver_link="${state_dir}/rollback-driver"
  local script_name stage legacy_dir tmp_link
  mkdir -p "${state_dir}" || return 1
  for script_name in lib.sh validate-runtime-env.sh remote-rollback.sh; do
    [[ -f "${source_scripts_dir}/${script_name}" && ! -L "${source_scripts_dir}/${script_name}" ]] || return 1
  done
  # Quarantine a pre-versioning real directory FIRST (we hold the deploy lock, so no rollback runs). The
  # legacy driver is NOT strict (it can start unpinned releases from mutable tags), so it must never remain
  # reachable at the documented path, even if staging the new bundle fails later (copy error, no inodes...).
  # It is never moved back; until a strict bundle is published the path is simply absent (fail closed).
  legacy_dir=""
  if [[ -e "${driver_link}" && ! -L "${driver_link}" ]]; then
    [[ -d "${driver_link}" ]] || return 1
    legacy_dir="$(mktemp -u "${state_dir}/rollback-driver.legacy.XXXXXX")" || return 1
    mv -- "${driver_link}" "${legacy_dir}" || return 1
  fi
  stage="$(mktemp -d "${state_dir}/rollback-driver.v.XXXXXX")" || return 1
  for script_name in lib.sh validate-runtime-env.sh remote-rollback.sh; do
    if ! cp "${source_scripts_dir}/${script_name}" "${stage}/${script_name}" ||
      ! chmod 755 "${stage}/${script_name}" ||
      ! bash -n "${stage}/${script_name}"; then
      rm -rf -- "${stage}"
      return 1
    fi
  done
  # Contract marker: only bundles published by this installer enforce strict five-image pins (refusing
  # unpinned targets) AND fail closed on interrupted/failed mutation with ingress quiesced; fallbacks and
  # the manual entry point never trust a bundle without it.
  if ! printf '%s\n' "${ROLLBACK_DRIVER_CONTRACT}" >"${stage}/.driver-contract" || ! chmod 755 "${stage}"; then
    rm -rf -- "${stage}"
    return 1
  fi
  tmp_link="$(mktemp -u "${state_dir}/.rollback-driver.link.XXXXXX")" || tmp_link=""
  if [[ -z "${tmp_link}" ]] || ! ln -s "${stage}" "${tmp_link}" ||
    ! rename_exact "${tmp_link}" "${driver_link}" ||
    [[ ! -L "${driver_link}" || "$(readlink "${driver_link}")" != "${stage}" ]]; then
    [[ -z "${tmp_link}" ]] || rm -f -- "${tmp_link}"
    if [[ -n "${legacy_dir}" ]]; then
      # Keep the strict staged bundle for operator recovery; the legacy driver stays quarantined.
      echo "Rollback driver publication failed; non-strict legacy driver quarantined at ${legacy_dir}; strict bundle kept at ${stage}." >&2
    else
      rm -rf -- "${stage}"
    fi
    return 1
  fi
  # Superseded bundles are NOT pruned and rollback-driver.good is NOT touched here: the candidate has not
  # proven itself. Only promote_rollback_driver(), after this deploy activates, may designate a known-good
  # bundle, so a failed candidate's driver (or a non-strict pre-versioning driver) can never become it.
}

publish_driver_link() {
  local target="$1"
  local link_path="$2"
  local tmp_link
  tmp_link="$(mktemp -u "$(dirname "${link_path}")/.rollback-driver.link.XXXXXX")" || return 1
  if ! ln -s "${target}" "${tmp_link}" || ! rename_exact "${tmp_link}" "${link_path}"; then
    rm -f -- "${tmp_link}"
    return 1
  fi
  [[ -L "${link_path}" && "$(readlink "${link_path}")" == "${target}" ]]
}

known_good_rollback_driver_path() {
  printf '%s\n' "$1/shared/deployment-state/rollback-driver.good/remote-rollback.sh"
}

# After a deploy has activated successfully, its rollback driver bundle becomes the known-good fallback and
# every other bundle (including a migrated legacy directory) is pruned.
promote_rollback_driver() {
  local base_dir="$1"
  local state_dir="${base_dir}/shared/deployment-state"
  local driver_link="${state_dir}/rollback-driver"
  local good_link="${state_dir}/rollback-driver.good"
  local target entry
  [[ -L "${driver_link}" ]] || return 1
  target="$(readlink "${driver_link}")"
  rollback_driver_bundle_is_strict "${target}" || return 1
  publish_driver_link "${target}" "${good_link}" || return 1
  for entry in "${state_dir}"/rollback-driver.v.* "${state_dir}"/rollback-driver.legacy.*; do
    [[ -d "${entry}" && ! -L "${entry}" && "${entry}" != "${target}" ]] || continue
    rm -rf -- "${entry}" >/dev/null 2>&1 || true
  done
}

# Full-precision (nanosecond) mtime as "<seconds>.<9 digits>".
file_mtime_ns() {
  local value
  value="$(stat -c '%.9Y' -- "$1" 2>/dev/null || stat -f '%Fm' -- "$1" 2>/dev/null)" || return 1
  normalize_timestamp_ns "${value}"
}

normalize_timestamp_ns() {
  local value="$1" seconds fraction
  [[ "${value}" =~ ^([0-9]+)(\.([0-9]+))?$ ]] || return 1
  seconds="${BASH_REMATCH[1]}"
  fraction="${BASH_REMATCH[3]:-0}"
  fraction="${fraction}000000000"
  printf '%s.%s\n' "${seconds}" "${fraction:0:9}"
}

# Strictly-before comparison of two normalized "<seconds>.<9 digits>" timestamps.
timestamp_ns_before() {
  local a_sec="${1%%.*}" a_ns="${1#*.}" b_sec="${2%%.*}" b_ns="${2#*.}"
  if (( 10#${a_sec} != 10#${b_sec} )); then
    (( 10#${a_sec} < 10#${b_sec} ))
  else
    (( 10#${a_ns} < 10#${b_ns} ))
  fi
}

write_activated_images() {
  local release_dir="$1"
  local pin_sha="$2"
  local compose_env="${3:-${release_dir}/.runtime.env}"
  # Optional: a file whose mtime is the moment this release became current. When given (pre-build
  # backfill of an already-active release), every container must predate it; a container created after
  # activation (e.g. PostgreSQL replaced by an interrupted later rollout, whose shared tag carries no
  # release identity) makes the baseline ambiguous and fails closed.
  local activated_at_file="${4:-}"
  local pg_ref svc image_ref container_ids container_id config_image image_id resolved_id tmp_file dest_file backup_file unsafe_marker had_prev=false
  local activated_ns="" created created_ns
  dest_file="${release_dir}/.activated-images"
  unsafe_marker="${release_dir}/.rollback-unsafe"
  [[ -d "${release_dir}" && -n "${COMPOSE_PROJECT_NAME:-}" && -f "${compose_env}" ]] || return 1
  if [[ -L "${dest_file}" || ( -e "${dest_file}" && ! -f "${dest_file}" ) ]]; then
    echo "Refusing to publish pinned image manifest: ${dest_file} is not a regular file." >&2
    return 1
  fi
  if [[ -L "${unsafe_marker}" || ( -e "${unsafe_marker}" && ! -f "${unsafe_marker}" ) ]]; then
    echo "Refusing to publish pinned image manifest: ${unsafe_marker} is not a regular file." >&2
    return 1
  fi
  if [[ -n "${activated_at_file}" ]]; then
    activated_ns="$(file_mtime_ns "${activated_at_file}")" || return 1
  fi
  pg_ref="$(postgres_image_ref_for "${release_dir}")"
  tmp_file="$(mktemp "${release_dir}/.activated-images.tmp.XXXXXX" 2>/dev/null)" || return 1
  chmod 600 "${tmp_file}" || {
    rm -f -- "${tmp_file}"
    return 1
  }
  for svc in postgres api supplier-web tmmin-web caddy; do
    if [[ "${svc}" == "postgres" ]]; then
      image_ref="${pg_ref}"
    else
      image_ref="supplier-henkaten-${svc}:${pin_sha}"
    fi
    container_ids="$(compose_for "${release_dir}" "${compose_env}" ps -q "${svc}" 2>/dev/null || true)"
    container_id="${container_ids%%$'\n'*}"
    if [[ -z "${container_id}" || "${container_ids}" == *$'\n'* ]]; then
      echo "Refusing to pin ${svc}: expected exactly one running container, found '${container_ids//$'\n'/ }'." >&2
      rm -f -- "${tmp_file}"
      return 1
    fi
    # Release ownership: the container must have been created from this release's exact image reference
    # (versioned services embed the release SHA), so an interrupted rollout's candidate containers sharing
    # the Compose project can never be recorded as another release's pins.
    config_image="$(docker inspect --format '{{.Config.Image}}' "${container_id}" 2>/dev/null || true)"
    if [[ "${config_image}" != "${image_ref}" ]]; then
      echo "Refusing to pin ${svc}: running container was created from '${config_image}', expected '${image_ref}' for release ${pin_sha}." >&2
      rm -f -- "${tmp_file}"
      return 1
    fi
    if [[ -n "${activated_ns}" ]]; then
      created="$(docker inspect --format '{{.Created}}' "${container_id}" 2>/dev/null || true)"
      created_ns=""
      # GNU date maps an empty string to today's midnight, so never parse an empty timestamp.
      if [[ "${created}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
        created_ns="$(normalize_timestamp_ns "$(date -u -d "${created}" +%s.%N 2>/dev/null || true)" || true)"
      fi
      # Full nanosecond precision and STRICT ordering: a container whose .Created is equal to or later than
      # the activation instant (including a recreation later within the same second) is ambiguous. A plain
      # restart preserves .Created and still passes. Both values are wall-clock readings of this host, so
      # this legacy-only heuristic assumes current_release was not touched/restored manually and the clock
      # did not step backwards after activation; the Config.Image ownership check above still applies.
      if [[ -z "${created_ns}" ]] || ! timestamp_ns_before "${created_ns}" "${activated_ns}"; then
        echo "Refusing to pin ${svc}: running container (created '${created}') does not strictly predate activation of release ${pin_sha}; baseline provenance is ambiguous." >&2
        rm -f -- "${tmp_file}"
        return 1
      fi
    fi
    image_id="$(docker inspect --format '{{.Image}}' "${container_id}" 2>/dev/null || true)"
    if [[ -z "${image_id}" ]]; then
      rm -f -- "${tmp_file}"
      return 1
    fi
    resolved_id="$(docker image inspect --format '{{.Id}}' "${image_id}" 2>/dev/null || true)"
    if [[ "${resolved_id}" != "${image_id}" ]]; then
      rm -f -- "${tmp_file}"
      return 1
    fi
    printf '%s %s\n' "${image_ref}" "${image_id}" >>"${tmp_file}" || {
      rm -f -- "${tmp_file}"
      return 1
    }
  done
  backup_file=""
  if [[ -f "${dest_file}" && ! -L "${dest_file}" ]]; then
    backup_file="$(mktemp "${release_dir}/.activated-images.prev.XXXXXX" 2>/dev/null)" || {
      rm -f -- "${tmp_file}"
      return 1
    }
    cp -p "${dest_file}" "${backup_file}" || {
      rm -f -- "${tmp_file}" "${backup_file}"
      return 1
    }
    had_prev=true
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -d "${dest_file}" || -L "${dest_file}" ]] || ! mv -f "${tmp_file}" "${dest_file}"; then
      rm -f -- "${tmp_file}" "${backup_file}"
      return 1
    fi
  else
    if ! mv -Tf "${tmp_file}" "${dest_file}"; then
      rm -f -- "${tmp_file}" "${backup_file}"
      return 1
    fi
  fi
  if [[ ! -f "${dest_file}" || -L "${dest_file}" ]] || ! rm -f -- "${unsafe_marker}" || [[ -e "${unsafe_marker}" || -L "${unsafe_marker}" ]]; then
    if [[ "${had_prev}" == "true" ]]; then
      if [[ "$(uname -s)" == "Darwin" ]]; then
        mv -f "${backup_file}" "${dest_file}" >/dev/null 2>&1 || true
      else
        mv -Tf "${backup_file}" "${dest_file}" >/dev/null 2>&1 || true
      fi
    else
      rm -f -- "${dest_file}" >/dev/null 2>&1 || true
    fi
    return 1
  fi
  if [[ -n "${backup_file}" ]]; then
    rm -f -- "${backup_file}" >/dev/null 2>&1 || true
  fi
}

restore_pinned_images_file() {
  local pinned_file="$1"
  local release_dir="$2"
  local pin_sha="$3"
  local pg_ref expected_ref ref expected_id restored_id resolved_id extra
  local -a expected_refs parsed_refs parsed_ids
  local seen_refs=" "
  local i found_count=0 status=0

  [[ -s "${pinned_file}" ]] || return 1
  pg_ref="$(postgres_image_ref_for "${release_dir}")"
  expected_refs=(
    "${pg_ref}"
    "supplier-henkaten-api:${pin_sha}"
    "supplier-henkaten-supplier-web:${pin_sha}"
    "supplier-henkaten-tmmin-web:${pin_sha}"
    "supplier-henkaten-caddy:${pin_sha}"
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
