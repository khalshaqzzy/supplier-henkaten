import type { Prisma } from '../generated/prisma/client.js';
import { ProblemException } from '../common/problem.js';

/** Must be called inside the supplier-locked Man submission/movement transaction. */
export async function assertTanokoEligible(
  tx: Prisma.TransactionClient,
  supplierId: string,
  memberId: string,
  jobId: string,
) {
  const mapping = await tx.tanokoMapping.findUnique({
    where: { supplierId_memberId_jobId: { supplierId, memberId, jobId } },
    select: { level: true },
  });
  if ((mapping?.level ?? 0) < 3)
    throw new ProblemException({
      status: 422,
      code: 'VALIDATION_FAILED',
      title: 'Tanoko level insufficient',
      detail:
        'MP pengganti harus memiliki level Tanoko minimal 3 pada job tujuan. Perbarui mapping melalui GL atau Supplier Admin.',
      fieldErrors: [
        {
          path: 'replacementMpMemberId',
          code: 'TANOKO_LEVEL_REQUIRED',
          message: 'Minimal level 3 pada job tujuan.',
        },
      ],
    });
}
