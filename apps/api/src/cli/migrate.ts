import { execFileSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const SAFE_PG_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SAFE_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * Append-only evidence tables enforced by database triggers; runtime role gets
 * SELECT and INSERT only (no UPDATE, DELETE, or TRUNCATE).
 */
export const APPEND_ONLY_LEDGER_TABLES = [
  'HenkatenDeletionCommand',
  'HenkatenPart',
  'HenkatenChecklistSnapshot',
  'HenkatenChecklistAnswer',
  'ManHenkatenDetail',
  'HenkatenTransition',
  'ApprovalDecision',
  'ApprovalRouteRouting',
  'AssignmentMovement',
  'MemberRoleChange',
  'ChecklistVersion',
  'ChecklistVersionItem',
] as const;

/**
 * Append-only ledgers that allow one-way hiddenAt soft-hiding during TMMIN
 * Henkaten deletion; runtime role gets SELECT, INSERT, and UPDATE ("hiddenAt") only.
 */
export const HIDDEN_AT_LEDGER_TABLES = ['AuditEvent', 'ExternalIngestionEvent'] as const;

/**
 * Soft-deletable core tables that must never be physically deleted or truncated.
 */
export const NO_DELETE_TABLES = [
  'Henkaten',
  'ExternalHenkatenProjection',
  'HenkatenApprovalRoute',
] as const;

/**
 * Computes a PostgreSQL SCRAM-SHA-256 verifier (RFC 5802 / PG 10+) so the
 * plaintext password never appears in PostgreSQL SQL statements or logs.
 */
export function buildScramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  const iterations = 4096;
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

export type ProvisionRuntimeRoleOptions = {
  migrationDatabaseUrl: string;
  appUser: string;
  appPassword: string;
  provisionRoleOnly?: boolean;
};

export async function provisionRuntimeRole(options: ProvisionRuntimeRoleOptions): Promise<void> {
  const { migrationDatabaseUrl, appUser, appPassword, provisionRoleOnly = false } = options;
  if (!SAFE_PG_ROLE_PATTERN.test(appUser)) {
    throw new Error('POSTGRES_APP_USER must match ^[a-z_][a-z0-9_]{0,62}$.');
  }
  if (!SAFE_PASSWORD_PATTERN.test(appPassword)) {
    throw new Error('POSTGRES_APP_PASSWORD must contain 32-128 URL-safe characters.');
  }
  const migrationUrl = new URL(migrationDatabaseUrl);
  const migrationUser = decodeURIComponent(migrationUrl.username);
  const migrationPassword = decodeURIComponent(migrationUrl.password);
  if (!migrationUser || appUser === migrationUser) {
    throw new Error('POSTGRES_APP_USER must be distinct from the migration database user.');
  }
  if (appPassword === migrationPassword) {
    throw new Error('POSTGRES_APP_PASSWORD must be distinct from the migration password.');
  }

  const verifier = buildScramSha256Verifier(appPassword);
  const adminClient = new pg.Client({ connectionString: migrationDatabaseUrl });
  await adminClient.connect();
  try {
    await adminClient.query('BEGIN');
    await adminClient.query("SELECT set_config('app.target_user', $1, true)", [appUser]);
    await adminClient.query("SELECT set_config('app.target_verifier', $1, true)", [verifier]);

    await adminClient.query(`
      DO $$
      DECLARE
        target_user text := current_setting('app.target_user');
        target_verifier text := current_setting('app.target_verifier');
        db_name text := current_database();
        tbl text;
        owned_count integer;
        member_count integer;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_user) THEN
          EXECUTE format(
            'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
            target_user,
            target_verifier
          );
        ELSE
          SELECT count(*) INTO owned_count
          FROM (
            SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE r.rolname = target_user
            UNION ALL
            SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = target_user
            UNION ALL
            SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = target_user
            UNION ALL
            SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = target_user
            UNION ALL
            SELECT 1 FROM pg_type t JOIN pg_roles r ON r.oid = t.typowner WHERE r.rolname = target_user
          ) owned;
          IF owned_count > 0 THEN
            RAISE EXCEPTION 'Runtime role % unexpectedly owns database objects', target_user;
          END IF;

          SELECT count(*) INTO member_count
          FROM pg_auth_members m
          JOIN pg_roles r ON r.oid = m.member
          WHERE r.rolname = target_user;
          IF member_count > 0 THEN
            RAISE EXCEPTION 'Runtime role % unexpectedly has role memberships', target_user;
          END IF;

          EXECUTE format(
            'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
            target_user,
            target_verifier
          );
        END IF;

        EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';
        EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC';
        EXECUTE 'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC';

        EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', db_name, target_user);
        EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', target_user);
        EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', target_user);

        EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', target_user);
        EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', target_user);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', target_user);
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', target_user);

        IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM %I', target_user);
          EXECUTE format('GRANT SELECT ON TABLE public."_prisma_migrations" TO %I', target_user);
        END IF;

        FOREACH tbl IN ARRAY ARRAY[${HIDDEN_AT_LEDGER_TABLES.map((name) => `'${name}'`).join(', ')}] LOOP
          IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', tbl, target_user);
            EXECUTE format('GRANT SELECT, INSERT, UPDATE ("hiddenAt") ON TABLE public.%I TO %I', tbl, target_user);
          END IF;
        END LOOP;

        FOREACH tbl IN ARRAY ARRAY[${NO_DELETE_TABLES.map((name) => `'${name}'`).join(', ')}] LOOP
          IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
            EXECUTE format('REVOKE DELETE, TRUNCATE ON TABLE public.%I FROM %I', tbl, target_user);
          END IF;
        END LOOP;

        FOREACH tbl IN ARRAY ARRAY[${APPEND_ONLY_LEDGER_TABLES.map((name) => `'${name}'`).join(', ')}] LOOP
          IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', tbl, target_user);
            EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', tbl, target_user);
          END IF;
        END LOOP;
      END $$;
    `);

    const expectedRestrictedTables = [
      ...APPEND_ONLY_LEDGER_TABLES,
      ...HIDDEN_AT_LEDGER_TABLES,
      ...NO_DELETE_TABLES,
    ];
    const uncategorized = await adminClient.query<{ table_name: string }>(
      `
      SELECT DISTINCT c.relname AS table_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
        AND t.tgname ~ '(_prevent_update_delete|_immutable|_deletion_guard|_enforce_immutability|_enforce_terminal)$'
        AND NOT (c.relname = ANY($1::text[]))
      `,
      [expectedRestrictedTables],
    );
    if (uncategorized.rows.length > 0) {
      const names = uncategorized.rows.map((r) => r.table_name);
      if (!provisionRoleOnly) {
        throw new Error(
          `Uncategorized immutable tables missing from runtime DB role grant lists: ${names.join(', ')}`,
        );
      }
      // During rollback to an older hardened release against a forward-migrated schema,
      // fail closed on newer immutable tables the older release does not query.
      await adminClient.query("SELECT set_config('app.uncategorized_tables', $1, true)", [
        names.join(','),
      ]);
      await adminClient.query(`
        DO $$
        DECLARE
          target_user text := current_setting('app.target_user');
          tbl text;
        BEGIN
          FOREACH tbl IN ARRAY string_to_array(current_setting('app.uncategorized_tables'), ',') LOOP
            IF tbl <> '' AND to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
              EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', tbl, target_user);
            END IF;
          END LOOP;
        END $$;
      `);
      process.stderr.write(
        `Warning: revoked access to forward-migrated immutable tables during rollback role reconciliation: ${names.join(', ')}\n`,
      );
    }

    const verification = await adminClient.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      can_delete_audit: boolean;
      can_truncate_audit: boolean;
      can_update_audit_action: boolean;
      can_update_audit_hidden_at: boolean;
      can_select_migrations: boolean;
      can_write_migrations: boolean;
    }>(
      `
      SELECT
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolbypassrls,
        rolcanlogin,
        has_table_privilege($1, 'public."AuditEvent"', 'DELETE') AS can_delete_audit,
        has_table_privilege($1, 'public."AuditEvent"', 'TRUNCATE') AS can_truncate_audit,
        has_column_privilege($1, 'public."AuditEvent"', 'action', 'UPDATE') AS can_update_audit_action,
        has_column_privilege($1, 'public."AuditEvent"', 'hiddenAt', 'UPDATE') AS can_update_audit_hidden_at,
        has_table_privilege($1, 'public."_prisma_migrations"', 'SELECT') AS can_select_migrations,
        has_table_privilege($1, 'public."_prisma_migrations"', 'INSERT') AS can_write_migrations
      FROM pg_roles
      WHERE rolname = $1
      `,
      [appUser],
    );
    const check = verification.rows[0];
    if (
      !check ||
      check.rolsuper ||
      check.rolcreatedb ||
      check.rolcreaterole ||
      check.rolbypassrls ||
      !check.rolcanlogin ||
      check.can_delete_audit ||
      check.can_truncate_audit ||
      check.can_update_audit_action ||
      !check.can_update_audit_hidden_at ||
      !check.can_select_migrations ||
      check.can_write_migrations
    ) {
      throw new Error('Runtime database role failed least-privilege verification.');
    }

    await adminClient.query('COMMIT');
  } catch (error) {
    await adminClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await adminClient.end();
  }

  // Verify a live login as the newly provisioned runtime role before returning.
  const appUrl = new URL(migrationDatabaseUrl);
  appUrl.username = encodeURIComponent(appUser);
  appUrl.password = encodeURIComponent(appPassword);
  const appClient = new pg.Client({ connectionString: appUrl.toString() });
  await appClient.connect();
  try {
    const identity = await appClient.query<{ current_user: string; is_superuser: string }>(
      "SELECT current_user, current_setting('is_superuser') AS is_superuser",
    );
    const row = identity.rows[0];
    if (!row || row.current_user !== appUser || row.is_superuser !== 'off') {
      throw new Error('Runtime role login verification failed.');
    }
  } finally {
    await appClient.end();
  }
}

async function run(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ENOENT')) throw error;
  }
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for migration.');
  }

  const provisionRoleOnly = process.argv.includes('--provision-role-only');
  if (!provisionRoleOnly) {
    execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      { stdio: 'inherit' },
    );
  }

  const requireAppRole = provisionRoleOnly || process.env['REQUIRE_APP_DB_ROLE'] === 'true';
  const appUser = process.env['POSTGRES_APP_USER']?.trim();
  const appPassword = process.env['POSTGRES_APP_PASSWORD']?.trim();

  if (requireAppRole || appUser || appPassword) {
    if (!appUser || !appPassword) {
      throw new Error('Both POSTGRES_APP_USER and POSTGRES_APP_PASSWORD must be provided.');
    }
    await provisionRuntimeRole({
      migrationDatabaseUrl: databaseUrl,
      appUser,
      appPassword,
      provisionRoleOnly,
    });
    process.stdout.write(`Provisioned least-privilege runtime database role ${appUser}.\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    // Emit only the safe error name/message so DATABASE_URL or secrets can never leak.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'MigrationError';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
