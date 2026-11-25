import { describe, expect, test } from 'bun:test';

import type { CommandRunner, CommandSpec } from '../adapters/command-runner.ts';
import type { WorkerKey } from '../catalog/resource-catalog.ts';
import type { SecretEntry } from '../core/secret-scope.ts';
import { commandLineOf } from '../test-fixtures/command-runner.ts';
import {
  CATALOG_HOST,
  createFakeSecretSource,
  createRecordingGithub,
  folderKeyOf,
  infisicalRepoTexts,
} from '../test-fixtures/infisical.ts';
import {
  FAKE_REPO_ROOT,
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import { PROJECT_ID } from '../test-fixtures/resource-catalog.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';
import { command } from './upload-sourcemaps.ts';

const TOKEN = 'fake-sentry-auth-token';
const ORG = 'example-org';
const PROJECT = 'example-project';

const SENTRY_FOLDER: readonly SecretEntry[] = [
  { key: 'SENTRY_AUTH_TOKEN', value: TOKEN },
  { key: 'SENTRY_ORG', value: ORG },
  { key: 'SENTRY_PROJECT', value: PROJECT },
];

type Step = 'inject' | 'upload' | 'remove-maps';

const stepOf = (spec: CommandSpec): Step | undefined => {
  if (spec.command === 'find') return 'remove-maps';
  if (spec.args.includes('inject')) return 'inject';
  if (spec.args.includes('upload')) return 'upload';
  return undefined;
};

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly folder?: readonly SecretEntry[] | null;
  readonly failAt?: Step;
}

const runWith = async (
  args: readonly string[],
  {
    env = { INFISICAL_TOKEN: 'fake-access-token' },
    folder = SENTRY_FOLDER,
    failAt,
  }: RunOptions = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      const failed = failAt !== undefined && stepOf(spec) === failAt;
      return Promise.resolve({
        code: failed ? 1 : 0,
        stdout: failed ? '' : '処理の出力\n',
        stderr: failed ? `${failAt}の失敗の診断\n` : '',
      });
    },
    start: () => {
      throw new Error('常駐の起動は使わない');
    },
  };
  const fake = createFakeDeps(createFakeRepoFiles(infisicalRepoTexts()));
  const code = await command.run(args, {
    ...fake.deps,
    env,
    runner,
    github: createRecordingGithub(timeline),
    secrets: createFakeSecretSource({
      timeline,
      folders:
        folder === null
          ? {}
          : { [folderKeyOf('staging', '/ci/sentry')]: folder },
    }),
  });
  const summaries = timeline
    .filter((event) => event.startsWith('summary:'))
    .map((event) => event.slice('summary:'.length));
  const shown = [fake.stdout.text(), fake.stderr.text(), ...summaries].join(
    '\n',
  );
  return {
    ...fake,
    code,
    calls,
    timeline,
    summaries,
    shown,
    steps: calls.map(stepOf),
  };
};

const ARGS = (app: WorkerKey): readonly string[] => [
  '--env',
  'staging',
  '--app',
  app,
];

const expectUsageError = async (promise: Promise<unknown>): Promise<void> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UsageError);
};

