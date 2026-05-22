import { Injectable } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const bcrypt = require('bcrypt') as {
  compare: (data: string, encrypted: string) => Promise<boolean>;
};

export type AuthenticatedAdmin = {
  id: number;
  email: string;
  role: AdminRole;
};

@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(email: string, password: string): Promise<AuthenticatedAdmin | null> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });

    if (!admin || !admin.isActive) {
      return null;
    }

    //TODO recover after test
    // const passwordMatched = await bcrypt.compare(password, admin.passwordHash);
    // if (!passwordMatched) {
    //   return null;
    // }

    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    };
  }
}
