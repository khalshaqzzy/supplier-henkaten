import { Injectable } from '@nestjs/common';

import {
  BOARD_JOB_CARD_DEFAULT_HEIGHT,
  BOARD_JOB_CARD_DEFAULT_WIDTH,
  boardLayoutDocumentSchema,
  type BoardLayoutDocument,
  type BoardLayoutNode,
  type BoardLayoutResponse,
  type BoardLayoutSaveRequest,
} from '@tmmin-henkaten/contracts';
import type { Prisma } from '../generated/prisma/client.js';

import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { TenantScope } from '../common/scope.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';

type BoardJob = { jobId: string; displayOrder: number };

@Injectable()
export class BoardLayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
  ) {}

  async get(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string,
  ): Promise<BoardLayoutResponse> {
    const { jobs, canEdit } = await this.assertReadableLine(this.prisma, scope, principal, lineId);
    const layout = await this.prisma.lineBoardLayout.findUnique({
      where: { lineId_supplierId: { lineId, supplierId: scope.supplierId } },
    });
    const parsed = layout
      ? boardLayoutDocumentSchema.parse(layout.document)
      : generatedDocument(jobs);
    const reconciled = reconcileDocument(parsed, jobs);
    const updatedBy = layout?.updatedById
      ? await this.prisma.user.findUnique({
          where: { id: layout.updatedById },
          select: { displayName: true },
        })
      : null;
    return {
      id: layout?.id ?? null,
      lineId,
      source: layout ? 'SAVED' : 'GENERATED',
      version: layout?.version ?? null,
      schemaVersion: 1,
      canEdit,
      updatedAt: layout?.updatedAt.toISOString() ?? null,
      updatedBy: updatedBy?.displayName ?? null,
      reconciliation: reconciled.reconciliation,
      document: reconciled.document,
    };
  }

  async save(
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string,
    input: BoardLayoutSaveRequest,
    context: MutationContext,
  ): Promise<BoardLayoutResponse> {
    const result = await runSerializable(this.prisma, async (transaction) => {
      const { jobs, canEdit } = await this.assertReadableLine(
        transaction,
        scope,
        principal,
        lineId,
      );
      if (!canEdit) throw forbiddenEdit();
      await transaction.$queryRaw`SELECT id FROM "Line" WHERE id = ${lineId}::uuid AND "supplierId" = ${scope.supplierId}::uuid FOR UPDATE`;
      const current = await transaction.lineBoardLayout.findUnique({
        where: { lineId_supplierId: { lineId, supplierId: scope.supplierId } },
      });
      if (
        (!current && input.expectedVersion !== null) ||
        (current && input.expectedVersion !== current.version)
      ) {
        throw versionConflict();
      }
      const reconciled = reconcileDocument(input.document, jobs);
      const saved = current
        ? await transaction.lineBoardLayout.update({
            where: { id: current.id },
            data: {
              document: reconciled.document,
              schemaVersion: 1,
              version: { increment: 1 },
              updatedById: principal.userId,
            },
          })
        : await transaction.lineBoardLayout.create({
            data: {
              supplierId: scope.supplierId,
              lineId,
              document: reconciled.document,
              schemaVersion: 1,
              createdById: principal.userId,
              updatedById: principal.userId,
            },
          });
      const action = current ? 'BOARD_LAYOUT_UPDATED' : 'BOARD_LAYOUT_CREATED';
      const counts = nodeCounts(reconciled.document.nodes);
      await this.audit.write(
        {
          actorKind: 'USER',
          actorUserId: context.actorUserId,
          actorRole: context.actorRole,
          ...(context.actorSupplierId ? { actorSupplierId: context.actorSupplierId } : {}),
          supplierId: scope.supplierId,
          lineId,
          action,
          resourceType: 'LineBoardLayout',
          resourceId: saved.id,
          changeSummary: { lineId, schemaVersion: 1, ...counts },
          correlationId: context.correlationId,
          ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
          ...(context.userAgent ? { userAgent: context.userAgent } : {}),
          sourceMode: 'HOSTED',
        },
        transaction,
      );
      await this.outbox.enqueue(
        {
          eventType: 'BOARD_LAYOUT_UPDATED',
          aggregateType: 'LineBoardLayout',
          aggregateId: saved.id,
          aggregateVersion: saved.version,
          supplierId: scope.supplierId,
          actor: { userId: principal.userId, role: principal.role },
          correlationId: context.correlationId,
          payload: { lineId, layoutId: saved.id, version: saved.version },
        },
        transaction,
      );
      return { saved, reconciled };
    });
    return {
      id: result.saved.id,
      lineId,
      source: 'SAVED',
      version: result.saved.version,
      schemaVersion: 1,
      canEdit: true,
      updatedAt: result.saved.updatedAt.toISOString(),
      updatedBy: principal.displayName,
      reconciliation: result.reconciled.reconciliation,
      document: result.reconciled.document,
    };
  }

  private async assertReadableLine(
    client: PrismaService | Prisma.TransactionClient,
    scope: TenantScope,
    principal: RequestPrincipal,
    lineId: string,
  ): Promise<{ jobs: BoardJob[]; canEdit: boolean }> {
    const shift = await client.shiftRun.findFirst({
      where: {
        supplierId: scope.supplierId,
        lineId,
        status: 'ACTIVE',
        ...(principal.realm === 'TMMIN' || ['SUPPLIER_ADMIN', 'QC'].includes(principal.role)
          ? {}
          : principal.role === 'SUPERVISOR'
            ? { supervisorMemberId: principal.memberId ?? impossibleId }
            : { lineLeaderMemberId: principal.memberId ?? impossibleId }),
      },
      select: {
        lineLeaderMemberId: true,
        workingAssignments: {
          where: { active: true, includedInPlan: true },
          orderBy: [{ jobDisplayOrderSnapshot: 'asc' }, { id: 'asc' }],
          select: { jobId: true, jobDisplayOrderSnapshot: true },
        },
      },
    });
    if (!shift) throw notFound();
    const canEdit =
      principal.realm === 'SUPPLIER' &&
      principal.purpose === 'NORMAL' &&
      (principal.role === 'SUPPLIER_ADMIN' ||
        (principal.role === 'LINE_LEADER' && shift.lineLeaderMemberId === principal.memberId));
    return {
      jobs: shift.workingAssignments.map((job) => ({
        jobId: job.jobId,
        displayOrder: job.jobDisplayOrderSnapshot,
      })),
      canEdit,
    };
  }
}

