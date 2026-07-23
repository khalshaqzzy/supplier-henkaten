import { z } from 'zod';

const booleanEnvironmentSchema = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().url(),
    RELEASE_SHA: z.string().min(1).max(100).default('local'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: booleanEnvironmentSchema('false'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
    SUPPLIER_APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    TMMIN_APP_ORIGIN: z.string().url().default('http://localhost:5174'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(100).default(30_000),
    OUTBOX_ENABLED: booleanEnvironmentSchema('true'),
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_LOCK_LEASE_MS: z.coerce.number().int().min(1_000).default(30_000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
    SESSION_CSRF_SECRET: z.string().min(32),
    AUTH_THROTTLE_SECRET: z.string().min(32),
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(19_456).default(19_456),
    ARGON2_ITERATIONS: z.coerce.number().int().min(2).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
    AUTH_IP_LOGIN_LIMIT: z.coerce.number().int().min(5).default(50),
    AUTH_GLOBAL_LIMIT_PER_MINUTE: z.coerce.number().int().min(30).default(300),
    PHOTO_STORAGE_ROOT: z.string().min(1).default('.local/uploads/member-photos'),
  })
  .passthrough();

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  releaseSha: string;
  logLevel: string;
  logPretty: boolean;
  corsAllowedOrigins: ReadonlySet<string>;
  supplierAppOrigin: string;
  tmminAppOrigin: string;
  trustProxyHops: number;
  dbPoolMax: number;
  dbConnectionTimeoutMs: number;
  dbIdleTimeoutMs: number;
  outboxEnabled: boolean;
  outboxPollMs: number;
  outboxBatchSize: number;
  outboxLockLeaseMs: number;
  outboxMaxAttempts: number;
  sessionCsrfSecret: string;
  authThrottleSecret: string;
  argon2MemoryKib: number;
  argon2Iterations: number;
  argon2Parallelism: number;
  authIpLoginLimit: number;
  authGlobalLimitPerMinute: number;
  photoStorageRoot: string;
};

export function loadAppConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const origins = parsed.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    releaseSha: parsed.RELEASE_SHA,
    logLevel: parsed.LOG_LEVEL,
    logPretty: parsed.LOG_PRETTY,
    corsAllowedOrigins: new Set(origins),
    supplierAppOrigin: parsed.SUPPLIER_APP_ORIGIN,
    tmminAppOrigin: parsed.TMMIN_APP_ORIGIN,
    trustProxyHops: parsed.TRUST_PROXY_HOPS,
    dbPoolMax: parsed.DB_POOL_MAX,
    dbConnectionTimeoutMs: parsed.DB_CONNECTION_TIMEOUT_MS,
    dbIdleTimeoutMs: parsed.DB_IDLE_TIMEOUT_MS,
    outboxEnabled: parsed.OUTBOX_ENABLED,
    outboxPollMs: parsed.OUTBOX_POLL_MS,
    outboxBatchSize: parsed.OUTBOX_BATCH_SIZE,
    outboxLockLeaseMs: parsed.OUTBOX_LOCK_LEASE_MS,
    outboxMaxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
    sessionCsrfSecret: parsed.SESSION_CSRF_SECRET,
    authThrottleSecret: parsed.AUTH_THROTTLE_SECRET,
    argon2MemoryKib: parsed.ARGON2_MEMORY_KIB,
    argon2Iterations: parsed.ARGON2_ITERATIONS,
    argon2Parallelism: parsed.ARGON2_PARALLELISM,
    authIpLoginLimit: parsed.AUTH_IP_LOGIN_LIMIT,
    authGlobalLimitPerMinute: parsed.AUTH_GLOBAL_LIMIT_PER_MINUTE,
    photoStorageRoot: parsed.PHOTO_STORAGE_ROOT,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
