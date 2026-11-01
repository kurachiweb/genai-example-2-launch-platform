import { join } from 'node:path';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

import { readNestedD1Migrations } from '../../config/vitest/read-nested-d1-migrations.ts';
import { workerTestPreset } from '../../config/vitest/worker.ts';

const TEST_HASH_PEPPER = 'test-hash-pepper-for-workers-integration-tests';

// 開発者のMailpitへ届かないよう、名前解決されない予約済みのドメインを宛先にする
const TEST_MAILPIT_API_URL = 'http://mailpit.example';

const TEST_EMAIL_FROM_ADDRESS = 'noreply@test.example';

const TEST_EMAIL_EVENTS_QUEUE_NAME = 'genai-example-2-email-events-test';

// デプロイ先と同じく抽出を有効にして試す。外部への通信は各テストがfetchの代わりで止める
const TEST_KEYWORD_EXTRACTOR = 'google-natural-language';

const TEST_GOOGLE_NL_API_KEY =
  'test-google-nl-api-key-for-workers-integration-tests';

// デプロイ先と同じく画像配信を専用のホストで受け、他のホストへの要求が通常の経路へ進むことを試せるようにする
const TEST_IMAGE_DELIVERY_HOSTNAME = 'images.test.example';

const TEST_IMAGE_DELIVERY_DEDICATED_HOST = 'true';

// 判定サービスへ送らず、判定用画像の寸法で結果を決める代替の判定を使う
const TEST_MODERATION_PROVIDER = 'stub';

const TEST_MODERATION_MIN_CONFIDENCE = '60';

const TEST_MODERATION_BLOCKED_CATEGORIES = [
  'Explicit',
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Swimwear or Underwear',
  'Violence',
  'Visually Disturbing',
  'Drugs & Tobacco',
  'Alcohol',
  'Rude Gestures',
  'Gambling',
  'Hate Symbols',
].join(',');

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          HASH_PEPPER: TEST_HASH_PEPPER,
          MAILPIT_API_URL: TEST_MAILPIT_API_URL,
          EMAIL_FROM_ADDRESS: TEST_EMAIL_FROM_ADDRESS,
          EMAIL_EVENTS_QUEUE_NAME: TEST_EMAIL_EVENTS_QUEUE_NAME,
          KEYWORD_EXTRACTOR: TEST_KEYWORD_EXTRACTOR,
          GOOGLE_NL_API_KEY: TEST_GOOGLE_NL_API_KEY,
          IMAGE_DELIVERY_HOSTNAME: TEST_IMAGE_DELIVERY_HOSTNAME,
          IMAGE_DELIVERY_DEDICATED_HOST: TEST_IMAGE_DELIVERY_DEDICATED_HOST,
          MODERATION_PROVIDER: TEST_MODERATION_PROVIDER,
          MODERATION_MIN_CONFIDENCE: TEST_MODERATION_MIN_CONFIDENCE,
          MODERATION_BLOCKED_CATEGORIES: TEST_MODERATION_BLOCKED_CATEGORIES,
          TEST_MIGRATIONS: await readNestedD1Migrations(
            join(import.meta.dirname, 'db', 'migrations'),
          ),
        },
      },
    })),
  ],
  test: {
    ...workerTestPreset,
    // 共有ディレクトリのWorkers統合テストは検査担当(apiと共用部品自身)が受け持つため、配置先を重ねて実行しない
    exclude: [...configDefaults.exclude, 'db/**', 'lib/**', 'common-lib/**'],
    coverage: {
      ...workerTestPreset.coverage,
      include: [
        'src/{infrastructure,presentation,composition}/**/*.{ts,tsx}',
        'src/index.ts',
      ],
    },
  },
});
