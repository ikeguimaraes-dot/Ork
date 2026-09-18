import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('production rejects missing Supabase configuration before publication', () => {
  for (const valid of [false, true]) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', "await import('./next.config.ts')"], {
      encoding: 'utf8',
      env: {
        ...process.env,
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_APP_URL: valid ? 'https://restaurant.example' : '',
        NEXT_PUBLIC_SUPABASE_URL: valid ? 'https://example.supabase.co' : '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: valid ? 'test' : ' ',
        SUPABASE_SERVICE_ROLE_KEY: valid ? 'test' : '',
      },
    });
    assert.equal(result.status === 0, valid, result.stderr);
    if (!valid) assert.match(result.stderr, /Configuração de produção ausente/);
  }
});
