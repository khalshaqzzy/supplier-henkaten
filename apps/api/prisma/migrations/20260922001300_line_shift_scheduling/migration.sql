-- Replace manually started Shift Runs with recurring Line–Shift configuration for new operations.
-- Legacy ShiftRun/WorkingAssignment data remains intact for historical reads.

-- migration-policy: allow-drop-index WorkingAssignment_one_active_effective_mp_key
DROP INDEX IF EXISTS "WorkingAssignment_one_active_effective_mp_key";

CREATE TABLE "LineShift" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "lineId" UUID NOT NULL,
  "shiftTemplateId" UUID NOT NULL,
  "supervisorMemberId" UUID,
  "lineLeaderMemberId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" UUID,
  CONSTRAINT "LineShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LineShift_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT,
  CONSTRAINT "LineShift_lineId_supplierId_fkey" FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line"("id", "supplierId") ON DELETE RESTRICT,
  CONSTRAINT "LineShift_shiftTemplateId_supplierId_fkey" FOREIGN KEY ("shiftTemplateId", "supplierId") REFERENCES "ShiftTemplate"("id", "supplierId") ON DELETE RESTRICT,
  CONSTRAINT "LineShift_supervisorMemberId_supplierId_fkey" FOREIGN KEY ("supervisorMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT,
  CONSTRAINT "LineShift_lineLeaderMemberId_supplierId_fkey" FOREIGN KEY ("lineLeaderMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "LineShift_id_supplierId_key" ON "LineShift"("id", "supplierId");
CREATE UNIQUE INDEX "LineShift_supplierId_lineId_shiftTemplateId_key" ON "LineShift"("supplierId", "lineId", "shiftTemplateId");
CREATE INDEX "LineShift_supplierId_lineId_active_idx" ON "LineShift"("supplierId", "lineId", "active");
CREATE INDEX "LineShift_supplierId_lineLeaderMemberId_active_idx" ON "LineShift"("supplierId", "lineLeaderMemberId", "active");
CREATE INDEX "LineShift_supplierId_supervisorMemberId_active_idx" ON "LineShift"("supplierId", "supervisorMemberId", "active");

INSERT INTO "LineShift" (
  "id", "supplierId", "lineId", "shiftTemplateId", "supervisorMemberId", "lineLeaderMemberId",
  "active", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), l."supplierId", l.id, st.id, dls."supervisorMemberId", dll."lineLeaderMemberId",
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Line" l
JOIN "ShiftTemplate" st ON st."supplierId" = l."supplierId" AND st.active = true
LEFT JOIN "DefaultLineSupervisor" dls ON dls."supplierId" = l."supplierId" AND dls."lineId" = l.id
LEFT JOIN "DefaultLineLeader" dll ON dll."supplierId" = l."supplierId" AND dll."lineId" = l.id
WHERE l.active = true;

CREATE TABLE "LineShiftJobAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "lineShiftId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "mpMemberId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" UUID,
  CONSTRAINT "LineShiftJobAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LineShiftJobAssignment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT,
  CONSTRAINT "LineShiftJobAssignment_lineShiftId_supplierId_fkey" FOREIGN KEY ("lineShiftId", "supplierId") REFERENCES "LineShift"("id", "supplierId") ON DELETE RESTRICT,
  CONSTRAINT "LineShiftJobAssignment_jobId_supplierId_fkey" FOREIGN KEY ("jobId", "supplierId") REFERENCES "Job"("id", "supplierId") ON DELETE RESTRICT,
  CONSTRAINT "LineShiftJobAssignment_mpMemberId_supplierId_fkey" FOREIGN KEY ("mpMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "LineShiftJobAssignment_id_supplierId_key" ON "LineShiftJobAssignment"("id", "supplierId");
CREATE UNIQUE INDEX "LineShiftJobAssignment_supplierId_lineShiftId_jobId_key" ON "LineShiftJobAssignment"("supplierId", "lineShiftId", "jobId");
CREATE INDEX "LineShiftJobAssignment_supplierId_lineShiftId_idx" ON "LineShiftJobAssignment"("supplierId", "lineShiftId");
CREATE INDEX "LineShiftJobAssignment_supplierId_mpMemberId_idx" ON "LineShiftJobAssignment"("supplierId", "mpMemberId");

INSERT INTO "LineShiftJobAssignment" (
  "id", "supplierId", "lineShiftId", "jobId", "mpMemberId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), ls."supplierId", ls.id, j.id, djm."mpMemberId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LineShift" ls
JOIN "Job" j ON j."supplierId" = ls."supplierId" AND j."lineId" = ls."lineId" AND j.active = true
LEFT JOIN "DefaultJobMp" djm ON djm."supplierId" = j."supplierId" AND djm."jobId" = j.id;

ALTER TABLE "Henkaten"
  ADD COLUMN "lineShiftId" UUID,
  ADD COLUMN "effectiveStartAt" TIMESTAMPTZ(3),
  ADD COLUMN "effectiveEndAt" TIMESTAMPTZ(3);

ALTER TABLE "Henkaten" DISABLE TRIGGER "Henkaten_enforce_immutability";
UPDATE "Henkaten" h
SET
  "lineShiftId" = ls.id,
  "effectiveStartAt" = sr."scheduledStartAt",
  "effectiveEndAt" = sr."scheduledEndAt"
FROM "ShiftRun" sr
JOIN "LineShift" ls
  ON ls."supplierId" = sr."supplierId"
 AND ls."lineId" = sr."lineId"
 AND ls."shiftTemplateId" = sr."shiftTemplateId"
WHERE h."shiftRunId" = sr.id;
ALTER TABLE "Henkaten" ENABLE TRIGGER "Henkaten_enforce_immutability";

ALTER TABLE "Henkaten"
  ADD CONSTRAINT "Henkaten_lineShiftId_supplierId_fkey"
  FOREIGN KEY ("lineShiftId", "supplierId") REFERENCES "LineShift"("id", "supplierId") ON DELETE RESTRICT;
CREATE INDEX "Henkaten_supplierId_lineShiftId_effectiveStartAt_effectiveEndAt_idx"
  ON "Henkaten"("supplierId", "lineShiftId", "effectiveStartAt", "effectiveEndAt");

CREATE OR REPLACE FUNCTION enforce_henkaten_line_shift_immutability()
RETURNS trigger AS $$
BEGIN
  IF ROW(NEW."lineShiftId", NEW."effectiveStartAt", NEW."effectiveEndAt") IS DISTINCT FROM
     ROW(OLD."lineShiftId", OLD."effectiveStartAt", OLD."effectiveEndAt") THEN
    RAISE EXCEPTION 'Henkaten Line Shift context is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Henkaten_line_shift_immutability"
  BEFORE UPDATE ON "Henkaten"
  FOR EACH ROW EXECUTE FUNCTION enforce_henkaten_line_shift_immutability();

ALTER TABLE "ManHenkatenDetail" ADD COLUMN "lineShiftJobAssignmentId" UUID;
UPDATE "ManHenkatenDetail" md
SET "lineShiftJobAssignmentId" = lsa.id
FROM "Henkaten" h
JOIN "LineShiftJobAssignment" lsa
  ON lsa."supplierId" = h."supplierId"
 AND lsa."lineShiftId" = h."lineShiftId"
 AND lsa."jobId" = h."jobId"
WHERE md."henkatenId" = h.id;
ALTER TABLE "ManHenkatenDetail"
  ADD CONSTRAINT "ManHenkatenDetail_lineShiftJobAssignmentId_supplierId_fkey"
  FOREIGN KEY ("lineShiftJobAssignmentId", "supplierId") REFERENCES "LineShiftJobAssignment"("id", "supplierId") ON DELETE RESTRICT;
CREATE INDEX "ManHenkatenDetail_supplierId_lineShiftJobAssignmentId_idx"
  ON "ManHenkatenDetail"("supplierId", "lineShiftJobAssignmentId");
