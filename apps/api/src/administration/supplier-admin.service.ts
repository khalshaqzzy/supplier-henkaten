import { Injectable } from '@nestjs/common';

import type { Prisma, Supplier, User } from '../generated/prisma/client.js';
import type { CreateSupplierRequest } from '@tmmin-henkaten/contracts';

import { normalizeLookup } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { ProblemException } from '../common/problem.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { runSerializable } from '../persistence/transaction.js';
import type { MutationContext } from './mutation-context.js';
import { decodeCursor, encodeCursor, presentSupplier, presentUser } from './presenters.js';
import {
  auditInput,
  notFound,
  trimPasswordHistory,
  versionConflict,
} from './user-admin.service.js';

type SupplierAdminIdentity = { username: string; displayName: string };

@Injectable()
export class SupplierAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditWriter,
  ) {}

  async list(limit: number, cursor?: string) {
    const cursorId = decodeCursor(cursor);
    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    const hasNextPage = suppliers.length > limit;
    const items = hasNextPage ? suppliers.slice(0, limit) : suppliers;
    return {
      items: items.map(presentSupplier),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.at(-1) ? encodeCursor(items.at(-1)?.id as string) : null,
      },
    };
  }

  async get(id: string) {
    return presentSupplier(await this.requireSupplier(id));
  }

  async create(input: CreateSupplierRequest, context: MutationContext) {
    const credential =
      input.sourceMode === 'HOSTED' ? await this.prepareCredential(input.supplierAdmin) : undefined;
    const result = await this.prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.create({
        data: {
          code: input.code.trim(),
          normalizedCode: normalizeLookup(input.code),
          name: input.name.trim(),
          timezone: input.timezone.trim(),
          sourceMode: input.sourceMode,
          active: input.sourceMode === 'HOSTED',
          createdById: context.actorUserId,
        },
      });
      const admin =
        input.sourceMode === 'HOSTED' && credential
          ? await this.createSupplierAdmin(
              transaction,
              supplier,
              input.supplierAdmin,
              credential.passwordHash,
              context,
            )
          : undefined;
      await this.audit.write(
        {
          actorKind: 'USER',
          actorUserId: context.actorUserId,
          actorRole: context.actorRole,
          supplierId: supplier.id,
          action: 'SUPPLIER_CREATED',
          resourceType: 'Supplier',
          resourceId: supplier.id,
          changeSummary: { sourceMode: supplier.sourceMode, active: supplier.active },
          correlationId: context.correlationId,
          sourceMode: supplier.sourceMode,
          sourceEpoch: supplier.sourceEpoch,
        },
        transaction,
      );
      return { supplier, admin };
    });
    return {
      supplier: presentSupplier(result.supplier),
      ...(result.admin ? { supplierAdmin: presentUser(result.admin) } : {}),
      ...(result.admin && credential
        ? {
            credential: {
              username: result.admin.username,
              temporaryPassword: credential.temporaryPassword,
            },
          }
        : {}),
    };
  }

  async update(
    id: string,
    input: {
      expectedVersion: number;
      name?: string | undefined;
      timezone?: string | undefined;
    },
    context: MutationContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.findUnique({ where: { id } });
      if (!supplier) throw notFound('Supplier');
      if (supplier.version !== input.expectedVersion) throw versionConflict();
      const updated = await transaction.supplier.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.timezone ? { timezone: input.timezone.trim() } : {}),
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(supplierAudit(context, supplier, 'SUPPLIER_UPDATED'), transaction);
      return presentSupplier(updated);
    });
  }

  setActive(id: string, expectedVersion: number, active: boolean, context: MutationContext) {
    return this.prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.findUnique({ where: { id } });
      if (!supplier) throw notFound('Supplier');
      if (supplier.version !== expectedVersion) throw versionConflict();
      if (active && supplier.sourceMode === 'EXTERNAL') {
        const client = await transaction.externalApiClient.findFirst({
          where: {
            supplierId: id,
            sourceEpoch: supplier.sourceEpoch,
            status: 'ACTIVE',
            secrets: { some: { revokedAt: null } },
          },
        });
        if (!client) {
          throw new ProblemException({
            status: 409,
            code: 'STATE_CONFLICT',
            title: 'External supplier is not ready',
            detail: 'An active credential for the current source epoch is required.',
          });
        }
      }
      const updated = await transaction.supplier.update({
        where: { id },
        data: {
          active,
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await transaction.userSession.updateMany({
        where: { supplierId: id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: 'SUPPLIER_DEACTIVATED',
          version: { increment: 1 },
        },
      });
      await this.audit.write(
        supplierAudit(context, updated, active ? 'SUPPLIER_ACTIVATED' : 'SUPPLIER_DEACTIVATED'),
        transaction,
      );
      return presentSupplier(updated);
    });
  }

  async replaceAdmin(
    supplierId: string,
    input: { expectedVersion: number; username: string; displayName: string },
    context: MutationContext,
  ) {
    const credential = await this.prepareCredential(input);
    return runSerializable(this.prisma, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
      const supplier = await transaction.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      if (supplier.version !== input.expectedVersion) throw versionConflict();
      if (supplier.sourceMode !== 'HOSTED') throw sourceModeMismatch();
      const current = await transaction.user.findFirst({
        where: { supplierId, role: 'SUPPLIER_ADMIN', status: 'ACTIVE' },
      });
      if (current) {
        await transaction.user.update({
          where: { id: current.id },
          data: {
            status: 'INACTIVE',
            authorizationEpoch: { increment: 1 },
            version: { increment: 1 },
          },
        });
        await transaction.userSession.updateMany({
          where: { userId: current.id, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revocationReason: 'ADMIN_REPLACED',
            version: { increment: 1 },
          },
        });
      }
      const admin = await this.createSupplierAdmin(
        transaction,
        supplier,
        input,
        credential.passwordHash,
        context,
      );
      await transaction.supplier.update({
        where: { id: supplierId },
        data: { version: { increment: 1 }, updatedById: context.actorUserId },
      });
      await this.audit.write(
        auditInput(context, 'SUPPLIER_ADMIN_REPLACED', admin.id, {
          supplierId,
        }),
        transaction,
      );
      return {
        user: presentUser(admin),
        credential: {
          username: admin.username,
          temporaryPassword: credential.temporaryPassword,
        },
      };
    });
  }

  async resetAdmin(supplierId: string, expectedVersion: number, context: MutationContext) {
    const temporaryPassword = this.passwords.temporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    return this.prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      if (supplier.version !== expectedVersion) throw versionConflict();
      const admin = await transaction.user.findFirst({
        where: { supplierId, role: 'SUPPLIER_ADMIN', status: 'ACTIVE' },
      });
      if (!admin) throw notFound('Active Supplier Admin');
      const updated = await transaction.user.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordEpoch: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await transaction.passwordHistory.create({ data: { userId: admin.id, passwordHash } });
      await trimPasswordHistory(transaction, admin.id);
      await transaction.userSession.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: 'PASSWORD_RESET',
          version: { increment: 1 },
        },
      });
      await transaction.supplier.update({
        where: { id: supplierId },
        data: { version: { increment: 1 } },
      });
      await this.audit.write(
        auditInput(context, 'SUPPLIER_ADMIN_PASSWORD_RESET', admin.id),
        transaction,
      );
      return {
        user: presentUser(updated),
        credential: { username: updated.username, temporaryPassword },
      };
    });
  }

  async startPreparation(
    supplierId: string,
    input: {
      expectedVersion: number;
      reason: string;
      privacyAcknowledged: true;
      supplierAdmin: SupplierAdminIdentity;
    },
    context: MutationContext,
  ) {
    const credential = await this.prepareCredential(input.supplierAdmin);
    return runSerializable(this.prisma, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
      const supplier = await transaction.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      if (supplier.version !== input.expectedVersion) throw versionConflict();
      if (supplier.sourceMode !== 'EXTERNAL') throw sourceModeMismatch();
      const admin = await this.createSupplierAdmin(
        transaction,
        supplier,
        input.supplierAdmin,
        credential.passwordHash,
        context,
      );
      const preparation = await transaction.hostedPreparation.create({
        data: {
          supplierId,
          adminUserId: admin.id,
          sourceEpoch: supplier.sourceEpoch,
          reason: input.reason,
          privacyAcknowledgedAt: new Date(),
          startedById: context.actorUserId,
        },
      });
      await transaction.supplier.update({
        where: { id: supplierId },
        data: { active: true, version: { increment: 1 }, updatedById: context.actorUserId },
      });
      await this.audit.write(
        {
          ...supplierAudit(context, supplier, 'HOSTED_PREPARATION_STARTED'),
          reason: input.reason,
          changeSummary: { privacyAcknowledged: true },
        },
        transaction,
      );
      return {
        preparation: {
          id: preparation.id,
          supplierId,
          adminUserId: admin.id,
          sourceEpoch: preparation.sourceEpoch,
          status: preparation.status,
          reason: preparation.reason,
          privacyAcknowledgedAt: preparation.privacyAcknowledgedAt.toISOString(),
          startedAt: preparation.startedAt.toISOString(),
          version: preparation.version,
        },
        user: presentUser(admin),
        credential: {
          username: admin.username,
          temporaryPassword: credential.temporaryPassword,
        },
      };
    });
  }

  async cancelPreparation(
    supplierId: string,
    expectedVersion: number,
    reason: string,
    context: MutationContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      if (supplier.version !== expectedVersion) throw versionConflict();
      const preparation = await transaction.hostedPreparation.findFirst({
        where: { supplierId, status: 'ACTIVE' },
      });
      if (!preparation) throw notFound('Active Hosted Preparation');
      await transaction.hostedPreparation.update({
        where: { id: preparation.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: context.actorUserId,
          version: { increment: 1 },
        },
      });
      await transaction.user.update({
        where: { id: preparation.adminUserId },
        data: {
          status: 'INACTIVE',
          authorizationEpoch: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await transaction.userSession.updateMany({
        where: { userId: preparation.adminUserId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: 'PREPARATION_CANCELLED',
          version: { increment: 1 },
        },
      });
      const updated = await transaction.supplier.update({
        where: { id: supplierId },
        data: {
          active: false,
          version: { increment: 1 },
          updatedById: context.actorUserId,
        },
      });
      await this.audit.write(
        { ...supplierAudit(context, supplier, 'HOSTED_PREPARATION_CANCELLED'), reason },
        transaction,
      );
      return presentSupplier(updated);
    });
  }

  private async prepareCredential(_identity: SupplierAdminIdentity) {
    const temporaryPassword = this.passwords.temporaryPassword();
    return {
      temporaryPassword,
      passwordHash: await this.passwords.hash(temporaryPassword),
    };
  }

  private async createSupplierAdmin(
    transaction: Prisma.TransactionClient,
    supplier: Supplier,
    identity: SupplierAdminIdentity,
    passwordHash: string,
    context: MutationContext,
  ): Promise<User> {
    const admin = await transaction.user.create({
      data: {
        realm: 'SUPPLIER',
        supplierId: supplier.id,
        role: 'SUPPLIER_ADMIN',
        username: identity.username.trim(),
        normalizedUsername: normalizeLookup(identity.username),
        displayName: identity.displayName.trim(),
        passwordHash,
        createdById: context.actorUserId,
      },
    });
    await transaction.passwordHistory.create({ data: { userId: admin.id, passwordHash } });
    return admin;
  }

  private async requireSupplier(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Supplier');
    return supplier;
  }
}

function supplierAudit(context: MutationContext, supplier: Supplier, action: string) {
  return {
    actorKind: 'USER' as const,
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    supplierId: supplier.id,
    action,
    resourceType: 'Supplier',
    resourceId: supplier.id,
    correlationId: context.correlationId,
    sourceMode: supplier.sourceMode,
    sourceEpoch: supplier.sourceEpoch,
  };
}

function sourceModeMismatch(): ProblemException {
  return new ProblemException({
    status: 409,
    code: 'SOURCE_MODE_MISMATCH',
    title: 'Source mode mismatch',
    detail: 'The operation is not allowed for the supplier source mode.',
  });
}
