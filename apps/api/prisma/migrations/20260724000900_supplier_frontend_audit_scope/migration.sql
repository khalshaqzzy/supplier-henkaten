ALTER TABLE "AuditEvent" ADD COLUMN "lineId" UUID;

UPDATE "AuditEvent" AS audit
SET "lineId" = henkaten."lineId"
FROM "Henkaten" AS henkaten
WHERE audit."resourceType" = 'Henkaten'
  AND audit."resourceId" = henkaten.id
  AND audit."lineId" IS NULL;

UPDATE "AuditEvent" AS audit
SET "lineId" = shift_run."lineId"
FROM "ShiftRun" AS shift_run
WHERE audit."resourceType" IN ('ShiftRun', 'Shift')
  AND audit."resourceId" = shift_run.id
  AND audit."lineId" IS NULL;

UPDATE "AuditEvent" AS audit
SET "lineId" = issue."lineId"
FROM "AssignmentIssue" AS issue
WHERE audit."resourceType" = 'AssignmentIssue'
  AND audit."resourceId" = issue.id
  AND audit."lineId" IS NULL;

CREATE INDEX "AuditEvent_supplierId_lineId_occurredAt_id_idx"
ON "AuditEvent"("supplierId", "lineId", "occurredAt" DESC, "id" DESC);
