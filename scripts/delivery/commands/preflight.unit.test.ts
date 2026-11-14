import { describe, expect, test } from 'bun:test';

import { WORKER_KEYS } from '../catalog/resource-catalog.ts';
import { STAGING_IDENTITY_ID } from '../test-fixtures/infisical.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import {
  PLACEHOLDER_CLOUDFLARE_ID,
  PLACEHOLDER_UUID,
  validCatalogJson,
} from '../test-fixtures/resource-catalog.ts';
import {
  backendHclOf,
  wranglerFileOf,
  wranglerJsoncOf,
} from '../test-fixtures/wrangler-config.ts';
import { replaceOnce } from '../test-fixtures/workflows.ts';
import { command } from './preflight.ts';
import { EXIT_FAILURE, EXIT_SUCCESS } from './shared/delivery-command.ts';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const PROD_IDENTITY_ID = '7b7b7b7b-1111-4222-8333-444444444444';

const STAGING_CATALOG = 'apps/infra/environments/staging.json';
const PROD_CATALOG = 'apps/infra/environments/prod.json';
const STAGING_BACKEND = 'apps/infra/backends/staging.s3.hcl';
const PROD_BACKEND = 'apps/infra/backends/prod.s3.hcl';

interface Identities {
  readonly staging?: string;
  readonly prod?: string;
  readonly projectId?: string;
}

const withInfisical = (
  catalog: Record<string, unknown>,
  identityId: string,
  projectId: string | undefined,
): Record<string, unknown> => {
  const infisical = catalog['infisical'] as Record<string, unknown>;
  return {
    ...catalog,
    infisical: {
      ...infisical,
      identityId,
      ...(projectId === undefined ? {} : { projectId }),
    },
  };
};

const withCloudflare = (
  catalog: Record<string, unknown>,
): Record<string, unknown> => ({
  ...catalog,
  cloudflare: {
    ...(catalog['cloudflare'] as Record<string, unknown>),
    accountId: PLACEHOLDER_CLOUDFLARE_ID,
    zoneId: PLACEHOLDER_CLOUDFLARE_ID,
  },
});

const prodCatalogJson = (): Record<string, unknown> => ({
  ...(JSON.parse(
    JSON.stringify(validCatalogJson()).replaceAll('staging', 'prod'),
  ) as Record<string, unknown>),
  github: { environment: 'prod', branch: 'prod' },
});

const textsOf = ({
  staging = STAGING_IDENTITY_ID,
  prod = PROD_IDENTITY_ID,
  projectId,
}: Identities = {}): Record<string, string> => ({
  [STAGING_CATALOG]: JSON.stringify(
    withInfisical(validCatalogJson(), staging, projectId),
  ),
  [PROD_CATALOG]: JSON.stringify(
    withInfisical(prodCatalogJson(), prod, projectId),
  ),
  ...Object.fromEntries(
    WORKER_KEYS.map((worker) => [
      wranglerFileOf(worker),
      wranglerJsoncOf(worker),
    ]),
  ),
  [STAGING_BACKEND]: backendHclOf(ACCOUNT_ID),
  [PROD_BACKEND]: backendHclOf(ACCOUNT_ID).replaceAll('staging', 'prod'),
});

const runWith = async (
  args: readonly string[],
  {
    texts = textsOf(),
    refName,
  }: {
    texts?: Readonly<Record<string, string>>;
    refName?: string;
  } = {},
) => {
  const files = createFakeRepoFiles(texts);
  const fake = createFakeDeps(files);
  const env = refName === undefined ? {} : { GITHUB_REF_NAME: refName };
  const code = await command.run(args, { ...fake.deps, env });
  return { ...fake, code, readPaths: files.readPaths() };
};

