-- Permanent (non-archive) deletion of master data.
--
-- A permanently deleted row keeps its primary key so historical Henkaten, ShiftRun, approval and
-- audit evidence that references it stays intact (all of those foreign keys are ON DELETE
-- RESTRICT). The row is tombstoned with "deletedAt", is always inactive, and no longer reserves
-- its natural key: the unique indexes below are re-created as partial indexes that only cover
-- rows where "deletedAt" IS NULL.
ALTER TABLE "Member" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
ALTER TABLE "Line" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
ALTER TABLE "Job" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
ALTER TABLE "ShiftTemplate" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
ALTER TABLE "LineShift" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

ALTER TABLE "Member" ADD CONSTRAINT "Member_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR active = false);
ALTER TABLE "User" ADD CONSTRAINT "User_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR status = 'INACTIVE');
ALTER TABLE "Line" ADD CONSTRAINT "Line_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR active = false);
ALTER TABLE "Job" ADD CONSTRAINT "Job_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR active = false);
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR active = false);
ALTER TABLE "LineShift" ADD CONSTRAINT "LineShift_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR active = false);

-- Natural keys are reserved by live rows only. Each index keeps its name so conflict handling is
-- unchanged.
-- migration-policy: allow-drop-index Member_supplierId_registration_key
DROP INDEX IF EXISTS "Member_supplierId_registration_key";
CREATE UNIQUE INDEX "Member_supplierId_registration_key"
  ON "Member" ("supplierId", "normalizedRegistrationNumber") WHERE "deletedAt" IS NULL;

-- migration-policy: allow-drop-index Member_supplierId_normalizedImportCode_key
DROP INDEX IF EXISTS "Member_supplierId_normalizedImportCode_key";
CREATE UNIQUE INDEX "Member_supplierId_normalizedImportCode_key"
  ON "Member" ("supplierId", "normalizedImportCode") WHERE "deletedAt" IS NULL;

-- migration-policy: allow-drop-index User_supplier_username_key
DROP INDEX IF EXISTS "User_supplier_username_key";
CREATE UNIQUE INDEX "User_supplier_username_key"
  ON "User" ("supplierId", "normalizedUsername") WHERE "realm" = 'SUPPLIER' AND "deletedAt" IS NULL;

-- migration-policy: allow-drop-index Line_supplier_code_key
DROP INDEX IF EXISTS "Line_supplier_code_key";
CREATE UNIQUE INDEX "Line_supplier_code_key"
  ON "Line" ("supplierId", "normalizedCode") WHERE "deletedAt" IS NULL;

-- migration-policy: allow-drop-index Job_line_name_key
DROP INDEX IF EXISTS "Job_line_name_key";
CREATE UNIQUE INDEX "Job_line_name_key"
  ON "Job" ("lineId", "normalizedName") WHERE "deletedAt" IS NULL;

-- migration-policy: allow-drop-index Job_lineId_normalizedImportCode_key
DROP INDEX IF EXISTS "Job_lineId_normalizedImportCode_key";
CREATE UNIQUE INDEX "Job_lineId_normalizedImportCode_key"
  ON "Job" ("lineId", "normalizedImportCode") WHERE "deletedAt" IS NULL;

-- migration-policy: allow-drop-index Part_supplier_number_key
DROP INDEX IF EXISTS "Part_supplier_number_key";
CREATE UNIQUE INDEX "Part_supplier_number_key"
  ON "Part" ("supplierId", "normalizedPartNumber") WHERE "deletedAt" IS NULL;

-- migration-policy: allow-drop-index ShiftTemplate_supplierId_normalizedImportCode_key
DROP INDEX IF EXISTS "ShiftTemplate_supplierId_normalizedImportCode_key";
CREATE UNIQUE INDEX "ShiftTemplate_supplierId_normalizedImportCode_key"
  ON "ShiftTemplate" ("supplierId", "normalizedImportCode") WHERE "deletedAt" IS NULL;

-- Per-day shift schedule. NULL keeps the existing behaviour: every day runs from "startMinute" to
-- "endMinute". When present it holds exactly seven ISO weekdays (1 = Monday ... 7 = Sunday); a day
-- is either off or has its own start/end minute. "startMinute"/"endMinute" remain the
-- representative schedule (first working day) so a previous release keeps reading valid times.
ALTER TABLE "ShiftTemplate" ADD COLUMN "weeklySchedule" JSONB;
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_weekly_schedule_shape_check"
  CHECK ("weeklySchedule" IS NULL OR (jsonb_typeof("weeklySchedule") = 'array' AND jsonb_array_length("weeklySchedule") = 7));

-- Weekly automatic shift rotation. On each run every shift in "shiftTemplateIds" takes the working
-- times of the next shift in the list (the last one takes the first one's times). Two shifts
-- therefore swap; three or more rotate cyclically.
CREATE TABLE "ShiftRotationSchedule" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "shiftTemplateIds" UUID[] NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "executeMinute" INTEGER NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "nextRunAt" TIMESTAMPTZ(3),
  "lastRunAt" TIMESTAMPTZ(3),
  "lastRunStatus" VARCHAR(30),
  "lastRunMessage" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "ShiftRotationSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShiftRotationSchedule_day_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  CONSTRAINT "ShiftRotationSchedule_minute_check" CHECK ("executeMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "ShiftRotationSchedule_members_check" CHECK (cardinality("shiftTemplateIds") BETWEEN 2 AND 10),
  CONSTRAINT "ShiftRotationSchedule_enabled_next_run_check" CHECK (enabled = false OR "nextRunAt" IS NOT NULL),
  CONSTRAINT "ShiftRotationSchedule_positive_version" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "ShiftRotationSchedule_id_supplierId_key" ON "ShiftRotationSchedule"("id", "supplierId");
CREATE INDEX "ShiftRotationSchedule_enabled_nextRunAt_idx" ON "ShiftRotationSchedule"("enabled", "nextRunAt");
CREATE INDEX "ShiftRotationSchedule_supplierId_createdAt_idx" ON "ShiftRotationSchedule"("supplierId", "createdAt");
ALTER TABLE "ShiftRotationSchedule" ADD CONSTRAINT "ShiftRotationSchedule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShiftRotationExecution" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "scheduledForAt" TIMESTAMPTZ(3) NOT NULL,
  "executedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" VARCHAR(30) NOT NULL,
  "trigger" VARCHAR(30) NOT NULL DEFAULT 'SCHEDULE',
  "affectedLines" INTEGER NOT NULL DEFAULT 0,
  "message" VARCHAR(500),
  "summary" JSONB,
  CONSTRAINT "ShiftRotationExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShiftRotationExecution_status_check" CHECK ("status" IN ('SUCCESS', 'SKIPPED')),
  CONSTRAINT "ShiftRotationExecution_trigger_check" CHECK ("trigger" IN ('SCHEDULE', 'MANUAL'))
);
CREATE UNIQUE INDEX "ShiftRotationExecution_scheduleId_scheduledForAt_key" ON "ShiftRotationExecution"("scheduleId", "scheduledForAt");
CREATE INDEX "ShiftRotationExecution_supplierId_executedAt_idx" ON "ShiftRotationExecution"("supplierId", "executedAt" DESC);
ALTER TABLE "ShiftRotationExecution" ADD CONSTRAINT "ShiftRotationExecution_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftRotationExecution" ADD CONSTRAINT "ShiftRotationExecution_scheduleId_supplierId_fkey" FOREIGN KEY ("scheduleId", "supplierId") REFERENCES "ShiftRotationSchedule"("id", "supplierId") ON DELETE CASCADE ON UPDATE CASCADE;
