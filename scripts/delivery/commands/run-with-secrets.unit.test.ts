import { describe, expect, test } from 'bun:test';

import type { CommandRunner, CommandSpec } from '../adapters/command-runner.ts';
import { CHECK_SECRETS_IDENTITY } from '../catalog/check-secrets.ts';
import type { SecretEntry } from '../core/secret-scope.ts';
import { commandLineOf } from '../test-fixtures/command-runner.ts';
import {
  createFakeSecretSource,
  createRecordingGithub,
  folderKeyOf,
  infisicalRepoTexts,
} from '../test-fixtures/infisical.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import { PROJECT_ID } from '../test-fixtures/resource-catalog.ts';
import { command } from './run-with-secrets.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const HOST = CHECK_SECRETS_IDENTITY.host;

const SHARED: readonly SecretEntry[] = [
  { key: 'HASH_PEPPER', value: 'fake-pepper-value' },
  { key: 'STRIPE_API_KEY', value: 'fake-shared-stripe-value' },
  { key: 'PRIVATE_KEY', value: 'fake-key-line-1\nfake-key-line-2' },
  { key: 'OVERRIDDEN', value: 'fake-shared-overridden-value' },
];

const API_FOLDER: readonly SecretEntry[] = [
  { key: 'STRIPE_API_KEY', value: 'fake-api-stripe-value' },
  { key: 'OVERRIDDEN', value: 'fake-api-overridden-value' },
];

const EVENT_FOLDER: readonly SecretEntry[] = [
  { key: 'STRIPE_API_KEY', value: 'fake-event-stripe-value' },
];

const ALL_FOLDERS: Readonly<Record<string, readonly SecretEntry[]>> = {
  [folderKeyOf('dev', '/')]: SHARED,
  [folderKeyOf('dev', '/workers/api')]: API_FOLDER,
  [folderKeyOf('dev', '/workers/event')]: EVENT_FOLDER,
};

const ALL_VALUES: readonly string[] = [
  ...SHARED,
  ...API_FOLDER,
  ...EVENT_FOLDER,
].flatMap(({ value }) => value.split('\n'));

const exportOf = (folder: string): string =>
  `export:${PROJECT_ID}:dev:${folder}:${HOST}`;

const runWith = async (
  args: readonly string[],
  {
    env = { INFISICAL_TOKEN: 'fake-access-token' },
    folders = ALL_FOLDERS,
    childExitCode = 0,
  }: {
    env?: Readonly<Record<string, string>>;
    folders?: Readonly<Record<string, readonly SecretEntry[]>>;
    childExitCode?: number;
  } = {},
) => {
  const timeline: string[] = [];
  const calls: CommandSpec[] = [];
  const runner: CommandRunner = {
    run: (spec) => {
      calls.push(spec);
      timeline.push(`run:${commandLineOf(spec)}`);
      return Promise.resolve({ code: childExitCode, stdout: '', stderr: '' });
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
    secrets: createFakeSecretSource({ timeline, folders }),
  });
  const shown = [
    fake.stdout.text(),
    fake.stderr.text(),
    ...fake.summaries(),
    ...timeline.filter((event) => event.startsWith('summary:')),
  ].join('\n');
  return { ...fake, code, timeline, calls, shown };
};

const expectNoValueShown = (shown: string): void => {
  for (const value of ALL_VALUES) expect(shown).not.toContain(value);
};

