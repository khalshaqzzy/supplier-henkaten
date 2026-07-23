import type { Supplier, User } from '../generated/prisma/client.js';

export function presentUser(user: User) {
  return {
    id: user.id,
    supplierId: user.supplierId,
    role: user.role,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    protectedBootstrapAdmin: user.protectedBootstrapAdmin,
    version: user.version,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function presentSupplier(supplier: Supplier) {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    timezone: supplier.timezone,
    sourceMode: supplier.sourceMode,
    sourceEpoch: supplier.sourceEpoch,
    active: supplier.active,
    version: supplier.version,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function decodeCursor(value?: string): string | undefined {
  return value ? Buffer.from(value, 'base64url').toString('utf8') : undefined;
}
