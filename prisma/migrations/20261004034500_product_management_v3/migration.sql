-- Product Management V3: brand relationship + mixed product media
ALTER TABLE "Product" ADD COLUMN "brandId" INTEGER;
CREATE TYPE "ProductMediaType" AS ENUM ('IMAGE', 'VIDEO');
CREATE TABLE "ProductMedia" (
  "id" SERIAL NOT NULL,
  "productId" INTEGER NOT NULL,
  "type" "ProductMediaType" NOT NULL DEFAULT 'IMAGE',
  "url" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "altText" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isMain" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");
CREATE INDEX "ProductMedia_productId_sortOrder_idx" ON "ProductMedia"("productId", "sortOrder");
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
