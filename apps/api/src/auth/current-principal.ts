import type { Prisma } from '../generated/prisma/client.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { ProblemException } from '../common/problem.js';

/** Revalidate a queued command after acquiring the supplier mutation lock. */
export async function assertCurrentPrincipal(
  tx: Prisma.TransactionClient,
  principal: RequestPrincipal,
) {
  const ids = [principal.sessionId];
  await tx.$queryRaw`SELECT id FROM "UserSession" WHERE id = ANY(${ids}::uuid[]) FOR SHARE`;
  let session = await tx.userSession.findUnique({
    where: { id: principal.sessionId },
    include: { user: true },
  });
  if (session)
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${session.userId}::uuid FOR SHARE`;
  if (session)
    session = await tx.userSession.findUnique({
      where: { id: principal.sessionId },
      include: { user: true },
    });
  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.idleExpiresAt <= now ||
    session.absoluteExpiresAt <= now ||
    session.realm !== 'SUPPLIER' ||
    session.purpose !== principal.purpose ||
    session.user.supplierId !== principal.supplierId ||
    session.user.status !== 'ACTIVE' ||
    session.user.role !== principal.role ||
    session.userId !== principal.userId ||
    session.passwordEpoch !== session.user.passwordEpoch ||
    session.authorizationEpoch !== session.user.authorizationEpoch ||
    (session.user.mustChangePassword && !session.impersonatedBySessionId) ||
    session.supplierId !== principal.supplierId
  )
    throw expired();
  if (session.impersonatedBySessionId) {
    await tx.$queryRaw`SELECT id FROM "UserSession" WHERE id = ${session.impersonatedBySessionId}::uuid FOR SHARE`;
    if (session.impersonatedByUserId)
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${session.impersonatedByUserId}::uuid FOR SHARE`;
    const actor = await tx.userSession.findUnique({
      where: { id: session.impersonatedBySessionId },
      include: { user: true },
    });
    if (
      !actor ||
      actor.revokedAt ||
      actor.idleExpiresAt <= now ||
      actor.absoluteExpiresAt <= now ||
      actor.userId !== session.impersonatedByUserId ||
      actor.user.role !== 'TMMIN_ADMIN' ||
      actor.user.status !== 'ACTIVE' ||
      actor.passwordEpoch !== actor.user.passwordEpoch ||
      actor.authorizationEpoch !== actor.user.authorizationEpoch
    )
      throw expired();
  }
  const supplier = principal.supplierId
    ? await tx.supplier.findUnique({ where: { id: principal.supplierId } })
    : null;
  if (!supplier?.active || supplier.sourceEpoch !== session.sourceEpoch) throw expired();
  if (principal.purpose === 'HOSTED_PREPARATION') {
    if (
      supplier.sourceMode !== 'EXTERNAL' ||
      !(await tx.hostedPreparation.count({
        where: {
          supplierId: supplier.id,
          status: 'ACTIVE',
          sourceEpoch: supplier.sourceEpoch,
          adminUserId: principal.userId,
        },
      }))
    )
      throw expired();
  } else if (supplier.sourceMode !== 'HOSTED') throw expired();
}
function expired() {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Session no longer valid',
    detail: 'Sesi atau izin telah berubah. Masuk kembali untuk melanjutkan.',
  });
}
