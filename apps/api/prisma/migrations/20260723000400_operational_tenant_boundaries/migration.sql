ALTER TABLE "MPReservation" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);

UPDATE "MPReservation" AS reservation
SET "expiresAt" = shift_run."scheduledEndAt"
FROM "ShiftRun" AS shift_run
WHERE shift_run.id = reservation."shiftRunId"
  AND shift_run."supplierId" = reservation."supplierId";

ALTER TABLE "MPReservation" ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE INDEX "MPReservation_supplierId_expiresAt_releasedAt_idx"
  ON "MPReservation"("supplierId", "expiresAt", "releasedAt");

ALTER TABLE "Henkaten" DROP CONSTRAINT "Henkaten_clonedFromHenkatenId_fkey";

ALTER TABLE "Henkaten"
  ADD CONSTRAINT "Henkaten_creatorMemberId_supplierId_fkey"
  FOREIGN KEY ("creatorMemberId", "supplierId")
  REFERENCES "Member"("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Henkaten"
  ADD CONSTRAINT "Henkaten_clonedFromHenkatenId_supplierId_fkey"
  FOREIGN KEY ("clonedFromHenkatenId", "supplierId")
  REFERENCES "Henkaten"("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
