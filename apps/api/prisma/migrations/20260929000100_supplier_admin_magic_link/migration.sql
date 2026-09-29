ALTER TABLE "UserSession" ADD COLUMN "impersonatedByUserId" UUID;
ALTER TABLE "UserSession" ADD COLUMN "impersonatedBySessionId" UUID;

CREATE TABLE "SupplierAdminMagicLink" (
    "id" UUID NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "supplierId" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorSessionId" UUID NOT NULL,
    "sourceEpoch" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierAdminMagicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierAdminMagicLink_tokenHash_key" ON "SupplierAdminMagicLink"("tokenHash");
CREATE INDEX "SupplierAdminMagicLink_supplierId_expiresAt_idx" ON "SupplierAdminMagicLink"("supplierId", "expiresAt");
