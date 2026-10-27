import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

import { workerTestPreset } from '../../config/vitest/worker.ts';

const TEST_HASH_PEPPER = 'test-hash-pepper-for-workers-integration-tests';

// 開発者のMailpitへ届かないよう、名前解決されない予約済みのドメインを宛先にする
const TEST_MAILPIT_API_URL = 'http://mailpit.example';

const TEST_EMAIL_FROM_ADDRESS = 'noreply@test.example';

const TEST_EMAIL_EVENTS_QUEUE_NAME = 'genai-example-2-email-events-test';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          HASH_PEPPER: TEST_HASH_PEPPER,
          MAILPIT_API_URL: TEST_MAILPIT_API_URL,
          EMAIL_FROM_ADDRESS: TEST_EMAIL_FROM_ADDRESS,
          EMAIL_EVENTS_QUEUE_NAME: TEST_EMAIL_EVENTS_QUEUE_NAME,
        },
      },
    }),
  ],
  test: {
    ...workerTestPreset,
    // 共有ディレクトリのWorkers統合テストは検査担当のapiが受け持つため、配置先を重ねて実行しない
    exclude: [...configDefaults.exclude, 'db/**', 'lib/**'],
    coverage: {
      ...workerTestPreset.coverage,
      include: [
        'src/{infrastructure,presentation,composition}/**/*.{ts,tsx}',
        'src/index.ts',
      ],
    },
  },
});
