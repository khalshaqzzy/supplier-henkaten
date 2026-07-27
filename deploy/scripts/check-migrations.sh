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

for migration in "${changed_migrations[@]}"; do
  [[ -f "${migration}" ]] || continue
  if grep -Ein \
    '(^|[[:space:];])(DROP[[:space:]]+|TRUNCATE|DELETE[[:space:]]+FROM[[:space:]]+"?_prisma_migrations"?|prisma[[:space:]]+migrate[[:space:]]+reset|DOWN[[:space:]]+MIGRATION)' \
    "${migration}"; then
    echo "Destructive or reset-like migration statement is forbidden in ${migration}." >&2
    exit 1
  fi
done

printf 'Changed migration SQL is forward-only by static policy (%s file(s)).\n' "${#changed_migrations[@]}"
