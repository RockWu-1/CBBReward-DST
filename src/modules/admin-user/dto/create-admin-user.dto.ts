import { AdminRole } from '@prisma/client';

export class CreateAdminUserDto {
  email!: string;
  password!: string;
  role: AdminRole = AdminRole.OPERATOR;
}
