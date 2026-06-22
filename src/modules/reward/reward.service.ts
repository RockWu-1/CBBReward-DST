import {
  Optional,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, RewardBatchSource, RewardBatchStatus, RewardRecordStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { BeansService } from '../beans/beans.service';
import { BigcommerceService } from '../bigcommerce/bigcommerce.service';
import { LedgerService } from '../ledger/ledger.service';
import { OrderService } from '../order/order.service';
import { TaskService } from '../task/task.service';
import { RewardCalculatorService } from './reward-calculator.service';

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
    @Optional() private readonly taskService?: TaskService,
  ) {}

  async runQuarterlyReward(
    period: QuarterPeriod,
    source: RewardBatchSource = RewardBatchSource.SCHEDULED,
    taskId?: number,
  ): Promise<void> {
    if (taskId) {
      await this.taskService?.markRunning(taskId);
    }

    const batch = await this.getOrCreateBatch(period, source);

    if (batch.status === RewardBatchStatus.COMPLETED) {
      this.logger.log(`Skip completed period=${period.period}`);
      if (taskId) {
        await this.taskService?.markSuccess(taskId, {
          batchId: batch.id,
          recordCount: 0,
          successCount: 0,
          failedCount: 0,
          finalBatchStatus: batch.status,
        });
      }
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
    await this.processPendingRecords(batch.id);

    const pendingOrFailedCount = await this.prisma.rewardRecord.count({
      where: {
        batchId: batch.id,
        status: { in: [RewardRecordStatus.PENDING, RewardRecordStatus.FAILED] },
      },
    });

    const finalBatchStatus =
      pendingOrFailedCount === 0
        ? RewardBatchStatus.COMPLETED
        : RewardBatchStatus.PARTIAL_FAILED;

    await this.prisma.rewardBatch.update({
      where: { id: batch.id },
      data: {
        status: finalBatchStatus,
        finishedAt: new Date(),
      },
    });

    if (!taskId) {
      return;
    }

    const recordCount = await this.prisma.rewardRecord.count({
      where: { batchId: batch.id },
    });
    const successCount = await this.prisma.rewardRecord.count({
      where: { batchId: batch.id, status: RewardRecordStatus.SUCCESS },
    });
    const failedCount = recordCount - successCount;
    const resultPayload = {
      batchId: batch.id,
      recordCount,
      successCount,
      failedCount,
      finalBatchStatus,
    };

    if (failedCount > 0 && successCount > 0) {
      await this.taskService?.markPartialFailed(taskId, resultPayload);
      return;
    }

    if (failedCount > 0) {
      await this.taskService?.markFailed(
        taskId,
        `Period run for ${period.period} failed for all records`,
        resultPayload,
      );
      return;
    }

    await this.taskService?.markSuccess(taskId, resultPayload);
  }

  async rerunQuarterlyReward(
    period: string,
    authToken: string,
    taskId?: number,
  ): Promise<{ success: true }> {
    if (taskId) {
      await this.taskService?.markRunning(taskId);
    }

    if (authToken !== process.env.AUTH_TOKEN) {
      if (taskId) {
        await this.taskService?.markFailed(taskId, 'Invalid auth token', { period });
      }
      throw new UnauthorizedException('Invalid auth token');
    }

    try {
      const quarter = this.parseQuarterPeriod(period);
      this.assertQuarterEndedForRerun(quarter);
      const batch = await this.prisma.rewardBatch.findUnique({
        where: { period: quarter.period },
      });

      const blockedRerunStatuses: RewardBatchStatus[] = [
        RewardBatchStatus.PENDING,
        RewardBatchStatus.PROCESSING,
        RewardBatchStatus.COMPLETED,
        RewardBatchStatus.PARTIAL_FAILED,
      ];

      if (batch && blockedRerunStatuses.includes(batch.status)) {
        throw new BadRequestException(
          `Cannot rerun period ${quarter.period} because batch status is ${batch.status}.`,
        );
      }

      if (batch?.status === RewardBatchStatus.FAILED) {
        const hasIssuedReward = await this.ledgerService.hasIssuedRewardForBatch(batch.id);
        if (hasIssuedReward) {
          throw new ConflictException(
            `Cannot rerun period ${quarter.period} because reward beans have already been issued for this batch.`,
          );
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.rewardBatch.update({
            where: { id: batch.id },
            data: {
              source: RewardBatchSource.RERUN,
              status: RewardBatchStatus.PENDING,
              startedAt: null,
              finishedAt: null,
            },
          });

          await tx.rewardRecord.deleteMany({
            where: {
              batchId: batch.id,
              status: { not: RewardRecordStatus.SUCCESS },
            },
          });
        });
      }

      void this.runQuarterlyReward(quarter, RewardBatchSource.RERUN, taskId);

      return { success: true };
    } catch (error) {
      if (taskId) {
        const message = error instanceof Error ? error.message : String(error);
        await this.taskService?.markFailed(taskId, message, { period });
      }
      throw error;
    }
  }

  async retryFailedRecords(batchId: number, taskId?: number): Promise<void> {
    if (taskId) {
      await this.taskService?.markRunning(taskId);
    }

    const retryCandidates = await this.prisma.rewardRecord.findMany({
      where: {
        batchId,
        status: RewardRecordStatus.FAILED,
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { updatedAt: 'asc' },
      take: 500,
    });

    let successCount = 0;
    const failedRecordIds: number[] = [];

    for (const record of retryCandidates) {
      try {
        await this.processOneRecord(record.id, false);
        successCount += 1;
      } catch (error) {
        failedRecordIds.push(record.id);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Batch retry failed for reward record ${record.id}: ${message}`);
      }
    }

    if (!taskId) {
      return;
    }

    const resultPayload = {
      candidateCount: retryCandidates.length,
      processedCount: retryCandidates.length,
      successCount,
      failedCount: failedRecordIds.length,
      failedRecordIds,
    };

    if (failedRecordIds.length > 0 && successCount > 0) {
      await this.taskService?.markPartialFailed(taskId, resultPayload);
      return;
    }

    if (failedRecordIds.length > 0) {
      await this.taskService?.markFailed(
        taskId,
        `Failed to retry any records for batch ${batchId}`,
        resultPayload,
      );
      return;
    }

    await this.taskService?.markSuccess(taskId, resultPayload);
  }

  async retryRecord(recordId: number, taskId?: number): Promise<void> {
    if (taskId) {
      await this.taskService?.markRunning(taskId);
    }

    try {
      await this.processOneRecord(recordId, true);
      if (taskId) {
        await this.taskService?.markSuccess(taskId, {
          finalStatus: RewardRecordStatus.SUCCESS,
        });
      }
    } catch (error) {
      if (taskId) {
        const message = error instanceof Error ? error.message : String(error);
        await this.taskService?.markFailed(taskId, message, { recordId });
      }
      throw error;
    }
  }

  async retryRecords(recordIds: number[], taskId?: number): Promise<void> {
    const uniqueRecordIds = [...new Set(recordIds)];
    const failedRecordIds: number[] = [];
    let successCount = 0;

    if (taskId) {
      await this.taskService?.markRunning(taskId);
    }

    for (const recordId of uniqueRecordIds) {
      try {
        await this.retryRecord(recordId);
        successCount += 1;
      } catch (error) {
        failedRecordIds.push(recordId);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Bulk retry failed for reward record ${recordId}: ${message}`);
      }
    }

    if (!taskId) {
      return;
    }

    const resultPayload = {
      requestedCount: recordIds.length,
      deduplicatedCount: uniqueRecordIds.length,
      successCount,
      failedCount: failedRecordIds.length,
      failedRecordIds,
    };

    if (failedRecordIds.length > 0 && successCount > 0) {
      await this.taskService?.markPartialFailed(taskId, resultPayload);
      return;
    }

    if (failedRecordIds.length > 0) {
      await this.taskService?.markFailed(
        taskId,
        'Bulk retry failed for all requested records',
        resultPayload,
      );
      return;
    }

    await this.taskService?.markSuccess(taskId, resultPayload);
  }

  async rollbackRecord(
    recordId: number,
    reason: string,
    operator: string,
    taskId?: number,
  ): Promise<void> {
    if (taskId) {
      await this.taskService?.markRunning(taskId);
    }

    try {
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
        if (taskId) {
          await this.taskService?.markSuccess(taskId, {
            finalStatus: RewardRecordStatus.ROLLED_BACK,
            ledgerUpdated: false,
          });
        }
        return;
      }

      const rollbackAmount = new Decimal(record.rewardAmount.toString()).mul(-1);

      const existing = await this.ledgerService.findByRewardRecordId(record.id);
      if (!existing || !existing.externalTxnId) throw new Error('Not found existed add credit record');
      const idempotencyKey = existing.idempotencyKey;
      await this.beansService.rollbackBeans({
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

      if (taskId) {
        await this.taskService?.markSuccess(taskId, {
          finalStatus: RewardRecordStatus.ROLLED_BACK,
          ledgerUpdated: true,
          externalTxnId: existing.externalTxnId,
        });
      }
    } catch (error) {
      if (taskId) {
        const message = error instanceof Error ? error.message : String(error);
        await this.taskService?.markFailed(taskId, message, { recordId, reason, operator });
      }
      throw error;
    }
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

  private parseQuarterPeriod(period: string): QuarterPeriod {
    const match = period.match(/^(\d{4})-Q([1-4])$/);
    if (!match) {
      throw new BadRequestException('Invalid period format');
    }

    return this.buildQuarter(Number(match[1]), Number(match[2]) as 1 | 2 | 3 | 4);
  }

  private assertQuarterEndedForRerun(quarter: QuarterPeriod): void {
    const timeZone = process.env.SCHEDULER_TIMEZONE ?? 'Asia/Shanghai';
    const nowInTimeZone = this.getDateTimePartsInTimeZone(new Date(), timeZone);
    const quarterEndInTimeZone = {
      year: quarter.endDate.getUTCFullYear(),
      month: quarter.endDate.getUTCMonth() + 1,
      day: quarter.endDate.getUTCDate(),
      hour: 23,
      minute: 59,
      second: 59,
    };

    if (this.toComparableDateTime(nowInTimeZone) <= this.toComparableDateTime(quarterEndInTimeZone)) {
      throw new BadRequestException(
        `Cannot rerun period ${quarter.period} before quarter end in timezone ${timeZone}.`,
      );
    }
  }

  private getDateTimePartsInTimeZone(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const entries = formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)] as const);
    const values = Object.fromEntries(entries) as Record<string, number>;

    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      second: values.second,
    };
  }

  private toComparableDateTime(parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  }): number {
    return Number(
      `${parts.year}${String(parts.month).padStart(2, '0')}${String(parts.day).padStart(2, '0')}${String(parts.hour).padStart(2, '0')}${String(parts.minute).padStart(2, '0')}${String(parts.second).padStart(2, '0')}`,
    );
  }

  private async getOrCreateBatch(period: QuarterPeriod, source: RewardBatchSource) {
    try {
      return await this.prisma.rewardBatch.create({
        data: {
          period: period.period,
          startDate: period.startDate,
          endDate: period.endDate,
          source,
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
        allocationDate: this.getAllocationDate(quarterEndDate), //TODO allocation date 需要修改
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
        await this.prisma.rewardRecord.deleteMany({
          where: {
            batchId,
            customerId: item.customerId,
            status: { not: RewardRecordStatus.SUCCESS },
          },
        });
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
    // const record = records[0];
    // console.log('🚀 ~ RewardService ~ processPendingRecords ~ record:', record);
    // await this.processOneRecord(record.id);

    for (const record of records) {
      await this.processOneRecord(record.id);
    }
  }

  private generateRandomRewardIdempotencyKey(): string {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let suffix = '';

    for (let index = 0; index < 12; index += 1) {
      suffix += alphabet[randomInt(alphabet.length)];
    }

    return `reward_${suffix}`;
  }

  private async generateRetryRecordIdempotencyKey(): Promise<string> {
    while (true) {
      const candidate = this.generateRandomRewardIdempotencyKey();
      const existing = await this.ledgerService.findByIdempotencyKey(candidate);
      if (!existing) return candidate;
    }
  }

  private async processOneRecord(recordId: number, ensureUnusedKey = false): Promise<void> {
    const record = await this.prisma.rewardRecord.findUniqueOrThrow({ where: { id: recordId } });

    const existing = await this.ledgerService.findByRewardRecordId(record.id);
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

    const idempotencyKey = ensureUnusedKey
      ? await this.generateRetryRecordIdempotencyKey()
      : this.generateRandomRewardIdempotencyKey();

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
