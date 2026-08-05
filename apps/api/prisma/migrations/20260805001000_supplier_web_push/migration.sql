CREATE TYPE "PushSubscriptionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "PushDeliveryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PERMANENT_FAILURE', 'EXPIRED');

CREATE TABLE "PushSubscription" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "endpointHash" CHAR(64) NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" VARCHAR(512) NOT NULL,
  "auth" VARCHAR(256) NOT NULL,
  "status" "PushSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "expirationAt" TIMESTAMPTZ(3),
  "lastAcceptedAt" TIMESTAMPTZ(3),
  "lastFailureAt" TIMESTAMPTZ(3),
  "lastFailureClass" VARCHAR(100),
  "revokedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PushSubscription_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");
CREATE INDEX "PushSubscription_userId_installationId_status_idx" ON "PushSubscription"("userId", "installationId", "status");
CREATE INDEX "PushSubscription_supplierId_status_idx" ON "PushSubscription"("supplierId", "status");

CREATE TABLE "PushDelivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lockedAt" TIMESTAMPTZ(3),
  "lockedBy" VARCHAR(100),
  "acceptedAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "safeFailureClass" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushDelivery_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PushDelivery_attempt_nonnegative" CHECK ("attemptCount" >= 0)
);

CREATE UNIQUE INDEX "PushDelivery_notificationId_subscriptionId_key" ON "PushDelivery"("notificationId", "subscriptionId");
CREATE INDEX "PushDelivery_status_nextAttemptAt_lockedAt_idx" ON "PushDelivery"("status", "nextAttemptAt", "lockedAt");
CREATE INDEX "PushDelivery_supplierId_createdAt_idx" ON "PushDelivery"("supplierId", "createdAt" DESC);
