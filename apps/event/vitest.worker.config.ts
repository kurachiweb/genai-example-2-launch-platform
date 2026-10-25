import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

import { workerTestPreset } from '../../config/vitest/worker.ts';

const TEST_HASH_PEPPER = 'test-hash-pepper-for-workers-integration-tests';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { HASH_PEPPER: TEST_HASH_PEPPER },
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
        'src/{infrastructure,presentation,composition}/**/*.ts',
        'src/index.ts',
      ],
    },
  },
});
