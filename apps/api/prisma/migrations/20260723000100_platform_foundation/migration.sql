CREATE TYPE "SourceMode" AS ENUM ('HOSTED', 'EXTERNAL');
CREATE TYPE "IdentityRealm" AS ENUM ('TMMIN', 'SUPPLIER');
CREATE TYPE "UserRole" AS ENUM (
  'TMMIN_ADMIN',
  'TMMIN_QUALITY',
  'SUPPLIER_ADMIN',
  'SUPERVISOR',
  'LINE_LEADER',
  'QC'
);
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "SessionPurpose" AS ENUM ('NORMAL', 'HOSTED_PREPARATION');
CREATE TYPE "SessionRevocationReason" AS ENUM (
  'LOGOUT',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'ROLE_CHANGED',
  'SUPPLIER_DEACTIVATED',
  'SOURCE_MODE_CHANGED',
  'PREPARATION_CANCELLED',
  'ADMIN_REPLACED',
  'OPERATOR_RECOVERY'
);
CREATE TYPE "HostedPreparationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

CREATE TABLE "Supplier" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "normalizedCode" VARCHAR(50) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "sourceMode" "SourceMode" NOT NULL,
  "sourceEpoch" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "sourceModeChangedAt" TIMESTAMPTZ(3),
  "sourceModeChangedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Supplier_positive_epoch_version" CHECK ("sourceEpoch" > 0 AND "version" > 0)
);

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "realm" "IdentityRealm" NOT NULL,
  "supplierId" UUID,
  "role" "UserRole" NOT NULL,
  "username" VARCHAR(100) NOT NULL,
  "normalizedUsername" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(150) NOT NULL,
  "passwordHash" VARCHAR(512) NOT NULL,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
  "passwordEpoch" INTEGER NOT NULL DEFAULT 1,
  "authorizationEpoch" INTEGER NOT NULL DEFAULT 1,
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "failedLoginWindowStartedAt" TIMESTAMPTZ(3),
  "lockedUntil" TIMESTAMPTZ(3),
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "protectedBootstrapAdmin" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_positive_epochs_version" CHECK (
    "passwordEpoch" > 0 AND "authorizationEpoch" > 0 AND "version" > 0
  ),
  CONSTRAINT "User_nonnegative_failed_login" CHECK ("failedLoginCount" >= 0),
  CONSTRAINT "User_realm_role_supplier_consistency" CHECK (
    (
      "realm" = 'TMMIN'
      AND "supplierId" IS NULL
      AND "role" IN ('TMMIN_ADMIN', 'TMMIN_QUALITY')
    )
    OR (
      "realm" = 'SUPPLIER'
      AND "supplierId" IS NOT NULL
      AND "role" IN ('SUPPLIER_ADMIN', 'SUPERVISOR', 'LINE_LEADER', 'QC')
    )
  ),
  CONSTRAINT "User_protected_admin_consistency" CHECK (
    NOT "protectedBootstrapAdmin"
    OR ("realm" = 'TMMIN' AND "role" = 'TMMIN_ADMIN' AND "status" = 'ACTIVE')
  )
);

CREATE TABLE "UserSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "supplierId" UUID,
  "realm" "IdentityRealm" NOT NULL,
  "purpose" "SessionPurpose" NOT NULL DEFAULT 'NORMAL',
  "sourceEpoch" INTEGER,
  "passwordEpoch" INTEGER NOT NULL,
  "authorizationEpoch" INTEGER NOT NULL,
  "tokenHash" BYTEA NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMPTZ(3) NOT NULL,
  "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revocationReason" "SessionRevocationReason",
  "sourceIp" VARCHAR(45),
  "userAgent" VARCHAR(512),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserSession_positive_values" CHECK (
    "version" > 0 AND "passwordEpoch" > 0 AND "authorizationEpoch" > 0
    AND ("sourceEpoch" IS NULL OR "sourceEpoch" > 0)
  ),
  CONSTRAINT "UserSession_realm_supplier_consistency" CHECK (
    ("realm" = 'TMMIN' AND "supplierId" IS NULL AND "sourceEpoch" IS NULL AND "purpose" = 'NORMAL')
    OR ("realm" = 'SUPPLIER' AND "supplierId" IS NOT NULL AND "sourceEpoch" IS NOT NULL)
  ),
  CONSTRAINT "UserSession_revocation_consistency" CHECK (
    ("revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revocationReason" IS NOT NULL)
  )
);

