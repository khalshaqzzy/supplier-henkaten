import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from './prisma.service.js';

export async function runSerializable<T>(
  prisma: PrismaService,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === 3) throw error;
      const delay = 10 * attempt + Math.floor(Math.random() * 15);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? error.code : undefined;
  const databaseCode =
    'meta' in error && typeof error.meta === 'object' && error.meta !== null && 'code' in error.meta
      ? error.meta.code
      : undefined;
  const driverCode =
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'driverAdapterError' in error.meta &&
    typeof error.meta.driverAdapterError === 'object' &&
    error.meta.driverAdapterError !== null &&
    'cause' in error.meta.driverAdapterError &&
    typeof error.meta.driverAdapterError.cause === 'object' &&
    error.meta.driverAdapterError.cause !== null &&
    'originalCode' in error.meta.driverAdapterError.cause
      ? error.meta.driverAdapterError.cause.originalCode
      : undefined;
  return (
    code === 'P2034' ||
    code === '40001' ||
    code === '40P01' ||
    (code === 'P2010' &&
      (databaseCode === '40001' ||
        databaseCode === '40P01' ||
        driverCode === '40001' ||
        driverCode === '40P01'))
  );
}
