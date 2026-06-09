import { Module } from '@nestjs/common';
import { BeansModule } from '../beans/beans.module';
import { BigcommerceModule } from '../bigcommerce/bigcommerce.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrderModule } from '../order/order.module';
import { RewardController } from './reward.controller';
import { RewardCalculatorService } from './reward-calculator.service';
import { RewardService } from './reward.service';

@Module({
  imports: [OrderModule, BeansModule, LedgerModule, BigcommerceModule],
  controllers: [RewardController],
  providers: [RewardService, RewardCalculatorService],
  exports: [RewardService],
})
export class RewardModule {}
