ALTER TABLE "Supplier" ADD COLUMN "setupRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Member" ADD COLUMN "importCode" VARCHAR(100), ADD COLUMN "normalizedImportCode" VARCHAR(100), ADD COLUMN "resetArchivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Job" ADD COLUMN "importCode" VARCHAR(100), ADD COLUMN "normalizedImportCode" VARCHAR(100), ADD COLUMN "resetArchivedAt" TIMESTAMPTZ(3);
ALTER TABLE "ShiftTemplate" ADD COLUMN "importCode" VARCHAR(100), ADD COLUMN "normalizedImportCode" VARCHAR(100), ADD COLUMN "resetArchivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Line" ADD COLUMN "resetArchivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Part" ADD COLUMN "resetArchivedAt" TIMESTAMPTZ(3);
ALTER TABLE "LineShift" ADD COLUMN "resetArchivedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "Member_supplierId_normalizedImportCode_key" ON "Member"("supplierId", "normalizedImportCode");
CREATE UNIQUE INDEX "Job_lineId_normalizedImportCode_key" ON "Job"("lineId", "normalizedImportCode");
CREATE UNIQUE INDEX "ShiftTemplate_supplierId_normalizedImportCode_key" ON "ShiftTemplate"("supplierId", "normalizedImportCode");
ALTER TABLE "ChecklistTemplate" ADD COLUMN "currentVersionId" UUID;
UPDATE "ChecklistTemplate" t SET "currentVersionId" = (SELECT v.id FROM "ChecklistVersion" v WHERE v."templateId" = t.id ORDER BY v."versionNumber" DESC LIMIT 1);
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_currentVersionId_supplierId_fkey" FOREIGN KEY ("currentVersionId", "supplierId") REFERENCES "ChecklistVersion"(id, "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "SetupOperation" (
 id UUID PRIMARY KEY, "supplierId" UUID NOT NULL, "requestedById" UUID NOT NULL, "sessionId" UUID NOT NULL,
 kind VARCHAR(10) NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'QUEUED', key VARCHAR(128) NOT NULL, digest VARCHAR(64) NOT NULL,
 "leaseUntil" TIMESTAMPTZ(3), payload JSONB, result JSONB NOT NULL DEFAULT '[]', error VARCHAR(500), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMPTZ(3),
 CONSTRAINT "SetupOperation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SetupOperation_kind_check" CHECK (kind IN ('IMPORT', 'RESET')),
 CONSTRAINT "SetupOperation_status_check" CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'))
);
CREATE UNIQUE INDEX "SetupOperation_supplierId_requestedById_key_key" ON "SetupOperation"("supplierId", "requestedById", key);
CREATE INDEX "SetupOperation_status_createdAt_idx" ON "SetupOperation"(status, "createdAt");
CREATE UNIQUE INDEX "SetupOperation_one_pending_supplier" ON "SetupOperation"("supplierId") WHERE status IN ('QUEUED', 'RUNNING');
