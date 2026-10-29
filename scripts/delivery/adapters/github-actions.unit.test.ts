import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import { createRecordingOutput } from '../test-fixtures/text-output.ts';
import {
  createGithubActionsIo,
  type FetchLike,
  type GithubActionsIoOptions,
} from './github-actions.ts';

let dir: string;
let fileCount = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'delivery-github-actions-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const createFile = async (initial = ''): Promise<string> => {
  fileCount += 1;
  const path = join(dir, `file-${String(fileCount)}`);
  await writeFile(path, initial);
  return path;
};

const unusedFetch: FetchLike = () => {
  throw new Error('fetchは呼ばれない想定です');
};

const createIo = (
  env: GithubActionsIoOptions['env'],
  fetchImpl: FetchLike = unusedFetch,
) => {
  const stdout = createRecordingOutput();
  const io = createGithubActionsIo({ env, stdout, fetch: fetchImpl });
  return { io, stdout };
};

const IN_ACTIONS = { GITHUB_ACTIONS: 'true' } as const;

describe('mask', () => {
  test('GitHub Actionsの中では値をマスクするコマンドを標準出力へ出す', () => {
    const { io, stdout } = createIo(IN_ACTIONS);

    io.mask('s3cr3t');

    expect(stdout.text()).toBe('::add-mask::s3cr3t\n');
  });

  test('複数行の値は空でない行ごとにマスクし、%はコマンドの表記に変換する', () => {
    const { io, stdout } = createIo(IN_ACTIONS);

    io.mask('-----BEGIN KEY-----\r\nab%cd\n\n  \nend');

    expect(stdout.text()).toBe(
      [
        '::add-mask::-----BEGIN KEY-----',
        '::add-mask::ab%25cd',
        '::add-mask::end',
        '',
      ].join('\n'),
    );
  });

  test.each([{}, { GITHUB_ACTIONS: 'false' }])(
    'GitHub Actionsの外(%p)ではマスクのコマンドを出さない',
    (env) => {
      const { io, stdout } = createIo(env);

      io.mask('s3cr3t');

      expect(stdout.text()).toBe('');
    },
  );
});

describe('exportEnv', () => {
  test('値をマスクしてから、環境変数のファイルへ区切り文字の形式で追記する', async () => {
    const envFile = await createFile('EXISTING=1\n');
    const { io, stdout } = createIo({ ...IN_ACTIONS, GITHUB_ENV: envFile });

    io.exportEnv('INFISICAL_TOKEN', 'token-value');

    expect(stdout.text()).toBe('::add-mask::token-value\n');
    const written = await readFile(envFile, 'utf8');
    const match =
      /^EXISTING=1\nINFISICAL_TOKEN<<(\S+)\ntoken-value\n(\S+)\n$/.exec(
        written,
      );
    expect(match?.[1]).toBeDefined();
    expect(match?.[1]).toBe(match?.[2]);
  });

  test('複数行の値も1つの環境変数として追記する', async () => {
    const envFile = await createFile();
    const { io } = createIo({ ...IN_ACTIONS, GITHUB_ENV: envFile });

    io.exportEnv('MULTI', 'line-1\nline-2');

    expect(await readFile(envFile, 'utf8')).toMatch(
      /^MULTI<<(\S+)\nline-1\nline-2\n\1\n$/,
    );
  });

  test('環境変数のファイルが指定されていなければ失敗し、値を出さない', () => {
    const { io, stdout } = createIo(IN_ACTIONS);

    expect(() => {
      io.exportEnv('INFISICAL_TOKEN', 'token-value');
    }).toThrow('GITHUB_ENVが無いため、INFISICAL_TOKENを後続の手順へ渡せません');
    expect(stdout.text()).not.toContain('token-value');
  });

  test.each(['', '1KEY', 'KEY=VALUE', 'KEY\nOTHER', 'KEY NAME'])(
    '環境変数の名前として不正な%pは追記せずに失敗する',
    async (key) => {
      const envFile = await createFile();
      const { io } = createIo({ ...IN_ACTIONS, GITHUB_ENV: envFile });

      expect(() => {
        io.exportEnv(key, 'value');
      }).toThrow('環境変数の名前が不正です');
      expect(await readFile(envFile, 'utf8')).toBe('');
    },
  );
});

describe('summary', () => {
  test('手順の要約のファイルへ、末尾に改行を付けて追記する', async () => {
    const summaryFile = await createFile('# 既存\n');
    const { io } = createIo({
      ...IN_ACTIONS,
      GITHUB_STEP_SUMMARY: summaryFile,
    });

    io.summary('### 構成検査\n\n違反はありません。');
    io.summary('次の節\n');

    expect(await readFile(summaryFile, 'utf8')).toBe(
      '# 既存\n### 構成検査\n\n違反はありません。\n次の節\n',
    );
  });

  test('手順の要約のファイルが無ければ何もしない', () => {
    const { io, stdout } = createIo({});

    expect(() => {
      io.summary('### 構成検査');
    }).not.toThrow();
    expect(stdout.text()).toBe('');
  });
});

describe('oidcToken', () => {
  const OIDC_ENV = {
    ...IN_ACTIONS,
    ACTIONS_ID_TOKEN_REQUEST_URL:
      'https://token.actions.example/request?api-version=2.0',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
  } as const;

  test('要求先へ対象を付けて要求し、得たトークンをマスクしてから返す', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(Response.json({ value: 'jwt-value' }));
    };
    const { io, stdout } = createIo(OIDC_ENV, fetchImpl);

    const token = await io.oidcToken('https://infisical.example');

    expect(token).toBe('jwt-value');
    expect(stdout.text()).toBe('::add-mask::jwt-value\n');
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://token.actions.example/request',
    );
    expect(url.searchParams.get('api-version')).toBe('2.0');
    expect(url.searchParams.get('audience')).toBe('https://infisical.example');
    expect(new Headers(requests[0]?.init.headers).get('authorization')).toBe(
      'Bearer request-token',
    );
  });

  test.each([
    ['ACTIONS_ID_TOKEN_REQUEST_URL'],
    ['ACTIONS_ID_TOKEN_REQUEST_TOKEN'],
  ] as const)(
    '%sが無ければ要求せずに、権限の不足を示して失敗する',
    async (missing) => {
      const env = Object.fromEntries(
        Object.entries(OIDC_ENV).filter(([key]) => key !== missing),
      );
      const { io } = createIo(env);

      expect(await rejectionMessageOf(io.oidcToken('aud'))).toContain(
        'OIDCのトークンを取得できません。ジョブに`id-token: write`の権限があるか確かめてください',
      );
    },
  );

  test('要求が失敗すれば状態コードを示して失敗する', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response('denied', { status: 403 }));
    const { io } = createIo(OIDC_ENV, fetchImpl);

    expect(await rejectionMessageOf(io.oidcToken('aud'))).toContain(
      'OIDCのトークンの要求が失敗しました(状態コード403)',
    );
  });

  test('応答にトークンが無ければ失敗する', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(Response.json({ other: 'x' }));
    const { io } = createIo(OIDC_ENV, fetchImpl);

    expect(await rejectionMessageOf(io.oidcToken('aud'))).toContain(
      'OIDCのトークンの応答にトークンがありません',
    );
  });
});
