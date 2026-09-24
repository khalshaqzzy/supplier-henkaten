-- migration-policy: allow-drop-not-null Member.registrationNumber
ALTER TABLE "Member" ALTER COLUMN "registrationNumber" DROP NOT NULL;
-- migration-policy: allow-drop-not-null Member.normalizedRegistrationNumber
ALTER TABLE "Member" ALTER COLUMN "normalizedRegistrationNumber" DROP NOT NULL;

UPDATE "Member"
SET "registrationNumber" = NULL,
    "normalizedRegistrationNumber" = NULL
WHERE "role" = 'MP';

-- migration-policy: allow-drop-not-null Henkaten.partId
ALTER TABLE "Henkaten" ALTER COLUMN "partId" DROP NOT NULL;

ALTER TABLE "Member" ADD CONSTRAINT "Member_registration_by_role_check"
CHECK (
  ("role" = 'MP' AND "registrationNumber" IS NULL AND "normalizedRegistrationNumber" IS NULL)
  OR ("role" <> 'MP' AND "registrationNumber" IS NOT NULL AND "normalizedRegistrationNumber" IS NOT NULL)
);
