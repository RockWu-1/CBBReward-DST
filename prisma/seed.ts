import { AdminRole, PrismaClient } from '@prisma/client';

const bcrypt = require('bcrypt') as {
  hash: (data: string, saltOrRounds: string | number) => Promise<string>;
};

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@test.com';
  const password = 'silk123456';
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: {
      passwordHash,
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`[seed] super admin ready: ${admin.email} (id=${admin.id})`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
