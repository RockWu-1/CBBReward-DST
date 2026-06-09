import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PartnerTier, TierRates } from './types/partner-tier.type';

type ResolveRatesInput = {
  tier: PartnerTier;
  isExistingCustomer: boolean;
  bobAmount: Decimal;
  csAmount: Decimal;
  allocationDate: Date;
};

const BOB_LEGACY_FLAT_RATE_END = new Date('2027-06-30T23:59:59.999Z');

@Injectable()
export class RewardCalculatorService {
  resolveTier(totalAmount: Decimal): PartnerTier {
    if (totalAmount.greaterThanOrEqualTo(18750)) return 'ICON';
    if (totalAmount.greaterThanOrEqualTo(10000)) return 'STUDIO';
    if (totalAmount.greaterThanOrEqualTo(5000)) return 'CRAFT';
    if (totalAmount.greaterThanOrEqualTo(2500)) return 'TOP_SHELF';
    if (totalAmount.greaterThanOrEqualTo(1500)) return 'COLLECTIVE';
    return 'NONE';
  }

  resolveRates(input: ResolveRatesInput): TierRates {
    const { tier, isExistingCustomer, bobAmount, csAmount, allocationDate } = input;
    const onlyBobCustomer = bobAmount.greaterThan(0) && csAmount.equals(0);
    if (
      isExistingCustomer &&
      onlyBobCustomer &&
      allocationDate.getTime() <= BOB_LEGACY_FLAT_RATE_END.getTime()
    ) {
      return { bobRate: 0.1, csRate: 0 };
    }

    const tierRates: Record<PartnerTier, TierRates> = {
      NONE: { bobRate: 0, csRate: 0 },
      COLLECTIVE: { bobRate: 0.05, csRate: 0 },
      TOP_SHELF: { bobRate: 0.06, csRate: 0.01 },
      CRAFT: { bobRate: 0.08, csRate: 0.02 },
      STUDIO: { bobRate: 0.09, csRate: 0.03 },
      ICON: { bobRate: 0.1, csRate: 0.04 },
    };

    return tierRates[tier];
  }

  calculateRewards(input: {
    bobAmount: Decimal;
    csAmount: Decimal;
    rates: TierRates;
  }): { bobReward: Decimal; csReward: Decimal; totalReward: Decimal } {
    const bobReward = input.bobAmount.mul(input.rates.bobRate).toDecimalPlaces(2);
    const csReward = input.csAmount.mul(input.rates.csRate).toDecimalPlaces(2);
    const totalReward = bobReward.add(csReward).toDecimalPlaces(2);
    return { bobReward, csReward, totalReward };
  }
}
