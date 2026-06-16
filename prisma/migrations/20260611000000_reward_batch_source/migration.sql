CREATE TYPE "RewardBatchSource" AS ENUM ('SCHEDULED', 'RERUN');

ALTER TABLE "RewardBatch"
  ADD COLUMN "source" "RewardBatchSource" NOT NULL DEFAULT 'SCHEDULED',
  DROP COLUMN "rewardRate",
  DROP COLUMN "parentPeriod",
  DROP COLUMN "batchType";

DROP TYPE "RewardBatchType";
