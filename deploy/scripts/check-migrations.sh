#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 1 ]] || {
  echo "Usage: check-migrations.sh <base-git-sha>" >&2
  exit 1
}

BASE_SHA="$1"
git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || {
  echo "Migration base commit is unavailable: ${BASE_SHA}" >&2
  exit 1
}

changed_migrations=()
while IFS= read -r migration; do
  changed_migrations+=("${migration}")
done < <(git diff --diff-filter=AM --name-only "${BASE_SHA}...HEAD" -- \
  'apps/api/prisma/migrations/*/migration.sql')

if (( ${#changed_migrations[@]} == 0 )); then
  echo "No migration SQL changed relative to ${BASE_SHA}."
  exit 0
fi

destructive_pattern='(^|[[:space:];])(DROP[[:space:]]+|TRUNCATE|DELETE[[:space:]]+FROM[[:space:]]+"?_prisma_migrations"?|prisma[[:space:]]+migrate[[:space:]]+reset|DOWN[[:space:]]+MIGRATION)'
drop_index_exception_pattern='^[[:space:]]*--[[:space:]]+migration-policy:[[:space:]]+allow-drop-index[[:space:]]+([A-Za-z0-9_]+)[[:space:]]*$'

for migration in "${changed_migrations[@]}"; do
  [[ -f "${migration}" ]] || continue

  allowed_drop_index=""
  line_number=0
  while IFS= read -r sql_line || [[ -n "${sql_line}" ]]; do
    ((line_number += 1))

    if [[ -n "${allowed_drop_index}" ]]; then
      expected_statement="DROP INDEX IF EXISTS \"${allowed_drop_index}\";"
      if [[ "${sql_line}" == "${expected_statement}" ]]; then
        allowed_drop_index=""
        continue
      fi

      echo "Invalid drop-index exception in ${migration}:$((line_number - 1)); the next line must be exactly DROP INDEX IF EXISTS for the declared index." >&2
      exit 1
    fi

    if [[ "${sql_line}" =~ ${drop_index_exception_pattern} ]]; then
      allowed_drop_index="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ "${sql_line}" =~ ${destructive_pattern} ]]; then
      printf '%s:%s:%s\n' "${migration}" "${line_number}" "${sql_line}" >&2
      echo "Destructive or reset-like migration statement is forbidden in ${migration}." >&2
      exit 1
    fi
  done <"${migration}"

  if [[ -n "${allowed_drop_index}" ]]; then
    echo "Invalid drop-index exception at end of ${migration}; the required DROP INDEX statement is missing." >&2
    exit 1
  fi
done

printf 'Changed migration SQL is forward-only by static policy (%s file(s)).\n' "${#changed_migrations[@]}"
