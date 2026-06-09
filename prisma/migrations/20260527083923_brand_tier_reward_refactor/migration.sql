/*
  Warnings:

  - You are about to drop the `OrderSnapshot` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PartnerTier" AS ENUM ('NONE', 'COLLECTIVE', 'TOP_SHELF', 'CRAFT', 'STUDIO', 'ICON');

-- AlterTable
ALTER TABLE "RewardRecord" ADD COLUMN     "bobReward" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "csReward" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "OrderSnapshot";

-- CreateTable
CREATE TABLE "CustomerQuarterSnapshot" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "season" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "bobAmount" DECIMAL(18,2) NOT NULL,
    "csAmount" DECIMAL(18,2) NOT NULL,
    "level" "PartnerTier" NOT NULL,
    "isExistingCustomer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerQuarterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerQuarterSnapshot_season_level_idx" ON "CustomerQuarterSnapshot"("season", "level");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerQuarterSnapshot_customerId_season_key" ON "CustomerQuarterSnapshot"("customerId", "season");
