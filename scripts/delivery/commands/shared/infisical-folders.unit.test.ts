import { describe, expect, test } from 'bun:test';

import {
  CATALOG_HOST,
  createFakeSecretSource,
  createRecordingGithub,
  folderKeyOf,
  infisicalRepoTexts,
} from '../../test-fixtures/infisical.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
  withoutPath,
} from '../../test-fixtures/repo-files.ts';
import { PROJECT_ID } from '../../test-fixtures/resource-catalog.ts';
import type { SecretEntry, SecretFolder } from '../../core/secret-scope.ts';
import { EXIT_FAILURE } from './delivery-command.ts';
import {
  INFISICAL_TOKEN_ENV,
  exportInfisicalFolders,
  openInfisicalFolders,
  requireInfisicalToken,
} from './infisical-folders.ts';

const NAME = 'deploy-worker';
const TITLE = 'シークレットの取り出し';
const TOKEN_ENV = { [INFISICAL_TOKEN_ENV]: 'fake-access-token' };

const runWith = async ({
  env = TOKEN_ENV,
  texts = infisicalRepoTexts(),
  folders = {},
  requested = ['/ci/cloudflare', '/workers/api'],
}: {
  readonly env?: Readonly<Record<string, string>>;
  readonly texts?: Record<string, string>;
  readonly folders?: Readonly<Record<string, readonly SecretEntry[]>>;
  readonly requested?: readonly SecretFolder[];
} = {}) => {
  const timeline: string[] = [];
  const fake = createFakeDeps(createFakeRepoFiles(texts));
  const deps = {
    ...fake.deps,
    env,
    github: createRecordingGithub(timeline),
    secrets: createFakeSecretSource({ timeline, folders }),
  };
  const result = await openInfisicalFolders(
    NAME,
    TITLE,
    'staging',
    requested,
    deps,
  );
  return { result, timeline, stderr: fake.stderr };
};

describe('INFISICAL_TOKEN_ENV', () => {
  test('infisical-loginが後続の手順へ渡す環境変数の名前である', () => {
    expect(INFISICAL_TOKEN_ENV).toBe('INFISICAL_TOKEN');
  });
});

describe('requireInfisicalToken', () => {
  test('トークンがあれば何も出さずに真を返す', () => {
    const fake = createFakeDeps(createFakeRepoFiles({}));

    expect(
      requireInfisicalToken(NAME, 'staging', { ...fake.deps, env: TOKEN_ENV }),
    ).toBe(true);
    expect(fake.stderr.text()).toBe('');
  });

  test.each([[{}], [{ [INFISICAL_TOKEN_ENV]: '' }]])(
    'トークンが無いか空なら(%p)、先に実行するログインの範囲を示して偽を返す',
    (env) => {
      const fake = createFakeDeps(createFakeRepoFiles({}));

      expect(requireInfisicalToken(NAME, 'checks', { ...fake.deps, env })).toBe(
        false,
      );
      expect(fake.stderr.text()).toBe(
        `${NAME}: INFISICAL_TOKENがありません。先に\`infisical-login --scope checks\`を実行してください。\n`,
      );
    },
  );
});

describe('exportInfisicalFolders', () => {
  const TARGET = {
    scope: 'checks',
    environment: 'dev',
    projectId: PROJECT_ID,
    host: CATALOG_HOST,
    identityId: '9c9c9c9c-1111-4222-8333-444444444444',
    oidcAudience: 'https://ci.launch.example',
    identitySource: 'scripts/delivery/catalog/check-secrets.ts',
  } as const;
  const SHARED: readonly SecretEntry[] = [
    { key: 'HASH_PEPPER', value: 'fake-pepper' },
  ];

  test('指定の順にフォルダを取り出し、マスクは呼び出し側に任せる', async () => {
    const timeline: string[] = [];
    const fake = createFakeDeps(createFakeRepoFiles({}));

    const deps = {
      ...fake.deps,
      github: createRecordingGithub(timeline),
      secrets: createFakeSecretSource({
        timeline,
        folders: { [folderKeyOf('dev', '/')]: SHARED },
      }),
    };

    const exported = await exportInfisicalFolders(NAME, TARGET, ['/'], deps);

    expect(exported).toEqual([SHARED]);
    expect(timeline).toEqual([`export:${PROJECT_ID}:dev:/:${CATALOG_HOST}`]);
  });
});

describe('openInfisicalFolders', () => {
  const CLOUDFLARE: readonly SecretEntry[] = [
    { key: 'CLOUDFLARE_API_TOKEN', value: 'fake-cloudflare-token' },
  ];
  const WORKER: readonly SecretEntry[] = [
    { key: 'STRIPE_API_KEY', value: 'fake-stripe\nsecond-line' },
  ];
  const FOLDERS = {
    [folderKeyOf('staging', '/ci/cloudflare')]: CLOUDFLARE,
    [folderKeyOf('staging', '/workers/api')]: WORKER,
  };

  test('資源一覧の接続先から指定の順にフォルダを取り出し、すべての値(複数行は行ごと)を取り出しの後にマスクして返す', async () => {
    const { result, timeline } = await runWith({ folders: FOLDERS });

    if (typeof result === 'number') throw new Error('取り出しに失敗した');
    expect(result.folders).toEqual([CLOUDFLARE, WORKER]);
    expect(result.target).toMatchObject({
      environment: 'staging',
      projectId: PROJECT_ID,
      host: CATALOG_HOST,
    });
    expect(timeline).toEqual([
      `export:${PROJECT_ID}:staging:/ci/cloudflare:${CATALOG_HOST}`,
      `export:${PROJECT_ID}:staging:/workers/api:${CATALOG_HOST}`,
      'mask:fake-cloudflare-token',
      'mask:fake-stripe',
      'mask:second-line',
    ]);
  });

  test('トークンが無ければ取り出さずに失敗する', async () => {
    const { result, timeline, stderr } = await runWith({ env: {} });

    expect(result).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain('infisical-login --scope staging');
  });

  test('資源一覧を読めなければ、読めない入力として表示して失敗する', async () => {
    const { result, timeline, stderr } = await runWith({
      texts: withoutPath(
        infisicalRepoTexts(),
        'apps/infra/environments/staging.json',
      ),
    });

    expect(result).toBe(EXIT_FAILURE);
    expect(timeline.filter((event) => event.startsWith('export:'))).toEqual([]);
    expect(stderr.text()).toContain(TITLE);
    expect(stderr.text()).toContain('apps/infra/environments/staging.json');
  });

  test('取り出せないフォルダがあれば、値を出さずに環境とフォルダの名前だけを示し、マスクも後続のフォルダの取り出しもせずに失敗する', async () => {
    const { result, timeline, stderr } = await runWith({
      folders: { [folderKeyOf('staging', '/workers/api')]: WORKER },
      requested: ['/ci/cloudflare', '/workers/api'],
    });

    expect(result).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([
      `export:${PROJECT_ID}:staging:/ci/cloudflare:${CATALOG_HOST}`,
    ]);
    expect(stderr.text()).toBe(
      `${NAME}: Infisicalのstagingのフォルダ/ci/cloudflareを取り出せませんでした(終了コード1)\n`,
    );
  });
});
