import { describe, expect, it } from 'vitest';

import { buildScramSha256Verifier, provisionRuntimeRole } from './migrate.js';

describe('migrate runtime role provisioning helpers', () => {
  it('formats a valid PostgreSQL SCRAM-SHA-256 verifier without embedding the plaintext password', () => {
    const secret = 'DistinctRuntimePassword_1234567890_ABCDEF';
    const verifier = buildScramSha256Verifier(secret, Buffer.alloc(16, 7));
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(verifier).not.toContain(secret);
  });

  it('rejects invalid role names, unsafe passwords, and credentials matching the migration role', async () => {
    const migrationDatabaseUrl =
      'postgresql://supplier_henkaten:MigrationPassword_1234567890_ABCDEF@127.0.0.1:5432/supplier_henkaten';
    await expect(
      provisionRuntimeRole({
        migrationDatabaseUrl,
        appUser: 'Bad-Role!',
        appPassword: 'DistinctRuntimePassword_1234567890_ABCDEF',
      }),
    ).rejects.toThrow(/POSTGRES_APP_USER/);

    await expect(
      provisionRuntimeRole({
        migrationDatabaseUrl,
        appUser: 'supplier_henkaten',
        appPassword: 'DistinctRuntimePassword_1234567890_ABCDEF',
      }),
    ).rejects.toThrow(/distinct/);

    await expect(
      provisionRuntimeRole({
        migrationDatabaseUrl,
        appUser: 'supplier_henkaten_app',
        appPassword: 'MigrationPassword_1234567890_ABCDEF',
      }),
    ).rejects.toThrow(/distinct/);

    await expect(
      provisionRuntimeRole({
        migrationDatabaseUrl,
        appUser: 'supplier_henkaten_app',
        appPassword: 'short',
      }),
    ).rejects.toThrow(/POSTGRES_APP_PASSWORD/);
  });
});
