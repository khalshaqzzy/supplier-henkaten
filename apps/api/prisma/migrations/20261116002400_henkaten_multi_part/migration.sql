-- A Henkaten can affect several parts. "HenkatenPart" holds every affected part in submission
-- order; the part columns on "Henkaten" keep describing the first part.
CREATE TABLE "HenkatenPart" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "henkatenId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "partId" UUID,
  "partNumberSnapshot" VARCHAR(100) NOT NULL,
  "normalizedPartNumberSnapshot" VARCHAR(100) NOT NULL,
  "partNameSnapshot" VARCHAR(200) NOT NULL,
  CONSTRAINT "HenkatenPart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HenkatenPart_positive_position" CHECK ("position" > 0)
);

INSERT INTO "HenkatenPart" (
  "id", "supplierId", "henkatenId", "position", "partId",
  "partNumberSnapshot", "normalizedPartNumberSnapshot", "partNameSnapshot"
)
SELECT
  gen_random_uuid(), "supplierId", "id", 1, "partId",
  "partNumberSnapshot", "normalizedPartNumberSnapshot", "partNameSnapshot"
FROM "Henkaten";

CREATE UNIQUE INDEX "HenkatenPart_henkatenId_position_key" ON "HenkatenPart"("henkatenId", "position");
CREATE UNIQUE INDEX "HenkatenPart_henkatenId_normalizedPartNumberSnapshot_key" ON "HenkatenPart"("henkatenId", "normalizedPartNumberSnapshot");
CREATE INDEX "HenkatenPart_supplierId_normalizedPartNumberSnapshot_idx" ON "HenkatenPart"("supplierId", "normalizedPartNumberSnapshot");
CREATE INDEX "HenkatenPart_supplierId_partId_idx" ON "HenkatenPart"("supplierId", "partId");

ALTER TABLE "HenkatenPart" ADD CONSTRAINT "HenkatenPart_henkatenId_supplierId_fkey" FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HenkatenPart" ADD CONSTRAINT "HenkatenPart_partId_supplierId_fkey" FOREIGN KEY ("partId", "supplierId") REFERENCES "Part"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "HenkatenPart_prevent_update_delete"
  BEFORE UPDATE OR DELETE ON "HenkatenPart"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_henkaten_evidence();

-- One warning is opened per affected part, so a Henkaten no longer owns exactly one warning.
-- migration-policy: allow-drop-index WarningInstance_henkatenId_key
DROP INDEX IF EXISTS "WarningInstance_henkatenId_key";
-- migration-policy: allow-drop-index WarningInstance_henkatenId_supplierId_key
DROP INDEX IF EXISTS "WarningInstance_henkatenId_supplierId_key";
CREATE UNIQUE INDEX "WarningInstance_henkatenId_normalizedPartNumberSnapshot_key" ON "WarningInstance"("henkatenId", "normalizedPartNumberSnapshot");
