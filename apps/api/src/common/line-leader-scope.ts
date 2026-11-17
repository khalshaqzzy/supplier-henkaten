import type { Prisma } from '../generated/prisma/client.js';

/**
 * Henkaten a Line Leader may read and withdraw: records submitted by that Line Leader, legacy
 * occurrence records led by that Line Leader, and every record of a Line–Shift that the Line
 * Leader currently co-leads.
 */
export function lineLeaderHenkatenScope(memberId: string): Prisma.HenkatenWhereInput {
  return {
    OR: [
      { lineLeaderResponsibility: { memberId } },
      { lineLeaderResponsibility: null, shiftRun: { lineLeaderMemberId: memberId } },
      { lineShift: { lineLeaders: { some: { memberId } } } },
    ],
  };
}

/** Occurrences visible to a Line Leader, including those of co-led Line–Shifts. */
export function lineLeaderShiftRunScope(memberId: string): Prisma.ShiftRunWhereInput {
  return {
    OR: [
      { lineLeaderMemberId: memberId },
      { henkatens: { some: { lineShift: { lineLeaders: { some: { memberId } } } } } },
    ],
  };
}
