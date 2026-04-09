import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { BeansModule } from './modules/beans/beans.module';
import { BigcommerceModule } from './modules/bigcommerce/bigcommerce.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { OrderModule } from './modules/order/order.module';
import { RewardModule } from './modules/reward/reward.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    BigcommerceModule,
    OrderModule,
    BeansModule,
    LedgerModule,
    RewardModule,
    SchedulerModule,
  ],
})
export class AppModule {}
