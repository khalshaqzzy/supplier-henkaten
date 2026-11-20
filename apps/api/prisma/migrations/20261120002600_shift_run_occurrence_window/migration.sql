-- Isolate materialized ShiftRun occurrences by scheduled time window so swapping or editing
-- a ShiftTemplate on the same business date creates a separate occurrence and WorkingAssignment
-- set instead of reusing the pre-swap snapshot.
-- migration-policy: allow-drop-index ShiftRun_supplierId_lineId_shiftTemplateId_businessDate_key
DROP INDEX IF EXISTS "ShiftRun_supplierId_lineId_shiftTemplateId_businessDate_key";
CREATE UNIQUE INDEX "ShiftRun_occurrence_window_key" ON "ShiftRun"("supplierId", "lineId", "shiftTemplateId", "businessDate", "scheduledStartAt", "scheduledEndAt");
