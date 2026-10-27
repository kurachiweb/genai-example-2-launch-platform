import { join } from 'node:path';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

import { workerTestPreset } from '../../config/vitest/worker.ts';
import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';

// Cloudflare Turnstileが公開している、常に成功を返すテスト用のシークレット
const TURNSTILE_ALWAYS_PASSES_SECRET_KEY =
  '1x0000000000000000000000000000000AA';

const TEST_HASH_PEPPER = 'test-hash-pepper-for-workers-integration-tests';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          HASH_PEPPER: TEST_HASH_PEPPER,
          TURNSTILE_SECRET_KEY: TURNSTILE_ALWAYS_PASSES_SECRET_KEY,
          TEST_MIGRATIONS: await readNestedD1Migrations(
            join(import.meta.dirname, 'db', 'migrations'),
          ),
        },
        // apiはデッドレターへ送らないが、共有コードのQueue関連の部品をapiで検査するために送信先を加える
        queueProducers: {
          JOBS_DLQ: { queueName: 'genai-example-2-jobs-dlq-dev' },
        },
      },
    })),
  ],
  test: {
    ...workerTestPreset,
    setupFiles: ['./test/setup/apply-migrations.ts'],
    coverage: {
      ...workerTestPreset.coverage,
      include: [
        'src/{infrastructure,presentation,composition}/**/*.ts',
        'src/index.ts',
        'lib/workers/**/*.ts',
        'db/client.ts',
      ],
    },
  },
});
