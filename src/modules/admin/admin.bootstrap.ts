import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminAuthService } from '../auth/admin-auth.service';
import { AdminActionsService } from './admin.actions';
import { buildAdminOptions } from './admin.config';

export const setupAdminPanel = async (app: INestApplication): Promise<void> => {
  const configService = app.get(ConfigService);
  const prisma = app.get(PrismaService);
  const adminAuthService = app.get(AdminAuthService);
  const adminActionsService = app.get(AdminActionsService);

  const options = await buildAdminOptions(
    configService,
    adminAuthService,
    prisma,
    adminActionsService,
  );

  const importEsm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const adminPkg = await importEsm('adminjs');
  const expressAdminPkg = await importEsm('@adminjs/express');
  const AdminJS = adminPkg.default;
  const adminJs = new AdminJS(options.adminJsOptions);
  const rootPath = adminJs.options.rootPath;
  const rewardBatchListPath = `${rootPath}/resources/RewardBatch/actions/list`;
  const expressApp = app.getHttpAdapter().getInstance();

  const redirectToRewardBatchList = (req: any, res: any, next: () => void) => {
    const isLoggedIn = Boolean(req?.session?.adminUser || req?.session?.admin);
    if (!isLoggedIn) {
      return next();
    }
    return res.redirect(rewardBatchListPath);
  };

  expressApp.get(rootPath, redirectToRewardBatchList);
  expressApp.get(`${rootPath}/`, redirectToRewardBatchList);

  const router = expressAdminPkg.buildAuthenticatedRouter(
    adminJs,
    options.auth,
    null,
    options.sessionOptions,
  );

  app.use(adminJs.options.rootPath, router);
};
