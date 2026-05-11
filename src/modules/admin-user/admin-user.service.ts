import { Injectable } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

const bcrypt = require('bcrypt') as {
  hash: (data: string, saltOrRounds: string | number) => Promise<string>;
};

@Injectable()
export class AdminUserService {
  constructor(private readonly prisma: PrismaService) {}

  async createAdminUser(dto: CreateAdminUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.adminUser.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        passwordHash,
        role: dto.role ?? AdminRole.OPERATOR,
        isActive: true,
      },
    });
  }
}
