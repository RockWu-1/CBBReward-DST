import * as fs from 'fs';
import * as path from 'path';

describe('admin.config RewardRecord batch display', () => {
  it('uses RewardBatch period as title and renders RewardRecord batch as a reference column', () => {
    const filePath = path.join(process.cwd(), 'src', 'modules', 'admin', 'admin.config.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("titleProperty: 'period'");
    expect(source).toContain("'batch',");
    expect(source).not.toContain("'batch.period'");
  });

  it('keeps both Retry Record and Retry All actions for reward records', () => {
    const filePath = path.join(process.cwd(), 'src', 'modules', 'admin', 'admin.config.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('retryRecord: {');
    expect(source).toContain("actionType: 'record'");
    expect(source).toContain("label: 'Retry Record'");
    expect(source).toContain('retryRecords: {');
    expect(source).toContain("actionType: 'bulk'");
    expect(source).toContain("label: 'Retry All'");
    expect(source).toContain('const ids = records');
    expect(source).toContain('adminActionsService.retryRecords(ids)');
  });

  it('makes Retry All visibility work from per-record bulkActions generation', () => {
    const filePath = path.join(process.cwd(), 'src', 'modules', 'admin', 'admin.config.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('context.record');
    expect(source).toContain('record?.params?.status');
  });
});

describe('admin branding assets', () => {
  it('uses the public admin logo asset in AdminJS branding', () => {
    const filePath = path.join(process.cwd(), 'src', 'modules', 'admin', 'admin.config.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("logo: '/admin-assets/cbb_logo.png'");
  });

  it('serves the public admin-assets directory from the app root', () => {
    const filePath = path.join(process.cwd(), 'src', 'main.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("app.use('/admin-assets'");
    expect(source).toContain("'public', 'admin-assets'");
  });

  it('uses custom English login copy for the AdminJS welcome panel', () => {
    const filePath = path.join(process.cwd(), 'src', 'modules', 'admin', 'admin.config.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("language: 'en'");
    expect(source).toContain("translations: {");
    expect(source).toContain("en: {");
    expect(source).toContain("components: {");
    expect(source).toContain("welcomeHeader: 'Welcome'");
    expect(source).toContain('welcomeMessage:');
    expect(source).toContain(
      'CBB Reward admin portal for quarterly rewards, reruns, and rollback operations.',
    );
    expect(source).toContain("loginButton: 'Sign in'");
  });
});
