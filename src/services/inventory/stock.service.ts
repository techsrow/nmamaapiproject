import { Prisma, InventoryMovementType } from '@prisma/client';

// ProductVariant.stockQuantity is the single sellable balance across all channels.
// Warehouses allocate that balance. No writer may replace it with a stale sum.
export async function stockContext(tx: Prisma.TransactionClient, input: {
  type: InventoryMovementType; referenceType: string; referenceId?: string;
  userId?: number; warehouseId?: number; note?: string;
}) {
  await tx.$queryRaw`SELECT set_config('namama.stock_context', ${JSON.stringify(input)}, true)`;
}
export async function clearStockContext(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT set_config('namama.stock_context', '', true)`;
}
export async function changeStock(tx: Prisma.TransactionClient, input: {
  variantId: number; delta: number; warehouseId?: number; type: InventoryMovementType;
  referenceType: string; referenceId?: string; userId?: number; note?: string;
}) {
  if (!Number.isSafeInteger(input.delta) || input.delta === 0) throw new Error('Stock change must be a nonzero integer.');
  await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${input.variantId} FOR UPDATE`;
  const before = await tx.productVariant.findUnique({ where: { id: input.variantId } });
  if (!before) throw new Error('Variant not found.');
  if (before.stockQuantity + input.delta < 0) throw new Error('Insufficient available stock.');
  await stockContext(tx, input);
  // The database trigger allocates warehouses and records the ledger atomically,
  // including legacy product imports / checkout writers that use this column.
  const after = await tx.productVariant.update({ where: { id: input.variantId }, data: { stockQuantity: { increment: input.delta } } });
  await clearStockContext(tx);
  return { variantId: input.variantId, warehouseId: input.warehouseId, before: before.stockQuantity, after: after.stockQuantity, delta: input.delta, quantity: Math.abs(input.delta), type: input.type };
}
