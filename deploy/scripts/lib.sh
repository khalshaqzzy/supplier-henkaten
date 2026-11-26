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

# A release is "hardened" (ADR 0057) when its stored runtime env provisions a distinct runtime DB role or
# its source tree ships the migrate CLI. Only NON-hardened (legacy) releases may ever have their image pins
# reconstructed from running containers with the wall-clock provenance heuristic; a hardened release always
# records .activated-images at activation, so a missing manifest means lost evidence, not a legacy baseline.
release_is_hardened() {
  local release_dir="$1"
  [[ -f "${release_dir}/apps/api/src/cli/migrate.ts" ]] && return 0
  [[ -f "${release_dir}/.runtime.env" ]] && grep -Eq '^POSTGRES_APP_USER="?[^"[:space:]]' "${release_dir}/.runtime.env"
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

# v3: strict five-image pins + content-addressed Docker retention tags (containerd-safe) +
# exact-image container reconciliation + in-driver post-rollback verification + mutation-flag
# EXIT/signal cleanup + ingress quiesced during rollback. Bumped from v2 so older bundles lacking
# retention tags and in-driver verification are never trusted as fallbacks or manual drivers.
ROLLBACK_DRIVER_CONTRACT="strict-five-image-pins-v3"
# Exit status remote-rollback.sh uses for deliberate policy refusals (never retried by any fallback).
# shellcheck disable=SC2034 # consumed by remote-rollback.sh and remote-deploy.sh, which source lib.sh
ROLLBACK_POLICY_REFUSAL_EXIT=4
DEPLOY_SERVICES=(postgres api supplier-web tmmin-web caddy)

rollback_driver_bundle_is_strict() {
  [[ -d "$1" && -x "$1/remote-rollback.sh" && -f "$1/.driver-contract" && "$(<"$1/.driver-contract")" == "${ROLLBACK_DRIVER_CONTRACT}" ]]
}

validate_image_id() {
  [[ "${1:-}" =~ ^sha256:[A-Za-z0-9._-]{1,96}$ ]]
}

service_image_ref_for() {
  local release_dir="$1"
  local pin_sha="$2"
  local svc="$3"
  if [[ "${svc}" == "postgres" ]]; then
    postgres_image_ref_for "${release_dir}"
  else
    printf 'supplier-henkaten-%s:%s\n' "${svc}" "${pin_sha}"
  fi
}

resolve_pin_env() {
  local explicit_env="${1:-}"
  if [[ -n "${explicit_env}" ]]; then
    [[ "${explicit_env}" =~ ^(staging|production)$ ]] || return 1
    printf '%s\n' "${explicit_env}"
    return 0
  fi
  if [[ -n "${APP_ENV:-}" && "${APP_ENV}" =~ ^(staging|production)$ ]]; then
    printf '%s\n' "${APP_ENV}"
    return 0
  fi
  if [[ "${COMPOSE_PROJECT_NAME:-}" =~ ^supplier-henkaten-(staging|production)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

pin_repo_for_env() {
  local app_env="$1"
  [[ "${app_env}" =~ ^(staging|production)$ ]] || return 1
  printf 'supplier-henkaten-pin-%s\n' "${app_env}"
}

pin_tag_for_image() {
  local app_env="$1"
  local svc="$2"
  local image_id="$3"
  local pin_repo
  pin_repo="$(pin_repo_for_env "${app_env}")" || return 1
  case "${svc}" in
    postgres | api | supplier-web | tmmin-web | caddy) ;;
    *) return 1 ;;
  esac
  validate_image_id "${image_id}" || return 1
  printf '%s:%s-%s\n' "${pin_repo}" "${svc}" "${image_id#sha256:}"
}

# Create and verify an immutable content-addressed local retention tag so containerd's image store
# never garbage-collects a pinned image ID when a mutable runtime tag (shared postgres or same-SHA)
# is overwritten by a later build.
pin_image_id() {
  local app_env="$1"
  local svc="$2"
  local image_id="$3"
  local pin_tag resolved_id existing_id tag_err verified_id

  if ! pin_tag="$(pin_tag_for_image "${app_env}" "${svc}" "${image_id}")"; then
    note_stderr "Pin retention failed: invalid inputs (env='${app_env}', service='${svc}', id='${image_id}')."
    return 1
  fi

  if ! resolved_id="$(docker image inspect --format '{{.Id}}' "${image_id}" 2>&1)"; then
    note_stderr "Pin retention failed for ${svc}: local image '${image_id}' is unavailable (${resolved_id:-docker image inspect failed})."
    return 1
  fi
  if [[ "${resolved_id}" != "${image_id}" ]]; then
    note_stderr "Pin retention failed for ${svc}: local image '${image_id}' resolved to '${resolved_id}'."
    return 1
  fi

  existing_id="$(docker image inspect --format '{{.Id}}' "${pin_tag}" 2>/dev/null || true)"
  if [[ -n "${existing_id}" ]]; then
    if [[ "${existing_id}" == "${image_id}" ]]; then
      log_info "[pin] Retained tag already verified for ${svc}: ${pin_tag} -> ${image_id}"
      return 0
    fi
    note_stderr "Pin retention failed for ${svc}: existing retention tag ${pin_tag} resolves to '${existing_id}', expected '${image_id}'."
    return 1
  fi

  if ! tag_err="$(docker tag "${image_id}" "${pin_tag}" 2>&1)"; then
    note_stderr "Pin retention failed for ${svc}: docker tag '${image_id}' '${pin_tag}' failed (${tag_err:-exit non-zero})."
    return 1
  fi
  if ! verified_id="$(docker image inspect --format '{{.Id}}' "${pin_tag}" 2>&1)"; then
    note_stderr "Pin retention failed for ${svc}: failed to verify retention tag ${pin_tag} (${verified_id:-inspect failed})."
    return 1
  fi
  if [[ "${verified_id}" != "${image_id}" ]]; then
    note_stderr "Pin retention failed for ${svc}: retention tag ${pin_tag} resolved to '${verified_id}', expected '${image_id}'."
    return 1
  fi
  log_info "[pin] Created retention tag for ${svc}: ${pin_tag} -> ${image_id}"
}

# Strictly parse and validate a 5-service pinned image manifest without side effects.
# Emits 5 canonical lines on stdout: "<svc> <image_ref> <image_id>".
parse_manifest_file() {
  local pinned_file="$1"
  local release_dir="$2"
  local pin_sha="$3"
  local pg_ref ref expected_id extra svc expected_ref idx line_no=0 found_count=0
  local -a expected_svcs expected_refs matched_ids
  local seen_refs=" "

  if [[ -L "${pinned_file}" || ! -f "${pinned_file}" ]]; then
    note_stderr "Pinned image manifest is missing or not a regular file: ${pinned_file}."
    return 1
  fi
  if [[ ! -s "${pinned_file}" ]]; then
    note_stderr "Pinned image manifest is empty: ${pinned_file}."
    return 1
  fi

  pg_ref="$(postgres_image_ref_for "${release_dir}")"
  expected_svcs=("${DEPLOY_SERVICES[@]}")
  expected_refs=(
    "${pg_ref}"
    "supplier-henkaten-api:${pin_sha}"
    "supplier-henkaten-supplier-web:${pin_sha}"
    "supplier-henkaten-tmmin-web:${pin_sha}"
    "supplier-henkaten-caddy:${pin_sha}"
  )
  matched_ids=("" "" "" "" "")

  while IFS=' ' read -r ref expected_id extra || [[ -n "${ref:-}" ]]; do
    line_no=$((line_no + 1))
    if [[ -z "${ref:-}" || -z "${expected_id:-}" || -n "${extra:-}" ]]; then
      note_stderr "Malformed entry at ${pinned_file}:${line_no} (expected '<image_ref> <sha256:id>')."
      return 1
    fi
    if ! validate_image_id "${expected_id}"; then
      note_stderr "Invalid image ID '${expected_id}' for ${ref} at ${pinned_file}:${line_no}."
      return 1
    fi
    if [[ "${seen_refs}" == *" ${ref} "* ]]; then
      note_stderr "Duplicate pinned image entry for ${ref} in ${pinned_file}."
      return 1
    fi
    local matched_idx=-1
    for ((idx = 0; idx < ${#expected_refs[@]}; idx++)); do
      if [[ "${ref}" == "${expected_refs[idx]}" ]]; then
        matched_idx="${idx}"
        break
      fi
    done
    if (( matched_idx < 0 )); then
      note_stderr "Unexpected pinned image entry '${ref}' in ${pinned_file} for release ${pin_sha}."
      return 1
    fi
    seen_refs+="${ref} "
    matched_ids[matched_idx]="${expected_id}"
    found_count=$((found_count + 1))
  done <"${pinned_file}"

  if (( found_count != ${#expected_refs[@]} )); then
    note_stderr "Incomplete pinned image manifest ${pinned_file}: found ${found_count}/${#expected_refs[@]} required images."
    return 1
  fi

  for ((idx = 0; idx < ${#expected_svcs[@]}; idx++)); do
    svc="${expected_svcs[idx]}"
    expected_ref="${expected_refs[idx]}"
    printf '%s %s %s\n' "${svc}" "${expected_ref}" "${matched_ids[idx]}"
  done
}

# Ensure all 5 image IDs recorded in a release's .activated-images manifest exist locally and have
# verified content-addressed retention tags.
# Returns:
#   0: all 5 rows valid, present locally, and retained with verified pin tags
#   2: manifest valid, but >= 1 pinned image ID is missing locally (unrecoverable)
#   1: manifest malformed or retention tagging failed on a locally present image
ensure_manifest_pins() {
  local app_env="$1"
  local release_dir="$2"
  local pin_sha="$3"
  local manifest="${release_dir}/.activated-images"
  local parsed_lines svc ref expected_id resolved_id
  local -a svcs=() ids=()
  local i missing_local=false

  parsed_lines="$(parse_manifest_file "${manifest}" "${release_dir}" "${pin_sha}")" || return 1
  while IFS=' ' read -r svc ref expected_id; do
    svcs+=("${svc}")
    ids+=("${expected_id}")
  done <<<"${parsed_lines}"

  for ((i = 0; i < ${#svcs[@]}; i++)); do
    if ! resolved_id="$(docker image inspect --format '{{.Id}}' "${ids[i]}" 2>&1)"; then
      note_stderr "Manifest pin check for ${pin_sha} (${svcs[i]}): pinned image ID '${ids[i]}' is unavailable locally (${resolved_id:-inspect failed})."
      missing_local=true
    elif [[ "${resolved_id}" != "${ids[i]}" ]]; then
      note_stderr "Manifest pin check for ${pin_sha} (${svcs[i]}): pinned image ID '${ids[i]}' resolved to '${resolved_id}'."
      missing_local=true
    fi
  done
  if [[ "${missing_local}" == "true" ]]; then
    return 2
  fi

  for ((i = 0; i < ${#svcs[@]}; i++)); do
    pin_image_id "${app_env}" "${svcs[i]}" "${ids[i]}" || return 1
  done
}

# Reconcile a single Compose service so it runs the exact expected image ref and ID.
# Checks existing containers (including stopped ones) BEFORE `up` so stale or orphaned containers
# are force-recreated in a single step before health checks run.
ensure_service_runs_image() {
  local release_dir="$1"
  local runtime_env="$2"
  local svc="$3"
  local expected_ref="$4"
  local expected_id="$5"
  local timeout_seconds="$6"
  shift 6
  local -a extra_up_args=("$@")
  local tag_id container_ids existing_cid obs_ref obs_id obs_inspectable
  local running_ids running_cid post_ref post_id post_local
  local need_force_recreate=false

  if [[ -z "${expected_ref}" ]] || ! validate_image_id "${expected_id}"; then
    note_stderr "Reconciliation failed for ${svc}: invalid expected target (ref='${expected_ref}', id='${expected_id}')."
    return 1
  fi
  if ! tag_id="$(docker image inspect --format '{{.Id}}' "${expected_ref}" 2>&1)"; then
    note_stderr "Reconciliation failed for ${svc}: runtime tag '${expected_ref}' is not inspectable (${tag_id:-inspect failed})."
    return 1
  fi
  if [[ "${tag_id}" != "${expected_id}" ]]; then
    note_stderr "Reconciliation failed for ${svc}: runtime tag '${expected_ref}' resolves to '${tag_id}', expected '${expected_id}'."
    return 1
  fi

  if ! container_ids="$(compose_for "${release_dir}" "${runtime_env}" ps --all -q "${svc}" 2>&1)"; then
    note_stderr "Reconciliation failed for ${svc}: docker compose ps --all failed (${container_ids:-unknown error})."
    return 1
  fi
  container_ids="$(printf '%s\n' "${container_ids}" | awk 'NF')"
  if [[ "${container_ids}" == *$'\n'* ]]; then
    note_stderr "Reconciliation failed for ${svc}: expected at most one existing container, found '${container_ids//$'\n'/ }'."
    return 1
  fi

  if [[ -n "${container_ids}" ]]; then
    existing_cid="${container_ids}"
    obs_ref="$(docker inspect --format '{{.Config.Image}}' "${existing_cid}" 2>/dev/null || true)"
    obs_id="$(docker inspect --format '{{.Image}}' "${existing_cid}" 2>/dev/null || true)"
    obs_inspectable="no"
    if [[ -n "${obs_id}" && "$(docker image inspect --format '{{.Id}}' "${obs_id}" 2>/dev/null || true)" == "${obs_id}" ]]; then
      obs_inspectable="yes"
    fi
    if [[ "${obs_ref}" != "${expected_ref}" || "${obs_id}" != "${expected_id}" || "${obs_inspectable}" != "yes" ]]; then
      need_force_recreate=true
      note_stderr "Reconciling ${svc}: container ${existing_cid} has ref='${obs_ref:-<empty>}' id='${obs_id:-<empty>}' inspectable=${obs_inspectable}; expected ref='${expected_ref}' id='${expected_id}' — forcing recreation."
    else
      log_info "[reconcile] ${svc}: container ${existing_cid} already matches ref='${expected_ref}' id='${expected_id}'; ensuring running without forced recreation."
    fi
  else
    log_info "[reconcile] ${svc}: no existing container found; starting ref='${expected_ref}' id='${expected_id}'."
  fi

  local -a up_cmd=(up -d --no-deps --no-build --pull never)
  if [[ "${need_force_recreate}" == "true" ]]; then
    up_cmd+=(--force-recreate)
  fi
  if (( ${#extra_up_args[@]} > 0 )); then
    up_cmd+=("${extra_up_args[@]}")
  fi
  up_cmd+=("${svc}")

  if ! compose_for "${release_dir}" "${runtime_env}" "${up_cmd[@]}"; then
    note_stderr "Reconciliation failed for ${svc}: docker compose ${up_cmd[*]} exited non-zero."
    return 1
  fi

  wait_for_service "${release_dir}" "${runtime_env}" "${svc}" "${timeout_seconds}" || return 1

  if ! running_ids="$(compose_for "${release_dir}" "${runtime_env}" ps -q "${svc}" 2>&1)"; then
    note_stderr "Post-reconciliation check failed for ${svc}: docker compose ps failed (${running_ids:-unknown error})."
    return 1
  fi
  running_ids="$(printf '%s\n' "${running_ids}" | awk 'NF')"
  if [[ -z "${running_ids}" || "${running_ids}" == *$'\n'* ]]; then
    note_stderr "Post-reconciliation check failed for ${svc}: expected exactly one running container, found '${running_ids//$'\n'/ }'."
    return 1
  fi
  running_cid="${running_ids}"
  post_ref="$(docker inspect --format '{{.Config.Image}}' "${running_cid}" 2>/dev/null || true)"
  post_id="$(docker inspect --format '{{.Image}}' "${running_cid}" 2>/dev/null || true)"
  post_local="$(docker image inspect --format '{{.Id}}' "${post_id}" 2>/dev/null || true)"
  if [[ "${post_ref}" != "${expected_ref}" || "${post_id}" != "${expected_id}" || "${post_local}" != "${expected_id}" ]]; then
    note_stderr "Post-reconciliation check failed for ${svc} container ${running_cid}: observed ref='${post_ref:-<empty>}' id='${post_id:-<empty>}' local_id='${post_local:-<empty>}'; expected ref='${expected_ref}' id='${expected_id}'."
    return 1
  fi
  log_info "[reconcile] Verified ${svc}: container ${running_cid} is healthy on ref='${post_ref}' id='${post_id}'."
}

# Verify that every running service container of a release runs exactly the image ID pinned in its
# .activated-images manifest, that each pinned ID and runtime tag resolve locally, and (when an
# environment is known) that the content-addressed retention tag matches.
verify_running_matches_manifest() {
  local release_dir="$1"
  local compose_env="$2"
  local pin_sha="$3"
  local explicit_env="${4:-}"
  local manifest="${release_dir}/.activated-images"
  local parsed_lines svc image_ref expected_id container_ids running_ref running_id local_id tag_id pin_env pin_tag pin_id

  parsed_lines="$(parse_manifest_file "${manifest}" "${release_dir}" "${pin_sha}")" || return 1
  pin_env="$(resolve_pin_env "${explicit_env}" || true)"

  while IFS=' ' read -r svc image_ref expected_id; do
    if ! container_ids="$(compose_for "${release_dir}" "${compose_env}" ps -q "${svc}" 2>&1)"; then
      note_stderr "Manifest verification failed for ${pin_sha} (${svc}): docker compose ps failed (${container_ids:-unknown error})."
      return 1
    fi
    container_ids="$(printf '%s\n' "${container_ids}" | awk 'NF')"
    if [[ -z "${container_ids}" || "${container_ids}" == *$'\n'* ]]; then
      note_stderr "Manifest verification failed for ${pin_sha} (${svc}): expected exactly one running container, found '${container_ids//$'\n'/ }'."
      return 1
    fi
    running_ref="$(docker inspect --format '{{.Config.Image}}' "${container_ids}" 2>/dev/null || true)"
    if [[ "${running_ref}" != "${image_ref}" ]]; then
      note_stderr "Manifest verification failed for ${pin_sha} (${svc} container ${container_ids}): Config.Image is '${running_ref:-<empty>}', expected '${image_ref}'."
      return 1
    fi
    running_id="$(docker inspect --format '{{.Image}}' "${container_ids}" 2>/dev/null || true)"
    if [[ "${running_id}" != "${expected_id}" ]]; then
      note_stderr "Manifest verification failed for ${pin_sha} (${svc} container ${container_ids}): running image is '${running_id:-<empty>}', expected pinned '${expected_id}'."
      return 1
    fi
    local_id="$(docker image inspect --format '{{.Id}}' "${expected_id}" 2>/dev/null || true)"
    if [[ "${local_id}" != "${expected_id}" ]]; then
      note_stderr "Manifest verification failed for ${pin_sha} (${svc}): pinned image ID '${expected_id}' is not inspectable locally (got '${local_id:-<empty>}')."
      return 1
    fi
    tag_id="$(docker image inspect --format '{{.Id}}' "${image_ref}" 2>/dev/null || true)"
    if [[ "${tag_id}" != "${expected_id}" ]]; then
      note_stderr "Manifest verification failed for ${pin_sha} (${svc}): runtime tag '${image_ref}' resolves to '${tag_id:-<empty>}', expected '${expected_id}'."
      return 1
    fi
    if [[ -n "${pin_env}" ]]; then
      pin_tag="$(pin_tag_for_image "${pin_env}" "${svc}" "${expected_id}")" || return 1
      pin_id="$(docker image inspect --format '{{.Id}}' "${pin_tag}" 2>/dev/null || true)"
      if [[ "${pin_id}" != "${expected_id}" ]]; then
        note_stderr "Manifest verification failed for ${pin_sha} (${svc}): retention tag '${pin_tag}' resolves to '${pin_id:-<empty>}', expected '${expected_id}'."
        return 1
      fi
    fi
  done <<<"${parsed_lines}"
  log_info "[verify] All 5 running containers, runtime tags, and retention pins verified for ${pin_sha}."
}

# Remove owned content-addressed retention tags not referenced by any kept release manifest.
# Fail-safe: if any kept .activated-images manifest fails strict validation, skip pruning entirely.
prune_unreferenced_pin_tags() {
  local app_env="$1"
  shift
  local -a kept_dirs=("$@")
  local pin_repo dir sha manifest parsed_lines svc ref id pin_tag
  local referenced_tags=" "
  local listed_tags existing_tag rm_err

  pin_repo="$(pin_repo_for_env "${app_env}")" || return 0

  for dir in "${kept_dirs[@]}"; do
    manifest="${dir}/.activated-images"
    [[ -e "${manifest}" || -L "${manifest}" ]] || continue
    sha="$(basename "${dir}")"
    if ! [[ "${sha}" =~ ^[0-9a-f]{40}$ ]]; then
      note_stderr "Skipping pin-tag pruning: kept release directory '${dir}' does not have a valid SHA basename."
      return 0
    fi
    if ! parsed_lines="$(parse_manifest_file "${manifest}" "${dir}" "${sha}")"; then
      note_stderr "Skipping pin-tag pruning: kept manifest ${manifest} failed validation; preserving all retention tags."
      return 0
    fi
    while IFS=' ' read -r svc ref id; do
      pin_tag="$(pin_tag_for_image "${app_env}" "${svc}" "${id}")" || {
        note_stderr "Skipping pin-tag pruning: could not derive retention tag for ${svc} (${id})."
        return 0
      }
      referenced_tags+="${pin_tag} "
    done <<<"${parsed_lines}"
  done

  if ! listed_tags="$(docker image ls --format '{{.Repository}}:{{.Tag}}' "${pin_repo}" 2>&1)"; then
    note_stderr "Warning: failed to list retention tags in ${pin_repo}: ${listed_tags:-unknown error}."
    return 0
  fi

  local kept_count=0 pruned_count=0
  while IFS= read -r existing_tag; do
    [[ -n "${existing_tag}" && "${existing_tag}" != *":<none>" ]] || continue
    if [[ "${referenced_tags}" == *" ${existing_tag} "* ]]; then
      kept_count=$((kept_count + 1))
      continue
    fi
    if ! rm_err="$(docker image rm --no-prune "${existing_tag}" 2>&1)"; then
      note_stderr "Warning: failed to prune unreferenced retention tag ${existing_tag}: ${rm_err:-unknown error}."
    else
      pruned_count=$((pruned_count + 1))
      log_info "[prune] Removed unreferenced retention tag ${existing_tag}"
    fi
  done <<<"${listed_tags}"
  log_info "[prune] Retention tag sweep for ${pin_repo}: kept ${kept_count}, pruned ${pruned_count}."
}

# Fail-closed stop of Caddy + application services (PostgreSQL preserved) that survives a broken SSH session:
# Compose output goes to a durable log instead of the (possibly closed) stdout/stderr pipe, so a cancelled CI
# runner cannot make the stop itself die of SIGPIPE before stopping anything.
failclosed_stop_app_services() {
  local release_dir="$1"
  local compose_env="$2"
  local base_dir="$3"
  local log="${base_dir}/shared/deployment-state/failclosed.log"
  if compose_for "${release_dir}" "${compose_env}" stop caddy supplier-web tmmin-web api >>"${log}" 2>&1; then
    return 0
  fi
  if compose_for "${release_dir}" "${compose_env}" stop caddy supplier-web tmmin-web api >/dev/null 2>&1; then
    return 0
  fi
  note_stderr "CRITICAL: fail-closed stop of caddy, supplier-web, tmmin-web, and api failed; inspect ${log} and container state immediately."
  return 1
}

# Best-effort message to stderr that can never abort a cleanup path when the pipe is gone.
note_stderr() {
  (
    trap '' PIPE
    printf '%s\n' "$*" >&2
  ) || true
}

# Best-effort timestamped operational log line to stderr (safe during broken pipes and never
# pollutes stdout captured by callers).
log_info() {
  note_stderr "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
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
  log_info "[driver] Installed hardened rollback driver (${ROLLBACK_DRIVER_CONTRACT}) at ${stage}."
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
  local pruned_bundles=0
  for entry in "${state_dir}"/rollback-driver.v.* "${state_dir}"/rollback-driver.legacy.*; do
    [[ -d "${entry}" && ! -L "${entry}" && "${entry}" != "${target}" ]] || continue
    rm -rf -- "${entry}" >/dev/null 2>&1 || true
    pruned_bundles=$((pruned_bundles + 1))
  done
  log_info "[driver] Promoted rollback driver ${target} to rollback-driver.good (pruned ${pruned_bundles} superseded bundle(s))."
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
  # backfill of an already-active legacy release), every container must predate it; a container
  # created at or after activation makes the baseline ambiguous and fails closed.
  local activated_at_file="${4:-}"
  # Optional: staged manifest of expected candidate IDs (when activating a freshly built candidate).
  local expected_manifest="${5:-}"
  # Optional: write the verified manifest to this path instead of publishing .activated-images directly
  # (used so same-SHA / retained-SHA redeploys never clobber a committed manifest before pointer commit).
  local dest_override="${6:-}"
  local pg_ref svc image_ref container_ids container_id config_image image_id resolved_id tag_id expected_id
  local tmp_file dest_file backup_file unsafe_marker had_prev=false pin_env=""
  local activated_ns="" created created_ns err_out
  local -a recorded_svcs=() recorded_ids=()
  local i

  dest_file="${dest_override:-${release_dir}/.activated-images}"
  unsafe_marker="${release_dir}/.rollback-unsafe"
  if [[ ! -d "${release_dir}" ]]; then
    note_stderr "Refusing to pin ${pin_sha}: release directory '${release_dir}' does not exist."
    return 1
  fi
  if [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
    note_stderr "Refusing to pin ${pin_sha}: COMPOSE_PROJECT_NAME is unset."
    return 1
  fi
  if [[ ! -f "${compose_env}" ]]; then
    note_stderr "Refusing to pin ${pin_sha}: compose env file '${compose_env}' does not exist."
    return 1
  fi
  if [[ -L "${release_dir}/.activated-images" || ( -e "${release_dir}/.activated-images" && ! -f "${release_dir}/.activated-images" ) ]]; then
    note_stderr "Refusing to publish pinned image manifest: ${release_dir}/.activated-images is not a regular file."
    return 1
  fi
  if [[ -n "${dest_override}" && ( -L "${dest_file}" || ( -e "${dest_file}" && ! -f "${dest_file}" ) ) ]]; then
    note_stderr "Refusing to write staged pinned image manifest: ${dest_file} is not a regular file."
    return 1
  fi
  if [[ -L "${unsafe_marker}" || ( -e "${unsafe_marker}" && ! -f "${unsafe_marker}" ) ]]; then
    note_stderr "Refusing to publish pinned image manifest: ${unsafe_marker} is not a regular file."
    return 1
  fi
  if [[ -n "${activated_at_file}" ]]; then
    if ! activated_ns="$(file_mtime_ns "${activated_at_file}")"; then
      note_stderr "Refusing to pin ${pin_sha}: could not read mtime of activation marker '${activated_at_file}'."
      return 1
    fi
  fi
  if [[ -n "${expected_manifest}" ]]; then
    parse_manifest_file "${expected_manifest}" "${release_dir}" "${pin_sha}" >/dev/null || return 1
  fi

  pin_env="$(resolve_pin_env || true)"
  pg_ref="$(postgres_image_ref_for "${release_dir}")"
  if ! tmp_file="$(mktemp "${release_dir}/.activated-images.tmp.XXXXXX" 2>&1)"; then
    note_stderr "Refusing to pin ${pin_sha}: failed to create temporary manifest file in ${release_dir} (${tmp_file:-mktemp failed})."
    return 1
  fi
  if ! err_out="$(chmod 600 "${tmp_file}" 2>&1)"; then
    note_stderr "Refusing to pin ${pin_sha}: chmod 600 on ${tmp_file} failed (${err_out:-chmod failed})."
    rm -f -- "${tmp_file}"
    return 1
  fi

  for svc in "${DEPLOY_SERVICES[@]}"; do
    if [[ "${svc}" == "postgres" ]]; then
      image_ref="${pg_ref}"
    else
      image_ref="supplier-henkaten-${svc}:${pin_sha}"
    fi
    if ! container_ids="$(compose_for "${release_dir}" "${compose_env}" ps -q "${svc}" 2>&1)"; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: docker compose ps failed (${container_ids:-unknown error})."
      rm -f -- "${tmp_file}"
      return 1
    fi
    container_ids="$(printf '%s\n' "${container_ids}" | awk 'NF')"
    container_id="${container_ids%%$'\n'*}"
    if [[ -z "${container_id}" || "${container_ids}" == *$'\n'* ]]; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: expected exactly one running container, found '${container_ids//$'\n'/ }'."
      rm -f -- "${tmp_file}"
      return 1
    fi
    # Release ownership: the container must have been created from this release's exact image reference
    # (versioned services embed the release SHA), so an interrupted rollout's candidate containers sharing
    # the Compose project can never be recorded as another release's pins.
    config_image="$(docker inspect --format '{{.Config.Image}}' "${container_id}" 2>/dev/null || true)"
    if [[ "${config_image}" != "${image_ref}" ]]; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: running container ${container_id} was created from '${config_image:-<empty>}', expected '${image_ref}'."
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
      # restart preserves .Created and still passes.
      if [[ -z "${created_ns}" ]] || ! timestamp_ns_before "${created_ns}" "${activated_ns}"; then
        note_stderr "Refusing to pin ${svc} for ${pin_sha}: running container ${container_id} (created '${created:-<empty>}') does not strictly predate activation (${activated_ns}); baseline provenance is ambiguous."
        rm -f -- "${tmp_file}"
        return 1
      fi
    fi
    if ! image_id="$(docker inspect --format '{{.Image}}' "${container_id}" 2>&1)"; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: failed to inspect container ${container_id} .Image (${image_id:-inspect failed})."
      rm -f -- "${tmp_file}"
      return 1
    fi
    if ! validate_image_id "${image_id}"; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: container ${container_id} reported invalid image ID '${image_id:-<empty>}'."
      rm -f -- "${tmp_file}"
      return 1
    fi
    if ! resolved_id="$(docker image inspect --format '{{.Id}}' "${image_id}" 2>&1)"; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: running container ${container_id} image '${image_id}' is not an inspectable local image (${resolved_id:-No such image})."
      rm -f -- "${tmp_file}"
      return 1
    fi
    if [[ "${resolved_id}" != "${image_id}" ]]; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: local image '${image_id}' resolved to '${resolved_id}'."
      rm -f -- "${tmp_file}"
      return 1
    fi
    if [[ -n "${expected_manifest}" ]]; then
      expected_id="$(awk -v target="${image_ref}" '$1 == target {print $2; exit}' "${expected_manifest}")"
      if [[ "${image_id}" != "${expected_id}" ]]; then
        note_stderr "Refusing to pin ${svc} for ${pin_sha}: running container ${container_id} uses '${image_id}', expected candidate image '${expected_id}'."
        rm -f -- "${tmp_file}"
        return 1
      fi
    elif [[ -z "${activated_at_file}" ]]; then
      tag_id="$(docker image inspect --format '{{.Id}}' "${image_ref}" 2>/dev/null || true)"
      if [[ -n "${tag_id}" && "${tag_id}" != "${image_id}" ]]; then
        note_stderr "Refusing to pin ${svc} for ${pin_sha}: running container ${container_id} uses '${image_id}', which differs from runtime tag ${image_ref} ('${tag_id}')."
        rm -f -- "${tmp_file}"
        return 1
      fi
    fi
    if ! printf '%s %s\n' "${image_ref}" "${image_id}" >>"${tmp_file}"; then
      note_stderr "Refusing to pin ${svc} for ${pin_sha}: failed to append manifest entry to ${tmp_file}."
      rm -f -- "${tmp_file}"
      return 1
    fi
    recorded_svcs+=("${svc}")
    recorded_ids+=("${image_id}")
  done

  # Materialize and verify content-addressed retention tags BEFORE publishing the manifest so a
  # published manifest never names an unretained ID under containerd's image store.
  if [[ -n "${pin_env}" ]]; then
    for ((i = 0; i < ${#recorded_svcs[@]}; i++)); do
      if ! pin_image_id "${pin_env}" "${recorded_svcs[i]}" "${recorded_ids[i]}"; then
        rm -f -- "${tmp_file}"
        return 1
      fi
    done
  fi

  if [[ -n "${dest_override}" ]]; then
    if ! rename_exact "${tmp_file}" "${dest_file}"; then
      note_stderr "Refusing to stage pinned image manifest for ${pin_sha}: failed to rename ${tmp_file} onto ${dest_file}."
      rm -f -- "${tmp_file}"
      return 1
    fi
    if [[ ! -f "${dest_file}" || -L "${dest_file}" ]]; then
      note_stderr "Refusing to stage pinned image manifest for ${pin_sha}: ${dest_file} is not a regular file after rename."
      rm -f -- "${dest_file}" >/dev/null 2>&1 || true
      return 1
    fi
    return 0
  fi

  backup_file=""
  if [[ -f "${dest_file}" && ! -L "${dest_file}" ]]; then
    if ! backup_file="$(mktemp "${release_dir}/.activated-images.prev.XXXXXX" 2>&1)"; then
      note_stderr "Refusing to publish pinned image manifest for ${pin_sha}: failed to create backup temp file (${backup_file:-mktemp failed})."
      rm -f -- "${tmp_file}"
      return 1
    fi
    if ! err_out="$(cp -p "${dest_file}" "${backup_file}" 2>&1)"; then
      note_stderr "Refusing to publish pinned image manifest for ${pin_sha}: failed to back up existing manifest (${err_out:-cp failed})."
      rm -f -- "${tmp_file}" "${backup_file}"
      return 1
    fi
    had_prev=true
  fi
  if ! rename_exact "${tmp_file}" "${dest_file}"; then
    note_stderr "Refusing to publish pinned image manifest for ${pin_sha}: failed to rename ${tmp_file} onto ${dest_file}."
    rm -f -- "${tmp_file}" "${backup_file}"
    return 1
  fi
  if [[ ! -f "${dest_file}" || -L "${dest_file}" ]] || ! rm -f -- "${unsafe_marker}" || [[ -e "${unsafe_marker}" || -L "${unsafe_marker}" ]]; then
    note_stderr "Failed post-publish verification or .rollback-unsafe cleanup for ${pin_sha}; restoring previous manifest state."
    if [[ "${had_prev}" == "true" ]]; then
      if ! rename_exact "${backup_file}" "${dest_file}"; then
        note_stderr "CRITICAL: failed to restore backup manifest ${backup_file} onto ${dest_file}."
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
  local explicit_env="${4:-}"
  local parsed_lines svc ref expected_id restored_id resolved_id tag_err pin_env
  local -a parsed_svcs=() parsed_refs=() parsed_ids=()
  local i status=0

  parsed_lines="$(parse_manifest_file "${pinned_file}" "${release_dir}" "${pin_sha}")" || return 1
  while IFS=' ' read -r svc ref expected_id; do
    parsed_svcs+=("${svc}")
    parsed_refs+=("${ref}")
    parsed_ids+=("${expected_id}")
  done <<<"${parsed_lines}"

  # Pass 1: verify every pinned image ID exists locally before modifying any tag.
  for ((i = 0; i < ${#parsed_refs[@]}; i++)); do
    if ! resolved_id="$(docker image inspect --format '{{.Id}}' "${parsed_ids[i]}" 2>&1)"; then
      note_stderr "Pinned Docker image ID ${parsed_ids[i]} for ${parsed_refs[i]} is unavailable locally (${resolved_id:-inspect failed})."
      return 1
    fi
    if [[ "${resolved_id}" != "${parsed_ids[i]}" ]]; then
      note_stderr "Pinned Docker image ID ${parsed_ids[i]} for ${parsed_refs[i]} resolved to '${resolved_id}'."
      return 1
    fi
  done

  # Pass 2: restore every runtime tag, re-verify it resolves to its exact pinned ID, and re-assert
  # its content-addressed retention tag so subsequent builds never GC it.
  pin_env="$(resolve_pin_env "${explicit_env}" || true)"
  for ((i = 0; i < ${#parsed_refs[@]}; i++)); do
    if ! tag_err="$(docker tag "${parsed_ids[i]}" "${parsed_refs[i]}" 2>&1)"; then
      note_stderr "Failed to restore pinned Docker image tag ${parsed_refs[i]} to ${parsed_ids[i]} (${tag_err:-docker tag failed})."
      status=1
      continue
    fi
    if ! restored_id="$(docker image inspect --format '{{.Id}}' "${parsed_refs[i]}" 2>&1)"; then
      note_stderr "Restored pinned Docker image tag ${parsed_refs[i]} failed verification (${restored_id:-inspect failed})."
      status=1
      continue
    fi
    if [[ "${restored_id}" != "${parsed_ids[i]}" ]]; then
      note_stderr "Restored pinned Docker image tag ${parsed_refs[i]} resolved to '${restored_id}', expected '${parsed_ids[i]}'."
      status=1
      continue
    fi
    if [[ -n "${pin_env}" ]]; then
      if ! pin_image_id "${pin_env}" "${parsed_svcs[i]}" "${parsed_ids[i]}"; then
        status=1
      fi
    fi
    log_info "[pin] Restored runtime tag ${parsed_refs[i]} -> ${parsed_ids[i]}"
  done
  return "${status}"
}
