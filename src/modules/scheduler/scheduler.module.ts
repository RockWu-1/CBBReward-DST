import { Module } from '@nestjs/common';
import { RewardModule } from '../reward/reward.module';
import { QuarterlyRewardScheduler } from './quarterly-reward.scheduler';

@Module({
  imports: [RewardModule],
  providers: [QuarterlyRewardScheduler],
})
export class SchedulerModule {}
