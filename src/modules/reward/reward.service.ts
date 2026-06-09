import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RewardBatchStatus, RewardBatchType, RewardRecordStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { BeansService } from '../beans/beans.service';
import { BigcommerceService } from '../bigcommerce/bigcommerce.service';
import { LedgerService } from '../ledger/ledger.service';
import { OrderService } from '../order/order.service';
import { RewardCalculatorService } from './reward-calculator.service';
import { CreateAdjustmentRequestDto } from './dto/create-adjustment.request.dto';

type QuarterPeriod = {
  period: string;
  startDate: Date;
  endDate: Date;
};

type CustomerOrderAggregate = {
  customerId: number;
  totalAmount: Decimal;
  bobAmount: Decimal;
  csAmount: Decimal;
};

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly beansService: BeansService,
    private readonly ledgerService: LedgerService,
    private readonly bigcommerce: BigcommerceService,
    private readonly rewardCalculator: RewardCalculatorService = new RewardCalculatorService(),
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
    await this.createOrUpdateRewardRecords(batch.id, period.period, aggregates, period.endDate);
    // await this.processPendingRecords(batch.id); //TODO for test

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

  async retryFailedRecords(batchId: number): Promise<void> {
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

  async retryRecord(recordId: number): Promise<void> {
    await this.processOneRecord(recordId);
  }

  async rollbackRecord(recordId: number, reason: string, operator: string): Promise<void> {
    const record = await this.prisma.rewardRecord.findUnique({ where: { id: recordId } });
    if (!record) {
      throw new Error(`Record ${recordId} not found`);
    }
    if (!record.customerEmail) {
      throw new Error(`Missing customerEmail for reward record ${recordId}`);
    }
    if (record.status === RewardRecordStatus.ROLLED_BACK) {
      await this.prisma.rewardRecord.update({
        where: { id: record.id },
        data: {
          status: RewardRecordStatus.ROLLED_BACK,
          rollbackReason: reason,
          rollbackBy: operator,
          rollbackAt: record.rollbackAt ?? new Date(),
        },
      });
      return;
    }


    const rollbackAmount = new Decimal(record.rewardAmount.toString()).mul(-1);

    const existing = await this.ledgerService.findByRewardRecordId(record.id);
    if (!existing || !existing.externalTxnId) throw new Error('Not found existed add credit record');
    const idempotencyKey = existing.idempotencyKey;
    const external = await this.beansService.rollbackBeans({
      customerEmail: record.customerEmail,
      beans: rollbackAmount.abs().toNumber(),
      reason,
      idempotencyKey,
      externalTxnId: existing.externalTxnId,
    });

    await this.prisma.$transaction(async (tx) => {
      await this.ledgerService.appendRollbackLedger(
        tx,
        existing,
        { reason, operator },
      );
      await tx.rewardRecord.update({
        where: { id: record.id },
        data: {
          status: RewardRecordStatus.ROLLED_BACK,
          rollbackReason: reason,
          rollbackBy: operator,
          rollbackAt: new Date(),
        },
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

  async createAdjustmentBatch(dto: CreateAdjustmentRequestDto) {
    return this.prisma.rewardBatch.create({
      data: {
        period: dto.period,
        batchType: RewardBatchType.ADJUSTMENT,
        parentPeriod: dto.parentPeriod,
        triggeredBy: dto.triggeredBy,
        startDate: dto.startDate,
        endDate: dto.endDate,
        rewardRate: new Prisma.Decimal(dto.rewardRate.toString()),
      },
    });
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
    batchId: number,
    season: string,
    aggregates: CustomerOrderAggregate[],
    quarterEndDate: Date,
  ): Promise<void> {
    for (const item of aggregates) {
      const customer = await this.bigcommerce.getCustomer(item.customerId);
      const level = this.rewardCalculator.resolveTier(item.totalAmount);
      const isExistingCustomer = await this.isExistingCustomer(item.customerId, season);
      const rates = this.rewardCalculator.resolveRates({
        tier: level,
        isExistingCustomer,
        bobAmount: item.bobAmount,
        csAmount: item.csAmount,
        allocationDate: this.getAllocationDate(quarterEndDate),//TODO allocation date 需要修改
      });
      const rewards = this.rewardCalculator.calculateRewards({
        bobAmount: item.bobAmount,
        csAmount: item.csAmount,
        rates,
      });

      await this.prisma.customerQuarterSnapshot.upsert({
        where: { customerId_season: { customerId: item.customerId, season } },
        update: {
          customerName: customer.customerName,
          customerEmail: customer.customerEmail,
          totalAmount: new Prisma.Decimal(item.totalAmount.toString()),
          bobAmount: new Prisma.Decimal(item.bobAmount.toString()),
          csAmount: new Prisma.Decimal(item.csAmount.toString()),
          level,
          isExistingCustomer,
        },
        create: {
          customerId: item.customerId,
          customerName: customer.customerName,
          customerEmail: customer.customerEmail,
          season,
          totalAmount: new Prisma.Decimal(item.totalAmount.toString()),
          bobAmount: new Prisma.Decimal(item.bobAmount.toString()),
          csAmount: new Prisma.Decimal(item.csAmount.toString()),
          level,
          isExistingCustomer,
        },
      });

      if (rewards.totalReward.equals(0)) {
        continue;
      }

      await this.prisma.rewardRecord.upsert({
        where: { batchId_customerId: { batchId, customerId: item.customerId } },
        update: {
          customerName: customer.customerName,
          customerEmail: customer.customerEmail,
          totalOrderAmount: new Prisma.Decimal(item.totalAmount.toString()),
          bobReward: new Prisma.Decimal(rewards.bobReward.toString()),
          csReward: new Prisma.Decimal(rewards.csReward.toString()),
          rewardAmount: new Prisma.Decimal(rewards.totalReward.toString()),
          status: RewardRecordStatus.PENDING,
          lastError: null,
          nextRetryAt: null,
        },
        create: {
          batchId,
          customerId: item.customerId,
          customerName: customer.customerName,
          customerEmail: customer.customerEmail,
          totalOrderAmount: new Prisma.Decimal(item.totalAmount.toString()),
          bobReward: new Prisma.Decimal(rewards.bobReward.toString()),
          csReward: new Prisma.Decimal(rewards.csReward.toString()),
          rewardAmount: new Prisma.Decimal(rewards.totalReward.toString()),
        },
      });
    }
  }

  private async processPendingRecords(batchId: number): Promise<void> {
    const records = await this.prisma.rewardRecord.findMany({
      where: { batchId, status: RewardRecordStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    //TODO for test 
    const record  = records[0];
    console.log("🚀 ~ RewardService ~ processPendingRecords ~ record:", record);
    // await this.processOneRecord(record.id);

    // for (const record of records) {
    //   await this.processOneRecord(record.id);
    // }
  }

  private async processOneRecord(recordId: number): Promise<void> {
    const record = await this.prisma.rewardRecord.findUniqueOrThrow({ where: { id: recordId } });
    const idempotencyKey = `reward_${record.id}`; //TODO 上线时需要修改前缀

    const existing = await this.ledgerService.findByIdempotencyKey(idempotencyKey);
    if (existing && !!existing.externalTxnId) {
      await this.prisma.rewardRecord.update({
        where: { id: record.id },
        data: {
          status: RewardRecordStatus.SUCCESS,
          processedAt: existing.createdAt,
          lastError: null,
          nextRetryAt: null,
        },
      });
      return;
    }
    if (!record.customerEmail) {
      await this.prisma.rewardRecord.update({
        where: { id: record.id },
        data: {
          status: RewardRecordStatus.FAILED,
          attemptCount: record.attemptCount + 1,
          lastError: `Missing customerEmail for reward record ${record.id}`,
          nextRetryAt: null,
        },
      });
      return;
    }

    try {
      const external = await this.beansService.grantBeans({
        // customerEmail: record.customerEmail,
        customerEmail: 'rock.wu@silksoftware.com',
        beans: Number(record.rewardAmount),
        orderAmount: Number(record.totalOrderAmount),
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
      const isRetryable = error instanceof ExternalApiError ? error.retryable : true;
      const canRetry = isRetryable && attempt < 8;
      const retryDelayMinutes = Math.min(60, 5 * 2 ** Math.max(attempt - 1, 0));
      await this.prisma.rewardRecord.update({
        where: { id: record.id },
        data: {
          status: RewardRecordStatus.FAILED,
          attemptCount: attempt,
          lastError: error instanceof Error ? error.message : 'Unknown error',
          nextRetryAt: canRetry ? new Date(Date.now() + retryDelayMinutes * 60_000) : null,
        },
      });
    }
  }

  private async isExistingCustomer(customerId: number, season: string): Promise<boolean> {
    const existing = await this.prisma.customerQuarterSnapshot.findFirst({
      where: {
        customerId,
        season: { not: season },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private getAllocationDate(quarterEndDate: Date): Date {
    const date = new Date(quarterEndDate);
    date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }
}
