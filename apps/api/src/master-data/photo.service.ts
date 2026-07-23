import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';

import { ProblemException } from '../common/problem.js';
import { TenantScope } from '../common/scope.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { masterAudit } from './master-data-audit.js';
import { missing } from './member.service.js';

type Variant = 'full' | 'thumbnail';

@Injectable()
export class PhotoService implements OnModuleInit {
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.root = resolve(config.photoStorageRoot);
  }

  onModuleInit(): void {
    this.outbox.register('MEMBER_PHOTO_CLEANUP_REQUESTED', async (event) => {
      const payload = event.payload as { photoId?: string };
      if (!payload.photoId) throw new Error('InvalidPhotoCleanupPayload');
      await this.cleanup(payload.photoId);
    });
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await stat(this.root);
    await access(this.root, constants.W_OK);
  }

  async upload(
    scope: TenantScope,
    memberId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    context: MutationContext,
  ) {
    if (file.size > 2 * 1024 * 1024) throw invalidImage('Photo exceeds 2 MiB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw invalidImage('Photo MIME type is not supported.');
    }
    let metadata;
    try {
      metadata = await sharp(file.buffer, {
        failOn: 'error',
        limitInputPixels: 25_000_000,
        animated: false,
        pages: 1,
      }).metadata();
    } catch {
      throw invalidImage('Photo is malformed or unsafe.');
    }
    const expectedMime =
      metadata.format === 'jpeg'
        ? 'image/jpeg'
        : metadata.format === 'png'
          ? 'image/png'
          : metadata.format === 'webp'
            ? 'image/webp'
            : undefined;
    if (!expectedMime || expectedMime !== file.mimetype || (metadata.pages ?? 1) !== 1) {
      throw invalidImage('Photo signature does not match the declared format.');
    }

    await this.ensureReady();
    const photoId = randomUUID();
    const directory = this.safePath(scope.supplierId, memberId, photoId);
    const temporary = join(directory, '.temporary');
    const finalDirectory = join(directory, 'current');
    await mkdir(temporary, { recursive: true });
    try {
      const [full, thumbnail] = await Promise.all([
        sharp(file.buffer)
          .rotate()
          .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true }),
        sharp(file.buffer)
          .rotate()
          .resize({ width: 256, height: 256, fit: 'cover', position: 'centre' })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true }),
      ]);
      await Promise.all([
        writeFile(join(temporary, 'full.webp'), full.data, { flag: 'wx' }),
        writeFile(join(temporary, 'thumbnail.webp'), thumbnail.data, { flag: 'wx' }),
      ]);
      await rename(temporary, finalDirectory);
      const fullPath = join(finalDirectory, 'full.webp');
      const thumbnailPath = join(finalDirectory, 'thumbnail.webp');
      await this.prisma.$transaction(async (tx) => {
        const member = await tx.member.findFirst({
          where: { id: memberId, supplierId: scope.supplierId, active: true },
        });
        if (!member) throw missing('Active member');
        const old = await tx.memberPhoto.findFirst({
          where: { memberId, supplierId: scope.supplierId, state: 'CURRENT' },
        });
        if (old) {
          await tx.memberPhoto.update({
            where: { id: old.id },
            data: { state: 'PENDING_DELETE', supersededAt: new Date(), version: { increment: 1 } },
          });
          await this.enqueueCleanup(tx, old.id, old.version + 1, scope, context);
        }
        await tx.memberPhoto.create({
          data: {
            id: photoId,
            supplierId: scope.supplierId,
            memberId,
            fullPath,
            thumbnailPath,
            fullChecksum: sha256(full.data),
            thumbnailChecksum: sha256(thumbnail.data),
            fullWidth: full.info.width,
            fullHeight: full.info.height,
            thumbnailWidth: thumbnail.info.width,
            thumbnailHeight: thumbnail.info.height,
            createdById: context.actorUserId,
          },
        });
        await this.audit.write(
          masterAudit(context, scope.supplierId, 'MEMBER_PHOTO_REPLACED', 'Member', memberId, {
            photoId,
            replaced: Boolean(old),
          }),
          tx,
        );
      });
      return { photoId };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async remove(
    scope: TenantScope,
    memberId: string,
    expectedVersion: number,
    context: MutationContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const photo = await tx.memberPhoto.findFirst({
        where: { memberId, supplierId: scope.supplierId, state: 'CURRENT' },
      });
      if (!photo) throw missing('Current member photo');
      if (photo.version !== expectedVersion) {
        throw new ProblemException({
          status: 409,
          code: 'VERSION_CONFLICT',
          title: 'Version conflict',
          detail: 'The photo was changed by another operation.',
        });
      }
      await tx.memberPhoto.update({
        where: { id: photo.id },
        data: { state: 'PENDING_DELETE', supersededAt: new Date(), version: { increment: 1 } },
      });
      await this.enqueueCleanup(tx, photo.id, photo.version + 1, scope, context);
      await this.audit.write(
        masterAudit(context, scope.supplierId, 'MEMBER_PHOTO_REMOVED', 'Member', memberId),
        tx,
      );
    });
  }

  async asset(scope: TenantScope, memberId: string, variant: Variant) {
    const photo = await this.prisma.memberPhoto.findFirst({
      where: { memberId, supplierId: scope.supplierId, state: 'CURRENT' },
    });
    if (!photo) throw missing('Member photo');
    return {
      path: this.assertContained(variant === 'full' ? photo.fullPath : photo.thumbnailPath),
      checksum: variant === 'full' ? photo.fullChecksum : photo.thumbnailChecksum,
    };
  }

  private async enqueueCleanup(
    tx: Parameters<OutboxService['enqueue']>[1],
    photoId: string,
    version: number,
    scope: TenantScope,
    context: MutationContext,
  ) {
    await this.outbox.enqueue(
      {
        eventType: 'MEMBER_PHOTO_CLEANUP_REQUESTED',
        aggregateType: 'MemberPhoto',
        aggregateId: photoId,
        aggregateVersion: version,
        supplierId: scope.supplierId,
        actor: { userId: context.actorUserId, role: context.actorRole },
        correlationId: context.correlationId,
        payload: { photoId },
      },
      tx,
    );
  }

  private async cleanup(photoId: string): Promise<void> {
    const photo = await this.prisma.memberPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.state === 'DELETED') return;
    if (photo.state !== 'PENDING_DELETE') throw new Error('PhotoNotPendingDelete');
    for (const path of [photo.fullPath, photo.thumbnailPath]) {
      try {
        await unlink(this.assertContained(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await this.prisma.memberPhoto.update({
      where: { id: photo.id },
      data: { state: 'DELETED', deletedAt: new Date(), version: { increment: 1 } },
    });
  }

  private safePath(...segments: string[]): string {
    return this.assertContained(join(this.root, ...segments));
  }

  private assertContained(path: string): string {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    const relation = relative(this.root, absolute);
    if (relation.startsWith('..') || isAbsolute(relation)) throw new Error('UnsafePhotoPath');
    return absolute;
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalidImage(detail: string): ProblemException {
  return new ProblemException({
    status: 400,
    code: 'INVALID_IMAGE',
    title: 'Invalid image',
    detail,
  });
}
