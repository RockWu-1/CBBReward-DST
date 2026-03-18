import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RewardBatchStatus, RewardRecordStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BeansService } from '../beans/beans.service';
import { LedgerService } from '../ledger/ledger.service';
import { OrderService } from '../order/order.service';

type QuarterPeriod = {
  period: string;
  startDate: Date;
  endDate: Date;
};

type UserOrderAggregate = {
  userId: string;
  totalAmount: Decimal;
};

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly beansService: BeansService,
    private readonly ledgerService: LedgerService,
  ) {}

  async runQuarterlyReward(period: QuarterPeriod): Promise<void> {
    const rewardRate = new Decimal(process.env.REWARD_RATE ?? '0.05');
    const batch = await this.getOrCreateBatch(period, rewardRate);

    if (batch.status === RewardBatchStatus.COMPLETED) {
      this.logger.log(`Skip completed period=${period.period}`);
      return;
    }

    await this.prisma.rewardBatch.update({
      where: { id: batch.id },
      data: { status: RewardBatchStatus.PROCESSING, startedAt: new Date() },
    });

    const aggregates = await this.orderService.fetchAndAggregateUserOrders(
      period.startDate,
      period.endDate,
    );

    await this.createOrUpdateRewardRecords(batch.id, aggregates, rewardRate);
    await this.processPendingRecords(batch.id);

    const pendingOrFailedCount = await this.prisma.rewardRecord.count({
      where: {
        batchId: batch.id,
        status: { in: [RewardRecordStatus.PENDING, RewardRecordStatus.FAILED] },
      },
    });

    await this.prisma.rewardBatch.update({
      where: { id: batch.id },
      data: {
        status:
          pendingOrFailedCount === 0
            ? RewardBatchStatus.COMPLETED
            : RewardBatchStatus.PARTIAL_FAILED,
        finishedAt: new Date(),
      },
    });
  }

  async retryFailedRecords(batchId: string): Promise<void> {
    const retryCandidates = await this.prisma.rewardRecord.findMany({
      where: {
        batchId,
        status: RewardRecordStatus.FAILED,
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { updatedAt: 'asc' },
      take: 500,
    });

    for (const record of retryCandidates) {
      await this.processOneRecord(record.id);
    }
  }

  async rollbackRecord(recordId: string, reason: string): Promise<void> {
    const record = await this.prisma.rewardRecord.findUnique({ where: { id: recordId } });
    if (!record) {
      throw new Error(`Record ${recordId} not found`);
    }
    if (record.status === RewardRecordStatus.ROLLED_BACK) {
      return;
    }

    const rollbackAmount = new Decimal(record.rewardAmount.toString()).mul(-1);
    const idempotencyKey = `rollback:${record.id}`;

    const existing = await this.ledgerService.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.prisma.rewardRecord.update({
        where: { id: record.id },
        data: { status: RewardRecordStatus.ROLLED_BACK },
      });
      return;
    }

    const external = await this.beansService.rollbackBeans({
      userId: record.userId,
      beans: rollbackAmount.abs().toNumber(),
      reason,
      idempotencyKey,
    });

    await this.prisma.$transaction(async (tx) => {
      await this.ledgerService.appendRollbackLedger(
        tx,
        record,
        rollbackAmount,
        idempotencyKey,
        external.transactionId,
        { reason },
      );
      await tx.rewardRecord.update({
        where: { id: record.id },
        data: { status: RewardRecordStatus.ROLLED_BACK },
      });
    });
  }

  async findCatchUpPeriods(today: Date): Promise<QuarterPeriod[]> {
    const periods = new Map<string, QuarterPeriod>();

    const previous = this.getPreviousQuarter(today);
    periods.set(previous.period, previous);

    const unfinishedBatches = await this.prisma.rewardBatch.findMany({
      where: {
        status: {
          in: [
            RewardBatchStatus.PENDING,
            RewardBatchStatus.PROCESSING,
            RewardBatchStatus.PARTIAL_FAILED,
            RewardBatchStatus.FAILED,
          ],
        },
      },
      orderBy: { startDate: 'asc' },
    });

    for (const batch of unfinishedBatches) {
      periods.set(batch.period, {
        period: batch.period,
        startDate: batch.startDate,
        endDate: batch.endDate,
      });
    }

    return [...periods.values()];
  }

  getPreviousQuarter(date: Date): QuarterPeriod {
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    if (month >= 4 && month <= 6) {
      return this.buildQuarter(year, 1);
    }
    if (month >= 7 && month <= 9) {
      return this.buildQuarter(year, 2);
    }
    if (month >= 10 && month <= 12) {
      return this.buildQuarter(year, 3);
    }
    return this.buildQuarter(year - 1, 4);
  }

  isQuarterStartDay(date: Date): boolean {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return day === 1 && [1, 4, 7, 10].includes(month);
  }

  private buildQuarter(year: number, quarter: 1 | 2 | 3 | 4): QuarterPeriod {
    const ranges: Record<1 | 2 | 3 | 4, [number, number]> = {
      1: [0, 2],
      2: [3, 5],
      3: [6, 8],
      4: [9, 11],
    };
    const [startMonth, endMonth] = ranges[quarter];

    const startDate = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, endMonth + 1, 0, 23, 59, 59));

    return { period: `${year}-Q${quarter}`, startDate, endDate };
  }

  private async getOrCreateBatch(period: QuarterPeriod, rewardRate: Decimal) {
    try {
      return await this.prisma.rewardBatch.create({
        data: {
          period: period.period,
          startDate: period.startDate,
          endDate: period.endDate,
          rewardRate: new Prisma.Decimal(rewardRate.toString()),
        },
      });
    } catch {
      return this.prisma.rewardBatch.findUniqueOrThrow({ where: { period: period.period } });
    }
  }

  private async createOrUpdateRewardRecords(
    batchId: string,
    aggregates: UserOrderAggregate[],
    rewardRate: Decimal,
  ): Promise<void> {
    for (const item of aggregates) {
      const rewardAmount = item.totalAmount.mul(rewardRate).toDecimalPlaces(2);
      await this.prisma.rewardRecord.upsert({
        where: { batchId_userId: { batchId, userId: item.userId } },
        update: {
          totalOrderAmount: new Prisma.Decimal(item.totalAmount.toString()),
          rewardAmount: new Prisma.Decimal(rewardAmount.toString()),
          status: RewardRecordStatus.PENDING,
          lastError: null,
          nextRetryAt: null,
        },
        create: {
          batchId,
          userId: item.userId,
          totalOrderAmount: new Prisma.Decimal(item.totalAmount.toString()),
          rewardAmount: new Prisma.Decimal(rewardAmount.toString()),
        },
      });
    }
  }

  private async processPendingRecords(batchId: string): Promise<void> {
    const records = await this.prisma.rewardRecord.findMany({
      where: { batchId, status: RewardRecordStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });

    for (const record of records) {
      await this.processOneRecord(record.id);
    }
  }

  private async processOneRecord(recordId: string): Promise<void> {
    const record = await this.prisma.rewardRecord.findUniqueOrThrow({ where: { id: recordId } });
    const idempotencyKey = `reward:${record.id}`;

    const existing = await this.ledgerService.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.prisma.rewardRecord.update({
        where: { id: record.id },
        data: {
          status: RewardRecordStatus.SUCCESS,
          processedAt: existing.createdAt,
          lastError: null,
        },
      });
      return;
    }

    try {
      const external = await this.beansService.grantBeans({
        userId: record.userId,
        beans: Number(record.rewardAmount),
        idempotencyKey,
      });

      await this.prisma.$transaction(async (tx) => {
        await this.ledgerService.appendRewardLedger(
          tx,
          record,
          new Decimal(record.rewardAmount.toString()),
          idempotencyKey,
          external.transactionId,
        );

        await tx.rewardRecord.update({
          where: { id: record.id },
          data: {
            status: RewardRecordStatus.SUCCESS,
            processedAt: new Date(),
            lastError: null,
            nextRetryAt: null,
          },
        });
      });
    } catch (error) {
      const attempt = record.attemptCount + 1;
      const retryDelayMinutes = Math.min(60, attempt * 5);
      await this.prisma.rewardRecord.update({
        where: { id: record.id },
        data: {
          status: RewardRecordStatus.FAILED,
          attemptCount: attempt,
          lastError: error instanceof Error ? error.message : 'Unknown error',
          nextRetryAt: new Date(Date.now() + retryDelayMinutes * 60_000),
        },
      });
    }
  }
}
