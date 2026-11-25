import { describe, expect, test } from 'bun:test';

import { commandLineOf } from '../test-fixtures/command-runner.ts';
import {
  BUNDLED_SCRIPT_ARGS,
  CLOUDFLARE_CHILD_ENV,
  SENTRY_CLI_ENV,
  SENTRY_FOLDER,
  SENTRY_TOKEN,
  bundleLineOf,
  bundledDeployLineOf,
  deployArgsOf,
  foldersOf,
  injectLineOf,
  maskedBefore,
  removeMapsLineOf,
  runWith,
  shownSecretsOf,
  stepOf,
  uploadLineOf,
} from '../test-fixtures/deploy-worker.ts';
import { folderKeyOf } from '../test-fixtures/infisical.ts';
import { EXIT_FAILURE, EXIT_SUCCESS } from './shared/delivery-command.ts';

const withSentry = () =>
  foldersOf('staging', {
    [folderKeyOf('staging', '/ci/sentry')]: SENTRY_FOLDER,
  });

const BUNDLED_API_DIR = 'apps/api/.wrangler/sourcemaps';
const BUNDLED_EVENT_DIR = 'apps/event/.wrangler/sourcemaps';

describe('deploy-workerのソースマップの手順', () => {
  test.each([
    ['api', BUNDLED_API_DIR],
    ['event', BUNDLED_EVENT_DIR],
  ] as const)(
    '%sは、Wranglerのバンドルを出力先へ書き出し、デバッグIDの埋め込みとアップロードをしてから、その出力を再バンドルせずにデプロイする',
    async (app, artifactDir) => {
      const { code, calls, shown } = await runWith(
        ['--env', 'staging', '--app', app],
        { folders: withSentry() },
      );

      expect(code).toBe(EXIT_SUCCESS);
      const lines = calls.map((spec) => commandLineOf(spec));
      expect(lines.slice(-4)).toEqual([
        bundleLineOf('staging'),
        injectLineOf(artifactDir),
        uploadLineOf(artifactDir),
        bundledDeployLineOf('staging'),
      ]);
      const [bundle, inject, upload, deploy] = calls.slice(-4);
      expect(bundle?.cwd).toEndWith(`/apps/${app}`);
      expect(bundle?.env).toBeUndefined();
      for (const spec of [inject, upload]) {
        expect(spec?.env).toEqual(SENTRY_CLI_ENV);
      }
      expect(deploy?.env).toEqual(CLOUDFLARE_CHILD_ENV);
      expect(deploy?.args).toEqual(
        deployArgsOf(['--env', 'staging'], BUNDLED_SCRIPT_ARGS),
      );
      expect(shownSecretsOf(shown)).toEqual([]);
    },
  );

  test.each(['client', 'admin'] as const)(
    '%sは、ビルドの後に、デバッグIDの埋め込みとアップロードをして、静的な配信物の.mapを削除してからデプロイする',
    async (app) => {
      const { code, calls } = await runWith(
        ['--env', 'staging', '--app', app],
        { folders: withSentry() },
      );

      expect(code).toBe(EXIT_SUCCESS);
      expect(calls.map((spec) => commandLineOf(spec))).toEqual([
        'bun run build',
        injectLineOf(`apps/${app}/dist`),
        uploadLineOf(`apps/${app}/dist`),
        removeMapsLineOf(app),
        ['bun', ...deployArgsOf([])].join(' '),
      ]);
    },
  );

  test('トークンのマスクを、埋め込みとアップロードの起動より先に行い、デプロイの子プロセスへはSentryの値を渡さない', async () => {
    const { timeline, calls } = await runWith(
      ['--env', 'staging', '--app', 'client'],
      { folders: withSentry() },
    );

    const inject = timeline.findIndex((event) =>
      event.includes('sentry-cli sourcemaps inject'),
    );
    expect(maskedBefore(timeline, inject)).toContain(SENTRY_TOKEN);
    const deploy = calls.find((spec) => stepOf(spec) === 'deploy');
    expect(Object.keys(deploy?.env ?? {})).not.toContain('SENTRY_AUTH_TOKEN');
  });

  test.each(['api', 'event', 'client', 'admin'] as const)(
    '%sは、/ci/sentryの値が無い環境では、警告を出してアップロードを飛ばし、デプロイを続ける',
    async (app) => {
      const { code, calls, stderr } = await runWith([
        '--env',
        'staging',
        '--app',
        app,
      ]);

      expect(code).toBe(EXIT_SUCCESS);
      const steps = calls.map((spec) => stepOf(spec));
      expect(steps).not.toContain('inject');
      expect(steps).not.toContain('upload');
      expect(steps.at(-1)).toBe('deploy');
      expect(stderr.text()).toContain('ソースマップのアップロードを飛ばします');
    },
  );

  test('埋め込みが失敗しても、アップロードを飛ばし、警告を要約に書いてデプロイを続ける', async () => {
    const { code, calls, summaries } = await runWith(
      ['--env', 'staging', '--app', 'api'],
      { folders: withSentry(), failAt: 'inject' },
    );

    expect(code).toBe(EXIT_SUCCESS);
    const steps = calls.map((spec) => stepOf(spec));
    expect(steps).not.toContain('upload');
    expect(steps.at(-1)).toBe('deploy');
    expect(summaries.join('\n')).toContain('元のソースの位置を表示できません');
  });

  test('アップロードが失敗しても、デプロイを続ける', async () => {
    const { code, calls } = await runWith(
      ['--env', 'staging', '--app', 'event'],
      { folders: withSentry(), failAt: 'upload' },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(calls.map((spec) => stepOf(spec)).at(-1)).toBe('deploy');
  });

  test('client・adminの.mapの削除が失敗したら、デプロイせずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--app', 'client'],
      { folders: withSentry(), failAt: 'remove-maps' },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map((spec) => stepOf(spec))).not.toContain('deploy');
    expect(stderr.text()).toContain('.mapを削除できませんでした');
  });

  test('api・eventのバンドルが失敗したら、アップロードもデプロイもせずに失敗する', async () => {
    const { code, calls, stderr } = await runWith(
      ['--env', 'staging', '--app', 'event'],
      { folders: withSentry(), failAt: 'bundle' },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(calls.map((spec) => commandLineOf(spec))).toEqual([
      bundleLineOf('staging'),
    ]);
    expect(stderr.text()).toContain('終了コード1');
  });

  test('prodでも、prodの/ci/sentryの値を使う', async () => {
    const { code, timeline } = await runWith(
      ['--env', 'prod', '--app', 'client'],
      {
        folders: foldersOf('prod', {
          [folderKeyOf('prod', '/ci/sentry')]: SENTRY_FOLDER,
        }),
      },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline.some((event) => event.includes(':prod:/ci/sentry:'))).toBe(
      true,
    );
  });
});
