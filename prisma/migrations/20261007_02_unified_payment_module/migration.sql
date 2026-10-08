ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerOrderId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerSignature" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerMeta" JSONB;
CREATE TABLE IF NOT EXISTS "PaymentGatewayConfig" (
  "id" SERIAL NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
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
  CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentGatewayConfig_provider_key" ON "PaymentGatewayConfig"("provider");
CREATE INDEX IF NOT EXISTS "PaymentGatewayConfig_isEnabled_idx" ON "PaymentGatewayConfig"("isEnabled");
