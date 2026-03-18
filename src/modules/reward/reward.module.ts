import { Module } from '@nestjs/common';
import { BeansModule } from '../beans/beans.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrderModule } from '../order/order.module';
import { RewardService } from './reward.service';

@Module({
  imports: [OrderModule, BeansModule, LedgerModule],
  providers: [RewardService],
  exports: [RewardService],
})
export class RewardModule {}
