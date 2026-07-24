-- Phase 7 approval, assignment movement, planned-resolution, and shift-finalization schema.

CREATE TYPE "ApprovalRoute" AS ENUM ('SUPERVISOR', 'QC');
CREATE TYPE "ApprovalRouteStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED');
CREATE TYPE "ApprovalDecisionValue" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "AssignmentIssue"
  ADD COLUMN "originHenkatenId" UUID,
  ADD COLUMN "originMovementId" UUID,
  ADD COLUMN "resolutionHenkatenId" UUID;

ALTER TABLE "ManHenkatenDetail"
  ADD COLUMN "resolutionIssueId" UUID;

ALTER TABLE "ShiftRun"
  ADD COLUMN "endCommandKey" VARCHAR(128),
  ADD COLUMN "endCommandPayloadHash" CHAR(64),
  ADD COLUMN "endSummary" JSONB;

ALTER TABLE "WorkingAssignment"
  ADD COLUMN "includedInPlan" BOOLEAN NOT NULL DEFAULT true;

UPDATE "ShiftRun"
SET
  "endCommandKey" = 'migration:' || id::text,
  "endCommandPayloadHash" =
    md5('legacy-shift-end:' || id::text)
    || md5('legacy-shift-end:' || id::text || ':continuation'),
  "endSummary" = jsonb_build_object(
    'cancelledHenkatens', 0,
    'releasedReservations', 0,
    'routesNotRequired', 0,
    'closedWarnings', 0,
    'closedAssignmentIssues', 0,
    'deactivatedWorkingAssignments', 0,
    'backfilled', true
  )
WHERE status = 'ENDED';

CREATE TABLE "HenkatenApprovalRoute" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "henkatenId" UUID NOT NULL,
  "route" "ApprovalRoute" NOT NULL,
  "status" "ApprovalRouteStatus" NOT NULL DEFAULT 'PENDING',
  "initialResponsibleMemberId" UUID,
  "initialResponsibleNameSnapshot" VARCHAR(150),
  "currentResponsibleMemberId" UUID,
  "currentResponsibleNameSnapshot" VARCHAR(150),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HenkatenApprovalRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalDecision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "routeId" UUID NOT NULL,
  "henkatenId" UUID NOT NULL,
  "decision" "ApprovalDecisionValue" NOT NULL,
  "actorUserId" UUID NOT NULL,
  "actorMemberId" UUID,
  "actorNameSnapshot" VARCHAR(150) NOT NULL,
  "actorRole" "UserRole" NOT NULL,
  "comment" VARCHAR(2000),
  "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceIp" VARCHAR(45),
  "correlationId" VARCHAR(128) NOT NULL,
  "expectedHenkatenVersion" INTEGER NOT NULL,
  "resultHenkatenVersion" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "commandPayloadHash" CHAR(64) NOT NULL,
  CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalRouteRouting" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "routeId" UUID NOT NULL,
  "henkatenId" UUID NOT NULL,
  "fromMemberId" UUID,
  "fromNameSnapshot" VARCHAR(150),
  "toMemberId" UUID NOT NULL,
  "toNameSnapshot" VARCHAR(150) NOT NULL,
  "actorUserId" UUID NOT NULL,
  "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correlationId" VARCHAR(128) NOT NULL,
  "expectedHenkatenVersion" INTEGER NOT NULL,
  "resultHenkatenVersion" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "commandPayloadHash" CHAR(64) NOT NULL,
  CONSTRAINT "ApprovalRouteRouting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "henkatenId" UUID NOT NULL,
  "targetShiftRunId" UUID NOT NULL,
  "sourceShiftRunId" UUID,
  "targetWorkingAssignmentId" UUID NOT NULL,
  "sourceWorkingAssignmentId" UUID,
  "targetLineId" UUID NOT NULL,
  "targetJobId" UUID NOT NULL,
  "sourceLineId" UUID,
  "sourceJobId" UUID,
  "movedMpMemberId" UUID NOT NULL,
  "movedMpNameSnapshot" VARCHAR(150) NOT NULL,
  "replacedMpMemberId" UUID,
  "replacedMpNameSnapshot" VARCHAR(150),
  "targetAssignmentVersionBefore" INTEGER NOT NULL,
  "targetAssignmentVersionAfter" INTEGER NOT NULL,
  "sourceAssignmentVersionBefore" INTEGER,
  "sourceAssignmentVersionAfter" INTEGER,
  "movedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "movedById" UUID NOT NULL,
  "correlationId" VARCHAR(128) NOT NULL,
  CONSTRAINT "AssignmentMovement_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Henkaten" WHERE status IN ('APPROVED', 'REJECTED')) THEN
    RAISE EXCEPTION
      'Cannot backfill approval evidence for pre-existing Approved/Rejected Henkaten';
  END IF;
