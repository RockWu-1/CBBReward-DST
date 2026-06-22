import { Module } from '@nestjs/common';
import { RewardModule } from '../reward/reward.module';
import { TaskModule } from '../task/task.module';
import { QuarterlyRewardScheduler } from './quarterly-reward.scheduler';

@Module({
  imports: [RewardModule, TaskModule],
  providers: [QuarterlyRewardScheduler],
})
export class SchedulerModule {}
