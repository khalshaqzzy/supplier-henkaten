import { Injectable } from '@nestjs/common';

import type { HenkatenCategory } from '@tmmin-henkaten/contracts';

import type { Prisma } from '../generated/prisma/client.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { versionConflict } from '../administration/user-admin.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { masterAudit } from './master-data-audit.js';
import { presentChecklistDraft, presentChecklistVersion } from './master-data-presenters.js';

@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async draft(scope: TenantScope, category: HenkatenCategory) {
    const template = await this.ensureTemplate(scope.supplierId, category);
    return presentChecklistDraft(template);
  }

  async updateDraft(
    scope: TenantScope,
    category: HenkatenCategory,
    input: { expectedVersion?: number; items: Array<{ label: string }> },
    context: MutationContext,
  ) {
    const normalized = input.items.map(({ label }, index) => ({
      label: label.trim(),
      normalizedLabel: normalizeLookup(label),
      displayOrder: index + 1,
    }));
    if (
      new Set(normalized.map(({ normalizedLabel }) => normalizedLabel)).size !== normalized.length
    ) {
      throw validation('Checklist draft labels must be unique.');
    }
    const template = await this.prisma.$transaction(async (tx) => {
      const current = await this.ensureTemplate(scope.supplierId, category, tx);
      await tx.$queryRaw`SELECT id FROM "ChecklistTemplate" WHERE id = ${current.id}::uuid FOR UPDATE`;
      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw versionConflict();
      }
      await tx.checklistDraftItem.deleteMany({ where: { templateId: current.id } });
      if (normalized.length) {
        await tx.checklistDraftItem.createMany({
          data: normalized.map((item) => ({
            ...item,
            templateId: current.id,
            supplierId: scope.supplierId,
          })),
        });
      }
      const updated = await tx.checklistTemplate.update({
        where: { id: current.id },
        data: { version: { increment: 1 }, updatedById: context.actorUserId },
        include: { draftItems: { orderBy: { displayOrder: 'asc' } } },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          'CHECKLIST_DRAFT_UPDATED',
          'ChecklistTemplate',
          current.id,
          { category, itemCount: normalized.length },
        ),
        tx,
      );
      return updated;
    });
    return presentChecklistDraft(template);
  }

  async publish(
    scope: TenantScope,
    category: HenkatenCategory,
    expectedVersion: number,
    context: MutationContext,
  ) {
    const version = await this.prisma.$transaction(async (tx) => {
      const template = await this.ensureTemplate(scope.supplierId, category, tx);
      await tx.$queryRaw`SELECT id FROM "ChecklistTemplate" WHERE id = ${template.id}::uuid FOR UPDATE`;
      const locked = await tx.checklistTemplate.findUnique({
        where: { id: template.id },
        include: { draftItems: { orderBy: { displayOrder: 'asc' } } },
      });
      if (!locked) throw validation('Checklist template is unavailable.');
      if (locked.version !== expectedVersion) throw versionConflict();
      if (!locked.active) throw validation('Inactive checklist cannot be published.');
      if (!locked.draftItems.length) {
        throw new ProblemException({
          status: 409,
          code: 'CHECKLIST_NOT_PUBLISHED',
          title: 'Checklist cannot be published',
          detail: 'At least one checklist item is required.',
        });
      }
      const latest = await tx.checklistVersion.aggregate({
        where: { templateId: locked.id },
        _max: { versionNumber: true },
      });
      const created = await tx.checklistVersion.create({
        data: {
          templateId: locked.id,
          supplierId: scope.supplierId,
          category,
          versionNumber: (latest._max.versionNumber ?? 0) + 1,
          publishedById: context.actorUserId,
          items: {
            create: locked.draftItems.map(({ label, displayOrder }) => ({
              label,
              displayOrder,
            })),
          },
        },
        include: { items: { orderBy: { displayOrder: 'asc' } } },
      });
      await tx.checklistTemplate.update({
        where: { id: locked.id },
        data: { version: { increment: 1 }, updatedById: context.actorUserId },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          'CHECKLIST_VERSION_PUBLISHED',
          'ChecklistVersion',
          created.id,
          { category, versionNumber: created.versionNumber, itemCount: created.items.length },
        ),
        tx,
      );
      return created;
    });
    return presentChecklistVersion(version);
  }

  async versions(scope: TenantScope, category: HenkatenCategory) {
    const rows = await this.prisma.checklistVersion.findMany({
      where: { supplierId: scope.supplierId, category },
      include: { items: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { versionNumber: 'desc' },
    });
    return { items: rows.map(presentChecklistVersion) };
  }

  async setActive(
    scope: TenantScope,
    category: HenkatenCategory,
    expectedVersion: number,
    active: boolean,
    context: MutationContext,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const template = await this.ensureTemplate(scope.supplierId, category, tx);
      if (template.version !== expectedVersion) throw versionConflict();
      if (
        !active &&
        (await tx.shiftRun.count({
          where: { supplierId: scope.supplierId, status: 'ACTIVE' },
        }))
      ) {
        throw new ProblemException({
          status: 409,
          code: 'RESOURCE_IN_USE',
          title: 'Resource is in use',
          detail: 'Checklist configuration is required by an active Shift Run.',
        });
      }
      const row = await tx.checklistTemplate.update({
        where: { id: template.id },
        data: { active, version: { increment: 1 }, updatedById: context.actorUserId },
        include: { draftItems: { orderBy: { displayOrder: 'asc' } } },
      });
      await this.audit.write(
        masterAudit(
          context,
          scope.supplierId,
          active ? 'CHECKLIST_TEMPLATE_ACTIVATED' : 'CHECKLIST_TEMPLATE_DEACTIVATED',
          'ChecklistTemplate',
          template.id,
          { category },
        ),
        tx,
      );
      return row;
    });
    return presentChecklistDraft(updated);
  }

  private ensureTemplate(
    supplierId: string,
    category: HenkatenCategory,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return client.checklistTemplate.upsert({
      where: { supplierId_category: { supplierId, category } },
      create: { supplierId, category },
      update: {},
      include: { draftItems: { orderBy: { displayOrder: 'asc' } } },
    });
  }
}

function validation(detail: string): ProblemException {
  return new ProblemException({
    status: 400,
    code: 'VALIDATION_FAILED',
    title: 'Validation failed',
    detail,
  });
}
