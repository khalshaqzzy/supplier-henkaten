#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 1 ]] || {
  echo "Usage: check-security-exceptions.sh <exception-registry.json>" >&2
  exit 1
}

REGISTRY="$1"
[[ -s "${REGISTRY}" ]] || {
  echo "Security exception registry is missing or empty." >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required to validate security exceptions." >&2
  exit 1
}

today="$(date -u +%F)"
jq -e \
  --arg today "${today}" \
  'type == "array"
   and (length == (unique_by([.scanner, .id]) | length))
   and all(.[];
     (.scanner | type == "string" and length > 0)
     and (.id | type == "string" and length > 0 and (contains("*") or contains("?") | not))
     and (.rationale | type == "string" and length >= 20)
     and (.expiresOn | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
     and .expiresOn >= $today
   )' \
  "${REGISTRY}" >/dev/null || {
    echo "Security exceptions must be exact, justified, and unexpired." >&2
    exit 1
  }

registry_has() {
  local scanner="$1"
  local id="$2"
  jq -e --arg scanner "${scanner}" --arg id "${id}" \
    'any(.[]; .scanner == $scanner and .id == $id)' "${REGISTRY}" >/dev/null
}

if [[ -f .gitleaksignore ]]; then
  while IFS= read -r finding; do
    [[ -z "${finding}" || "${finding}" == \#* ]] && continue
    registry_has gitleaks "${finding}" || {
      echo "Gitleaks fingerprint lacks a registered exception: ${finding}" >&2
      exit 1
    }
  done <.gitleaksignore
fi

if [[ -f .gitleaks.toml ]]; then
  while IFS= read -r exact_value; do
    [[ -z "${exact_value}" ]] && continue
    registry_has gitleaks "${exact_value}" || {
      echo "Gitleaks allowlist value lacks a registered exception: ${exact_value}" >&2
      exit 1
    }
  done < <(sed -n "s/^[[:space:]]*'''\\([^']*\\)''',[[:space:]]*$/\\1/p" .gitleaks.toml)
fi

while IFS= read -r audit_exception; do
  [[ -z "${audit_exception}" ]] && continue
  registry_has pnpm-audit "${audit_exception}" || {
    echo "pnpm audit ignore lacks a registered exception: ${audit_exception}" >&2
    exit 1
  }
done < <(sed -n '/^auditConfig:/,/^[^[:space:]]/s/^[[:space:]]*-[[:space:]]*\\(GHSA-[A-Za-z0-9-]*\\)$/\\1/p' pnpm-workspace.yaml)

for unsupported_trivy_ignore in .trivyignore.yaml .trivyignore.yml; do
  [[ ! -e "${unsupported_trivy_ignore}" ]] || {
    echo "${unsupported_trivy_ignore} is not permitted; use exact identifiers in .trivyignore." >&2
    exit 1
  }
done

if [[ -f .trivyignore ]]; then
  while IFS= read -r finding; do
    [[ -z "${finding}" || "${finding}" == \#* ]] && continue
    [[ "${finding}" != *"*"* && "${finding}" != *"?"* && "${finding}" != *":"* ]] || {
      echo "Trivy exception must be one exact finding identifier: ${finding}" >&2
      exit 1
    }
    registry_has trivy "${finding}" || {
      echo "Trivy finding lacks a registered exception: ${finding}" >&2
      exit 1
    }
  done <.trivyignore
fi

printf 'Security exception registry is exact and unexpired (%s entries).\n' \
  "$(jq 'length' "${REGISTRY}")"
