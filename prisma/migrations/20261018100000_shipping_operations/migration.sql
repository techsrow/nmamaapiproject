CREATE TABLE "ShippingJob" ("id" SERIAL PRIMARY KEY,"key" TEXT NOT NULL UNIQUE,"kind" TEXT NOT NULL,"orderId" INTEGER NOT NULL,"shipmentId" INTEGER,"state" TEXT NOT NULL DEFAULT 'QUEUED',"attempts" INTEGER NOT NULL DEFAULT 0,"runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"leaseUntil" TIMESTAMP(3),"leaseToken" TEXT,"payload" JSONB NOT NULL,"lastError" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "ShippingJob_state_runAfter_idx" ON "ShippingJob"("state","runAfter");
CREATE INDEX "ShippingJob_orderId_idx" ON "ShippingJob"("orderId");
CREATE TABLE "ShippingAudit" ("id" SERIAL PRIMARY KEY,"orderId" INTEGER,"shipmentId" INTEGER,"jobId" INTEGER,"actorId" INTEGER,"action" TEXT NOT NULL,"detail" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "ShippingAudit_orderId_createdAt_idx" ON "ShippingAudit"("orderId","createdAt");
CREATE INDEX "ShippingAudit_shipmentId_createdAt_idx" ON "ShippingAudit"("shipmentId","createdAt");
