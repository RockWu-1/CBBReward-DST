import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TaskTriggerSource, TaskType } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { RewardService } from '../reward/reward.service';
import { TaskService } from '../task/task.service';

@Injectable()
export class QuarterlyRewardScheduler implements OnModuleInit {
  private readonly logger = new Logger(QuarterlyRewardScheduler.name);

  constructor(
    private readonly rewardService: RewardService,
    private readonly taskService: TaskService,
  ) {}

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
    const runTargets: Array<{ period: string; startDate: Date; endDate: Date }> = [];

    if (this.rewardService.isQuarterStartDay(today)) {
      const currentQuarterTarget = this.rewardService.getPreviousQuarter(today);
      this.logger.log(`Quarter start detected, run period=${currentQuarterTarget.period}`);
      runTargets.push(currentQuarterTarget);
    }

    const catchUpPeriods = await this.rewardService.findCatchUpPeriods(today);
    runTargets.push(...catchUpPeriods);

    const deduplicatedTargets: typeof runTargets = [];
    const seenPeriods = new Set<string>();
    for (const target of runTargets) {
      if (seenPeriods.has(target.period)) {
        continue;
      }
      seenPeriods.add(target.period);
      deduplicatedTargets.push(target);
    }

    for (const period of deduplicatedTargets) {
      this.logger.log(`Scheduled run for period=${period.period}`);
      const task = await this.taskService.createTask({
        taskType: TaskType.PERIOD_RUN,
        triggerSource: TaskTriggerSource.SCHEDULER,
        title: `Scheduled period run for ${period.period}`,
        period: period.period,
        triggeredBy: 'scheduler',
        requestPayload: { source: 'SCHEDULED' },
      });
      await this.rewardService.runQuarterlyReward(period, undefined, task.id);
    }
  }
}
