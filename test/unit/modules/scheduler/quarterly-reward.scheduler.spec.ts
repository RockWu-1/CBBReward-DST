import { QuarterlyRewardScheduler } from '../../../../src/modules/scheduler/quarterly-reward.scheduler';

type QuarterPeriod = {
  period: string;
  startDate: Date;
  endDate: Date;
};

describe('QuarterlyRewardScheduler.handleDailyCheck', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs deduplicated periods when quarter-start day overlaps with catch-up periods', async () => {
    const quarterStartTarget: QuarterPeriod = {
      period: '2026-Q1',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.000Z'),
    };
    const catchUpOnlyTarget: QuarterPeriod = {
      period: '2025-Q4',
      startDate: new Date('2025-10-01T00:00:00.000Z'),
      endDate: new Date('2025-12-31T23:59:59.000Z'),
    };

    const rewardService = {
      isQuarterStartDay: jest.fn().mockReturnValue(true),
      getPreviousQuarter: jest.fn().mockReturnValue(quarterStartTarget),
      findCatchUpPeriods: jest
        .fn()
        .mockResolvedValue([quarterStartTarget, catchUpOnlyTarget]),
      runQuarterlyReward: jest.fn().mockResolvedValue(undefined),
    };
    const taskService = {
      createTask: jest
        .fn()
        .mockResolvedValueOnce({ id: 501 })
        .mockResolvedValueOnce({ id: 502 }),
    };

    const scheduler = new QuarterlyRewardScheduler(rewardService as any, taskService as any);

    await scheduler.handleDailyCheck();

    expect(rewardService.runQuarterlyReward).toHaveBeenCalledTimes(2);
    expect(taskService.createTask).toHaveBeenNthCalledWith(1, {
      taskType: 'PERIOD_RUN',
      triggerSource: 'SCHEDULER',
      title: 'Scheduled period run for 2026-Q1',
      period: '2026-Q1',
      triggeredBy: 'scheduler',
      requestPayload: { source: 'SCHEDULED' },
    });
    expect(rewardService.runQuarterlyReward).toHaveBeenNthCalledWith(1, quarterStartTarget, undefined, 501);
    expect(rewardService.runQuarterlyReward).toHaveBeenNthCalledWith(2, catchUpOnlyTarget, undefined, 502);
  });
});
