CREATE TYPE "MemberRole" AS ENUM ('SUPERVISOR', 'LINE_LEADER', 'MP', 'QC');
CREATE TYPE "HenkatenCategory" AS ENUM ('MAN', 'MACHINE', 'MATERIAL', 'METHOD');
CREATE TYPE "MemberPhotoState" AS ENUM ('CURRENT', 'PENDING_DELETE', 'DELETED');

ALTER TABLE "User" ADD COLUMN "memberId" UUID;
ALTER TABLE "User" ADD CONSTRAINT "User_member_link_consistency" CHECK (
  ("memberId" IS NULL AND "role" IN ('TMMIN_ADMIN', 'TMMIN_QUALITY', 'SUPPLIER_ADMIN'))
  OR ("memberId" IS NOT NULL AND "role" IN ('SUPERVISOR', 'LINE_LEADER', 'QC'))
);

CREATE TABLE "Member" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "fullName" VARCHAR(150) NOT NULL,
  "registrationNumber" VARCHAR(100) NOT NULL,
  "normalizedRegistrationNumber" VARCHAR(100) NOT NULL,
  "role" "MemberRole" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "Member_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Member_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "MemberPhoto" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "state" "MemberPhotoState" NOT NULL DEFAULT 'CURRENT',
  "fullPath" VARCHAR(500) NOT NULL,
  "thumbnailPath" VARCHAR(500) NOT NULL,
  "fullChecksum" VARCHAR(64) NOT NULL,
  "thumbnailChecksum" VARCHAR(64) NOT NULL,
  "fullWidth" INTEGER NOT NULL,
  "fullHeight" INTEGER NOT NULL,
  "thumbnailWidth" INTEGER NOT NULL,
  "thumbnailHeight" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "supersededAt" TIMESTAMPTZ(3),
  "deletedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "MemberPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberPhoto_positive_dimensions_version" CHECK (
    "fullWidth" > 0 AND "fullHeight" > 0 AND "thumbnailWidth" > 0
    AND "thumbnailHeight" > 0 AND "version" > 0
  )
);

CREATE TABLE "Line" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "normalizedCode" VARCHAR(100) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "Line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Line_positive_order_version" CHECK ("displayOrder" > 0 AND "version" > 0)
);

CREATE TABLE "Job" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "lineId" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "normalizedName" VARCHAR(150) NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Job_positive_order_version" CHECK ("displayOrder" > 0 AND "version" > 0)
);

CREATE TABLE "Part" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "partNumber" VARCHAR(100) NOT NULL,
  "normalizedPartNumber" VARCHAR(100) NOT NULL,
  "partName" VARCHAR(200) NOT NULL,
  "normalizedPartName" VARCHAR(200) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "Part_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Part_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "ShiftTemplate" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShiftTemplate_valid_time_order_version" CHECK (
    "startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 0 AND 1439
    AND "startMinute" <> "endMinute" AND "displayOrder" > 0 AND "version" > 0
  )
);

CREATE TABLE "ChecklistTemplate" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "category" "HenkatenCategory" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChecklistTemplate_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "ChecklistDraftItem" (
  "id" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "label" VARCHAR(500) NOT NULL,
  "normalizedLabel" VARCHAR(500) NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  CONSTRAINT "ChecklistDraftItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChecklistDraftItem_positive_order" CHECK ("displayOrder" > 0)
);

CREATE TABLE "ChecklistVersion" (
  "id" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "category" "HenkatenCategory" NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedById" UUID,
  CONSTRAINT "ChecklistVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChecklistVersion_positive_number" CHECK ("versionNumber" > 0)
);

CREATE TABLE "ChecklistVersionItem" (
  "id" UUID NOT NULL,
  "checklistVersionId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "label" VARCHAR(500) NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  CONSTRAINT "ChecklistVersionItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChecklistVersionItem_positive_order" CHECK ("displayOrder" > 0)
);

CREATE TABLE "DefaultAssignmentSet" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "DefaultAssignmentSet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DefaultAssignmentSet_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "DefaultLineSupervisor" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "lineId" UUID NOT NULL,
  "supervisorMemberId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "DefaultLineSupervisor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DefaultLineSupervisor_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "DefaultLineLeader" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "lineId" UUID NOT NULL,
  "lineLeaderMemberId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "DefaultLineLeader_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DefaultLineLeader_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "DefaultJobMp" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "mpMemberId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "DefaultJobMp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DefaultJobMp_positive_version" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "User_memberId_key" ON "User" ("memberId");
