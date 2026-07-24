CREATE TYPE "ExternalClientStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "ExternalApiClient" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "clientId" VARCHAR(100) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "sourceEpoch" INTEGER NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "ipAllowlist" TEXT[] NOT NULL,
  "status" "ExternalClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSuccessfulIngestionAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "ExternalApiClient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalApiClient_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalApiClient_version_positive" CHECK ("version" > 0),
  CONSTRAINT "ExternalApiClient_sourceEpoch_positive" CHECK ("sourceEpoch" > 0)
);
CREATE UNIQUE INDEX "ExternalApiClient_clientId_key" ON "ExternalApiClient"("clientId");
CREATE UNIQUE INDEX "ExternalApiClient_id_supplierId_key" ON "ExternalApiClient"("id", "supplierId");
CREATE INDEX "ExternalApiClient_supplierId_status_sourceEpoch_idx" ON "ExternalApiClient"("supplierId", "status", "sourceEpoch");

CREATE TABLE "ExternalApiSecret" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "clientId" UUID NOT NULL,
  "secretHash" VARCHAR(512) NOT NULL,
  "lastFour" CHAR(4) NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdById" UUID NOT NULL,
  CONSTRAINT "ExternalApiSecret_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalApiSecret_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ExternalApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ExternalApiSecret_clientId_revokedAt_expiresAt_idx" ON "ExternalApiSecret"("clientId", "revokedAt", "expiresAt");

CREATE TABLE "ExternalAccessToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "clientId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "sourceEpoch" INTEGER NOT NULL,
  "tokenHash" BYTEA NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "sourceIp" VARCHAR(45),
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ExternalAccessToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalAccessToken_clientId_supplierId_fkey" FOREIGN KEY ("clientId", "supplierId") REFERENCES "ExternalApiClient"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalAccessToken_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalAccessToken_sourceEpoch_positive" CHECK ("sourceEpoch" > 0)
);
CREATE UNIQUE INDEX "ExternalAccessToken_tokenHash_key" ON "ExternalAccessToken"("tokenHash");
CREATE INDEX "ExternalAccessToken_clientId_expiresAt_revokedAt_idx" ON "ExternalAccessToken"("clientId", "expiresAt", "revokedAt");
CREATE INDEX "ExternalAccessToken_supplierId_sourceEpoch_expiresAt_idx" ON "ExternalAccessToken"("supplierId", "sourceEpoch", "expiresAt");

CREATE TABLE "ExternalHenkatenProjection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "sourceEpoch" INTEGER NOT NULL,
  "sourceHenkatenId" VARCHAR(200) NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "status" "HenkatenStatus" NOT NULL,
  "category" "HenkatenCategory" NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "lineSnapshot" JSONB NOT NULL,
  "shiftSnapshot" JSONB NOT NULL,
  "jobSnapshot" JSONB NOT NULL,
  "partSnapshot" JSONB NOT NULL,
  "changeSnapshot" JSONB NOT NULL,
  "checklistSnapshot" JSONB NOT NULL,
  "decisionsSnapshot" JSONB NOT NULL,
  "lastEventId" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ExternalHenkatenProjection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalHenkatenProjection_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalHenkatenProjection_sourceVersion_positive" CHECK ("sourceVersion" > 0)
);
CREATE UNIQUE INDEX "ExternalHenkatenProjection_id_supplierId_key" ON "ExternalHenkatenProjection"("id", "supplierId");
CREATE UNIQUE INDEX "ExternalHenkatenProjection_supplierId_sourceEpoch_sourceHenkatenId_key" ON "ExternalHenkatenProjection"("supplierId", "sourceEpoch", "sourceHenkatenId");
CREATE INDEX "ExternalHenkatenProjection_supplierId_status_updatedAt_idx" ON "ExternalHenkatenProjection"("supplierId", "status", "updatedAt" DESC);
CREATE INDEX "ExternalHenkatenProjection_status_updatedAt_idx" ON "ExternalHenkatenProjection"("status", "updatedAt" DESC);

CREATE TABLE "ExternalIngestionEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "sourceEpoch" INTEGER NOT NULL,
  "eventId" VARCHAR(200) NOT NULL,
  "sourceHenkatenId" VARCHAR(200) NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "eventType" VARCHAR(50) NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "canonicalPayload" JSONB NOT NULL,
  "correlationId" VARCHAR(128) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectionId" UUID,
  CONSTRAINT "ExternalIngestionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalIngestionEvent_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalIngestionEvent_clientId_supplierId_fkey" FOREIGN KEY ("clientId", "supplierId") REFERENCES "ExternalApiClient"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalIngestionEvent_projectionId_supplierId_fkey" FOREIGN KEY ("projectionId", "supplierId") REFERENCES "ExternalHenkatenProjection"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalIngestionEvent_sourceVersion_positive" CHECK ("sourceVersion" > 0)
);
CREATE UNIQUE INDEX "ExternalIngestionEvent_supplierId_sourceEpoch_eventId_key" ON "ExternalIngestionEvent"("supplierId", "sourceEpoch", "eventId");
CREATE UNIQUE INDEX "ExternalIngestionEvent_supplierId_sourceEpoch_sourceHenkatenId_sourceVersion_key" ON "ExternalIngestionEvent"("supplierId", "sourceEpoch", "sourceHenkatenId", "sourceVersion");
CREATE INDEX "ExternalIngestionEvent_clientId_receivedAt_idx" ON "ExternalIngestionEvent"("clientId", "receivedAt" DESC);
CREATE INDEX "ExternalIngestionEvent_supplierId_receivedAt_idx" ON "ExternalIngestionEvent"("supplierId", "receivedAt" DESC);

ALTER TABLE "WarningInstance" ALTER COLUMN "henkatenId" DROP NOT NULL;
ALTER TABLE "WarningInstance" ADD COLUMN "externalProjectionId" UUID;
ALTER TABLE "WarningInstance" ADD COLUMN "sourceMode" "SourceMode" NOT NULL DEFAULT 'HOSTED';
CREATE UNIQUE INDEX "WarningInstance_externalProjectionId_key" ON "WarningInstance"("externalProjectionId");
CREATE UNIQUE INDEX "WarningInstance_externalProjectionId_supplierId_key" ON "WarningInstance"("externalProjectionId", "supplierId");
ALTER TABLE "WarningInstance"
  ADD CONSTRAINT "WarningInstance_externalProjectionId_supplierId_fkey"
  FOREIGN KEY ("externalProjectionId", "supplierId")
  REFERENCES "ExternalHenkatenProjection"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarningInstance"
  ADD CONSTRAINT "WarningInstance_exactly_one_source"
  CHECK (
    (("henkatenId" IS NOT NULL)::int + ("externalProjectionId" IS NOT NULL)::int) = 1
  );

CREATE OR REPLACE FUNCTION prevent_external_immutable_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'external ingestion evidence is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ExternalIngestionEvent_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "ExternalIngestionEvent"
  FOR EACH ROW EXECUTE FUNCTION prevent_external_immutable_mutation();
