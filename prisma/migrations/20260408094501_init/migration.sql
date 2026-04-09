-- CreateEnum
CREATE TYPE "RewardBatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "RewardRecordStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "RewardBatchType" AS ENUM ('REGULAR', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('REWARD', 'ROLLBACK');

-- CreateTable
CREATE TABLE "RewardBatch" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "batchType" "RewardBatchType" NOT NULL DEFAULT 'REGULAR',
    "parentPeriod" TEXT,
    "triggeredBy" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "RewardBatchStatus" NOT NULL DEFAULT 'PENDING',
    "rewardRate" DECIMAL(8,6) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalOrderAmount" DECIMAL(18,2) NOT NULL,
    "rewardAmount" DECIMAL(18,2) NOT NULL,
    "status" "RewardRecordStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "rollbackReason" TEXT,
    "rollbackBy" TEXT,
    "rollbackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeansLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardRecordId" TEXT,
    "changeAmount" DECIMAL(18,2) NOT NULL,
    "type" "LedgerType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "externalTxnId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeansLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshot" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderAmount" DECIMAL(18,2) NOT NULL,
    "orderCreated" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewardBatch_period_key" ON "RewardBatch"("period");

-- CreateIndex
CREATE INDEX "RewardBatch_status_createdAt_idx" ON "RewardBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RewardRecord_status_nextRetryAt_idx" ON "RewardRecord"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRecord_batchId_userId_key" ON "RewardRecord"("batchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BeansLedger_idempotencyKey_key" ON "BeansLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BeansLedger_userId_createdAt_idx" ON "BeansLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BeansLedger_referenceId_type_idx" ON "BeansLedger"("referenceId", "type");

-- CreateIndex
CREATE INDEX "OrderSnapshot_batchId_customerId_idx" ON "OrderSnapshot"("batchId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSnapshot_batchId_externalId_key" ON "OrderSnapshot"("batchId", "externalId");

-- AddForeignKey
ALTER TABLE "RewardRecord" ADD CONSTRAINT "RewardRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RewardBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeansLedger" ADD CONSTRAINT "BeansLedger_rewardRecordId_fkey" FOREIGN KEY ("rewardRecordId") REFERENCES "RewardRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
