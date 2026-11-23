import type { IdentityRealm, Prisma } from '../generated/prisma/client.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { ProblemException } from '../common/problem.js';

/**
 * Renames one account. Usernames stay unique per realm (TMMIN) or per supplier, compared
 * case-insensitively. Sessions are bound to the account id and stay valid after a rename.
 */
export async function renameUser(
  transaction: Prisma.TransactionClient,
  user: { id: string; realm: IdentityRealm; supplierId: string | null; username: string },
  username: string,
  actorUserId: string | null,
) {
  const trimmed = username.trim();
  const normalizedUsername = normalizeLookup(trimmed);
  const taken = await transaction.user.findFirst({
    where: {
      id: { not: user.id },
      realm: user.realm,
      normalizedUsername,
      deletedAt: null,
      ...(user.realm === 'SUPPLIER' ? { supplierId: user.supplierId } : {}),
    },
    select: { id: true },
  });
  if (taken) throw usernameTaken();
  return transaction.user.update({
    where: { id: user.id },
    data: {
      username: trimmed,
      normalizedUsername,
      version: { increment: 1 },
      updatedById: actorUserId,
    },
  });
}

export function usernameTaken(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'STATE_CONFLICT',
    title: 'Username already used',
    detail: 'Username sudah digunakan akun lain.',
  });
}
