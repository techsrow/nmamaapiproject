-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShippingProvider" ADD VALUE 'BlueDart';
ALTER TYPE "ShippingProvider" ADD VALUE 'Xpressbees';
ALTER TYPE "ShippingProvider" ADD VALUE 'EcomExpress';
ALTER TYPE "ShippingProvider" ADD VALUE 'DTDC';
ALTER TYPE "ShippingProvider" ADD VALUE 'IndiaPost';
ALTER TYPE "ShippingProvider" ADD VALUE 'Local';
ALTER TYPE "ShippingProvider" ADD VALUE 'Custom';

-- CreateTable
CREATE TABLE "ShippingProviderConfig" (
    "id" SERIAL NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "displayName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'TEST',
    "encryptedCredentials" TEXT,
    "publicConfig" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupLocation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pincode" TEXT NOT NULL,
    "providerCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "courierName" TEXT,
    "courierCode" TEXT,
    "providerOrderId" TEXT,
    "providerShipmentId" TEXT,
    "awb" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'Draft',
    "pickupLocationId" INTEGER,
    "weightKg" DECIMAL(10,3),
    "lengthCm" DECIMAL(10,2),
    "widthCm" DECIMAL(10,2),
    "heightCm" DECIMAL(10,2),
    "shippingCost" DECIMAL(18,2),
    "codAmount" DECIMAL(18,2),
    "labelUrl" TEXT,
    "manifestUrl" TEXT,
    "trackingUrl" TEXT,
    "estimatedDelivery" TIMESTAMP(3),
    "pickupScheduledAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "providerMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentTrackingEvent" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "activity" TEXT,
    "location" TEXT,
    "eventTime" TIMESTAMP(3),
    "providerCode" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRule" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "zoneId" INTEGER,
    "methodName" TEXT NOT NULL,
    "rateType" TEXT NOT NULL DEFAULT 'FLAT',
    "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freeAbove" DECIMAL(18,2),
    "codFee" DECIMAL(18,2),
    "minOrderValue" DECIMAL(18,2),
    "maxOrderValue" DECIMAL(18,2),
    "minWeightKg" DECIMAL(10,3),
    "maxWeightKg" DECIMAL(10,3),
    "pincodes" JSONB,
    "estimatedMinDays" INTEGER,
    "estimatedMaxDays" INTEGER,
    "codAllowed" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NdrAction" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "requestedById" INTEGER,
    "providerMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NdrAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingProviderConfig_provider_key" ON "ShippingProviderConfig"("provider");

-- CreateIndex
CREATE INDEX "PickupLocation_pincode_isActive_idx" ON "PickupLocation"("pincode", "isActive");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_awb_idx" ON "Shipment"("awb");

-- CreateIndex
CREATE INDEX "Shipment_provider_status_idx" ON "Shipment"("provider", "status");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentId_idx" ON "ShipmentItem"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_shipmentId_createdAt_idx" ON "ShipmentTrackingEvent"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingRule_isActive_priority_idx" ON "ShippingRule"("isActive", "priority");

-- CreateIndex
CREATE INDEX "NdrAction_shipmentId_createdAt_idx" ON "NdrAction"("shipmentId", "createdAt");