END;
$$;

INSERT INTO "HenkatenApprovalRoute" (
  "supplierId",
  "henkatenId",
  "route",
  "status",
  "initialResponsibleMemberId",
  "initialResponsibleNameSnapshot",
  "currentResponsibleMemberId",
  "currentResponsibleNameSnapshot"
)
SELECT
  h."supplierId",
  h.id,
  'SUPERVISOR'::"ApprovalRoute",
  CASE
    WHEN h.status = 'OPEN' THEN 'PENDING'::"ApprovalRouteStatus"
    ELSE 'NOT_REQUIRED'::"ApprovalRouteStatus"
  END,
  s."supervisorMemberId",
  s."supervisorNameSnapshot",
  s."supervisorMemberId",
  s."supervisorNameSnapshot"
FROM "Henkaten" h
JOIN "ShiftRun" s
  ON s.id = h."shiftRunId"
 AND s."supplierId" = h."supplierId";

INSERT INTO "HenkatenApprovalRoute" ("supplierId", "henkatenId", "route", "status")
SELECT
  h."supplierId",
  h.id,
  'QC'::"ApprovalRoute",
  CASE
    WHEN h.status = 'OPEN' THEN 'PENDING'::"ApprovalRouteStatus"
    ELSE 'NOT_REQUIRED'::"ApprovalRouteStatus"
  END
FROM "Henkaten" h;

CREATE UNIQUE INDEX "HenkatenApprovalRoute_id_supplierId_key"
  ON "HenkatenApprovalRoute" ("id", "supplierId");
CREATE UNIQUE INDEX "HenkatenApprovalRoute_henkatenId_route_key"
  ON "HenkatenApprovalRoute" ("henkatenId", "route");
CREATE INDEX "HenkatenApprovalRoute_supplierId_route_status_createdAt_idx"
  ON "HenkatenApprovalRoute" ("supplierId", "route", "status", "createdAt");
CREATE INDEX "HenkatenApprovalRoute_supplierId_currentResponsibleMemberId_idx"
  ON "HenkatenApprovalRoute" ("supplierId", "currentResponsibleMemberId", "status");

CREATE UNIQUE INDEX "ApprovalDecision_routeId_key" ON "ApprovalDecision" ("routeId");
CREATE UNIQUE INDEX "ApprovalDecision_id_supplierId_key"
  ON "ApprovalDecision" ("id", "supplierId");
CREATE UNIQUE INDEX "ApprovalDecision_routeId_supplierId_key"
  ON "ApprovalDecision" ("routeId", "supplierId");
CREATE UNIQUE INDEX "ApprovalDecision_supplierId_actorUserId_idempotencyKey_key"
  ON "ApprovalDecision" ("supplierId", "actorUserId", "idempotencyKey");
CREATE INDEX "ApprovalDecision_supplierId_henkatenId_decidedAt_idx"
  ON "ApprovalDecision" ("supplierId", "henkatenId", "decidedAt");

CREATE UNIQUE INDEX "ApprovalRouteRouting_id_supplierId_key"
  ON "ApprovalRouteRouting" ("id", "supplierId");
CREATE UNIQUE INDEX "ApprovalRouteRouting_supplierId_actorUserId_idempotencyKey_key"
  ON "ApprovalRouteRouting" ("supplierId", "actorUserId", "idempotencyKey");
CREATE INDEX "ApprovalRouteRouting_supplierId_henkatenId_assignedAt_idx"
  ON "ApprovalRouteRouting" ("supplierId", "henkatenId", "assignedAt");

CREATE UNIQUE INDEX "AssignmentMovement_henkatenId_key" ON "AssignmentMovement" ("henkatenId");
CREATE UNIQUE INDEX "AssignmentMovement_id_supplierId_key"
  ON "AssignmentMovement" ("id", "supplierId");
