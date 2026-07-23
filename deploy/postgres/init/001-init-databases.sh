#!/bin/bash
set -euo pipefail

if [[ ! "${TEST_DATABASE_NAME}" =~ ^[a-z][a-z0-9_]*_test$ ]]; then
  echo "TEST_DATABASE_NAME must be a lowercase PostgreSQL identifier ending with _test." >&2
  exit 1
fi

psql --set ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<SQL
CREATE EXTENSION IF NOT EXISTS vector;
SELECT format('CREATE DATABASE %I', '${TEST_DATABASE_NAME}') \gexec
SQL

psql --set ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${TEST_DATABASE_NAME}" <<SQL
CREATE EXTENSION IF NOT EXISTS vector;
SQL