describe('preflight', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('preflight');
    expect(command.description).not.toBe('');
  });

  test('実行中のブランチが資源一覧のブランチと一致し、資源一覧の解析と構成検査が通り、Infisicalの識別子が仮の値でなければ成功する', async () => {
    const { code, readPaths, stdout, stderr, summaries } = await runWith(
      ['--env', 'staging'],
      { refName: 'main' },
    );

    expect(code).toBe(EXIT_SUCCESS);
    expect(readPaths).toEqual(
      [
        STAGING_CATALOG,
        ...WORKER_KEYS.map(wranglerFileOf),
        STAGING_BACKEND,
      ].toSorted(),
    );
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toBe(
      'stagingの事前確認(構成検査): 違反はありません。\n事前確認: stagingへのデプロイの前提を満たしています(ブランチmain)。\n',
    );
    expect(summaries()).toEqual([
      '### stagingの事前確認(構成検査)\n\n違反はありません。\n',
      '### stagingの事前確認\n\nデプロイの前提を満たしています(ブランチmain)。\n',
    ]);
  });

  test('prodはprodのブランチとprodの資源一覧で確かめる', async () => {
    const { code, readPaths } = await runWith(['--env', 'prod'], {
      refName: 'prod',
    });

    expect(code).toBe(EXIT_SUCCESS);
    expect(readPaths).toContain(PROD_CATALOG);
    expect(readPaths).toContain(PROD_BACKEND);
    expect(readPaths).not.toContain(STAGING_CATALOG);
  });

  test('実行中のブランチが資源一覧のブランチと異なれば失敗する', async () => {
    const { code, stderr, summaries } = await runWith(['--env', 'staging'], {
      refName: 'feature/x',
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toBe(
      `preflight: 実行中のブランチfeature/xが、${STAGING_CATALOG}のgithub.branch(main)と一致しません。\n`,
    );
    expect(summaries().at(-1)).toBe(
      `### stagingの事前確認\n\n- 実行中のブランチfeature/xが、${STAGING_CATALOG}のgithub.branch(main)と一致しません。\n`,
    );
  });

  test('実行中のブランチが分からなければ失敗する', async () => {
    const { code, stderr } = await runWith(['--env', 'staging']);

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toBe(
      'preflight: 実行中のブランチが分かりません(GITHUB_REF_NAMEがありません)。\n',
    );
  });

  test('stagingの主体のIDが仮の値なら、資源一覧への記入を求めて失敗する', async () => {
    const { code, stderr } = await runWith(['--env', 'staging'], {
      texts: textsOf({ staging: PLACEHOLDER_UUID }),
      refName: 'main',
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toBe(
      `preflight: ${STAGING_CATALOG}のinfisical.identityIdが仮の値です。初回の準備で主体を作り、そのIDを記入してください。\n`,
    );
  });

  test('prodの主体のIDが仮の値なら、launch-readinessの準備が必要と表示して失敗する', async () => {
    const { code, stderr } = await runWith(['--env', 'prod'], {
      texts: textsOf({ prod: PLACEHOLDER_UUID }),
      refName: 'prod',
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toBe(
      `preflight: ${PROD_CATALOG}のinfisical.identityIdが仮の値です。prodへのデプロイの前にlaunch-readinessの準備が必要です。\n`,
    );
  });

  test.each([
    [
      'staging',
      'main',
      STAGING_CATALOG,
      STAGING_BACKEND,
      '本物の値を記入してください。',
    ],
    [
      'prod',
      'prod',
      PROD_CATALOG,
      PROD_BACKEND,
      '本物の値を記入してください。prodへのデプロイの前にlaunch-readinessの準備が必要です。',
    ],
  ])(
    '%sのCloudflareのアカウントID・ゾーンIDが仮の値なら、記入先のファイルを示して失敗する',
    async (env, refName, catalogPath, backendPath, nextStep) => {
      const texts = textsOf();
      const placeholders = {
        ...texts,
        [catalogPath]: JSON.stringify(
          withCloudflare(
            JSON.parse(texts[catalogPath] ?? '{}') as Record<string, unknown>,
          ),
        ),
        [backendPath]: (texts[backendPath] ?? '').replace(
          ACCOUNT_ID,
          PLACEHOLDER_CLOUDFLARE_ID,
        ),
      };

      const { code, stdout, stderr } = await runWith(['--env', env], {
        texts: placeholders,
        refName,
      });

      expect(code).toBe(EXIT_FAILURE);
      expect(stdout.text()).toContain('違反はありません。');
      expect(stderr.text()).toBe(
        [
          `preflight: ${catalogPath}のcloudflare.accountIdが仮の値です。${catalogPath}のcloudflare.accountIdと${backendPath}のendpoints.s3へ${nextStep}`,
          `preflight: ${catalogPath}のcloudflare.zoneIdが仮の値です。${catalogPath}のcloudflare.zoneIdへ${nextStep}`,
          '',
        ].join('\n'),
      );
    },
  );

  test('プロジェクトのIDが仮の値でも失敗し、すべての問題と構成検査の違反をまとめて表示する', async () => {
    const texts = textsOf({
      staging: PLACEHOLDER_UUID,
      projectId: PLACEHOLDER_UUID,
    });
    const edited = {
      ...texts,
      [wranglerFileOf('api')]: replaceOnce(
        texts[wranglerFileOf('api')] ?? '',
        '"bucket_name": "app-images-staging", "jurisdiction": "us"',
        '"bucket_name": "app-images-staging"',
      ),
    };

    const { code, stderr } = await runWith(['--env', 'staging'], {
      texts: edited,
      refName: 'feature/x',
    });

    expect(code).toBe(EXIT_FAILURE);
    const lines = stderr.text().split('\n');
    expect(lines[0]).toBe('stagingの事前確認(構成検査): 違反が1件あります。');
    expect(lines[2]).toMatch(/^C3\s+apps\/api\/wrangler\.jsonc\s+/);
    const problems = lines.filter((line) => line.startsWith('preflight: '));
    expect(problems).toEqual([
      `preflight: 実行中のブランチfeature/xが、${STAGING_CATALOG}のgithub.branch(main)と一致しません。`,
      `preflight: ${STAGING_CATALOG}のinfisical.projectIdが仮の値です。.infisical.yamlのsecrets-management.project-idと同じ値を記入してください。`,
      `preflight: ${STAGING_CATALOG}のinfisical.identityIdが仮の値です。初回の準備で主体を作り、そのIDを記入してください。`,
    ]);
  });

  test('資源一覧を解析できなければ、入力の誤りとして出して失敗する', async () => {
    const { code, stderr } = await runWith(['--env', 'staging'], {
      texts: {
        ...textsOf(),
        [STAGING_CATALOG]: JSON.stringify({
          ...validCatalogJson(),
          jurisdiction: 'eu',
        }),
      },
      refName: 'main',
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(stderr.text()).toContain(
      'stagingの事前確認: 検査の入力を読み込めません。',
    );
    expect(stderr.text()).toContain(
      `- ${STAGING_CATALOG}: jurisdiction: "us"のいずれかが必要です(実際: "eu")`,
    );
  });

  test.each([
    [[], '--envを指定してください(staging・prod)'],
    [
      ['--env', 'dev'],
      '--envはstaging・prodのいずれかにしてください(実際: dev)',
    ],
    [['--env', 'staging', '--', 'x'], '`--`の後のコマンドは受け取りません'],
  ])('引数%pの誤りを使い方の誤りとして投げる', async (args, message) => {
    const fake = createFakeDeps(createFakeRepoFiles(textsOf()));

    expect(await rejectionMessageOf(command.run(args, fake.deps))).toBe(
      message,
    );
  });
});
