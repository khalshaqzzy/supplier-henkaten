ALTER TABLE "Part" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
CREATE TABLE "CatalogCommand" (
  "id" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogCommand_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CatalogCommand_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogCommand_supplierId_actorUserId_key_key" ON "CatalogCommand"("supplierId", "actorUserId", "key");
CREATE INDEX "CatalogCommand_supplierId_createdAt_idx" ON "CatalogCommand"("supplierId", "createdAt");
ALTER TABLE "Part" ADD CONSTRAINT "Part_deleted_inactive_check" CHECK ("deletedAt" IS NULL OR active = false);
