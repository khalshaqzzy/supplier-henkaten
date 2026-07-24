import type { ShiftRun, WorkingAssignment } from '../generated/prisma/client.js';
import { databaseDate } from './shift-time.js';

export function presentWorking(row: WorkingAssignment) {
  return {
    id: row.id,
    shiftRunId: row.shiftRunId,
    lineId: row.lineId,
    jobId: row.jobId,
    jobName: row.jobNameSnapshot,
    jobDisplayOrder: row.jobDisplayOrderSnapshot,
    effectiveMpMemberId: row.effectiveMpMemberId,
    candidateMpMemberId: row.candidateMpMemberId,
    mpName: row.mpNameSnapshot,
    mpRegistrationNumber: row.mpRegistrationSnapshot,
    state: row.state,
    active: row.active,
    version: row.version,
  };
}

export function presentShift(row: ShiftRun, workingAssignments?: WorkingAssignment[]) {
  const checks = Array.isArray(row.latestPreflight) ? row.latestPreflight : [];
  return {
    id: row.id,
    lineId: row.lineId,
    shiftTemplateId: row.shiftTemplateId,
    status: row.status,
    businessDate: databaseDate(row.businessDate),
    scheduledStartAt: row.scheduledStartAt.toISOString(),
    scheduledEndAt: row.scheduledEndAt.toISOString(),
    timezone: row.timezoneSnapshot,
    line: { code: row.lineCodeSnapshot, name: row.lineNameSnapshot },
    shift: {
      name: row.shiftNameSnapshot,
      startMinute: row.shiftStartMinuteSnapshot,
      endMinute: row.shiftEndMinuteSnapshot,
    },
    defaultAssignmentSetVersion: row.defaultAssignmentSetVersion,
    supervisor:
      row.supervisorMemberId && row.supervisorNameSnapshot
        ? { memberId: row.supervisorMemberId, name: row.supervisorNameSnapshot }
        : null,
    lineLeader:
      row.lineLeaderMemberId && row.lineLeaderNameSnapshot
        ? { memberId: row.lineLeaderMemberId, name: row.lineLeaderNameSnapshot }
        : null,
    eligible: checks.every((check) => !isBlocking(check)),
    checks,
    latestPreflightAt: row.latestPreflightAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    startedWithOverride: row.startedWithOverride,
    overrideReason: row.overrideReason,
    endedAt: row.endedAt?.toISOString() ?? null,
    endSummary: parseEndSummary(row.endSummary),
    version: row.version,
    ...(workingAssignments ? { workingAssignments: workingAssignments.map(presentWorking) } : {}),
  };
}

function parseEndSummary(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = [
    'cancelledHenkatens',
    'releasedReservations',
    'routesNotRequired',
    'closedWarnings',
    'closedAssignmentIssues',
    'deactivatedWorkingAssignments',
  ] as const;
  if (keys.some((key) => !Number.isInteger(record[key]) || Number(record[key]) < 0)) return null;
  return Object.fromEntries(keys.map((key) => [key, Number(record[key])]));
}

function isBlocking(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'blocking' in value && value.blocking === true
  );
}
