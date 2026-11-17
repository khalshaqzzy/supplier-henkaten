-- Line Leaders are assigned to a LineShift through "LineShiftLineLeader". One Line Leader may lead
-- several active LineShifts and one LineShift may have several Line Leaders. The legacy
-- "LineShift"."lineLeaderMemberId" column is kept as a mirror of the first Line Leader so that the
-- previous release can still read a consistent value after a compatible code rollback.
CREATE TABLE "LineShiftLineLeader" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "lineShiftId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  CONSTRAINT "LineShiftLineLeader_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LineShiftLineLeader_positive_position" CHECK ("position" > 0)
);

INSERT INTO "LineShiftLineLeader" ("id", "supplierId", "lineShiftId", "memberId", "position", "createdById")
SELECT gen_random_uuid(), "supplierId", "id", "lineLeaderMemberId", 1, "updatedById"
FROM "LineShift"
WHERE "lineLeaderMemberId" IS NOT NULL;

CREATE UNIQUE INDEX "LineShiftLineLeader_lineShiftId_memberId_key" ON "LineShiftLineLeader"("lineShiftId", "memberId");
CREATE INDEX "LineShiftLineLeader_supplierId_memberId_idx" ON "LineShiftLineLeader"("supplierId", "memberId");
CREATE INDEX "LineShiftLineLeader_supplierId_lineShiftId_idx" ON "LineShiftLineLeader"("supplierId", "lineShiftId");

ALTER TABLE "LineShiftLineLeader" ADD CONSTRAINT "LineShiftLineLeader_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineShiftLineLeader" ADD CONSTRAINT "LineShiftLineLeader_lineShiftId_supplierId_fkey" FOREIGN KEY ("lineShiftId", "supplierId") REFERENCES "LineShift"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineShiftLineLeader" ADD CONSTRAINT "LineShiftLineLeader_memberId_supplierId_fkey" FOREIGN KEY ("memberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A Line Leader may now lead several active LineShifts.
-- migration-policy: allow-drop-index LineShift_one_active_line_leader_key
DROP INDEX IF EXISTS "LineShift_one_active_line_leader_key";

-- "Part"."partNumber" is the TMMIN part number. Suppliers may record their own internal number;
-- it is optional and not unique.
ALTER TABLE "Part" ADD COLUMN "internalPartNumber" VARCHAR(100);
ALTER TABLE "Part" ADD COLUMN "normalizedInternalPartNumber" VARCHAR(100);
CREATE INDEX "Part_supplierId_normalizedInternalPartNumber_idx" ON "Part"("supplierId", "normalizedInternalPartNumber");

-- Henkaten part evidence stays immutable; records created before this column existed keep NULL.
ALTER TABLE "HenkatenPart" ADD COLUMN "internalPartNumberSnapshot" VARCHAR(100);
