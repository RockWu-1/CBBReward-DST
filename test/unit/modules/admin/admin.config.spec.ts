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
});
