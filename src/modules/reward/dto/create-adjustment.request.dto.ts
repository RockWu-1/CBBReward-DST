import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

export class CreateAdjustmentRequestDto {
  period!: string;
  parentPeriod!: string;
  triggeredBy!: string;
  startDate!: Date;
  endDate!: Date;
  rewardRate!: Prisma.Decimal | Decimal | string | number;
}
