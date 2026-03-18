import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';

type GrantBeansInput = {
  userId: string;
  beans: number;
  idempotencyKey: string;
};

type RollbackBeansInput = {
  userId: string;
  beans: number;
  reason: string;
  idempotencyKey: string;
};

@Injectable()
export class BeansService {
  private readonly logger = new Logger(BeansService.name);

  constructor(private readonly http: HttpService) {}

  async grantBeans(input: GrantBeansInput): Promise<{ transactionId: string }> {
    this.logger.log(`Grant beans user=${input.userId} amount=${input.beans}`);

    // Placeholder HTTP call:
    // POST /v1/beans/grants with idempotency key

    return { transactionId: `txn_reward_${input.idempotencyKey}` };
  }

  async rollbackBeans(input: RollbackBeansInput): Promise<{ transactionId: string }> {
    this.logger.warn(
      `Rollback beans user=${input.userId} amount=${input.beans} reason=${input.reason}`,
    );

    // Placeholder HTTP call:
    // POST /v1/beans/reversals with idempotency key

    return { transactionId: `txn_rollback_${input.idempotencyKey}` };
  }
}
