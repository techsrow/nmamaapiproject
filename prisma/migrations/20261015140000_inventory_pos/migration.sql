-- No deletion of duplicate barcodes: this migration deliberately fails if they exist.
CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");
ALTER TABLE "Order" ADD COLUMN "salesChannel" TEXT NOT NULL DEFAULT 'WEB';
CREATE TABLE "PosSession" (
 "id" SERIAL PRIMARY KEY, "cashierId" INTEGER NOT NULL REFERENCES "User"("id"),
 "warehouseId" INTEGER NOT NULL REFERENCES "Warehouse"("id"),
 "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" TIMESTAMP(3),
 "openingCash" DECIMAL(18,2) NOT NULL, "closingCash" DECIMAL(18,2), "note" TEXT
);
CREATE UNIQUE INDEX "PosSession_open_cashier" ON "PosSession"("cashierId") WHERE "closedAt" IS NULL;
CREATE TABLE "PosSale" (
 "id" SERIAL PRIMARY KEY, "orderId" INTEGER NOT NULL UNIQUE REFERENCES "Order"("id"),
 "sessionId" INTEGER NOT NULL REFERENCES "PosSession"("id"), "cashierId" INTEGER NOT NULL REFERENCES "User"("id"),
 "requestKey" TEXT NOT NULL UNIQUE, "fingerprint" TEXT NOT NULL, "tenders" JSONB NOT NULL,
 "sellerSnapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PosSale_sessionId_createdAt_idx" ON "PosSale"("sessionId", "createdAt");
CREATE TABLE "PosReturn" (
 "sessionId" INTEGER NOT NULL REFERENCES "PosSession"("id"),
 "id" SERIAL PRIMARY KEY, "saleId" INTEGER NOT NULL REFERENCES "PosSale"("id"), "cashierId" INTEGER NOT NULL REFERENCES "User"("id"),
 "requestKey" TEXT NOT NULL UNIQUE, "fingerprint" TEXT NOT NULL, "items" JSONB NOT NULL,
 "amount" DECIMAL(18,2) NOT NULL, "method" TEXT NOT NULL, "reference" TEXT, "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PosReturn_saleId_idx" ON "PosReturn"("saleId");

-- Single database-level writer: web reservations, POS and existing imports all
-- update ProductVariant.stockQuantity; trigger keeps allocations and ledger aligned.
CREATE OR REPLACE FUNCTION namama_sync_stock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
 d integer; remaining integer; available integer; take_qty integer; total integer;
 ctx jsonb; target integer; row_inv record; wid integer; before_q integer;
BEGIN
 IF NEW."stockQuantity" < 0 THEN RAISE EXCEPTION 'Stock cannot be negative'; END IF;
 IF TG_OP = 'INSERT' THEN d := NEW."stockQuantity"; ELSE d := NEW."stockQuantity" - OLD."stockQuantity"; END IF;
 IF d = 0 THEN RETURN NEW; END IF;
 ctx := COALESCE(NULLIF(current_setting('namama.stock_context', true), ''), '{}')::jsonb;
 target := NULLIF(ctx->>'warehouseId','')::integer;
 IF target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Warehouse" WHERE id=target AND ("isActive" OR ctx->>'type'='RELEASE')) THEN RAISE EXCEPTION 'Active warehouse required'; END IF;
 -- Existing reservation columns must be reconciled before enabling the new model.
 IF EXISTS(SELECT 1 FROM "WarehouseInventory" WHERE "variantId"=NEW.id AND reserved<>0) THEN RAISE EXCEPTION 'Legacy warehouse reservations require reconciliation'; END IF;
 SELECT COALESCE(sum(quantity),0) INTO total FROM "WarehouseInventory" WHERE "variantId"=NEW.id;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM "WarehouseInventory" WHERE "variantId"=NEW.id) AND total<>OLD."stockQuantity" THEN
  RAISE EXCEPTION 'Warehouse/global stock mismatch for variant %. Reconcile allocations before selling.',NEW.id;
 END IF;
 -- Missing allocations are adopted into an explicit unallocated-stock warehouse.
 INSERT INTO "Warehouse"(name,code,"isActive") VALUES('Unallocated stock','SYSTEM-UNALLOCATED',true) ON CONFLICT(code) DO NOTHING;
 SELECT id INTO wid FROM "Warehouse" WHERE code='SYSTEM-UNALLOCATED';
 IF TG_OP='UPDATE' AND NOT EXISTS(SELECT 1 FROM "WarehouseInventory" WHERE "variantId"=NEW.id) THEN
  INSERT INTO "WarehouseInventory"("warehouseId","variantId",quantity,reserved) VALUES(wid,NEW.id,OLD."stockQuantity",0);
 END IF;
 IF d > 0 THEN
  wid := COALESCE(target,wid);
  INSERT INTO "WarehouseInventory"("warehouseId","variantId",quantity,reserved) VALUES(wid,NEW.id,0,0) ON CONFLICT DO NOTHING;
  SELECT quantity INTO before_q FROM "WarehouseInventory" WHERE "warehouseId"=wid AND "variantId"=NEW.id FOR UPDATE;
  UPDATE "WarehouseInventory" SET quantity=quantity+d WHERE "warehouseId"=wid AND "variantId"=NEW.id;
  INSERT INTO "InventoryMovement"("variantId","warehouseId",type,quantity,"beforeQty","afterQty","referenceType","referenceId",note,"createdById","createdAt")
  VALUES(NEW.id,wid,COALESCE(ctx->>'type','ADJUSTMENT')::"InventoryMovementType",d,before_q,before_q+d,COALESCE(ctx->>'referenceType','STOCK_WRITE'),ctx->>'referenceId',ctx->>'note',NULLIF(ctx->>'userId','')::integer,CURRENT_TIMESTAMP);
 ELSE
  remaining := -d;
  FOR row_inv IN SELECT wi.* FROM "WarehouseInventory" wi JOIN "Warehouse" w ON w.id=wi."warehouseId"
   WHERE wi."variantId"=NEW.id AND (target IS NULL OR wi."warehouseId"=target) AND w."isActive"
   ORDER BY wi."warehouseId" FOR UPDATE OF wi LOOP
   take_qty := LEAST(remaining,row_inv.quantity);
   IF take_qty<=0 THEN CONTINUE; END IF;
   UPDATE "WarehouseInventory" SET quantity=quantity-take_qty WHERE "warehouseId"=row_inv."warehouseId" AND "variantId"=NEW.id;
   INSERT INTO "InventoryMovement"("variantId","warehouseId",type,quantity,"beforeQty","afterQty","referenceType","referenceId",note,"createdById","createdAt")
   VALUES(NEW.id,row_inv."warehouseId",COALESCE(ctx->>'type','ADJUSTMENT')::"InventoryMovementType",take_qty,row_inv.quantity,row_inv.quantity-take_qty,COALESCE(ctx->>'referenceType','STOCK_WRITE'),ctx->>'referenceId',ctx->>'note',NULLIF(ctx->>'userId','')::integer,CURRENT_TIMESTAMP);
   remaining := remaining-take_qty;
   EXIT WHEN remaining=0;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Insufficient available stock in active warehouse'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "namama_stock_sync" AFTER INSERT OR UPDATE OF "stockQuantity" ON "ProductVariant" FOR EACH ROW EXECUTE FUNCTION namama_sync_stock();

CREATE UNIQUE INDEX "Payment_pos_external_reference" ON "Payment"("providerPaymentId")
 WHERE provider='Manual' AND "providerPaymentId" IS NOT NULL AND "providerMeta"->>'source'='POS';
