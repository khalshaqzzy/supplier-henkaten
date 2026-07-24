CREATE TABLE "Notification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "recipientUserId" UUID NOT NULL,
  "sourceEventId" UUID NOT NULL,
  "kind" VARCHAR(50) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(1000) NOT NULL,
  "resourceType" VARCHAR(100) NOT NULL,
  "resourceId" VARCHAR(200) NOT NULL,
  "deepLink" VARCHAR(500),
  "readAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Notification_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "Notification_sourceEventId_recipientUserId_key"
  ON "Notification"("sourceEventId", "recipientUserId");
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_id_idx"
  ON "Notification"("recipientUserId", "readAt", "createdAt" DESC, "id" DESC);
CREATE INDEX "Notification_supplierId_createdAt_idx"
  ON "Notification"("supplierId", "createdAt" DESC);