CREATE UNIQUE INDEX "Member_supplierId_registration_key"
  ON "Member" ("supplierId", "normalizedRegistrationNumber");
CREATE UNIQUE INDEX "Member_id_supplierId_key" ON "Member" ("id", "supplierId");
CREATE INDEX "Member_supplier_active_role_idx" ON "Member" ("supplierId", "active", "role");
CREATE INDEX "Member_supplier_name_idx" ON "Member" ("supplierId", "fullName");
CREATE UNIQUE INDEX "MemberPhoto_one_current_key"
  ON "MemberPhoto" ("memberId") WHERE "state" = 'CURRENT';
CREATE UNIQUE INDEX "MemberPhoto_id_supplierId_key" ON "MemberPhoto" ("id", "supplierId");
CREATE INDEX "MemberPhoto_supplier_member_state_idx"
  ON "MemberPhoto" ("supplierId", "memberId", "state");
CREATE UNIQUE INDEX "Line_supplier_code_key" ON "Line" ("supplierId", "normalizedCode");
CREATE UNIQUE INDEX "Line_id_supplierId_key" ON "Line" ("id", "supplierId");
CREATE INDEX "Line_supplier_active_order_idx"
  ON "Line" ("supplierId", "active", "displayOrder", "id");
CREATE UNIQUE INDEX "Job_line_name_key" ON "Job" ("lineId", "normalizedName");
CREATE UNIQUE INDEX "Job_id_supplierId_key" ON "Job" ("id", "supplierId");
CREATE INDEX "Job_supplier_line_active_order_idx"
  ON "Job" ("supplierId", "lineId", "active", "displayOrder", "id");
CREATE UNIQUE INDEX "Part_supplier_number_key"
  ON "Part" ("supplierId", "normalizedPartNumber");
CREATE UNIQUE INDEX "Part_id_supplierId_key" ON "Part" ("id", "supplierId");
CREATE INDEX "Part_supplier_active_name_idx"
  ON "Part" ("supplierId", "active", "normalizedPartName", "id");
CREATE UNIQUE INDEX "ShiftTemplate_id_supplierId_key"
  ON "ShiftTemplate" ("id", "supplierId");
CREATE INDEX "ShiftTemplate_supplier_active_order_idx"
  ON "ShiftTemplate" ("supplierId", "active", "displayOrder", "id");
CREATE UNIQUE INDEX "ChecklistTemplate_supplier_category_key"
  ON "ChecklistTemplate" ("supplierId", "category");
CREATE UNIQUE INDEX "ChecklistTemplate_id_supplierId_key"
  ON "ChecklistTemplate" ("id", "supplierId");
CREATE UNIQUE INDEX "ChecklistDraftItem_template_label_key"
  ON "ChecklistDraftItem" ("templateId", "normalizedLabel");
CREATE INDEX "ChecklistDraftItem_template_order_idx"
  ON "ChecklistDraftItem" ("supplierId", "templateId", "displayOrder");
CREATE UNIQUE INDEX "ChecklistVersion_template_number_key"
  ON "ChecklistVersion" ("templateId", "versionNumber");
CREATE UNIQUE INDEX "ChecklistVersion_id_supplierId_key"
  ON "ChecklistVersion" ("id", "supplierId");
CREATE INDEX "ChecklistVersion_supplier_category_number_idx"
  ON "ChecklistVersion" ("supplierId", "category", "versionNumber" DESC);
CREATE INDEX "ChecklistVersionItem_version_order_idx"
  ON "ChecklistVersionItem" ("supplierId", "checklistVersionId", "displayOrder");
CREATE UNIQUE INDEX "DefaultAssignmentSet_supplierId_key"
  ON "DefaultAssignmentSet" ("supplierId");
CREATE UNIQUE INDEX "DefaultLineSupervisor_id_supplierId_key"
  ON "DefaultLineSupervisor" ("id", "supplierId");
CREATE UNIQUE INDEX "DefaultLineSupervisor_line_supplier_key"
  ON "DefaultLineSupervisor" ("lineId", "supplierId");
CREATE INDEX "DefaultLineSupervisor_member_idx"
  ON "DefaultLineSupervisor" ("supplierId", "supervisorMemberId");
CREATE UNIQUE INDEX "DefaultLineLeader_id_supplierId_key"
  ON "DefaultLineLeader" ("id", "supplierId");
CREATE UNIQUE INDEX "DefaultLineLeader_line_supplier_key"
  ON "DefaultLineLeader" ("lineId", "supplierId");
