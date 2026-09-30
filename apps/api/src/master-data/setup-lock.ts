import type { Prisma } from '../generated/prisma/client.js';

export async function lockSetupMutation(tx: Prisma.TransactionClient, supplierId: string) {
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId}::uuid FOR UPDATE`;
  await tx.supplier.update({
    where: { id: supplierId },
    data: { setupRevision: { increment: 1 } },
  });
}
