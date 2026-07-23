import { Injectable } from '@nestjs/common';

import type { AssignmentIssue, AssignmentIssueType, Prisma } from '../generated/prisma/client.js';

type OpenIssueInput = {
  supplierId: string;
  shiftRunId: string;
  lineId: string;
  jobId: string;
  type: AssignmentIssueType;
  originKind: string;
  originReferenceId?: string;
  originHenkatenId?: string;
  originMovementId?: string;
};

type ResolveIssueInput = {
  supplierId: string;
  issueId: string;
  shiftRunId: string;
  jobId: string;
  resolutionKind: string;
  resolutionReferenceId: string;
  resolutionHenkatenId: string;
  resolvedById: string;
};

@Injectable()
export class AssignmentIssueService {
  async createOpen(tx: Prisma.TransactionClient, input: OpenIssueInput): Promise<AssignmentIssue> {
    const existing = await tx.assignmentIssue.findFirst({
      where: {
        supplierId: input.supplierId,
        jobId: input.jobId,
        status: 'OPEN',
      },
    });
    if (existing) return existing;
    return tx.assignmentIssue.create({
      data: {
        supplierId: input.supplierId,
        shiftRunId: input.shiftRunId,
        lineId: input.lineId,
        jobId: input.jobId,
        type: input.type,
        originKind: input.originKind,
        ...(input.originReferenceId ? { originReferenceId: input.originReferenceId } : {}),
        ...(input.originHenkatenId ? { originHenkatenId: input.originHenkatenId } : {}),
        ...(input.originMovementId ? { originMovementId: input.originMovementId } : {}),
      },
    });
  }

  async resolveFromVerifiedWorkflow(
    tx: Prisma.TransactionClient,
    input: ResolveIssueInput,
  ): Promise<AssignmentIssue | null> {
    const issue = await tx.assignmentIssue.findFirst({
      where: {
        id: input.issueId,
        supplierId: input.supplierId,
        shiftRunId: input.shiftRunId,
        jobId: input.jobId,
        status: 'OPEN',
      },
    });
    if (!issue) return null;
    return tx.assignmentIssue.update({
      where: { id: issue.id },
      data: {
        status: 'RESOLVED',
        resolutionKind: input.resolutionKind,
        resolutionReferenceId: input.resolutionReferenceId,
        resolutionHenkatenId: input.resolutionHenkatenId,
        resolvedAt: new Date(),
        resolvedById: input.resolvedById,
        version: { increment: 1 },
      },
    });
  }
}
