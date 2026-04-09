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

    const scheduler = new QuarterlyRewardScheduler(rewardService as any);

    await scheduler.handleDailyCheck();

    expect(rewardService.runQuarterlyReward).toHaveBeenCalledTimes(2);
    expect(rewardService.runQuarterlyReward).toHaveBeenNthCalledWith(1, quarterStartTarget);
    expect(rewardService.runQuarterlyReward).toHaveBeenNthCalledWith(2, catchUpOnlyTarget);
  });
});
