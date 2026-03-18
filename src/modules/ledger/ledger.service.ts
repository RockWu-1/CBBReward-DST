import { Injectable } from '@nestjs/common';
import { BeansLedger, LedgerType, Prisma, RewardRecord } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  findByIdempotencyKey(idempotencyKey: string): Promise<BeansLedger | null> {
    return this.prisma.beansLedger.findUnique({ where: { idempotencyKey } });
  }

  appendRewardLedger(
    tx: Prisma.TransactionClient,
    record: RewardRecord,
    amount: Decimal,
    idempotencyKey: string,
    externalTxnId: string,
  ) {
    return tx.beansLedger.create({
      data: {
        userId: record.userId,
        rewardRecordId: record.id,
        changeAmount: new Prisma.Decimal(amount.toString()),
        type: LedgerType.REWARD,
        referenceId: `${record.batchId}:${record.id}`,
        idempotencyKey,
        externalTxnId,
      },
    });
  }

  appendRollbackLedger(
    tx: Prisma.TransactionClient,
    record: RewardRecord,
    negativeAmount: Decimal,
    idempotencyKey: string,
    externalTxnId: string,
    metadata: Prisma.JsonObject,
  ) {
    return tx.beansLedger.create({
      data: {
        userId: record.userId,
        rewardRecordId: record.id,
        changeAmount: new Prisma.Decimal(negativeAmount.toString()),
        type: LedgerType.ROLLBACK,
        referenceId: `${record.batchId}:${record.id}`,
        idempotencyKey,
        externalTxnId,
        metadata,
      },
    });
  }
}
