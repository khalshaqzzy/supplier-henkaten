CREATE TYPE "HenkatenExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED');

CREATE TABLE "HenkatenExportJob" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "requestedRealm" "IdentityRealm" NOT NULL,
    "status" "HenkatenExportStatus" NOT NULL DEFAULT 'QUEUED',
    "filters" JSONB NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "HenkatenExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HenkatenExportJob_status_createdAt_idx" ON "HenkatenExportJob"("status", "createdAt");
CREATE INDEX "HenkatenExportJob_supplierId_requestedById_createdAt_idx" ON "HenkatenExportJob"("supplierId", "requestedById", "createdAt" DESC);
CREATE INDEX "HenkatenExportJob_expiresAt_idx" ON "HenkatenExportJob"("expiresAt");

ALTER TABLE "HenkatenExportJob" ADD CONSTRAINT "HenkatenExportJob_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