describe('run-with-secrets', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('run-with-secrets');
    expect(command.description).not.toBe('');
  });

  test('検査の範囲でWorkerの指定が無ければ、devの共通のフォルダからWorkerごとに分けると定めたキーを除き、すべての値を行ごとにマスクしてから子プロセスの環境変数に渡す', async () => {
    const { code, timeline, calls, shown } = await runWith([
      '--scope',
      'checks',
      '--',
      'bun',
      'run',
      'test:unit',
    ]);

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline).toEqual([
      exportOf('/'),
      'mask:fake-pepper-value',
      'mask:fake-key-line-1',
      'mask:fake-key-line-2',
      'mask:fake-shared-overridden-value',
      'run:bun run test:unit',
    ]);
    expect(calls[0]?.env).toEqual({
      HASH_PEPPER: 'fake-pepper-value',
      PRIVATE_KEY: 'fake-key-line-1\nfake-key-line-2',
      OVERRIDDEN: 'fake-shared-overridden-value',
    });
    expect(calls[0]?.output).toBe('inherit');
    expectNoValueShown(shown);
  });

  test.each([
    [
      'api',
      {
        HASH_PEPPER: 'fake-pepper-value',
        PRIVATE_KEY: 'fake-key-line-1\nfake-key-line-2',
        OVERRIDDEN: 'fake-api-overridden-value',
        STRIPE_API_KEY: 'fake-api-stripe-value',
      },
    ],
    [
      'event',
      {
        HASH_PEPPER: 'fake-pepper-value',
        PRIVATE_KEY: 'fake-key-line-1\nfake-key-line-2',
        OVERRIDDEN: 'fake-shared-overridden-value',
        STRIPE_API_KEY: 'fake-event-stripe-value',
      },
    ],
  ] as const)(
    'Workerの指定(%s)があれば、そのWorkerのフォルダを重ね、同じキーと分けると定めたキーはWorkerごとのフォルダの値にする',
    async (worker, expectedEnv) => {
      const { code, timeline, calls, shown } = await runWith([
        '--scope',
        'checks',
        '--worker',
        worker,
        '--',
        'bunx',
        'wrangler',
        'dev',
      ]);

      expect(code).toBe(EXIT_SUCCESS);
      expect(timeline.slice(0, 2)).toEqual([
        exportOf('/'),
        exportOf(`/workers/${worker}`),
      ]);
      expect(calls[0]?.env).toEqual(expectedEnv);
      const runIndex = timeline.indexOf('run:bunx wrangler dev');
      const masked = timeline
        .slice(0, runIndex)
        .filter((event) => event.startsWith('mask:'))
        .map((event) => event.slice('mask:'.length));
      expect(masked.toSorted()).toEqual(
        [
          ...new Set(
            Object.values(expectedEnv).flatMap((value) => value.split('\n')),
          ),
        ].toSorted(),
      );
      expect(runIndex).toBe(timeline.length - 1);
      expectNoValueShown(shown);
    },
  );

  test('Workerごとのフォルダが空なら、分けると定めたキーを除いた共通のフォルダの値だけを渡す', async () => {
    const { code, calls } = await runWith(
      ['--scope', 'checks', '--worker', 'api', '--', 'bunx', 'wrangler', 'dev'],
      {
        folders: {
          ...ALL_FOLDERS,
          [folderKeyOf('dev', '/workers/api')]: [],
        },
      },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(Object.keys(calls[0]?.env ?? {})).toEqual([
      'HASH_PEPPER',
      'PRIVATE_KEY',
      'OVERRIDDEN',
    ]);
  });

  test('ローカルの範囲では、アクセストークンが無くてもログインせずに開発者のログインでdevを取り出す', async () => {
    const { code, timeline } = await runWith(
      ['--scope', 'local', '--worker', 'event', '--', 'bun', 'run', 'dev'],
      { env: {} },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline.some((event) => event.startsWith('login:'))).toBe(false);
    expect(timeline.slice(0, 2)).toEqual([
      exportOf('/'),
      exportOf('/workers/event'),
    ]);
  });

  test('検査の範囲でアクセストークンが無ければ、取り出さずにログインの手順を示して失敗する', async () => {
    const { code, timeline, stderr } = await runWith(
      ['--scope', 'checks', '--', 'bun', 'run', 'test:unit'],
      { env: {} },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain(
      'INFISICAL_TOKENがありません。先に`infisical-login --scope checks`を実行してください',
    );
  });

  test('Workerごとのフォルダを取り出せなければ、値を出さずにフォルダの名前だけを示し、子プロセスを起動せずに失敗する', async () => {
    const { code, timeline, stderr, shown } = await runWith(
      ['--scope', 'checks', '--worker', 'api', '--', 'bunx', 'wrangler', 'dev'],
      { folders: { [folderKeyOf('dev', '/')]: SHARED } },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline.some((event) => event.startsWith('run:'))).toBe(false);
    expect(timeline.some((event) => event.startsWith('mask:'))).toBe(false);
    expect(stderr.text()).toContain(
      'Infisicalのdevのフォルダ/workers/apiを取り出せませんでした(終了コード1)',
    );
    expectNoValueShown(shown);
  });

  test('共通のフォルダを取り出せなければ、子プロセスを起動せずに失敗する', async () => {
    const { code, timeline, stderr } = await runWith(
      ['--scope', 'checks', '--', 'bun', 'run', 'test:unit'],
      { folders: {} },
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([exportOf('/')]);
    expect(stderr.text()).toContain(
      'Infisicalのdevのフォルダ/を取り出せませんでした',
    );
  });

  test('子プロセスの終了コードをそのまま返し、注入したキーの数だけを示す', async () => {
    const { code, stdout } = await runWith(
      ['--scope', 'checks', '--', 'bun', 'run', 'test:unit'],
      { childExitCode: 3 },
    );

    expect(code).toBe(3);
    expect(stdout.text()).toContain(
      'devの/から3件のシークレットを注入して起動します: bun run test:unit',
    );
  });

  test.each([
    [['--scope', 'checks'], '`--`の後に起動するコマンドを指定してください'],
    [
      ['--scope', 'checks', '--'],
      '`--`の後に起動するコマンドを指定してください',
    ],
    [['--', 'echo'], '--scopeを指定してください(checks・local)'],
    [
      ['--scope', 'staging', '--', 'echo'],
      '--scopeはchecks・localのいずれかにしてください',
    ],
    [
      ['--scope', 'checks', '--worker', 'client', '--', 'echo'],
      '--workerはapi・eventのいずれかにしてください',
    ],
  ])('引数の誤り(%p)は取り出さずに示す', async (args, message) => {
    const error = await runWith(args).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(UsageError);
    expect(await rejectionMessageOf(runWith(args))).toContain(message);
  });
});
