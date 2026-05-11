import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AdminUserModule } from '../admin-user/admin-user.module';
import { AuthModule } from '../auth/auth.module';
import { RewardModule } from '../reward/reward.module';
import { AdminActionsService } from './admin.actions';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule, RewardModule, AdminUserModule],
  providers: [AdminActionsService],
  exports: [AdminActionsService],
})
export class AdminModule {}
