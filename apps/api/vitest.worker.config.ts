import { join } from 'node:path';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

import { workerTestPreset } from '../../config/vitest/worker.ts';
import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import { listUnitTestedSources } from '../../config/vitest/unit-tested-sources.ts';

// 判定サービスへの通信は全て差し替えるため、Turnstileのテスト用の秘密鍵を使わず、本番と同じく操作名を照合させる
const TURNSTILE_SECRET_KEY_FOR_TESTS =
  'workers-integration-test-turnstile-secret';

const TEST_HASH_PEPPER = 'test-hash-pepper-for-workers-integration-tests';

// デプロイ先と同じくキーを持たせて決済の処理を通す。Stripeへの通信は各テストがfetchの代わりで止める。シークレットの検出に実在の鍵と誤認させないよう、連結で組み立てる
const TEST_STRIPE_API_KEY = ['rk', 'test', 'WorkersIntegrationTests'].join('_');

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          HASH_PEPPER: TEST_HASH_PEPPER,
          TURNSTILE_SECRET_KEY: TURNSTILE_SECRET_KEY_FOR_TESTS,
          STRIPE_API_KEY: TEST_STRIPE_API_KEY,
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
    // 共用部品のテストは検査担当の共用部品自身が受け持つため、配置先を重ねて実行しない
    exclude: [...configDefaults.exclude, 'common-lib/**'],
    coverage: {
      ...workerTestPreset.coverage,
      include: [
        'src/{infrastructure,presentation,composition}/**/*.ts',
        'src/index.ts',
        'lib/workers/**/*.ts',
        'db/client.ts',
      ],
      // 単体テストが検査するソースは、単体テストのカバレッジで数えるため分母から外す
      exclude: [
        ...workerTestPreset.coverage.exclude,
        ...listUnitTestedSources(import.meta.dirname, 'src/infrastructure'),
        ...listUnitTestedSources(import.meta.dirname, 'lib/workers'),
      ],
    },
  },
});