CREATE UNIQUE INDEX "AssignmentMovement_henkatenId_supplierId_key"
  ON "AssignmentMovement" ("henkatenId", "supplierId");
CREATE INDEX "AssignmentMovement_supplierId_targetShiftRunId_movedAt_idx"
  ON "AssignmentMovement" ("supplierId", "targetShiftRunId", "movedAt");
CREATE INDEX "AssignmentMovement_supplierId_sourceShiftRunId_movedAt_idx"
  ON "AssignmentMovement" ("supplierId", "sourceShiftRunId", "movedAt");
CREATE INDEX "AssignmentMovement_supplierId_movedMpMemberId_movedAt_idx"
  ON "AssignmentMovement" ("supplierId", "movedMpMemberId", "movedAt");
CREATE INDEX "ManHenkatenDetail_supplierId_resolutionIssueId_idx"
  ON "ManHenkatenDetail" ("supplierId", "resolutionIssueId");
CREATE UNIQUE INDEX "ShiftRun_supplierId_endCommandKey_key"
  ON "ShiftRun" ("supplierId", "endCommandKey")
  WHERE "endCommandKey" IS NOT NULL;

ALTER TABLE "HenkatenApprovalRoute"
  ADD CONSTRAINT "HenkatenApprovalRoute_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HenkatenApprovalRoute_henkatenId_supplierId_fkey"
  FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HenkatenApprovalRoute_initialResponsibleMemberId_supplierI_fkey"
  FOREIGN KEY ("initialResponsibleMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HenkatenApprovalRoute_currentResponsibleMemberId_supplierI_fkey"
  FOREIGN KEY ("currentResponsibleMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovalDecision"
  ADD CONSTRAINT "ApprovalDecision_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalDecision_routeId_supplierId_fkey"
  FOREIGN KEY ("routeId", "supplierId") REFERENCES "HenkatenApprovalRoute" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalDecision_henkatenId_supplierId_fkey"
  FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalDecision_actorMemberId_supplierId_fkey"
  FOREIGN KEY ("actorMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalDecision_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovalRouteRouting"
  ADD CONSTRAINT "ApprovalRouteRouting_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalRouteRouting_routeId_supplierId_fkey"
  FOREIGN KEY ("routeId", "supplierId") REFERENCES "HenkatenApprovalRoute" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalRouteRouting_henkatenId_supplierId_fkey"
  FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalRouteRouting_fromMemberId_supplierId_fkey"
  FOREIGN KEY ("fromMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalRouteRouting_toMemberId_supplierId_fkey"
  FOREIGN KEY ("toMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalRouteRouting_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssignmentMovement"
  ADD CONSTRAINT "AssignmentMovement_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_henkatenId_supplierId_fkey"
  FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_targetShiftRunId_supplierId_fkey"
  FOREIGN KEY ("targetShiftRunId", "supplierId") REFERENCES "ShiftRun" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_sourceShiftRunId_supplierId_fkey"
  FOREIGN KEY ("sourceShiftRunId", "supplierId") REFERENCES "ShiftRun" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_targetWorkingAssignmentId_supplierId_fkey"
  FOREIGN KEY ("targetWorkingAssignmentId", "supplierId")
  REFERENCES "WorkingAssignment" ("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_sourceWorkingAssignmentId_supplierId_fkey"
  FOREIGN KEY ("sourceWorkingAssignmentId", "supplierId")
  REFERENCES "WorkingAssignment" ("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_targetLineId_supplierId_fkey"
  FOREIGN KEY ("targetLineId", "supplierId") REFERENCES "Line" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_sourceLineId_supplierId_fkey"
  FOREIGN KEY ("sourceLineId", "supplierId") REFERENCES "Line" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_targetJobId_supplierId_fkey"
  FOREIGN KEY ("targetJobId", "supplierId") REFERENCES "Job" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_sourceJobId_supplierId_fkey"
  FOREIGN KEY ("sourceJobId", "supplierId") REFERENCES "Job" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_movedMpMemberId_supplierId_fkey"
  FOREIGN KEY ("movedMpMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_replacedMpMemberId_supplierId_fkey"
  FOREIGN KEY ("replacedMpMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentMovement_movedById_fkey"
  FOREIGN KEY ("movedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssignmentIssue"
  ADD CONSTRAINT "AssignmentIssue_originHenkatenId_supplierId_fkey"
  FOREIGN KEY ("originHenkatenId", "supplierId") REFERENCES "Henkaten" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentIssue_originMovementId_supplierId_fkey"
  FOREIGN KEY ("originMovementId", "supplierId") REFERENCES "AssignmentMovement" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AssignmentIssue_resolutionHenkatenId_supplierId_fkey"
  FOREIGN KEY ("resolutionHenkatenId", "supplierId") REFERENCES "Henkaten" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManHenkatenDetail"
  ADD CONSTRAINT "ManHenkatenDetail_resolutionIssueId_supplierId_fkey"
  FOREIGN KEY ("resolutionIssueId", "supplierId") REFERENCES "AssignmentIssue" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HenkatenApprovalRoute"
  ADD CONSTRAINT "HenkatenApprovalRoute_valid_state" CHECK (
    "version" > 0
    AND (
      ("route" = 'QC'
        AND "initialResponsibleMemberId" IS NULL
        AND "initialResponsibleNameSnapshot" IS NULL
        AND "currentResponsibleMemberId" IS NULL
        AND "currentResponsibleNameSnapshot" IS NULL)
      OR
      ("route" = 'SUPERVISOR'
        AND ("initialResponsibleMemberId" IS NULL) = ("initialResponsibleNameSnapshot" IS NULL)
        AND ("currentResponsibleMemberId" IS NULL) = ("currentResponsibleNameSnapshot" IS NULL))
    )
  );

ALTER TABLE "ApprovalDecision"
  ADD CONSTRAINT "ApprovalDecision_valid_versions" CHECK (
    "expectedHenkatenVersion" > 0
    AND "resultHenkatenVersion" = "expectedHenkatenVersion" + 1
  );

ALTER TABLE "ApprovalRouteRouting"
  ADD CONSTRAINT "ApprovalRouteRouting_valid_versions" CHECK (
    "expectedHenkatenVersion" > 0
    AND "resultHenkatenVersion" = "expectedHenkatenVersion" + 1
  );

ALTER TABLE "AssignmentMovement"
  ADD CONSTRAINT "AssignmentMovement_valid_versions" CHECK (
    "targetAssignmentVersionBefore" > 0
    AND "targetAssignmentVersionAfter" = "targetAssignmentVersionBefore" + 1
    AND (
      ("sourceWorkingAssignmentId" IS NULL
        AND "sourceShiftRunId" IS NULL
        AND "sourceLineId" IS NULL
        AND "sourceJobId" IS NULL
        AND "sourceAssignmentVersionBefore" IS NULL
        AND "sourceAssignmentVersionAfter" IS NULL)
      OR
      ("sourceWorkingAssignmentId" IS NOT NULL
        AND "sourceShiftRunId" IS NOT NULL
        AND "sourceLineId" IS NOT NULL
        AND "sourceJobId" IS NOT NULL
        AND "sourceAssignmentVersionBefore" > 0
        AND "sourceAssignmentVersionAfter" = "sourceAssignmentVersionBefore" + 1)
    )
  );

ALTER TABLE "ShiftRun"
  ADD CONSTRAINT "ShiftRun_valid_end_command" CHECK (
    ("status" <> 'ENDED'
      AND "endCommandKey" IS NULL
      AND "endCommandPayloadHash" IS NULL
      AND "endSummary" IS NULL)
    OR
    ("status" = 'ENDED'
      AND "endedAt" IS NOT NULL
      AND "endedById" IS NOT NULL
      AND "endCommandKey" IS NOT NULL
      AND "endCommandPayloadHash" IS NOT NULL
      AND "endSummary" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION prevent_immutable_operational_ledger()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Operational decision and movement evidence is immutable'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalDecision_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "ApprovalDecision"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_operational_ledger();
CREATE TRIGGER "ApprovalRouteRouting_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "ApprovalRouteRouting"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_operational_ledger();
CREATE TRIGGER "AssignmentMovement_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "AssignmentMovement"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_operational_ledger();

CREATE OR REPLACE FUNCTION enforce_approval_route_terminal()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approval route cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Terminal approval route is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HenkatenApprovalRoute_enforce_terminal"
  BEFORE UPDATE OR DELETE ON "HenkatenApprovalRoute"
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_route_terminal();