CREATE TABLE "PasswordHistory" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "passwordHash" VARCHAR(512) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HostedPreparation" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "adminUserId" UUID NOT NULL,
  "sourceEpoch" INTEGER NOT NULL,
  "status" "HostedPreparationStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" VARCHAR(1000) NOT NULL,
  "privacyAcknowledgedAt" TIMESTAMPTZ(3) NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedById" UUID NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "completedById" UUID,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledById" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "HostedPreparation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HostedPreparation_positive_values" CHECK ("sourceEpoch" > 0 AND "version" > 0)
);

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorKind" VARCHAR(30) NOT NULL,
  "actorUserId" UUID,
  "actorRole" "UserRole",
  "actorSupplierId" UUID,
  "supplierId" UUID,
  "action" VARCHAR(150) NOT NULL,
  "resourceType" VARCHAR(100) NOT NULL,
  "resourceId" UUID,
  "changeSummary" JSONB,
  "reason" VARCHAR(1000),
  "correlationId" VARCHAR(128) NOT NULL,
  "sourceIp" VARCHAR(45),
  "userAgent" VARCHAR(512),
  "result" "AuditResult" NOT NULL,
  "sourceMode" "SourceMode",
  "sourceEpoch" INTEGER,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
  "id" UUID NOT NULL,
  "eventType" VARCHAR(150) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "aggregateType" VARCHAR(100) NOT NULL,
  "aggregateId" UUID NOT NULL,
  "aggregateVersion" INTEGER NOT NULL,
  "supplierId" UUID,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor" JSONB NOT NULL,
  "correlationId" VARCHAR(128) NOT NULL,
  "causationId" UUID,
  "payload" JSONB NOT NULL,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMPTZ(3),
  "lockedBy" VARCHAR(100),
  "processedAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "lastSafeError" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboxEvent_positive_values" CHECK (
    "schemaVersion" > 0 AND "aggregateVersion" > 0 AND "attemptCount" >= 0
  )
);

CREATE UNIQUE INDEX "Supplier_normalizedCode_key" ON "Supplier" ("normalizedCode");
CREATE INDEX "Supplier_sourceMode_active_idx" ON "Supplier" ("sourceMode", "active");
CREATE UNIQUE INDEX "User_tmmin_username_key"
  ON "User" ("normalizedUsername") WHERE "realm" = 'TMMIN';
CREATE UNIQUE INDEX "User_supplier_username_key"
  ON "User" ("supplierId", "normalizedUsername") WHERE "realm" = 'SUPPLIER';
CREATE UNIQUE INDEX "User_one_active_supplier_admin_key"
  ON "User" ("supplierId")
  WHERE "role" = 'SUPPLIER_ADMIN' AND "status" = 'ACTIVE';
CREATE INDEX "User_supplierId_role_status_idx" ON "User" ("supplierId", "role", "status");
CREATE INDEX "User_realm_role_status_idx" ON "User" ("realm", "role", "status");
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession" ("tokenHash");
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession" ("userId", "revokedAt");
CREATE INDEX "UserSession_supplierId_revokedAt_idx" ON "UserSession" ("supplierId", "revokedAt");
CREATE INDEX "UserSession_expiry_idx" ON "UserSession" ("idleExpiresAt", "absoluteExpiresAt");
CREATE INDEX "PasswordHistory_userId_createdAt_idx"
  ON "PasswordHistory" ("userId", "createdAt" DESC);
CREATE UNIQUE INDEX "HostedPreparation_one_active_key"
  ON "HostedPreparation" ("supplierId") WHERE "status" = 'ACTIVE';
CREATE INDEX "HostedPreparation_supplierId_status_idx"
  ON "HostedPreparation" ("supplierId", "status");
CREATE INDEX "AuditEvent_supplierId_occurredAt_idx"
  ON "AuditEvent" ("supplierId", "occurredAt" DESC);
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx"
  ON "AuditEvent" ("actorUserId", "occurredAt" DESC);
CREATE INDEX "AuditEvent_resource_idx"
  ON "AuditEvent" ("resourceType", "resourceId", "occurredAt" DESC);
CREATE INDEX "OutboxEvent_pending_idx"
  ON "OutboxEvent" ("availableAt", "createdAt")
  WHERE "processedAt" IS NULL AND "failedAt" IS NULL;
CREATE INDEX "OutboxEvent_supplierId_occurredAt_idx"
  ON "OutboxEvent" ("supplierId", "occurredAt");

ALTER TABLE "User"
  ADD CONSTRAINT "User_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordHistory"
  ADD CONSTRAINT "PasswordHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HostedPreparation"
  ADD CONSTRAINT "HostedPreparation_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HostedPreparation"
  ADD CONSTRAINT "HostedPreparation_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboxEvent"
  ADD CONSTRAINT "OutboxEvent_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AuditEvent_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