describe('upload-sourcemaps', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('upload-sourcemaps');
    expect(command.description).not.toBe('');
  });

  test.each([[[]], [['--env', 'staging']], [['--app', 'client']]])(
    '環境とアプリの指定が足りなければ使い方の誤りにする(%j)',
    async (args) => {
      await expectUsageError(runWith(args));
    },
  );

  test('未知のアプリは使い方の誤りにする', async () => {
    await expectUsageError(runWith(['--env', 'staging', '--app', 'x']));
  });

  describe('値が揃っている', () => {
    test.each(['client', 'admin'] as const)(
      '%sは、資源一覧の主体で/ci/sentryを取り出し、埋め込み→アップロード→.mapの削除の順に呼ぶ',
      async (app) => {
        const result = await runWith(ARGS(app));

        expect(result.code).toBe(EXIT_SUCCESS);
        expect(result.timeline).toContain(
          `export:${PROJECT_ID}:staging:/ci/sentry:${CATALOG_HOST}`,
        );
        expect(result.calls.map(commandLineOf)).toEqual([
          `bun x --no-install sentry-cli sourcemaps inject apps/${app}/dist`,
          `bun x --no-install sentry-cli sourcemaps upload apps/${app}/dist`,
          `find apps/${app}/dist/client -type f -name *.map -delete`,
        ]);
        for (const call of result.calls) {
          expect(call.cwd).toBe(FAKE_REPO_ROOT);
        }
      },
    );

    test.each(['api', 'event'] as const)(
      '%sは、Wranglerの出力先を埋め込みとアップロードの対象にし、.mapの削除は呼ばない',
      async (app) => {
        const result = await runWith(ARGS(app));

        expect(result.code).toBe(EXIT_SUCCESS);
        expect(result.calls.map(commandLineOf)).toEqual([
          `bun x --no-install sentry-cli sourcemaps inject apps/${app}/.wrangler/sourcemaps`,
          `bun x --no-install sentry-cli sourcemaps upload apps/${app}/.wrangler/sourcemaps`,
        ]);
      },
    );

    test('トークンのマスクを、最初のコマンドの実行より先に行う', async () => {
      const { timeline } = await runWith(ARGS('client'));

      const maskIndex = timeline.indexOf(`mask:${TOKEN}`);
      const firstRunIndex = timeline.findIndex((event) =>
        event.startsWith('run:'),
      );
      expect(maskIndex).toBeGreaterThanOrEqual(0);
      expect(maskIndex).toBeLessThan(firstRunIndex);
    });

    test('マスクはトークンだけにし、組織やプロジェクトの名前をログ全体から伏せない', async () => {
      const { timeline } = await runWith(ARGS('client'));

      const masked = timeline.filter((event) => event.startsWith('mask:'));
      expect(masked).toEqual([`mask:${TOKEN}`]);
    });

    test('sentry-cliの手順だけに3つの値を環境変数で渡し、引数・表示には載せない', async () => {
      const result = await runWith(ARGS('client'));

      for (const call of result.calls) {
        if (call.command === 'find') {
          expect(call.env).toBeUndefined();
        } else {
          expect(call.env).toEqual({
            SENTRY_AUTH_TOKEN: TOKEN,
            SENTRY_ORG: ORG,
            SENTRY_PROJECT: PROJECT,
          });
        }
        expect(call.args.join(' ')).not.toContain(TOKEN);
      }
      expect(result.shown).not.toContain(TOKEN);
    });

    test('子プロセスの出力を取り込み、標準出力と標準エラーへ中継する', async () => {
      const result = await runWith(ARGS('client'));

      for (const call of result.calls) expect(call.output).toBe('capture');
      expect(result.stdout.text()).toContain('処理の出力');
    });
  });

  describe('値が欠けている', () => {
    test.each([
      ['フォルダに一部のキーが無い', [{ key: 'SENTRY_ORG', value: ORG }]],
      ['フォルダが空', []],
      [
        'トークンが空',
        [
          { key: 'SENTRY_AUTH_TOKEN', value: '' },
          { key: 'SENTRY_ORG', value: ORG },
          { key: 'SENTRY_PROJECT', value: PROJECT },
        ],
      ],
    ] as const)(
      '%s場合は、警告を1行出してアップロードを飛ばし、成功で終わる',
      async (_name, folder) => {
        const result = await runWith(ARGS('api'), { folder });

        expect(result.code).toBe(EXIT_SUCCESS);
        expect(result.calls).toEqual([]);
        const warnings = result.stderr
          .text()
          .split('\n')
          .filter((line) => line !== '');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('警告');
        expect(warnings[0]).toContain('/ci/sentry');
      },
    );

    test('欠けたキーの名前を警告に示す', async () => {
      const result = await runWith(ARGS('api'), {
        folder: [{ key: 'SENTRY_ORG', value: ORG }],
      });

      expect(result.stderr.text()).toContain('SENTRY_AUTH_TOKEN');
      expect(result.stderr.text()).toContain('SENTRY_PROJECT');
      expect(result.stderr.text()).not.toContain('SENTRY_ORG');
    });

    test('アップロードを飛ばしても、client・adminの配信物から.mapを削除する', async () => {
      const result = await runWith(ARGS('client'), { folder: [] });

      expect(result.code).toBe(EXIT_SUCCESS);
      expect(result.calls.map(commandLineOf)).toEqual([
        'find apps/client/dist/client -type f -name *.map -delete',
      ]);
    });

    test('/ci/sentryを取り出せない環境(stagingの準備の前)も、警告で継続する', async () => {
      const result = await runWith(ARGS('client'), { folder: null });

      expect(result.code).toBe(EXIT_SUCCESS);
      expect(result.stderr.text()).toContain('警告');
      expect(result.stderr.text()).toContain('/ci/sentry');
      expect(result.steps).toEqual(['remove-maps']);
    });
  });

  describe('呼び出しの失敗', () => {
    test.each(['inject', 'upload'] as const)(
      '%sの失敗はデプロイを止めず、警告と要約に出して成功で終わる',
      async (failAt) => {
        const result = await runWith(ARGS('client'), { failAt });

        expect(result.code).toBe(EXIT_SUCCESS);
        expect(result.stderr.text()).toContain('警告');
        expect(result.stderr.text()).toContain(`${failAt}の失敗の診断`);
        expect(result.summaries).toHaveLength(1);
        expect(result.summaries[0]).toContain('ソースマップ');
        expect(result.summaries[0]).toContain(failAt);
      },
    );

    test('埋め込みが失敗したらアップロードを飛ばし、.mapの削除は続ける', async () => {
      const result = await runWith(ARGS('client'), { failAt: 'inject' });

      expect(result.steps).toEqual(['inject', 'remove-maps']);
    });

    test('アップロードが失敗しても.mapの削除は続ける', async () => {
      const result = await runWith(ARGS('client'), { failAt: 'upload' });

      expect(result.steps).toEqual(['inject', 'upload', 'remove-maps']);
    });

    test('.mapの削除の失敗は、配信物にソースが残り得るため失敗にする', async () => {
      const result = await runWith(ARGS('client'), { failAt: 'remove-maps' });

      expect(result.code).toBe(EXIT_FAILURE);
      expect(result.stderr.text()).toContain('remove-mapsの失敗の診断');
    });

    test('失敗の出力にもトークンを出さない', async () => {
      const result = await runWith(ARGS('client'), { failAt: 'upload' });

      expect(result.shown).not.toContain(TOKEN);
    });
  });

  test('INFISICAL_TOKENが無ければ、ログインを促して失敗にする', async () => {
    const result = await runWith(ARGS('client'), { env: {} });

    expect(result.code).toBe(EXIT_FAILURE);
    expect(result.stderr.text()).toContain('INFISICAL_TOKEN');
    expect(result.calls).toEqual([]);
  });

  test('資源一覧を読めなければ、入力の誤りとして失敗にする', async () => {
    const fake = createFakeDeps(createFakeRepoFiles({}));
    const code = await command.run(ARGS('client'), {
      ...fake.deps,
      env: { INFISICAL_TOKEN: 'fake-access-token' },
    });

    expect(code).toBe(EXIT_FAILURE);
  });
});
