export const assertRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.NODE_ENV === 'production' && !env.ADMIN_SESSION_SECRET) {
    throw new Error('ADMIN_SESSION_SECRET is required in production');
  }
};
