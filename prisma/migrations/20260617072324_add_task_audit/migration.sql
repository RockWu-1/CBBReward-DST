-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('PERIOD_RUN', 'PERIOD_RERUN', 'BATCH_RETRY', 'RECORD_RETRY', 'RECORD_RETRY_BULK', 'RECORD_ROLLBACK');

-- CreateEnum
CREATE TYPE "TaskTriggerSource" AS ENUM ('SCHEDULER', 'ADMIN', 'API', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL_FAILED');

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "triggerSource" "TaskTriggerSource" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "period" TEXT,
    "rewardBatchId" INTEGER,
    "rewardRecordId" INTEGER,
    "targetIds" JSONB,
    "triggeredBy" TEXT,
    "requestPayload" JSONB,
    "resultPayload" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_taskType_createdAt_idx" ON "Task"("taskType", "createdAt");

-- CreateIndex
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Task_triggerSource_createdAt_idx" ON "Task"("triggerSource", "createdAt");

-- CreateIndex
CREATE INDEX "Task_period_idx" ON "Task"("period");

-- CreateIndex
CREATE INDEX "Task_rewardBatchId_idx" ON "Task"("rewardBatchId");

-- CreateIndex
CREATE INDEX "Task_rewardRecordId_idx" ON "Task"("rewardRecordId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_rewardBatchId_fkey" FOREIGN KEY ("rewardBatchId") REFERENCES "RewardBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_rewardRecordId_fkey" FOREIGN KEY ("rewardRecordId") REFERENCES "RewardRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
