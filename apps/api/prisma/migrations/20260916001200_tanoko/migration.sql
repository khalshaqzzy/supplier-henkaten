ALTER TABLE "Job" ADD COLUMN "skillCategory" VARCHAR(6);
ALTER TABLE "Job" ADD CONSTRAINT "Job_skillCategory_check" CHECK ("skillCategory" IN ('HIGH', 'MEDIUM', 'LOW'));
CREATE TABLE "TanokoMapping" (
  "id" UUID NOT NULL, "supplierId" UUID NOT NULL, "memberId" UUID NOT NULL, "jobId" UUID NOT NULL,
  "level" INTEGER CHECK ("level" BETWEEN 1 AND 4), "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, PRIMARY KEY ("id"),
  FOREIGN KEY ("memberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT,
  FOREIGN KEY ("jobId", "supplierId") REFERENCES "Job"("id", "supplierId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "TanokoMapping_supplierId_memberId_jobId_key" ON "TanokoMapping"("supplierId", "memberId", "jobId");
CREATE TABLE "TanokoChange" (
 "id" UUID NOT NULL PRIMARY KEY, "supplierId" UUID NOT NULL REFERENCES "Supplier"("id") ON DELETE RESTRICT,
 "memberId" UUID NOT NULL, "jobId" UUID NOT NULL, "lineId" UUID NOT NULL,
 "memberName" VARCHAR(150) NOT NULL, "jobName" VARCHAR(150) NOT NULL, "lineName" VARCHAR(150) NOT NULL,
 "previousLevel" INTEGER CHECK ("previousLevel" BETWEEN 1 AND 4), "level" INTEGER CHECK ("level" BETWEEN 1 AND 4),
 "actorUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "actorName" VARCHAR(150) NOT NULL, "actorRole" VARCHAR(30) NOT NULL, "note" VARCHAR(500) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TanokoChange_supplierId_createdAt_id_idx" ON "TanokoChange"("supplierId", "createdAt", "id");
CREATE INDEX "TanokoChange_supplierId_lineId_createdAt_id_idx" ON "TanokoChange"("supplierId", "lineId", "createdAt", "id");
