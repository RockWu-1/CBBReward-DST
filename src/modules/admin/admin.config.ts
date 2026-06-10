import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import { AdminAuthService } from '../auth/admin-auth.service';
import { AdminActionsService } from './admin.actions';

export type AdminSessionUser = {
  id: number;
  email: string;
  role: string;
};

const parseRecordId = (context: any): number => {
  const parsed = Number(context?.record?.params?.id);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid record id');
  }
  return parsed;
};

const parsePayload = (request: any) => request?.payload ?? {};
const parseStatus = (context: any): string => String(context?.record?.params?.status ?? '').toUpperCase();
const canRetryRecord = (status: string): boolean => ['PENDING', 'FAILED'].includes(status);
const canRollbackRecord = (status: string): boolean => status === 'SUCCESS';
const bcrypt = require('bcrypt') as {
  hash: (data: string, saltOrRounds: string | number) => Promise<string>;
};

export const buildAdminOptions = async (
  configService: ConfigService,
  adminAuthService: AdminAuthService,
  prisma: PrismaClient,
  adminActionsService: AdminActionsService,
) => {
  const importEsm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const adminJsPkg = await importEsm('adminjs');
  const adminPrismaPkg = await importEsm('@adminjs/prisma');

  const AdminJS = adminJsPkg.default;
  const { ComponentLoader } = adminJsPkg;
  const { Database, Resource, getModelByName } = adminPrismaPkg;
  AdminJS.registerAdapter({ Database, Resource });
  const componentLoader = new ComponentLoader();
  const dashboardComponentPath = path.resolve(
    process.cwd(),
    'src',
    'modules',
    'admin',
    'components',
    'custom-dashboard.ts',
  );
  const CustomDashboard = componentLoader.add('CustomDashboard', dashboardComponentPath);

  const sessionSecret = configService.get<string>('ADMIN_SESSION_SECRET', 'dev-admin-session-secret');

  return {
    adminJsOptions: {
      rootPath: '/admin',
      branding: {
        companyName: 'CBBReward DST',
        withMadeWithLove: false,
      },
      componentLoader,
      dashboard: {
        component: CustomDashboard,
      },
      resources: [
        {
          resource: { model: getModelByName('RewardBatch'), client: prisma },
          options: {
            navigation: null,
            titleProperty: 'period',
            actions: {
              edit: {
                isAccessible: false,
                isVisible: false,
              },
              retryBatch: {
                actionType: 'record',
                icon: 'Play',
                label: 'Retry Batch',
                component: false,
                handler: async (_request: any, _response: any, context: any) => {
                  const result = await adminActionsService.retryBatch(parseRecordId(context));
                  return { record: context.record?.toJSON(context.currentAdmin), notice: { message: result.message, type: 'success' } };
                },
              },
            },
          },
        },
        {
          resource: { model: getModelByName('RewardRecord'), client: prisma },
          options: {
            navigation: null,
            listProperties: [
              'id',
              'batch',
              'customerEmail',
              // 'totalOrderAmount',
              'bobReward',
              'csReward',
              'rewardAmount',
              'status',
              // 'updatedAt',
            ],
            actions: {
              edit: {
                isAccessible: false,
                isVisible: false,
              },
              retryRecord: {
                actionType: 'record',
                icon: 'Play',
                label: 'Retry Record',
                guard: 'Are you sure you want to retry this reward record?',
                component: false,
                isVisible: (context: any) => canRetryRecord(parseStatus(context)),
                isAccessible: (context: any) => canRetryRecord(parseStatus(context)),
                handler: async (_request: any, _response: any, context: any) => {
                  const status = parseStatus(context);
                  if (!canRetryRecord(status)) {
                    return {
                      record: context.record?.toJSON(context.currentAdmin),
                      notice: { message: `Retry is not allowed for status=${status}`, type: 'error' },
                    };
                  }
                  const result = await adminActionsService.retryRecord(parseRecordId(context));
                  return { record: context.record?.toJSON(context.currentAdmin), notice: { message: result.message, type: 'success' } };
                },
              },
              rollbackRecord: {
                actionType: 'record',
                icon: 'Undo',
                label: 'Rollback',
                guard: 'The rollback operation will reverse the acquired beans points and is irreversible. Continue?',
                component: false,
                isVisible: (context: any) => canRollbackRecord(parseStatus(context)),
                isAccessible: (context: any) => canRollbackRecord(parseStatus(context)),
                handler: async (request: any, _response: any, context: any) => {
                  const status = parseStatus(context);
                  if (!canRollbackRecord(status)) {
                    return {
                      record: context.record?.toJSON(context.currentAdmin),
                      notice: { message: `Rollback is not allowed for status=${status}`, type: 'error' },
                    };
                  }
                  const payload = parsePayload(request);
                  const reason = typeof payload.reason === 'string' ? payload.reason : 'manual rollback';
                  const operator = context.currentAdmin?.email ?? 'admin';
                  const result = await adminActionsService.rollbackRecord(parseRecordId(context), reason, operator);
                  return { record: context.record?.toJSON(context.currentAdmin), notice: { message: result.message, type: 'success' } };
                },
              },
            },
          },
        },
        {
          resource: { model: getModelByName('BeansLedger'), client: prisma },
          options: {
            navigation: null,
            actions: {
              edit: {
                isAccessible: false,
                isVisible: false,
              },
            },
          },
        },
        {
          resource: { model: getModelByName('CustomerQuarterSnapshot'), client: prisma },
          options: {
            navigation: null,
            actions: {
              edit: { isAccessible: false, isVisible: false },
            },
            listProperties: [
              // 'id',
              'customerId',
              'customerEmail',
              'season',
              'totalAmount',
              'bobAmount',
              'csAmount',
              'level',
              // 'updatedAt',
            ],
          },
        },
        {
          resource: { model: getModelByName('AdminUser'), client: prisma },
          options: {
            navigation: null,
            properties: {
              passwordHash: { isVisible: false },
              password: {
                type: 'password',
                isVisible: { list: false, filter: false, show: false, edit: true },
              },
            },
            actions: {
              new: {
                label: 'Create Admin User',
                isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
                  currentAdmin?.role === 'SUPER_ADMIN',
                isVisible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
                  currentAdmin?.role === 'SUPER_ADMIN',
                before: async (request: any) => {
                  if (request.method !== 'post') {
                    return request;
                  }
                  const payload = parsePayload(request);
                  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
                  const password = typeof payload.password === 'string' ? payload.password : '';
                  const role = typeof payload.role === 'string' ? payload.role : 'OPERATOR';
                  if (!email) {
                    throw new Error('Email is required');
                  }
                  if (!password) {
                    throw new Error('Password is required');
                  }
                  const passwordHash = await bcrypt.hash(password, 10);
                  request.payload = {
                    ...payload,
                    email,
                    role,
                    isActive: true,
                    passwordHash,
                  };
                  delete request.payload.password;
                  return request;
                },
              },
              edit: { isAccessible: false, isVisible: false },
            },
          },
        },
      ],
    },
    auth: {
      authenticate: (email: string, password: string): Promise<AdminSessionUser | null> =>
        adminAuthService.authenticate(email, password) as Promise<AdminSessionUser | null>,
      cookieName: 'adminjs',
      cookiePassword: sessionSecret,
    },
    sessionOptions: {
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
    },
  };
};
