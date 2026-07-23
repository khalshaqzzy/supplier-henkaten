-- CreateEnum
CREATE TYPE "ShiftRunStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "WorkingAssignmentState" AS ENUM ('ASSIGNED', 'VACANT', 'CONFLICTED', 'RESERVED');

-- CreateEnum
CREATE TYPE "AssignmentIssueType" AS ENUM ('VACANCY', 'CONFLICT');

-- CreateEnum
CREATE TYPE "AssignmentIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED_SHIFT_ENDED');

-- CreateEnum
CREATE TYPE "HenkatenStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HenkatenCancellationReason" AS ENUM ('WITHDRAWN', 'SHIFT_ENDED');

-- CreateEnum
CREATE TYPE "ChecklistAnswer" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "WarningStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "ShiftRun" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "shiftTemplateId" UUID NOT NULL,
    "status" "ShiftRunStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "businessDate" DATE NOT NULL,
    "scheduledStartAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledEndAt" TIMESTAMPTZ(3) NOT NULL,
    "timezoneSnapshot" VARCHAR(100) NOT NULL,
    "lineCodeSnapshot" VARCHAR(100) NOT NULL,
    "lineNameSnapshot" VARCHAR(150) NOT NULL,
    "shiftNameSnapshot" VARCHAR(150) NOT NULL,
    "shiftStartMinuteSnapshot" INTEGER NOT NULL,
    "shiftEndMinuteSnapshot" INTEGER NOT NULL,
    "defaultAssignmentSetVersion" INTEGER NOT NULL,
    "sourceEpoch" INTEGER NOT NULL,
    "supervisorMemberId" UUID,
    "supervisorNameSnapshot" VARCHAR(150),
    "lineLeaderMemberId" UUID,
    "lineLeaderNameSnapshot" VARCHAR(150),
    "latestPreflight" JSONB NOT NULL,
    "latestPreflightAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "startedById" UUID,
    "startedWithOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" VARCHAR(1000),
    "overrideFailedChecks" JSONB,
    "endedAt" TIMESTAMPTZ(3),
    "endedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ShiftRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingAssignment" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "shiftRunId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "jobNameSnapshot" VARCHAR(150) NOT NULL,
    "jobDisplayOrderSnapshot" INTEGER NOT NULL,
    "sourceDefaultAssignmentId" UUID,
    "sourceDefaultVersion" INTEGER,
    "effectiveMpMemberId" UUID,
    "candidateMpMemberId" UUID,
    "mpNameSnapshot" VARCHAR(150),
    "mpRegistrationSnapshot" VARCHAR(100),
    "state" "WorkingAssignmentState" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "WorkingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentIssue" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "shiftRunId" UUID,
    "lineId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "type" "AssignmentIssueType" NOT NULL,
    "status" "AssignmentIssueStatus" NOT NULL DEFAULT 'OPEN',
    "originKind" VARCHAR(50) NOT NULL,
    "originReferenceId" UUID,
    "resolutionKind" VARCHAR(50),
    "resolutionReferenceId" UUID,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AssignmentIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HenkatenDailySequence" (
    "supplierId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "lastValue" INTEGER NOT NULL,

    CONSTRAINT "HenkatenDailySequence_pkey" PRIMARY KEY ("supplierId","businessDate")
);

