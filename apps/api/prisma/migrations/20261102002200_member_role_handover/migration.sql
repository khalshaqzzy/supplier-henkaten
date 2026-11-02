CREATE TABLE "MemberRoleChange" (
  "id" UUID PRIMARY KEY, "supplierId" UUID NOT NULL, "memberId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL, "fromRole" "MemberRole" NOT NULL, "toRole" "MemberRole" NOT NULL,
  "memberVersion" INTEGER NOT NULL, "reason" VARCHAR(500) NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL, "payloadHash" CHAR(64) NOT NULL,
  "handovers" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("memberId", "supplierId") REFERENCES "Member" (id, "supplierId") ON DELETE RESTRICT,
  FOREIGN KEY ("actorUserId") REFERENCES "User" (id) ON DELETE RESTRICT,
  CHECK ("fromRole" <> 'MP' AND "toRole" <> 'MP' AND "fromRole" <> "toRole")
);
CREATE UNIQUE INDEX "MemberRoleChange_supplierId_actorUserId_idempotencyKey_key"
  ON "MemberRoleChange" ("supplierId", "actorUserId", "idempotencyKey");
CREATE UNIQUE INDEX "MemberRoleChange_memberId_memberVersion_key" ON "MemberRoleChange" ("memberId", "memberVersion");
CREATE INDEX "MemberRoleChange_supplierId_memberId_createdAt_idx" ON "MemberRoleChange" ("supplierId", "memberId", "createdAt");
CREATE TRIGGER "MemberRoleChange_immutable" BEFORE UPDATE OR DELETE ON "MemberRoleChange"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_operational_ledger();

CREATE TABLE "HenkatenLineLeaderResponsibility" (
  "henkatenId" UUID PRIMARY KEY, "supplierId" UUID NOT NULL, "memberId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("henkatenId", "supplierId") REFERENCES "Henkaten" (id, "supplierId") ON DELETE RESTRICT,
  FOREIGN KEY ("memberId", "supplierId") REFERENCES "Member" (id, "supplierId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "HenkatenLineLeaderResponsibility_henkatenId_supplierId_key" ON "HenkatenLineLeaderResponsibility" ("henkatenId", "supplierId");
CREATE INDEX "HenkatenLineLeaderResponsibility_supplierId_memberId_idx"
  ON "HenkatenLineLeaderResponsibility" ("supplierId", "memberId");

-- Keep role changes behind a recorded command, including for direct SQL callers.
CREATE OR REPLACE FUNCTION prevent_member_role_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role <> OLD.role AND (
    OLD.role = 'MP' OR NEW.role = 'MP' OR NOT EXISTS (
      SELECT 1 FROM "MemberRoleChange" c WHERE c."memberId" = OLD.id
        AND c."supplierId" = OLD."supplierId" AND c."fromRole" = OLD.role
        AND c."toRole" = NEW.role AND c."memberVersion" = NEW.version
        AND NEW.version = OLD.version + 1
    )
  ) THEN
    RAISE EXCEPTION 'Member role change requires a recorded operational command' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Both sides must agree at transaction commit, even when the member is updated first.
CREATE FUNCTION check_member_account_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" u JOIN "Member" m ON m.id = u."memberId"
    WHERE m.id = NEW.id AND (u.role::text <> m.role::text OR u."supplierId" <> m."supplierId")) THEN
    RAISE EXCEPTION 'Member and account role must agree' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "Member_account_role_consistency" AFTER UPDATE OF role ON "Member"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_member_account_role();

CREATE FUNCTION validate_henkaten_leader_handover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Henkaten" h WHERE h.id = NEW."henkatenId"
      AND h."supplierId" = NEW."supplierId" AND h.status = 'OPEN' AND h."deletedAt" IS NULL)
    OR NOT EXISTS (SELECT 1 FROM "Member" m JOIN "User" u ON u."memberId" = m.id
      WHERE m.id = NEW."memberId" AND m."supplierId" = NEW."supplierId" AND m.active
        AND m.role = 'LINE_LEADER' AND u.role = 'LINE_LEADER' AND u.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Invalid current Henkaten Line Leader responsibility' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "HenkatenLineLeaderResponsibility_validate" BEFORE INSERT OR UPDATE ON "HenkatenLineLeaderResponsibility"
  FOR EACH ROW EXECUTE FUNCTION validate_henkaten_leader_handover();
