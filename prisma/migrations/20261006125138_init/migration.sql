/*
  Warnings:

  - The values [PURCHASE_RECEIPT,PREORDER,BACKORDER] on the enum `InventoryMovementType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `productId` on the `CartItem` table. All the data in the column will be lost.
  - The `status` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `paymentMethod` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `paymentStatus` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `provider` column on the `Payment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `paymentMethod` column on the `Payment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `role` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[invoiceNumber]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[emailVerifyToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[resetPasswordToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `productName` to the `OrderItem` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `paymentStatus` on the `Payment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `slug` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Customer', 'Admin');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('Pending', 'Confirmed', 'Processing', 'PartiallyFulfilled', 'Fulfilled', 'Shipped', 'Delivered', 'Cancelled', 'Returned');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('Pending', 'Created', 'PartiallyPaid', 'Paid', 'Failed', 'PartiallyRefunded', 'Refunded');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('Razorpay', 'COD', 'BankTransfer', 'Manual');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'UPI', 'NETBANKING', 'WALLET', 'COD', 'Prepaid', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "ShippingProvider" AS ENUM ('Shiprocket', 'Delhivery', 'Manual');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('NotCreated', 'Created', 'Picked', 'InTransit', 'OutForDelivery', 'Delivered', 'RTO', 'Cancelled', 'Failed');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('Pending', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'PDF', 'OTHER');

-- CreateEnum
CREATE TYPE "SliderDevice" AS ENUM ('DESKTOP', 'MOBILE');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('RETURN', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'REFUNDED', 'EXCHANGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENT', 'FIXED', 'BOGO', 'BUNDLE', 'QUANTITY', 'FLASH', 'CUSTOMER_PRICE', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterEnum
BEGIN;
CREATE TYPE "InventoryMovementType_new" AS ENUM ('IN', 'OUT', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT');
ALTER TABLE "InventoryMovement" ALTER COLUMN "type" TYPE "InventoryMovementType_new" USING ("type"::text::"InventoryMovementType_new");
ALTER TYPE "InventoryMovementType" RENAME TO "InventoryMovementType_old";
ALTER TYPE "InventoryMovementType_new" RENAME TO "InventoryMovementType";
DROP TYPE "public"."InventoryMovementType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_productId_fkey";

-- DropIndex
DROP INDEX "Product_isFeatured_isActive_idx";

-- AlterTable
ALTER TABLE "Brand" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CartItem" DROP COLUMN "productId";

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Collection" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "awbNumber" TEXT,
ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponDiscount" DECIMAL(18,2),
ADD COLUMN     "couponId" INTEGER,
ADD COLUMN     "customerGstin" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryOption" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "expressCheckout" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "giftMessage" TEXT,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "invoiceIssuedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "orderNotes" TEXT,
ADD COLUMN     "paymentDue" DECIMAL(18,2),
ADD COLUMN     "refundedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shipmentId" TEXT,
ADD COLUMN     "shipmentStatus" "ShipmentStatus" NOT NULL DEFAULT 'NotCreated',
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "shippingAddressJson" JSONB,
ADD COLUMN     "shippingFee" DECIMAL(18,2),
ADD COLUMN     "shippingMeta" JSONB,
ADD COLUMN     "shippingProvider" "ShippingProvider",
ADD COLUMN     "subtotal" DECIMAL(18,2),
ADD COLUMN     "taxAmount" DECIMAL(18,2),
ADD COLUMN     "taxBreakdown" JSONB,
ADD COLUMN     "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trackingCode" TEXT,
ADD COLUMN     "trackingUrl" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "OrderStatus" NOT NULL DEFAULT 'Pending',
DROP COLUMN "paymentMethod",
ADD COLUMN     "paymentMethod" "PaymentMethod",
DROP COLUMN "paymentStatus",
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'Pending';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "productName" TEXT NOT NULL,
ADD COLUMN     "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "variantLabel" TEXT;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "provider",
ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'Razorpay',
DROP COLUMN "paymentStatus",
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL,
DROP COLUMN "paymentMethod",
ADD COLUMN     "paymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "hsnSac" TEXT,
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "metaKeywords" TEXT,
ADD COLUMN     "metaTitle" TEXT,
ADD COLUMN     "ogImageUrl" TEXT,
ADD COLUMN     "slug" TEXT NOT NULL,
ADD COLUMN     "taxClass" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "allowBackorder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "colorGroupId" INTEGER,
ADD COLUMN     "compareAtPrice" DECIMAL(18,2),
ADD COLUMN     "costPrice" DECIMAL(18,2),
ADD COLUMN     "lastLowStockNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "lowStockAlertAt" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "optionValues" JSONB,
ADD COLUMN     "preorderEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trackInventory" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SubCategory" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifyToken" TEXT,
ADD COLUMN     "emailVerifyTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "resetPasswordToken" TEXT,
ADD COLUMN     "resetPasswordTokenExpiry" TIMESTAMP(3),
ALTER COLUMN "passwordHash" DROP NOT NULL,
DROP COLUMN "role",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'Customer';

-- CreateTable
CREATE TABLE "Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discountType" "CouponDiscountType" NOT NULL,
    "percentOff" DECIMAL(5,2),
    "amountOff" DECIMAL(18,2),
    "minOrderAmount" DECIMAL(18,2),
    "maxDiscount" DECIMAL(18,2),
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "usagePerUser" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponProduct" (
    "couponId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponProduct_pkey" PRIMARY KEY ("couponId","productId")
);

-- CreateTable
CREATE TABLE "CouponCategory" (
    "couponId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponCategory_pkey" PRIMARY KEY ("couponId","categoryId")
);

-- CreateTable
CREATE TABLE "CouponSubCategory" (
    "couponId" INTEGER NOT NULL,
    "subCategoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponSubCategory_pkey" PRIMARY KEY ("couponId","subCategoryId")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantImage" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariantImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "userId" INTEGER,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'Pending',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewImage" (
    "id" SERIAL NOT NULL,
    "reviewId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secureUrl" TEXT,
    "type" "MediaType" NOT NULL,
    "format" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "folder" TEXT,
    "originalName" TEXT,
    "uploadedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeSlider" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'home',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSlider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeSliderItem" (
    "id" TEXT NOT NULL,
    "sliderId" TEXT NOT NULL,
    "device" "SliderDevice" NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "heading" TEXT,
    "subHeading" TEXT,
    "ctaText" TEXT,
    "ctaHref" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSliderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerGrid" (
    "id" TEXT NOT NULL,
    "banner1ImageUrl" TEXT NOT NULL,
    "banner1CtaUrl" TEXT NOT NULL,
    "banner2ImageUrl" TEXT NOT NULL,
    "banner2CtaUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BannerGrid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductColorGroup" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "colorHex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductColorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductColorImage" (
    "id" SERIAL NOT NULL,
    "colorGroupId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductColorImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "values" JSONB NOT NULL,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSpecification" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeGuide" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "SizeGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatedProduct" (
    "productId" INTEGER NOT NULL,
    "relatedProductId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RelatedProduct_pkey" PRIMARY KEY ("productId","relatedProductId")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "label" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentlyViewed" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentlyViewed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "orderId" INTEGER NOT NULL,
    "type" "ReturnType" NOT NULL DEFAULT 'RETURN',
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "resolution" JSONB,
    "reversePickup" JSONB,
    "refundAmount" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "PromotionType" NOT NULL,
    "rules" JSONB NOT NULL,
    "benefit" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPage" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoRedirect" (
    "id" SERIAL NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SeoRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faq" (
    "id" SERIAL NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Faq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "orderId" INTEGER,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "countries" JSONB NOT NULL,
    "regions" JSONB,
    "rates" JSONB NOT NULL,
    "freeShippingRule" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "region" TEXT,
    "rate" DECIMAL(7,4) NOT NULL,
    "inclusive" BOOLEAN NOT NULL DEFAULT true,
    "hsnSac" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" SERIAL NOT NULL,
    "target" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestCart" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "couponCode" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestCart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestCartItem" (
    "id" SERIAL NOT NULL,
    "cartId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbandonedCart" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "guestCartId" INTEGER,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABANDONED',
    "snapshot" JSONB NOT NULL,
    "abandonedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "recoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedCart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "paymentId" INTEGER,
    "amount" DECIMAL(18,2) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "meta" JSONB,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "provider" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "labelUrl" TEXT,
    "items" JSONB NOT NULL,
    "meta" JSONB,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditAccount" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditTransaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "type" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "initialValue" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "customerEmail" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" SERIAL NOT NULL,
    "promotionId" INTEGER NOT NULL,
    "userId" INTEGER,
    "orderId" INTEGER,
    "discountAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingMethod" (
    "id" SERIAL NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minOrderValue" DECIMAL(18,2),
    "maxOrderValue" DECIMAL(18,2),
    "minWeightKg" DECIMAL(10,3),
    "maxWeightKg" DECIMAL(10,3),
    "freeAbove" DECIMAL(18,2),
    "estimatedMinDays" INTEGER,
    "estimatedMaxDays" INTEGER,
    "codAllowed" BOOLEAN NOT NULL DEFAULT true,
    "localDelivery" BOOLEAN NOT NULL DEFAULT false,
    "storePickup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnPolicy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "daysFromDelivery" INTEGER NOT NULL DEFAULT 7,
    "allowReturn" BOOLEAN NOT NULL DEFAULT true,
    "allowExchange" BOOLEAN NOT NULL DEFAULT true,
    "reversePickup" BOOLEAN NOT NULL DEFAULT true,
    "refundMethods" JSONB NOT NULL,
    "excludedProductIds" JSONB,
    "excludedCategoryIds" JSONB,
    "conditions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewMediaV2" (
    "id" SERIAL NOT NULL,
    "reviewId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewMediaV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "quote" TEXT NOT NULL,
    "rating" INTEGER,
    "imageUrl" TEXT,
    "source" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustBadge" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "linkUrl" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'PRODUCT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "segmentId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignDelivery" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "userId" INTEGER,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSegment" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL DEFAULT 'POINTS',
    "rewardValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralEvent" (
    "id" SERIAL NOT NULL,
    "referralCodeId" INTEGER NOT NULL,
    "referredUserId" INTEGER,
    "orderId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CLICKED',
    "rewardGranted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "commissionType" TEXT NOT NULL DEFAULT 'PERCENT',
    "commissionValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateEvent" (
    "id" SERIAL NOT NULL,
    "affiliateId" INTEGER NOT NULL,
    "sessionId" TEXT,
    "orderId" INTEGER,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,2),
    "commission" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoMeta" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "keywords" TEXT,
    "canonicalUrl" TEXT,
    "robots" TEXT DEFAULT 'index,follow',
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "ogImageUrl" TEXT,
    "structuredData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" JSONB NOT NULL,
    "featuredImageUrl" TEXT,
    "featuredImageAlt" TEXT,
    "authorId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "canonicalUrl" TEXT,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavigationMenu" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavigationMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LANDING',
    "schema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSubmission" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "source" TEXT DEFAULT 'CONTACT_FORM',
    "assignedToId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "senderUserId" INTEGER,
    "senderType" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "message" TEXT NOT NULL,
    "attachments" JSONB,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "guestToken" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" INTEGER,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "senderUserId" INTEGER,
    "senderType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpCenterArticle" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "excerpt" TEXT,
    "content" JSONB NOT NULL,
    "keywords" JSONB,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpCenterArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventName" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" INTEGER,
    "anonymousId" TEXT,
    "orderId" INTEGER,
    "productId" INTEGER,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "landingPage" TEXT,
    "value" DECIMAL(18,2),
    "currency" TEXT DEFAULT 'INR',
    "properties" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingIntegration" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicConfig" JSONB,
    "secretConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversionEvent" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" INTEGER,
    "userId" INTEGER,
    "value" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "userData" JSONB,
    "eventData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerResponse" JSONB,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "anonymousId" TEXT,
    "sessionId" TEXT,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "advertising" BOOLEAN NOT NULL DEFAULT false,
    "functional" BOOLEAN NOT NULL DEFAULT true,
    "policyVersion" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFeed" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "language" TEXT NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "lastGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "lines" JSONB,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT 'INV',
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "financialYear" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StaffRole" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "title" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "requestedById" INTEGER NOT NULL,
    "assignedRoleId" INTEGER,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" INTEGER,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffNotificationSetting" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffNotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudCheck" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER,
    "userId" INTEGER,
    "score" INTEGER NOT NULL DEFAULT 0,
    "decision" TEXT NOT NULL DEFAULT 'ALLOW',
    "reasons" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "checksum" TEXT,
    "sizeBytes" BIGINT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemIncident" (
    "id" SERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "meta" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyConfig" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "rateToBase" DECIMAL(18,6) NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyConfig_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "LocaleConfig" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fallbackCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocaleConfig_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "countries" JSONB NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "localeCode" TEXT NOT NULL,
    "priceAdjustment" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
    "paymentMethods" JSONB,
    "shippingConfig" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionalPrice" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "marketId" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "compareAtPrice" DECIMAL(18,2),

    CONSTRAINT "RegionalPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTranslation" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "ProductTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "secrets" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" SERIAL NOT NULL,
    "endpointId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "anonymousId" TEXT,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'ONESIGNAL',
    "token" TEXT NOT NULL,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "marketingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transactionalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushNotification" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrl" TEXT,
    "deepLink" TEXT,
    "category" TEXT NOT NULL DEFAULT 'TRANSACTIONAL',
    "audience" JSONB,
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushNotificationDelivery" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileAppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileAppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AccessibilityIssue" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessibilityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "CouponProduct_productId_idx" ON "CouponProduct"("productId");

-- CreateIndex
CREATE INDEX "CouponCategory_categoryId_idx" ON "CouponCategory"("categoryId");

-- CreateIndex
CREATE INDEX "CouponSubCategory_subCategoryId_idx" ON "CouponSubCategory"("subCategoryId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_url_key" ON "ProductImage"("productId", "url");

-- CreateIndex
CREATE INDEX "ProductVariantImage_variantId_idx" ON "ProductVariantImage"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantImage_variantId_url_key" ON "ProductVariantImage"("variantId", "url");

-- CreateIndex
CREATE INDEX "Review_productId_idx" ON "Review"("productId");

-- CreateIndex
CREATE INDEX "Review_userId_idx" ON "Review"("userId");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Review_productId_userId_key" ON "Review"("productId", "userId");

-- CreateIndex
CREATE INDEX "ReviewImage_reviewId_idx" ON "ReviewImage"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_publicId_key" ON "MediaAsset"("publicId");

-- CreateIndex
CREATE INDEX "MediaAsset_type_idx" ON "MediaAsset"("type");

-- CreateIndex
CREATE INDEX "MediaAsset_folder_idx" ON "MediaAsset"("folder");

-- CreateIndex
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");

-- CreateIndex
CREATE INDEX "WishlistItem_userId_idx" ON "WishlistItem"("userId");

-- CreateIndex
CREATE INDEX "WishlistItem_productId_idx" ON "WishlistItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_userId_productId_key" ON "WishlistItem"("userId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeSlider_key_key" ON "HomeSlider"("key");

-- CreateIndex
CREATE INDEX "HomeSliderItem_sliderId_device_isActive_sortOrder_idx" ON "HomeSliderItem"("sliderId", "device", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductColorGroup_productId_idx" ON "ProductColorGroup"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductColorGroup_productId_color_key" ON "ProductColorGroup"("productId", "color");

-- CreateIndex
CREATE INDEX "ProductColorImage_colorGroupId_idx" ON "ProductColorImage"("colorGroupId");

-- CreateIndex
CREATE INDEX "ProductOption_productId_position_idx" ON "ProductOption"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_name_key" ON "ProductOption"("productId", "name");

-- CreateIndex
CREATE INDEX "ProductSpecification_productId_position_idx" ON "ProductSpecification"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SizeGuide_productId_key" ON "SizeGuide"("productId");

-- CreateIndex
CREATE INDEX "CustomerAddress_userId_idx" ON "CustomerAddress"("userId");

-- CreateIndex
CREATE INDEX "RecentlyViewed_userId_viewedAt_idx" ON "RecentlyViewed"("userId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecentlyViewed_userId_productId_key" ON "RecentlyViewed"("userId", "productId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_slug_key" ON "CmsPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SeoRedirect_fromPath_key" ON "SeoRedirect"("fromPath");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE INDEX "OtpCode_target_purpose_createdAt_idx" ON "OtpCode"("target", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCart_token_key" ON "GuestCart"("token");

-- CreateIndex
CREATE INDEX "GuestCart_email_updatedAt_idx" ON "GuestCart"("email", "updatedAt");

-- CreateIndex
CREATE INDEX "GuestCartItem_variantId_idx" ON "GuestCartItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCartItem_cartId_variantId_key" ON "GuestCartItem"("cartId", "variantId");

-- CreateIndex
CREATE INDEX "AbandonedCart_userId_status_idx" ON "AbandonedCart"("userId", "status");

-- CreateIndex
CREATE INDEX "AbandonedCart_email_status_idx" ON "AbandonedCart"("email", "status");

-- CreateIndex
CREATE INDEX "PaymentRefund_orderId_createdAt_idx" ON "PaymentRefund"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE INDEX "Fulfillment_orderId_createdAt_idx" ON "Fulfillment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCreditAccount_userId_key" ON "StoreCreditAccount"("userId");

-- CreateIndex
CREATE INDEX "StoreCreditTransaction_userId_createdAt_idx" ON "StoreCreditTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE INDEX "PromotionRedemption_promotionId_createdAt_idx" ON "PromotionRedemption"("promotionId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionRedemption_userId_createdAt_idx" ON "PromotionRedemption"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingMethod_zoneId_isActive_idx" ON "ShippingMethod"("zoneId", "isActive");

-- CreateIndex
CREATE INDEX "ReviewMediaV2_reviewId_idx" ON "ReviewMediaV2"("reviewId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_scheduledAt_idx" ON "MarketingCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CampaignDelivery_campaignId_status_idx" ON "CampaignDelivery"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignDelivery_userId_idx" ON "CampaignDelivery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_userId_key" ON "LoyaltyAccount"("userId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralCode_userId_idx" ON "ReferralCode"("userId");

-- CreateIndex
CREATE INDEX "ReferralEvent_referralCodeId_status_idx" ON "ReferralEvent"("referralCodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- CreateIndex
CREATE INDEX "AffiliateEvent_affiliateId_createdAt_idx" ON "AffiliateEvent"("affiliateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeoMeta_entityType_entityId_key" ON "SeoMeta"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NavigationMenu_name_key" ON "NavigationMenu"("name");

-- CreateIndex
CREATE UNIQUE INDEX "NavigationMenu_handle_key" ON "NavigationMenu"("handle");

-- CreateIndex
CREATE INDEX "ContactSubmission_status_createdAt_idx" ON "ContactSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContactSubmission_email_idx" ON "ContactSubmission"("email");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_guestToken_key" ON "ChatConversation"("guestToken");

-- CreateIndex
CREATE INDEX "ChatConversation_userId_status_idx" ON "ChatConversation"("userId", "status");

-- CreateIndex
CREATE INDEX "ChatConversation_status_lastMessageAt_idx" ON "ChatConversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HelpCenterArticle_slug_key" ON "HelpCenterArticle"("slug");

-- CreateIndex
CREATE INDEX "HelpCenterArticle_isPublished_category_idx" ON "HelpCenterArticle"("isPublished", "category");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_occurredAt_idx" ON "AnalyticsEvent"("eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_occurredAt_idx" ON "AnalyticsEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_campaign_occurredAt_idx" ON "AnalyticsEvent"("campaign", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_orderId_idx" ON "AnalyticsEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingIntegration_provider_key" ON "TrackingIntegration"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ConversionEvent_eventId_key" ON "ConversionEvent"("eventId");

-- CreateIndex
CREATE INDEX "ConversionEvent_provider_status_createdAt_idx" ON "ConversionEvent"("provider", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ConversionEvent_orderId_idx" ON "ConversionEvent"("orderId");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_updatedAt_idx" ON "ConsentRecord"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_anonymousId_updatedAt_idx" ON "ConsentRecord"("anonymousId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE INDEX "CreditNote_orderId_issuedAt_idx" ON "CreditNote"("orderId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRole_name_key" ON "StaffRole"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");

-- CreateIndex
CREATE INDEX "StaffProfile_roleId_isActive_idx" ON "StaffProfile"("roleId", "isActive");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffNotificationSetting_userId_channel_event_key" ON "StaffNotificationSetting"("userId", "channel", "event");

-- CreateIndex
CREATE INDEX "FraudCheck_orderId_idx" ON "FraudCheck"("orderId");

-- CreateIndex
CREATE INDEX "FraudCheck_decision_createdAt_idx" ON "FraudCheck"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "SystemIncident_level_createdAt_idx" ON "SystemIncident"("level", "createdAt");

-- CreateIndex
CREATE INDEX "RegionalPrice_marketId_idx" ON "RegionalPrice"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "RegionalPrice_productId_variantId_marketId_key" ON "RegionalPrice"("productId", "variantId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTranslation_productId_locale_key" ON "ProductTranslation"("productId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_provider_name_key" ON "IntegrationConnection"("provider", "name");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- CreateIndex
CREATE INDEX "PushDevice_userId_enabled_idx" ON "PushDevice"("userId", "enabled");

-- CreateIndex
CREATE INDEX "PushDevice_platform_enabled_idx" ON "PushDevice"("platform", "enabled");

-- CreateIndex
CREATE INDEX "PushNotification_status_scheduledAt_idx" ON "PushNotification"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PushNotificationDelivery_status_idx" ON "PushNotificationDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PushNotificationDelivery_notificationId_deviceId_key" ON "PushNotificationDelivery"("notificationId", "deviceId");

-- CreateIndex
CREATE INDEX "AccessibilityIssue_entityType_entityId_idx" ON "AccessibilityIssue"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AccessibilityIssue_resolved_severity_idx" ON "AccessibilityIssue"("resolved", "severity");

-- CreateIndex
CREATE INDEX "CartItem_userId_idx" ON "CartItem"("userId");

-- CreateIndex
CREATE INDEX "CartItem_variantId_idx" ON "CartItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_couponId_idx" ON "Order"("couponId");

-- CreateIndex
CREATE INDEX "Order_shippingProvider_idx" ON "Order"("shippingProvider");

-- CreateIndex
CREATE INDEX "Order_shipmentStatus_idx" ON "Order"("shipmentStatus");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerifyToken_key" ON "User"("emailVerifyToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetPasswordToken_key" ON "User"("resetPasswordToken");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorGroupId_fkey" FOREIGN KEY ("colorGroupId") REFERENCES "ProductColorGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProduct" ADD CONSTRAINT "CouponProduct_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProduct" ADD CONSTRAINT "CouponProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCategory" ADD CONSTRAINT "CouponCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCategory" ADD CONSTRAINT "CouponCategory_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponSubCategory" ADD CONSTRAINT "CouponSubCategory_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponSubCategory" ADD CONSTRAINT "CouponSubCategory_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantImage" ADD CONSTRAINT "ProductVariantImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeSliderItem" ADD CONSTRAINT "HomeSliderItem_sliderId_fkey" FOREIGN KEY ("sliderId") REFERENCES "HomeSlider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductColorGroup" ADD CONSTRAINT "ProductColorGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductColorImage" ADD CONSTRAINT "ProductColorImage_colorGroupId_fkey" FOREIGN KEY ("colorGroupId") REFERENCES "ProductColorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSpecification" ADD CONSTRAINT "ProductSpecification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizeGuide" ADD CONSTRAINT "SizeGuide_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedProduct" ADD CONSTRAINT "RelatedProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedProduct" ADD CONSTRAINT "RelatedProduct_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentlyViewed" ADD CONSTRAINT "RecentlyViewed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentlyViewed" ADD CONSTRAINT "RecentlyViewed_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCartItem" ADD CONSTRAINT "GuestCartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "GuestCart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestCartItem" ADD CONSTRAINT "GuestCartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StaffRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegionalPrice" ADD CONSTRAINT "RegionalPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTranslation" ADD CONSTRAINT "ProductTranslation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushNotificationDelivery" ADD CONSTRAINT "PushNotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "PushNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
