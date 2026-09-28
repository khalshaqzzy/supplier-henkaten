-- Preserve the oldest active LineShift assignment for each supplier and LL.
-- Only the duplicate LL field is cleared; historical Henkaten and other assignments stay intact.
BEGIN;

LOCK TABLE "LineShift" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT id, "lineLeaderMemberId",
         row_number() OVER (
           PARTITION BY "supplierId", "lineLeaderMemberId"
           ORDER BY "createdAt", id
         ) AS position
  FROM "LineShift"
  WHERE active = true AND "lineLeaderMemberId" IS NOT NULL
), cleared AS (
  UPDATE "LineShift" ls
  SET "lineLeaderMemberId" = NULL,
      version = ls.version + 1,
      "updatedAt" = now(),
      "updatedById" = NULL
  FROM ranked
  WHERE ls.id = ranked.id AND ranked.position > 1
  RETURNING ls.id, ls."supplierId", ls."lineId"
)
INSERT INTO "AuditEvent" (
  id, "actorKind", "supplierId", "lineId", action, "resourceType", "resourceId",
  "changeSummary", reason, "correlationId", result
)
SELECT gen_random_uuid(), 'SYSTEM', cleared."supplierId", cleared."lineId",
       'LINE_SHIFT_LEADER_DEDUPED', 'LineShift', cleared.id,
       jsonb_build_object('lineId', cleared."lineId",
                          'previousLineLeaderMemberId', ranked."lineLeaderMemberId",
                          'lineLeaderMemberId', NULL),
       'Active LL assignment cleared by unique LineShift migration.',
       'migration-20260928000100', 'SUCCESS'
FROM cleared
JOIN ranked ON ranked.id = cleared.id;

CREATE UNIQUE INDEX "LineShift_one_active_line_leader_key"
  ON "LineShift" ("supplierId", "lineLeaderMemberId")
  WHERE active = true AND "lineLeaderMemberId" IS NOT NULL;

COMMIT;
