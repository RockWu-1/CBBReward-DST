import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AdminUserService } from './admin-user.service';

@Module({
  imports: [PrismaModule],
  providers: [AdminUserService],
  exports: [AdminUserService],
})
export class AdminUserModule {}