CREATE UNIQUE INDEX "DefaultLineLeader_member_supplier_key"
  ON "DefaultLineLeader" ("lineLeaderMemberId", "supplierId");
CREATE UNIQUE INDEX "DefaultJobMp_id_supplierId_key"
  ON "DefaultJobMp" ("id", "supplierId");
CREATE UNIQUE INDEX "DefaultJobMp_job_supplier_key"
  ON "DefaultJobMp" ("jobId", "supplierId");
CREATE UNIQUE INDEX "DefaultJobMp_member_supplier_key"
  ON "DefaultJobMp" ("mpMemberId", "supplierId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_memberId_supplierId_fkey"
  FOREIGN KEY ("memberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Member" ADD CONSTRAINT "Member_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberPhoto" ADD CONSTRAINT "MemberPhoto_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberPhoto" ADD CONSTRAINT "MemberPhoto_member_supplier_fkey"
  FOREIGN KEY ("memberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Line" ADD CONSTRAINT "Line_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_line_supplier_fkey"
  FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Part" ADD CONSTRAINT "Part_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistDraftItem" ADD CONSTRAINT "ChecklistDraftItem_template_supplier_fkey"
  FOREIGN KEY ("templateId", "supplierId") REFERENCES "ChecklistTemplate" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistVersion" ADD CONSTRAINT "ChecklistVersion_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistVersion" ADD CONSTRAINT "ChecklistVersion_template_supplier_fkey"
  FOREIGN KEY ("templateId", "supplierId") REFERENCES "ChecklistTemplate" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChecklistVersionItem"
  ADD CONSTRAINT "ChecklistVersionItem_version_supplier_fkey"
  FOREIGN KEY ("checklistVersionId", "supplierId")
  REFERENCES "ChecklistVersion" ("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultAssignmentSet" ADD CONSTRAINT "DefaultAssignmentSet_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultLineSupervisor"
  ADD CONSTRAINT "DefaultLineSupervisor_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultLineSupervisor"
  ADD CONSTRAINT "DefaultLineSupervisor_line_supplier_fkey"
  FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultLineSupervisor"
  ADD CONSTRAINT "DefaultLineSupervisor_member_supplier_fkey"
  FOREIGN KEY ("supervisorMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultLineLeader" ADD CONSTRAINT "DefaultLineLeader_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultLineLeader" ADD CONSTRAINT "DefaultLineLeader_line_supplier_fkey"
  FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultLineLeader" ADD CONSTRAINT "DefaultLineLeader_member_supplier_fkey"
  FOREIGN KEY ("lineLeaderMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultJobMp" ADD CONSTRAINT "DefaultJobMp_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultJobMp" ADD CONSTRAINT "DefaultJobMp_job_supplier_fkey"
  FOREIGN KEY ("jobId", "supplierId") REFERENCES "Job" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DefaultJobMp" ADD CONSTRAINT "DefaultJobMp_member_supplier_fkey"
  FOREIGN KEY ("mpMemberId", "supplierId") REFERENCES "Member" ("id", "supplierId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_member_role_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" <> OLD."role" THEN
    RAISE EXCEPTION 'Member role is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Member_prevent_role_update"
BEFORE UPDATE OF "role" ON "Member"
FOR EACH ROW EXECUTE FUNCTION prevent_member_role_update();

CREATE FUNCTION enforce_operational_user_member() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  member_role "MemberRole";
  member_supplier UUID;
BEGIN
  IF NEW."memberId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "role", "supplierId" INTO member_role, member_supplier
  FROM "Member" WHERE "id" = NEW."memberId";
  IF member_role IS NULL
    OR member_supplier <> NEW."supplierId"
    OR member_role::text <> NEW."role"::text
    OR member_role = 'MP'
  THEN
    RAISE EXCEPTION 'Operational user/member linkage is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_enforce_operational_member"
BEFORE INSERT OR UPDATE OF "memberId", "supplierId", "role" ON "User"
FOR EACH ROW EXECUTE FUNCTION enforce_operational_user_member();

CREATE FUNCTION prevent_published_checklist_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published checklist is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ChecklistVersion_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "ChecklistVersion"
FOR EACH ROW EXECUTE FUNCTION prevent_published_checklist_mutation();

CREATE TRIGGER "ChecklistVersionItem_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "ChecklistVersionItem"
FOR EACH ROW EXECUTE FUNCTION prevent_published_checklist_mutation();
