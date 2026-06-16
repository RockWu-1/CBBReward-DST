import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RewardService } from '../reward/reward.service';

@Injectable()
export class QuarterlyRewardScheduler implements OnModuleInit{
  private readonly logger = new Logger(QuarterlyRewardScheduler.name);

  constructor(private readonly rewardService: RewardService) {}
  async onModuleInit() {
    // await this.handleDailyCheck();
  }

  // Every day at 01:10:00 (timezone from env)
  // Example cron: "0 10 1 * * *"
  @Cron(process.env.DAILY_CRON ?? '0 10 1 * * *', {
    timeZone: process.env.SCHEDULER_TIMEZONE ?? 'Asia/Shanghai',
  })
  async handleDailyCheck() {
    const today = new Date();
    console.log("🚀 ~ QuarterlyRewardScheduler ~ handleDailyCheck ~ today:", today)
    const runTargets: Array<{ period: string; startDate: Date; endDate: Date }> = [];

    // Collect primary run target at quarter-start day first
    // if (this.rewardService.isQuarterStartDay(today)) {
    //   const currentQuarterTarget = this.rewardService.getPreviousQuarter(today);
    //   this.logger.log(`Quarter start detected, run period=${currentQuarterTarget.period}`);
    //   runTargets.push(currentQuarterTarget);
    // }
    const currentQuarterTarget = this.rewardService.getPreviousQuarter(today);
    this.logger.log(`Quarter start detected, run period=${currentQuarterTarget.period}`);
    runTargets.push(currentQuarterTarget);

    // Merge catch-up targets, then deduplicate by period (keep first seen)
    // const catchUpPeriods = await this.rewardService.findCatchUpPeriods(today);
    // runTargets.push(...catchUpPeriods);

    // const deduplicatedTargets: typeof runTargets = [];
    // const seenPeriods = new Set<string>();
    // for (const target of runTargets) {
    //   if (seenPeriods.has(target.period)) {
    //     continue;
    //   }
    //   seenPeriods.add(target.period);
    //   deduplicatedTargets.push(target);
    // }

    // for (const period of deduplicatedTargets) {
    // }
    this.logger.log(`Scheduled run for period=${currentQuarterTarget.period}`);
    await this.rewardService.runQuarterlyReward(currentQuarterTarget);
  }
}
