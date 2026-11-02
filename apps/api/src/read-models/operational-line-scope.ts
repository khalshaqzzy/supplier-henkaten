import type { RequestPrincipal } from '../common/request-context.js';
import type { PrismaService } from '../persistence/prisma.service.js';

/** Historical scope plus current assignments and explicit responsibility handovers. */
export async function operationalLineScope(
  prisma: PrismaService,
  supplierId: string,
  principal: RequestPrincipal,
) {
  if (!principal.memberId) return [];
  const memberId = principal.memberId;
  const role =
    principal.role === 'SUPERVISOR'
      ? { supervisorMemberId: memberId }
      : { lineLeaderMemberId: memberId };
  const [runs, assignments, responsibilities] = await Promise.all([
    prisma.shiftRun.findMany({
      where: { supplierId, ...role },
      distinct: ['lineId'],
      select: { lineId: true },
    }),
    prisma.lineShift.findMany({
      where: { supplierId, active: true, ...role },
      distinct: ['lineId'],
      select: { lineId: true },
    }),
    prisma.henkaten.findMany({
      where: {
        supplierId,
        deletedAt: null,
        ...(principal.role === 'SUPERVISOR'
          ? {
              approvalRoutes: {
                some: { route: 'SUPERVISOR', currentResponsibleMemberId: memberId },
              },
            }
          : { lineLeaderResponsibility: { memberId } }),
      },
      distinct: ['lineId'],
      select: { lineId: true },
    }),
  ]);
  return [...new Set([...runs, ...assignments, ...responsibilities].map((row) => row.lineId))];
}
