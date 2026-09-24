CREATE TYPE "PcrStatus" AS ENUM ('PENDING', 'PCR', 'NO_PCR', 'REVIEW');
CREATE TYPE "PcrDecisionSource" AS ENUM ('AI', 'TMMIN', 'SEED');

CREATE TABLE "PcrAssessment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "henkatenId" UUID,
  "externalProjectionId" UUID,
  "status" "PcrStatus" NOT NULL DEFAULT 'PENDING',
  "decisionSource" "PcrDecisionSource",
  "assessment" TEXT,
  "aiNeedsPcr" BOOLEAN,
  "aiConfidence" DOUBLE PRECISION,
  "aiAssessment" TEXT,
  "aiMatchedItems" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "model" VARCHAR(200),
  "promptVersion" VARCHAR(50),
  "inputHash" CHAR(64) NOT NULL,
  "leaseToken" UUID,
  "leasedAt" TIMESTAMPTZ(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PcrAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PcrAssessment_one_source" CHECK (("henkatenId" IS NOT NULL) <> ("externalProjectionId" IS NOT NULL)),
  CONSTRAINT "PcrAssessment_confidence_range" CHECK ("aiConfidence" IS NULL OR ("aiConfidence" >= 0 AND "aiConfidence" <= 1)),
  CONSTRAINT "PcrAssessment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PcrAssessment_henkatenId_fkey" FOREIGN KEY ("henkatenId") REFERENCES "Henkaten"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PcrAssessment_externalProjectionId_fkey" FOREIGN KEY ("externalProjectionId") REFERENCES "ExternalHenkatenProjection"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PcrAssessment_henkatenId_key" ON "PcrAssessment"("henkatenId");
CREATE UNIQUE INDEX "PcrAssessment_externalProjectionId_key" ON "PcrAssessment"("externalProjectionId");
CREATE INDEX "PcrAssessment_status_leasedAt_createdAt_idx" ON "PcrAssessment"("status", "leasedAt", "createdAt");
CREATE INDEX "PcrAssessment_supplierId_status_updatedAt_idx" ON "PcrAssessment"("supplierId", "status", "updatedAt" DESC);
