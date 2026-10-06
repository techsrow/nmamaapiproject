-- Modules 3-5 completion: featured products + inventory audit trail.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Product_isFeatured_isActive_idx" ON "Product"("isFeatured", "isActive");

DO $$ BEGIN CREATE TYPE "InventoryMovementType" AS ENUM ('ADJUSTMENT','SALE','RETURN','TRANSFER_OUT','TRANSFER_IN','PURCHASE_RECEIPT','RESERVATION','RELEASE','PREORDER','BACKORDER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS "InventoryMovement" (
  "id" SERIAL NOT NULL,
  "variantId" INTEGER NOT NULL,
  "warehouseId" INTEGER,
  "type" "InventoryMovementType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "beforeQty" INTEGER NOT NULL,
  "afterQty" INTEGER NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "note" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InventoryMovement_variantId_createdAt_idx" ON "InventoryMovement"("variantId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryMovement_warehouseId_createdAt_idx" ON "InventoryMovement"("warehouseId", "createdAt");
