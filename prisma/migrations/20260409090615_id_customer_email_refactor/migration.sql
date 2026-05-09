/*
  Warnings:

  - The primary key for the `BeansLedger` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `userId` on the `BeansLedger` table. All the data in the column will be lost.
  - The `id` column on the `BeansLedger` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `rewardRecordId` column on the `BeansLedger` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `OrderSnapshot` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `OrderSnapshot` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `RewardBatch` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `RewardBatch` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `RewardRecord` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `userId` on the `RewardRecord` table. All the data in the column will be lost.
  - The `id` column on the `RewardRecord` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[batchId,customerId]` on the table `RewardRecord` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `customerId` to the `BeansLedger` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `customerId` on the `OrderSnapshot` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `customerId` to the `RewardRecord` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `batchId` on the `RewardRecord` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "BeansLedger" DROP CONSTRAINT "BeansLedger_rewardRecordId_fkey";

-- DropForeignKey
ALTER TABLE "RewardRecord" DROP CONSTRAINT "RewardRecord_batchId_fkey";

-- DropIndex
DROP INDEX "BeansLedger_userId_createdAt_idx";

-- DropIndex
DROP INDEX "RewardRecord_batchId_userId_key";

-- AlterTable
ALTER TABLE "BeansLedger" DROP CONSTRAINT "BeansLedger_pkey",
DROP COLUMN "userId",
ADD COLUMN     "customerId" INTEGER NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "rewardRecordId",
ADD COLUMN     "rewardRecordId" INTEGER,
ADD CONSTRAINT "BeansLedger_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "OrderSnapshot" DROP CONSTRAINT "OrderSnapshot_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" INTEGER NOT NULL,
ADD CONSTRAINT "OrderSnapshot_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "RewardBatch" DROP CONSTRAINT "RewardBatch_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "RewardBatch_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "RewardRecord" DROP CONSTRAINT "RewardRecord_pkey",
DROP COLUMN "userId",
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerId" INTEGER NOT NULL,
ADD COLUMN     "customerName" TEXT,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "batchId",
ADD COLUMN     "batchId" INTEGER NOT NULL,
ADD CONSTRAINT "RewardRecord_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "BeansLedger_customerId_createdAt_idx" ON "BeansLedger"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderSnapshot_batchId_customerId_idx" ON "OrderSnapshot"("batchId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRecord_batchId_customerId_key" ON "RewardRecord"("batchId", "customerId");

-- AddForeignKey
ALTER TABLE "RewardRecord" ADD CONSTRAINT "RewardRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RewardBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeansLedger" ADD CONSTRAINT "BeansLedger_rewardRecordId_fkey" FOREIGN KEY ("rewardRecordId") REFERENCES "RewardRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
