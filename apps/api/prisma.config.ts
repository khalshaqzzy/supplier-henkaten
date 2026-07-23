import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('ENOENT')) {
    throw error;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Generation does not connect. Runtime and migration commands still validate the real URL.
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://supplier_henkaten:supplier_henkaten_local_only@127.0.0.1:55432/supplier_henkaten',
  },
});