-- CreateTable
CREATE TABLE "Henkaten" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "shiftRunId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "partId" UUID NOT NULL,
    "identifier" VARCHAR(150) NOT NULL,
    "dailySequence" INTEGER NOT NULL,
    "sourceMode" "SourceMode" NOT NULL,
    "sourceEpoch" INTEGER NOT NULL,
    "status" "HenkatenStatus" NOT NULL DEFAULT 'OPEN',
    "category" "HenkatenCategory" NOT NULL,
    "businessDate" DATE NOT NULL,
    "timezoneSnapshot" VARCHAR(100) NOT NULL,
    "shiftNameSnapshot" VARCHAR(150) NOT NULL,
    "lineCodeSnapshot" VARCHAR(100) NOT NULL,
    "lineNameSnapshot" VARCHAR(150) NOT NULL,
    "jobNameSnapshot" VARCHAR(150) NOT NULL,
    "partNumberSnapshot" VARCHAR(100) NOT NULL,
    "normalizedPartNumberSnapshot" VARCHAR(100) NOT NULL,
    "partNameSnapshot" VARCHAR(200) NOT NULL,
    "creatorMemberId" UUID,
    "creatorNameSnapshot" VARCHAR(150) NOT NULL,
    "cause" VARCHAR(2000) NOT NULL,
    "detail" VARCHAR(2000) NOT NULL,
    "affectedObject" VARCHAR(2000),
    "replacementObject" VARCHAR(2000),
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "cancellationReason" "HenkatenCancellationReason",
    "withdrawalReason" VARCHAR(1000),
    "finalizedAt" TIMESTAMPTZ(3),
    "finalizedById" UUID,
    "clonedFromHenkatenId" UUID,
    "submissionKey" VARCHAR(128) NOT NULL,
    "submissionPayloadHash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Henkaten_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HenkatenChecklistSnapshot" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "henkatenId" UUID NOT NULL,
    "checklistVersionId" UUID NOT NULL,
    "category" "HenkatenCategory" NOT NULL,
    "versionNumber" INTEGER NOT NULL,

    CONSTRAINT "HenkatenChecklistSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HenkatenChecklistAnswer" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "sourceItemId" UUID NOT NULL,
    "labelSnapshot" VARCHAR(500) NOT NULL,
    "displayOrderSnapshot" INTEGER NOT NULL,
    "answer" "ChecklistAnswer" NOT NULL,

    CONSTRAINT "HenkatenChecklistAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManHenkatenDetail" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "henkatenId" UUID NOT NULL,
    "targetWorkingAssignmentId" UUID NOT NULL,
    "sourceWorkingAssignmentId" UUID,
    "replacedMpMemberId" UUID,
    "replacedWasVacant" BOOLEAN NOT NULL,
    "replacedMpNameSnapshot" VARCHAR(150),
    "replacementMpMemberId" UUID NOT NULL,
    "replacementMpNameSnapshot" VARCHAR(150) NOT NULL,
    "targetAssignmentVersion" INTEGER NOT NULL,
    "sourceAssignmentVersion" INTEGER,

    CONSTRAINT "ManHenkatenDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MPReservation" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "henkatenId" UUID NOT NULL,
    "shiftRunId" UUID NOT NULL,
    "replacementMpMemberId" UUID NOT NULL,
    "targetWorkingAssignmentId" UUID NOT NULL,
    "sourceWorkingAssignmentId" UUID,
    "targetAssignmentVersion" INTEGER NOT NULL,
    "sourceAssignmentVersion" INTEGER,
    "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),
    "releaseReason" VARCHAR(50),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MPReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarningInstance" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "henkatenId" UUID NOT NULL,
    "status" "WarningStatus" NOT NULL DEFAULT 'OPEN',
    "partNumberSnapshot" VARCHAR(100) NOT NULL,
    "normalizedPartNumberSnapshot" VARCHAR(100) NOT NULL,
    "partNameSnapshot" VARCHAR(200) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "closeReason" VARCHAR(50),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WarningInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HenkatenTransition" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "henkatenId" UUID NOT NULL,
    "fromStatus" "HenkatenStatus",
    "toStatus" "HenkatenStatus" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "actorName" VARCHAR(150) NOT NULL,
    "reason" VARCHAR(1000),
    "correlationId" VARCHAR(128) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HenkatenTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftRun_supplierId_status_businessDate_id_idx" ON "ShiftRun"("supplierId", "status", "businessDate" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ShiftRun_supplierId_lineId_status_idx" ON "ShiftRun"("supplierId", "lineId", "status");

