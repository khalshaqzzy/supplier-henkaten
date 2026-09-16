import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { assertTanokoEligible } from './tanoko-eligibility.js';

describe('Tanoko replacement qualification', () => {
  it.each([null, 1, 2])('refuses unassessed or supervised mastery (%s)', async (level) => {
    const tx = {
      tanokoMapping: { findUnique: vi.fn().mockResolvedValue(level === null ? null : { level }) },
    };
    await expect(
      assertTanokoEligible(tx as unknown as Prisma.TransactionClient, 'supplier', 'mp', 'job'),
    ).rejects.toMatchObject({
      problem: {
        status: 422,
        fieldErrors: [
          {
            path: 'replacementMpMemberId',
            code: 'TANOKO_LEVEL_REQUIRED',
            message: 'Minimal level 3 pada job tujuan.',
          },
        ],
      },
    });
  });
  it.each([3, 4])('accepts mastery %s only for the exact tenant, MP and job', async (level) => {
    const findUnique = vi.fn().mockResolvedValue({ level });
    await assertTanokoEligible(
      { tanokoMapping: { findUnique } } as unknown as Prisma.TransactionClient,
      'supplier',
      'mp',
      'job',
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        supplierId_memberId_jobId: { supplierId: 'supplier', memberId: 'mp', jobId: 'job' },
      },
      select: { level: true },
    });
  });
});
