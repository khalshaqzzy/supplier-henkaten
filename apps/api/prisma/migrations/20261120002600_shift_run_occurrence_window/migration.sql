-- Expand-phase index for per-occurrence ShiftRun isolation. The legacy
-- ShiftRun_supplierId_lineId_shiftTemplateId_businessDate_key index is retained
-- during this release so a code-only rollback to the previous release stays safe.
CREATE UNIQUE INDEX "ShiftRun_occurrence_window_key" ON "ShiftRun"("supplierId", "lineId", "shiftTemplateId", "businessDate", "scheduledStartAt", "scheduledEndAt");
