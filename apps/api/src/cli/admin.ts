import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { normalizeLookup } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';

type Command = 'bootstrap' | 'recover';

async function run(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ENOENT')) throw error;
  }
  const command = process.argv[2] as Command | undefined;
  if (command !== 'bootstrap' && command !== 'recover') {
    throw new Error('Usage: admin <bootstrap|recover>');
  }
  const username = requireEnvironment('TMMIN_BOOTSTRAP_USERNAME');
  const displayName = requireEnvironment('TMMIN_BOOTSTRAP_DISPLAY_NAME');
  const password = requireEnvironment('TMMIN_BOOTSTRAP_PASSWORD');
  if (password.length < 12 || password.length > 128) {
    throw new Error('TMMIN_BOOTSTRAP_PASSWORD must contain 12-128 characters.');
  }

  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const prisma = application.get(PrismaService);
    const passwords = application.get(PasswordService);
    const audit = application.get(AuditWriter);
    const normalizedUsername = normalizeLookup(username);
    const existing = await prisma.user.findFirst({
      where: {
        realm: 'TMMIN',
        role: 'TMMIN_ADMIN',
        protectedBootstrapAdmin: true,
      },
    });

    if (command === 'bootstrap' && existing) {
      process.stdout.write('Protected bootstrap administrator already exists; no changes made.\n');
      return;
    }
    const passwordHash = await passwords.hash(password);
    await prisma.$transaction(async (transaction) => {
      if (command === 'bootstrap') {
        const user = await transaction.user.create({
          data: {
            realm: 'TMMIN',
            role: 'TMMIN_ADMIN',
            username,
            normalizedUsername,
            displayName,
            passwordHash,
            protectedBootstrapAdmin: true,
          },
        });
        await transaction.passwordHistory.create({
          data: { userId: user.id, passwordHash },
        });
        await audit.write(
          {
            actorKind: 'SYSTEM',
            action: 'BOOTSTRAP_ADMIN_CREATED',
            resourceType: 'User',
            resourceId: user.id,
            correlationId: randomUUID(),
          },
          transaction,
        );
        return;
      }

      if (!existing) throw new Error('Protected bootstrap administrator does not exist.');
      await transaction.user.update({
        where: { id: existing.id },
        data: {
          username,
          normalizedUsername,
          displayName,
          passwordHash,
          mustChangePassword: true,
          passwordEpoch: { increment: 1 },
          authorizationEpoch: { increment: 1 },
          status: 'ACTIVE',
          version: { increment: 1 },
        },
      });
      await transaction.passwordHistory.create({
        data: { userId: existing.id, passwordHash },
      });
      await transaction.userSession.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: 'OPERATOR_RECOVERY',
          version: { increment: 1 },
        },
      });
      await audit.write(
        {
          actorKind: 'SYSTEM',
          action: 'BOOTSTRAP_ADMIN_RECOVERED',
          resourceType: 'User',
          resourceId: existing.id,
          correlationId: randomUUID(),
        },
        transaction,
      );
    });
    process.stdout.write(`Protected bootstrap administrator ${command} completed.\n`);
  } finally {
    await application.close();
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown operator command failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
