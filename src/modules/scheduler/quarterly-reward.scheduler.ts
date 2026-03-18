import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RewardService } from '../reward/reward.service';

@Injectable()
export class QuarterlyRewardScheduler {
  private readonly logger = new Logger(QuarterlyRewardScheduler.name);

  constructor(private readonly rewardService: RewardService) {}

  // Every day at 01:10:00 (timezone from env)
  // Example cron: "0 10 1 * * *"
  @Cron(process.env.DAILY_CRON ?? '0 10 1 * * *', {
    timeZone: process.env.SCHEDULER_TIMEZONE ?? 'Asia/Shanghai',
  })
  async handleDailyCheck() {
    const today = new Date();

    // Primary run at quarter-start day
    if (this.rewardService.isQuarterStartDay(today)) {
      const currentQuarterTarget = this.rewardService.getPreviousQuarter(today);
      this.logger.log(`Quarter start detected, run period=${currentQuarterTarget.period}`);
      await this.rewardService.runQuarterlyReward(currentQuarterTarget);
    }

    // Catch-up run for restart/downtime scenario
    const periods = await this.rewardService.findCatchUpPeriods(today);
    for (const period of periods) {
      this.logger.log(`Catch-up run for period=${period.period}`);
      await this.rewardService.runQuarterlyReward(period);
    }
  }
}
