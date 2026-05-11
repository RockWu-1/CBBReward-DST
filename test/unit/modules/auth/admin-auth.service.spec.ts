import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../../../src/common/prisma/prisma.service';

jest.mock(
  'bcrypt',
  () => ({
    compare: jest.fn(),
  }),
  { virtual: true },
);

const bcrypt = require('bcrypt') as {
  compare: jest.Mock<Promise<boolean>, [string, string]>;
};
const { AdminAuthService } = require('../../../../src/modules/auth/admin-auth.service') as {
  AdminAuthService: new (prisma: PrismaService) => {
    authenticate: (email: string, password: string) => Promise<{
      id: number;
      email: string;
      role: AdminRole;
    } | null>;
  };
};

describe('AdminAuthService.authenticate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns { id, email, role } when credentials are valid', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 1,
      email: 'admin@example.com',
      passwordHash: 'hashed-password',
      role: AdminRole.OPERATOR,
      isActive: true,
    });
    const prisma = { adminUser: { findUnique } } as unknown as PrismaService;
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const service = new AdminAuthService(prisma);
    const result = await service.authenticate('admin@example.com', 'plain-password');

    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'admin@example.com' } });
    expect(bcrypt.compare).toHaveBeenCalledWith('plain-password', 'hashed-password');
    expect(result).toEqual({
      id: 1,
      email: 'admin@example.com',
      role: AdminRole.OPERATOR,
    });
  });

  it('returns null when admin user does not exist', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { adminUser: { findUnique } } as unknown as PrismaService;
    const compareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const service = new AdminAuthService(prisma);
    const result = await service.authenticate('missing@example.com', 'plain-password');

    expect(result).toBeNull();
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('returns null when admin user is inactive', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 2,
      email: 'inactive@example.com',
      passwordHash: 'hashed-password',
      role: AdminRole.SUPER_ADMIN,
      isActive: false,
    });
    const prisma = { adminUser: { findUnique } } as unknown as PrismaService;
    const compareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const service = new AdminAuthService(prisma);
    const result = await service.authenticate('inactive@example.com', 'plain-password');

    expect(result).toBeNull();
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('returns null when password verification fails', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 3,
      email: 'admin@example.com',
      passwordHash: 'hashed-password',
      role: AdminRole.OPERATOR,
      isActive: true,
    });
    const prisma = { adminUser: { findUnique } } as unknown as PrismaService;
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    const service = new AdminAuthService(prisma);
    const result = await service.authenticate('admin@example.com', 'wrong-password');

    expect(result).toBeNull();
  });
});
