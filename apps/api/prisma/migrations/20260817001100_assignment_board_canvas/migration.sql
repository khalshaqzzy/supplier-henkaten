CREATE TABLE "LineBoardLayout" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplierId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "document" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LineBoardLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineBoardLayout_id_supplierId_key" ON "LineBoardLayout"("id", "supplierId");
CREATE UNIQUE INDEX "LineBoardLayout_lineId_supplierId_key" ON "LineBoardLayout"("lineId", "supplierId");
CREATE INDEX "LineBoardLayout_supplierId_updatedAt_idx" ON "LineBoardLayout"("supplierId", "updatedAt" DESC);

ALTER TABLE "LineBoardLayout" ADD CONSTRAINT "LineBoardLayout_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineBoardLayout" ADD CONSTRAINT "LineBoardLayout_lineId_supplierId_fkey"
FOREIGN KEY ("lineId", "supplierId") REFERENCES "Line"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
