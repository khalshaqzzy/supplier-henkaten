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

version_ge() {
  local current="$1"
  local minimum="$2"
  [[ "$(printf '%s\n%s\n' "${minimum}" "${current}" | sort -V | head -n 1)" == "${minimum}" ]]
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

load_runtime_env() {
  local runtime_env="$1"
  [[ -f "${runtime_env}" ]] || die "Runtime env file does not exist: ${runtime_env}"
  set -a
  # shellcheck disable=SC1090
  source "${runtime_env}"
  set +a
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
