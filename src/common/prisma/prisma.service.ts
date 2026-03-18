import { INestApplication, Injectable, OnModuleInit, OnApplicationShutdown} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
  let retries = 10;

  while (retries > 0) {
    try {
      await this.$connect();
      console.log('✅ Prisma connected');
      return;
    } catch (error: any) {
      console.error('❌ Prisma connect failed, retrying...', error.message);
      retries--;
      await new Promise(res => setTimeout(res, 3000));
    }
  }

  console.error('❌ Could not connect to DB, but app will stay alive');
}

 async onApplicationShutdown() {
    await this.$disconnect();
  }
}
