import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
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
  const { Database, Resource, getModelByName } = adminPrismaPkg;
  AdminJS.registerAdapter({ Database, Resource });

  const sessionSecret = configService.get<string>('ADMIN_SESSION_SECRET', 'dev-admin-session-secret');

  return {
    adminJsOptions: {
      rootPath: '/admin',
      resources: [
        {
          resource: { model: getModelByName('RewardBatch'), client: prisma },
          options: {
            actions: {
              retryBatch: {
                actionType: 'record',
                icon: 'Play',
                label: 'Retry Batch',
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
            actions: {
              retryRecord: {
                actionType: 'record',
                icon: 'Play',
                label: 'Retry Record',
                handler: async (_request: any, _response: any, context: any) => {
                  const result = await adminActionsService.retryRecord(parseRecordId(context));
                  return { record: context.record?.toJSON(context.currentAdmin), notice: { message: result.message, type: 'success' } };
                },
              },
              rollbackRecord: {
                actionType: 'record',
                icon: 'Undo',
                label: 'Rollback',
                guard: 'This will create a negative ledger entry. Continue?',
                handler: async (request: any, _response: any, context: any) => {
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
        { resource: { model: getModelByName('BeansLedger'), client: prisma } },
        { resource: { model: getModelByName('OrderSnapshot'), client: prisma } },
        {
          resource: { model: getModelByName('AdminUser'), client: prisma },
          options: {
            properties: {
              passwordHash: { isVisible: false },
              password: {
                type: 'password',
                isVisible: { list: false, filter: false, show: false, edit: true },
              },
            },
            actions: {
              new: { isAccessible: false },
              createAdminUser: {
                actionType: 'resource',
                label: 'Create Admin User',
                isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
                  currentAdmin?.role === 'SUPER_ADMIN',
                handler: async (request: any, _response: any, context: any) => {
                  if (request.method !== 'post') {
                    return {};
                  }
                  const payload = parsePayload(request);
                  const email = typeof payload.email === 'string' ? payload.email : '';
                  const password = typeof payload.password === 'string' ? payload.password : '';
                  const role = typeof payload.role === 'string' ? payload.role : 'OPERATOR';
                  const result = await adminActionsService.createAdminUser(
                    {
                      id: Number(context.currentAdmin?.id ?? 0),
                      email: String(context.currentAdmin?.email ?? ''),
                      role: context.currentAdmin?.role as any,
                    },
                    { email, password, role: role as any },
                  );
                  return { notice: { message: result.message, type: 'success' } };
                },
              },
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