const impossibleId = '00000000-0000-0000-0000-000000000000';

export function generatedDocument(jobs: BoardJob[]): BoardLayoutDocument {
  const cards = autoPlaceJobs(jobs, 10);
  const rows = Math.max(1, Math.ceil(jobs.length / 4));
  const height = Math.max(1_350, 200 + rows * 500);
  return boardLayoutDocumentSchema.parse({
    schemaVersion: 1,
    canvas: { width: 2_400, height, background: 'LIGHT_GRID' },
    nodes: cards,
  });
}

export function reconcileDocument(document: BoardLayoutDocument, jobs: BoardJob[]) {
  const required = new Set(jobs.map(({ jobId }) => jobId));
  const removedJobIds: string[] = [];
  const kept = document.nodes.filter((node) => {
    if (node.type !== 'JOB_SLOT' || required.has(node.jobId)) return true;
    removedJobIds.push(node.jobId);
    return false;
  });
  const present = new Set(
    kept
      .filter(
        (node): node is Extract<BoardLayoutNode, { type: 'JOB_SLOT' }> => node.type === 'JOB_SLOT',
      )
      .map(({ jobId }) => jobId),
  );
  const missing = jobs.filter(({ jobId }) => !present.has(jobId));
  const maxZ = kept.reduce((value, node) => Math.max(value, node.transform.zIndex), 0);
  const additions = autoPlaceJobs(missing, maxZ + 1, kept.length);
  const addedJobIds = missing.map(({ jobId }) => jobId);
  let width = document.canvas.width;
  let height = document.canvas.height;
  for (const node of additions) {
    width = Math.max(width, Math.ceil((node.transform.x + node.transform.width + 80) / 10) * 10);
    height = Math.max(height, Math.ceil((node.transform.y + node.transform.height + 80) / 10) * 10);
  }
  width = Math.min(12_000, Math.max(2_400, width));
  height = Math.min(8_000, Math.max(1_350, height));
  const reconciled = boardLayoutDocumentSchema.parse({
    ...document,
    canvas: { ...document.canvas, width, height },
    nodes: [...kept, ...additions],
  });
  return { document: reconciled, reconciliation: { addedJobIds, removedJobIds } };
}

function autoPlaceJobs(jobs: BoardJob[], zStart: number, offset = 0): BoardLayoutNode[] {
  return jobs.map((job, index) => {
    const position = index + offset;
    const column = position % 4;
    const row = Math.floor(position / 4);
    return {
      id: `job:${job.jobId}`,
      type: 'JOB_SLOT' as const,
      jobId: job.jobId,
      transform: {
        x: 100 + column * 570,
        y: 100 + row * 500,
        width: BOARD_JOB_CARD_DEFAULT_WIDTH,
        height: BOARD_JOB_CARD_DEFAULT_HEIGHT,
        rotation: 0,
        zIndex: zStart + index,
        locked: false,
      },
    };
  });
}

function nodeCounts(nodes: BoardLayoutNode[]) {
  return nodes.reduce<Record<string, number>>(
    (counts, node) => ({ ...counts, [node.type]: (counts[node.type] ?? 0) + 1 }),
    { nodeCount: nodes.length },
  );
}

function notFound(): ProblemException {
  return new ProblemException({
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
    title: 'Active line not found',
    detail: 'Canvas layout is available only for an active Shift Run in the current scope.',
  });
}

function forbiddenEdit(): ProblemException {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Board layout is read-only',
    detail: 'Only the active Line Leader or Supplier Admin may edit this line layout.',
  });
}
