import { readFileSync } from 'fs';
import { join } from 'path';

describe('.env.example required keys', () => {
  it('contains all BEANS reward engine keys', () => {
    const envExamplePath = join(process.cwd(), '.env.example');
    const content = readFileSync(envExamplePath, 'utf8');
    const requiredKeys = [
      'BEANS_REWARD_RULE',
      'BEANS_ROLLBACK_RULE',
      'BEANS_API_TIMEOUT_MS',
      'BEANS_REAL_CALL_ENABLED',
      'BEANS_SAFE_ACCOUNT',
    ];

    for (const key of requiredKeys) {
      expect(content).toMatch(new RegExp(`^${key}=`, 'm'));
    }
  });
});