-- CreateIndex
CREATE INDEX "ShiftRun_supplierId_lineLeaderMemberId_status_idx" ON "ShiftRun"("supplierId", "lineLeaderMemberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRun_id_supplierId_key" ON "ShiftRun"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRun_supplierId_lineId_shiftTemplateId_businessDate_key" ON "ShiftRun"("supplierId", "lineId", "shiftTemplateId", "businessDate");

-- CreateIndex
CREATE INDEX "WorkingAssignment_supplierId_shiftRunId_jobDisplayOrderSnap_idx" ON "WorkingAssignment"("supplierId", "shiftRunId", "jobDisplayOrderSnapshot");

-- CreateIndex
CREATE INDEX "WorkingAssignment_supplierId_effectiveMpMemberId_active_idx" ON "WorkingAssignment"("supplierId", "effectiveMpMemberId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingAssignment_id_supplierId_key" ON "WorkingAssignment"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingAssignment_shiftRunId_jobId_key" ON "WorkingAssignment"("shiftRunId", "jobId");

-- CreateIndex
CREATE INDEX "AssignmentIssue_supplierId_status_openedAt_idx" ON "AssignmentIssue"("supplierId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "AssignmentIssue_supplierId_lineId_status_idx" ON "AssignmentIssue"("supplierId", "lineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentIssue_id_supplierId_key" ON "AssignmentIssue"("id", "supplierId");

-- CreateIndex
CREATE INDEX "Henkaten_supplierId_occurredAt_id_idx" ON "Henkaten"("supplierId", "occurredAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Henkaten_supplierId_status_occurredAt_idx" ON "Henkaten"("supplierId", "status", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Henkaten_supplierId_category_occurredAt_idx" ON "Henkaten"("supplierId", "category", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Henkaten_supplierId_lineId_occurredAt_idx" ON "Henkaten"("supplierId", "lineId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Henkaten_supplierId_normalizedPartNumberSnapshot_status_idx" ON "Henkaten"("supplierId", "normalizedPartNumberSnapshot", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Henkaten_id_supplierId_key" ON "Henkaten"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Henkaten_supplierId_identifier_key" ON "Henkaten"("supplierId", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Henkaten_supplierId_createdById_submissionKey_key" ON "Henkaten"("supplierId", "createdById", "submissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "HenkatenChecklistSnapshot_henkatenId_key" ON "HenkatenChecklistSnapshot"("henkatenId");

-- CreateIndex
CREATE INDEX "HenkatenChecklistSnapshot_supplierId_checklistVersionId_idx" ON "HenkatenChecklistSnapshot"("supplierId", "checklistVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "HenkatenChecklistSnapshot_id_supplierId_key" ON "HenkatenChecklistSnapshot"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "HenkatenChecklistSnapshot_henkatenId_supplierId_key" ON "HenkatenChecklistSnapshot"("henkatenId", "supplierId");

-- CreateIndex
CREATE INDEX "HenkatenChecklistAnswer_supplierId_snapshotId_displayOrderS_idx" ON "HenkatenChecklistAnswer"("supplierId", "snapshotId", "displayOrderSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "HenkatenChecklistAnswer_snapshotId_sourceItemId_key" ON "HenkatenChecklistAnswer"("snapshotId", "sourceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ManHenkatenDetail_henkatenId_key" ON "ManHenkatenDetail"("henkatenId");

-- CreateIndex
CREATE INDEX "ManHenkatenDetail_supplierId_replacementMpMemberId_idx" ON "ManHenkatenDetail"("supplierId", "replacementMpMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "ManHenkatenDetail_id_supplierId_key" ON "ManHenkatenDetail"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ManHenkatenDetail_henkatenId_supplierId_key" ON "ManHenkatenDetail"("henkatenId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "MPReservation_henkatenId_key" ON "MPReservation"("henkatenId");

-- CreateIndex
CREATE INDEX "MPReservation_supplierId_replacementMpMemberId_releasedAt_idx" ON "MPReservation"("supplierId", "replacementMpMemberId", "releasedAt");

-- CreateIndex
CREATE INDEX "MPReservation_supplierId_targetWorkingAssignmentId_released_idx" ON "MPReservation"("supplierId", "targetWorkingAssignmentId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MPReservation_id_supplierId_key" ON "MPReservation"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "MPReservation_henkatenId_supplierId_key" ON "MPReservation"("henkatenId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "WarningInstance_henkatenId_key" ON "WarningInstance"("henkatenId");

-- CreateIndex
CREATE INDEX "WarningInstance_supplierId_status_normalizedPartNumberSnaps_idx" ON "WarningInstance"("supplierId", "status", "normalizedPartNumberSnapshot", "openedAt");

-- CreateIndex
CREATE INDEX "WarningInstance_status_openedAt_idx" ON "WarningInstance"("status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WarningInstance_id_supplierId_key" ON "WarningInstance"("id", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "WarningInstance_henkatenId_supplierId_key" ON "WarningInstance"("henkatenId", "supplierId");

-- CreateIndex
CREATE INDEX "HenkatenTransition_supplierId_henkatenId_occurredAt_idx" ON "HenkatenTransition"("supplierId", "henkatenId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "HenkatenTransition_id_supplierId_key" ON "HenkatenTransition"("id", "supplierId");

-- AddForeignKey
ALTER TABLE "ShiftRun" ADD CONSTRAINT "ShiftRun_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRun" ADD CONSTRAINT "ShiftRun_lineId_supplierId_fkey" FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRun" ADD CONSTRAINT "ShiftRun_shiftTemplateId_supplierId_fkey" FOREIGN KEY ("shiftTemplateId", "supplierId") REFERENCES "ShiftTemplate"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRun" ADD CONSTRAINT "ShiftRun_supervisorMemberId_supplierId_fkey" FOREIGN KEY ("supervisorMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRun" ADD CONSTRAINT "ShiftRun_lineLeaderMemberId_supplierId_fkey" FOREIGN KEY ("lineLeaderMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingAssignment" ADD CONSTRAINT "WorkingAssignment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingAssignment" ADD CONSTRAINT "WorkingAssignment_shiftRunId_supplierId_fkey" FOREIGN KEY ("shiftRunId", "supplierId") REFERENCES "ShiftRun"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingAssignment" ADD CONSTRAINT "WorkingAssignment_lineId_supplierId_fkey" FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingAssignment" ADD CONSTRAINT "WorkingAssignment_jobId_supplierId_fkey" FOREIGN KEY ("jobId", "supplierId") REFERENCES "Job"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingAssignment" ADD CONSTRAINT "WorkingAssignment_effectiveMpMemberId_supplierId_fkey" FOREIGN KEY ("effectiveMpMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingAssignment" ADD CONSTRAINT "WorkingAssignment_candidateMpMemberId_supplierId_fkey" FOREIGN KEY ("candidateMpMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentIssue" ADD CONSTRAINT "AssignmentIssue_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentIssue" ADD CONSTRAINT "AssignmentIssue_shiftRunId_supplierId_fkey" FOREIGN KEY ("shiftRunId", "supplierId") REFERENCES "ShiftRun"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentIssue" ADD CONSTRAINT "AssignmentIssue_lineId_supplierId_fkey" FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentIssue" ADD CONSTRAINT "AssignmentIssue_jobId_supplierId_fkey" FOREIGN KEY ("jobId", "supplierId") REFERENCES "Job"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HenkatenDailySequence" ADD CONSTRAINT "HenkatenDailySequence_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Henkaten" ADD CONSTRAINT "Henkaten_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Henkaten" ADD CONSTRAINT "Henkaten_shiftRunId_supplierId_fkey" FOREIGN KEY ("shiftRunId", "supplierId") REFERENCES "ShiftRun"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Henkaten" ADD CONSTRAINT "Henkaten_lineId_supplierId_fkey" FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Henkaten" ADD CONSTRAINT "Henkaten_jobId_supplierId_fkey" FOREIGN KEY ("jobId", "supplierId") REFERENCES "Job"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Henkaten" ADD CONSTRAINT "Henkaten_partId_supplierId_fkey" FOREIGN KEY ("partId", "supplierId") REFERENCES "Part"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Henkaten" ADD CONSTRAINT "Henkaten_clonedFromHenkatenId_fkey" FOREIGN KEY ("clonedFromHenkatenId") REFERENCES "Henkaten"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HenkatenChecklistSnapshot" ADD CONSTRAINT "HenkatenChecklistSnapshot_henkatenId_supplierId_fkey" FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HenkatenChecklistSnapshot" ADD CONSTRAINT "HenkatenChecklistSnapshot_checklistVersionId_supplierId_fkey" FOREIGN KEY ("checklistVersionId", "supplierId") REFERENCES "ChecklistVersion"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HenkatenChecklistAnswer" ADD CONSTRAINT "HenkatenChecklistAnswer_snapshotId_supplierId_fkey" FOREIGN KEY ("snapshotId", "supplierId") REFERENCES "HenkatenChecklistSnapshot"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManHenkatenDetail" ADD CONSTRAINT "ManHenkatenDetail_henkatenId_supplierId_fkey" FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManHenkatenDetail" ADD CONSTRAINT "ManHenkatenDetail_targetWorkingAssignmentId_supplierId_fkey" FOREIGN KEY ("targetWorkingAssignmentId", "supplierId") REFERENCES "WorkingAssignment"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManHenkatenDetail" ADD CONSTRAINT "ManHenkatenDetail_sourceWorkingAssignmentId_supplierId_fkey" FOREIGN KEY ("sourceWorkingAssignmentId", "supplierId") REFERENCES "WorkingAssignment"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManHenkatenDetail" ADD CONSTRAINT "ManHenkatenDetail_replacedMpMemberId_supplierId_fkey" FOREIGN KEY ("replacedMpMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManHenkatenDetail" ADD CONSTRAINT "ManHenkatenDetail_replacementMpMemberId_supplierId_fkey" FOREIGN KEY ("replacementMpMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MPReservation" ADD CONSTRAINT "MPReservation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MPReservation" ADD CONSTRAINT "MPReservation_henkatenId_supplierId_fkey" FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MPReservation" ADD CONSTRAINT "MPReservation_shiftRunId_supplierId_fkey" FOREIGN KEY ("shiftRunId", "supplierId") REFERENCES "ShiftRun"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MPReservation" ADD CONSTRAINT "MPReservation_replacementMpMemberId_supplierId_fkey" FOREIGN KEY ("replacementMpMemberId", "supplierId") REFERENCES "Member"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MPReservation" ADD CONSTRAINT "MPReservation_targetWorkingAssignmentId_supplierId_fkey" FOREIGN KEY ("targetWorkingAssignmentId", "supplierId") REFERENCES "WorkingAssignment"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MPReservation" ADD CONSTRAINT "MPReservation_sourceWorkingAssignmentId_supplierId_fkey" FOREIGN KEY ("sourceWorkingAssignmentId", "supplierId") REFERENCES "WorkingAssignment"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningInstance" ADD CONSTRAINT "WarningInstance_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningInstance" ADD CONSTRAINT "WarningInstance_henkatenId_supplierId_fkey" FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HenkatenTransition" ADD CONSTRAINT "HenkatenTransition_henkatenId_supplierId_fkey" FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ShiftRun_one_active_line_key"
  ON "ShiftRun" ("supplierId", "lineId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "ShiftRun_one_active_line_leader_key"
  ON "ShiftRun" ("supplierId", "lineLeaderMemberId")
  WHERE "status" = 'ACTIVE' AND "lineLeaderMemberId" IS NOT NULL;
CREATE UNIQUE INDEX "WorkingAssignment_one_active_effective_mp_key"
  ON "WorkingAssignment" ("supplierId", "effectiveMpMemberId")
  WHERE "active" = true AND "effectiveMpMemberId" IS NOT NULL;
CREATE UNIQUE INDEX "AssignmentIssue_one_open_job_key"
  ON "AssignmentIssue" ("supplierId", "jobId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "MPReservation_one_active_replacement_key"
  ON "MPReservation" ("supplierId", "replacementMpMemberId") WHERE "releasedAt" IS NULL;
CREATE UNIQUE INDEX "MPReservation_one_active_target_key"
  ON "MPReservation" ("supplierId", "targetWorkingAssignmentId") WHERE "releasedAt" IS NULL;

ALTER TABLE "ShiftRun" ADD CONSTRAINT "ShiftRun_valid_snapshot" CHECK (
  "shiftStartMinuteSnapshot" BETWEEN 0 AND 1439
  AND "shiftEndMinuteSnapshot" BETWEEN 0 AND 1439
  AND "scheduledEndAt" > "scheduledStartAt"
  AND "defaultAssignmentSetVersion" > 0
  AND "sourceEpoch" > 0
  AND "version" > 0
);
ALTER TABLE "WorkingAssignment" ADD CONSTRAINT "WorkingAssignment_valid_state" CHECK (
  "jobDisplayOrderSnapshot" > 0 AND "version" > 0
  AND (
    ("state" = 'ASSIGNED' AND "effectiveMpMemberId" IS NOT NULL)
    OR ("state" <> 'ASSIGNED' AND "effectiveMpMemberId" IS NULL)
  )
);
ALTER TABLE "AssignmentIssue" ADD CONSTRAINT "AssignmentIssue_valid_resolution" CHECK (
  "version" > 0 AND (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolutionKind" IS NULL AND "resolutionReferenceId" IS NULL)
    OR ("status" <> 'OPEN' AND "resolvedAt" IS NOT NULL AND "resolutionKind" IS NOT NULL AND "resolutionReferenceId" IS NOT NULL)
  )
);
ALTER TABLE "HenkatenDailySequence" ADD CONSTRAINT "HenkatenDailySequence_positive_value"
  CHECK ("lastValue" > 0);
ALTER TABLE "Henkaten" ADD CONSTRAINT "Henkaten_valid_terminal_state" CHECK (
  "dailySequence" > 0 AND "sourceEpoch" > 0 AND "version" > 0
  AND (
    ("status" = 'OPEN' AND "finalizedAt" IS NULL AND "cancellationReason" IS NULL)
    OR ("status" <> 'OPEN' AND "finalizedAt" IS NOT NULL)
  )
  AND (
    ("category" = 'MAN' AND "affectedObject" IS NULL AND "replacementObject" IS NULL)
    OR ("category" <> 'MAN' AND "affectedObject" IS NOT NULL AND "replacementObject" IS NOT NULL)
  )
);
ALTER TABLE "HenkatenChecklistSnapshot" ADD CONSTRAINT "HenkatenChecklistSnapshot_positive_version"
  CHECK ("versionNumber" > 0);
ALTER TABLE "HenkatenChecklistAnswer" ADD CONSTRAINT "HenkatenChecklistAnswer_positive_order"
  CHECK ("displayOrderSnapshot" > 0);
ALTER TABLE "ManHenkatenDetail" ADD CONSTRAINT "ManHenkatenDetail_valid_replaced" CHECK (
  "targetAssignmentVersion" > 0
  AND (("replacedWasVacant" = true AND "replacedMpMemberId" IS NULL)
    OR ("replacedWasVacant" = false AND "replacedMpMemberId" IS NOT NULL))
  AND ("sourceAssignmentVersion" IS NULL OR "sourceAssignmentVersion" > 0)
);
ALTER TABLE "MPReservation" ADD CONSTRAINT "MPReservation_valid_state" CHECK (
  "targetAssignmentVersion" > 0 AND "version" > 0
  AND ("sourceAssignmentVersion" IS NULL OR "sourceAssignmentVersion" > 0)
  AND (("releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL))
);
ALTER TABLE "WarningInstance" ADD CONSTRAINT "WarningInstance_valid_state" CHECK (
  "version" > 0 AND (
    ("status" = 'OPEN' AND "closedAt" IS NULL AND "closeReason" IS NULL)
    OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closeReason" IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION prevent_immutable_henkaten_evidence()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Henkaten evidence is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HenkatenChecklistSnapshot_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "HenkatenChecklistSnapshot"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_henkaten_evidence();
CREATE TRIGGER "HenkatenChecklistAnswer_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "HenkatenChecklistAnswer"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_henkaten_evidence();
CREATE TRIGGER "ManHenkatenDetail_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "ManHenkatenDetail"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_henkaten_evidence();
CREATE TRIGGER "HenkatenTransition_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "HenkatenTransition"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_henkaten_evidence();

CREATE OR REPLACE FUNCTION enforce_henkaten_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Henkaten cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'Terminal Henkaten is immutable' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    NEW."supplierId", NEW."shiftRunId", NEW."lineId", NEW."jobId", NEW."partId",
    NEW."identifier", NEW."dailySequence", NEW."sourceMode", NEW."sourceEpoch",
    NEW."category", NEW."businessDate", NEW."timezoneSnapshot", NEW."shiftNameSnapshot",
    NEW."lineCodeSnapshot", NEW."lineNameSnapshot", NEW."jobNameSnapshot",
    NEW."partNumberSnapshot", NEW."normalizedPartNumberSnapshot", NEW."partNameSnapshot",
    NEW."creatorMemberId", NEW."creatorNameSnapshot", NEW."cause", NEW."detail",
    NEW."affectedObject", NEW."replacementObject", NEW."occurredAt",
    NEW."clonedFromHenkatenId", NEW."submissionKey", NEW."submissionPayloadHash",
    NEW."createdById", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."supplierId", OLD."shiftRunId", OLD."lineId", OLD."jobId", OLD."partId",
    OLD."identifier", OLD."dailySequence", OLD."sourceMode", OLD."sourceEpoch",
    OLD."category", OLD."businessDate", OLD."timezoneSnapshot", OLD."shiftNameSnapshot",
    OLD."lineCodeSnapshot", OLD."lineNameSnapshot", OLD."jobNameSnapshot",
    OLD."partNumberSnapshot", OLD."normalizedPartNumberSnapshot", OLD."partNameSnapshot",
    OLD."creatorMemberId", OLD."creatorNameSnapshot", OLD."cause", OLD."detail",
    OLD."affectedObject", OLD."replacementObject", OLD."occurredAt",
    OLD."clonedFromHenkatenId", OLD."submissionKey", OLD."submissionPayloadHash",
    OLD."createdById", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Henkaten context is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Henkaten_enforce_immutability"
  BEFORE UPDATE OR DELETE ON "Henkaten"
  FOR EACH ROW EXECUTE FUNCTION enforce_henkaten_immutability();
