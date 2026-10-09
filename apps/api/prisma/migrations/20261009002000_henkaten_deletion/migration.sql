ALTER TABLE "Henkaten" ADD COLUMN "deletedAt" TIMESTAMPTZ(3), ADD COLUMN "deletedById" UUID;
ALTER TABLE "ExternalHenkatenProjection" ADD COLUMN "deletedAt" TIMESTAMPTZ(3), ADD COLUMN "deletedById" UUID;
ALTER TABLE "AuditEvent" ADD COLUMN "hiddenAt" TIMESTAMPTZ(3);
ALTER TABLE "Notification" ADD COLUMN "hiddenAt" TIMESTAMPTZ(3);
ALTER TABLE "WarningInstance" ADD COLUMN "hiddenAt" TIMESTAMPTZ(3);
ALTER TABLE "PcrAssessment" ADD COLUMN "hiddenAt" TIMESTAMPTZ(3);
ALTER TABLE "ExternalIngestionEvent" ADD COLUMN "hiddenAt" TIMESTAMPTZ(3);
ALTER TABLE "OutboxEvent" ADD COLUMN "suppressedAt" TIMESTAMPTZ(3);
ALTER TABLE "HenkatenExportJob" ADD COLUMN "invalidatedAt" TIMESTAMPTZ(3);
CREATE TABLE "HenkatenDeletionCommand" (
  id UUID PRIMARY KEY, "supplierId" UUID NOT NULL REFERENCES "Supplier"(id) ON DELETE RESTRICT,
  "actorUserId" UUID NOT NULL, key VARCHAR(128) NOT NULL, "payloadHash" CHAR(64) NOT NULL,
  result JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HenkatenDeletionCommand_supplierId_actorUserId_key_key" ON "HenkatenDeletionCommand"("supplierId", "actorUserId", key);
CREATE INDEX "HenkatenDeletionCommand_supplierId_createdAt_idx" ON "HenkatenDeletionCommand"("supplierId", "createdAt");
CREATE INDEX "Henkaten_visible_supplier_idx" ON "Henkaten"("supplierId", "occurredAt") WHERE "deletedAt" IS NULL;
CREATE INDEX "ExternalHenkatenProjection_visible_supplier_idx" ON "ExternalHenkatenProjection"("supplierId", "updatedAt") WHERE "deletedAt" IS NULL;
CREATE TRIGGER "HenkatenDeletionCommand_immutable" BEFORE UPDATE OR DELETE ON "HenkatenDeletionCommand"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_henkaten_evidence();
CREATE OR REPLACE FUNCTION enforce_henkaten_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Henkaten cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted Henkaten is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."deletedAt" IS NOT NULL THEN
    IF NEW."deletedById" IS NULL OR NEW.version <> OLD.version + 1 OR
       (to_jsonb(NEW) - ARRAY['deletedAt','deletedById','version','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['deletedAt','deletedById','version','updatedAt']) THEN
      RAISE EXCEPTION 'Deletion cannot change Henkaten evidence' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."deletedById" IS DISTINCT FROM OLD."deletedById" THEN
    RAISE EXCEPTION 'Invalid deletion metadata' USING ERRCODE = '55000';
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

CREATE OR REPLACE FUNCTION enforce_projection_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Projection cannot be physically deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted projection is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."deletedAt" IS NOT NULL THEN
    IF NEW."deletedById" IS NULL OR
       (to_jsonb(NEW) - ARRAY['deletedAt','deletedById','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['deletedAt','deletedById','updatedAt']) THEN
      RAISE EXCEPTION 'Deletion cannot change projection evidence' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."deletedById" IS DISTINCT FROM OLD."deletedById" THEN
    RAISE EXCEPTION 'Invalid deletion metadata' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ExternalHenkatenProjection_deletion_guard" BEFORE UPDATE OR DELETE ON "ExternalHenkatenProjection"
  FOR EACH ROW EXECUTE FUNCTION enforce_projection_deletion();
CREATE OR REPLACE FUNCTION prevent_audit_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."hiddenAt" IS NULL AND NEW."hiddenAt" IS NOT NULL AND
     (to_jsonb(NEW) - 'hiddenAt') = (to_jsonb(OLD) - 'hiddenAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditEvent is append-only' USING ERRCODE = '55000';
END; $$;

CREATE OR REPLACE FUNCTION prevent_external_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."hiddenAt" IS NULL AND NEW."hiddenAt" IS NOT NULL AND
     (to_jsonb(NEW) - 'hiddenAt') = (to_jsonb(OLD) - 'hiddenAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'external ingestion evidence is immutable' USING ERRCODE = '55000';
END; $$;
