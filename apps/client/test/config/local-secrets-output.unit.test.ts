import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cloudflare } from '@cloudflare/vite-plugin';
import { createBuilder, type PluginOption } from 'vite';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

import {
  excludeLocalSecretsFile,
  LOCAL_SECRETS_FILE_NAME,
} from '../../lib/config/local-secrets-output.ts';
import viteConfig from '../../vite.config.ts';

const EXCLUDE_PLUGIN_NAME = excludeLocalSecretsFile().name;

const FAKE_SECRET_KEY = 'LOCAL_SECRETS_OUTPUT_FAKE_SECRET';

const FAKE_SECRET_VALUE = 'fake-value-for-test';

const FAKE_WORKER_NAME = 'fake-worker';

// @cloudflare/vite-pluginは、環境を指定しても、ルートのWorker名の-を_に替えた名前でビルド結果のディレクトリを作る
const FAKE_WORKER_OUTPUT_DIR = 'fake_worker';

// ビルド中に@cloudflare/vite-pluginが読み書きする環境の変数を、テストの後に元へ戻す
const TOUCHED_ENV_KEYS = [
  FAKE_SECRET_KEY,
  'CLOUDFLARE_ENV',
  'CLOUDFLARE_VITE_BUILD',
] as const;

// 本物の@cloudflare/vite-pluginによるビルドは単体テストの既定の5秒を超え得る
const BUILD_TIMEOUT_MS = 60_000;

function pluginNames(option: unknown): string[] {
  if (Array.isArray(option)) {
    return option.flatMap((item: unknown) => pluginNames(item));
  }
  return option !== null &&
    typeof option === 'object' &&
    'name' in option &&
    typeof option.name === 'string'
    ? [option.name]
    : [];
}

describe('vite.config.ts', () => {
  test('ビルド結果からローカルのシークレットのファイルを除くプラグインを使う', () => {
    expect(pluginNames(viteConfig.plugins ?? [])).toContain(
      EXCLUDE_PLUGIN_NAME,
    );
  });
});

describe('本物の@cloudflare/vite-pluginによる偽のWorkerのビルド', () => {
  let rootDir: string;
  let savedEnv: Partial<Record<(typeof TOUCHED_ENV_KEYS)[number], string>>;

  beforeEach(async () => {
    savedEnv = Object.fromEntries(
      TOUCHED_ENV_KEYS.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    );
    for (const key of TOUCHED_ENV_KEYS) {
      Reflect.deleteProperty(process.env, key);
    }
    rootDir = await mkdtemp(join(tmpdir(), 'local-secrets-output-'));
    await writeFile(
      join(rootDir, 'worker.js'),
      'export default { fetch() { return new Response("ok"); } };\n',
    );
    await writeFile(
      join(rootDir, 'wrangler.jsonc'),
      JSON.stringify({
        name: FAKE_WORKER_NAME,
        main: './worker.js',
        compatibility_date: '2026-08-04',
        secrets: { required: [FAKE_SECRET_KEY] },
        env: {
          staging: {
            name: `${FAKE_WORKER_NAME}-staging`,
            secrets: { required: [FAKE_SECRET_KEY] },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    for (const key of TOUCHED_ENV_KEYS) {
      Reflect.deleteProperty(process.env, key);
    }
    Object.assign(process.env, savedEnv);
    await rm(rootDir, { recursive: true, force: true });
  });

  async function buildFakeWorker(
    pluginsAfter: PluginOption[],
    pluginsBefore: PluginOption[] = [],
  ): Promise<string> {
    const builder = await createBuilder({
      root: rootDir,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        ...pluginsBefore,
        cloudflare({
          configPath: join(rootDir, 'wrangler.jsonc'),
          persistState: false,
        }),
        ...pluginsAfter,
      ],
    });
    await builder.buildApp();
    return join(rootDir, 'dist', FAKE_WORKER_OUTPUT_DIR);
  }

  test(
    '除く処理が無ければ、注入した偽のシークレットがビルド結果にファイルとして書き出される',
    async () => {
      process.env[FAKE_SECRET_KEY] = FAKE_SECRET_VALUE;

      const outputDir = await buildFakeWorker([]);

      expect(await readdir(outputDir)).toContain(LOCAL_SECRETS_FILE_NAME);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    '除く処理があれば、注入の下のビルドでもファイルを書き出さず、Wrangler設定のsecrets.requiredとWorkerのコードを残す',
    async () => {
      process.env[FAKE_SECRET_KEY] = FAKE_SECRET_VALUE;

      const outputDir = await buildFakeWorker([excludeLocalSecretsFile()]);
      const files = await readdir(outputDir);

      expect(files).not.toContain(LOCAL_SECRETS_FILE_NAME);
      expect(files).toContain('index.mjs');
      expect(
        JSON.parse(await readFile(join(outputDir, 'wrangler.json'), 'utf8')),
      ).toMatchObject({ secrets: { required: [FAKE_SECRET_KEY] } });
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    '除く処理を@cloudflare/vite-pluginより前に置いても、ファイルを書き出さない',
    async () => {
      process.env[FAKE_SECRET_KEY] = FAKE_SECRET_VALUE;

      const outputDir = await buildFakeWorker([], [excludeLocalSecretsFile()]);
      const files = await readdir(outputDir);

      expect(files).not.toContain(LOCAL_SECRETS_FILE_NAME);
      expect(files).toContain('wrangler.json');
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    'ファイルが無いビルド結果をプレビューで動かす時、注入した値をprocess.envから読んでWorkerへ渡し、注入しなければ渡さない',
    async () => {
      process.env[FAKE_SECRET_KEY] = FAKE_SECRET_VALUE;
      const outputDir = await buildFakeWorker([excludeLocalSecretsFile()]);
      const builtConfigPath = join(outputDir, 'wrangler.json');

      const injected = unstable_getMiniflareWorkerOptions(builtConfigPath);
      Reflect.deleteProperty(process.env, FAKE_SECRET_KEY);
      const notInjected = unstable_getMiniflareWorkerOptions(builtConfigPath);

      expect(injected.workerOptions.bindings).toMatchObject({
        [FAKE_SECRET_KEY]: FAKE_SECRET_VALUE,
      });
      expect(notInjected.workerOptions.bindings ?? {}).not.toHaveProperty(
        FAKE_SECRET_KEY,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    '注入せずに環境を指定したビルドは、除く処理が無くてもファイルを書き出さない',
    async () => {
      process.env.CLOUDFLARE_ENV = 'staging';

      const outputDir = await buildFakeWorker([]);

      expect(await readdir(outputDir)).not.toContain(LOCAL_SECRETS_FILE_NAME);
      expect(
        JSON.parse(await readFile(join(outputDir, 'wrangler.json'), 'utf8')),
      ).toMatchObject({
        name: `${FAKE_WORKER_NAME}-staging`,
        secrets: { required: [FAKE_SECRET_KEY] },
      });
    },
    BUILD_TIMEOUT_MS,
  );
});
