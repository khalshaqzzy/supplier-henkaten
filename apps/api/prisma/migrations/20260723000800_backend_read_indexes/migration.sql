CREATE INDEX "AuditEvent_supplierId_occurredAt_id_idx"
  ON "AuditEvent"("supplierId", "occurredAt" DESC, "id" DESC);

CREATE INDEX "OutboxEvent_supplierId_occurredAt_id_idx"
  ON "OutboxEvent"("supplierId", "occurredAt", "id");

CREATE INDEX "ExternalHenkatenProjection_supplierId_updatedAt_id_idx"
  ON "ExternalHenkatenProjection"("supplierId", "updatedAt" DESC, "id" DESC);

CREATE INDEX "Member_supplierId_active_fullName_id_idx"
  ON "Member"("supplierId", "active", "fullName", "id");

CREATE INDEX "Job_supplierId_lineId_active_displayOrder_id_idx"
  ON "Job"("supplierId", "lineId", "active", "displayOrder", "id");
