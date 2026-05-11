import { assertRuntimeConfig } from '../../../src/common/config/runtime-config.guard';

describe('assertRuntimeConfig', () => {
  it('should fail when ADMIN_SESSION_SECRET is missing in production', () => {
    expect(() => assertRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'ADMIN_SESSION_SECRET is required in production',
    );
  });

  it('should pass when ADMIN_SESSION_SECRET exists in production', () => {
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: 'production',
        ADMIN_SESSION_SECRET: 'secret',
      }),
    ).not.toThrow();
  });
});
