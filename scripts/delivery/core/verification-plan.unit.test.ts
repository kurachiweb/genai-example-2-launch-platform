import { describe, expect, test } from 'bun:test';

import {
  type ResourceCatalog,
  parseResourceCatalog,
} from '../catalog/resource-catalog.ts';
import {
  playwrightListJson,
  smokeSpec,
} from '../test-fixtures/playwright-list.ts';
import { validCatalogJson } from '../test-fixtures/resource-catalog.ts';
import {
  VERIFY_WAIT_TIMEOUT_MS,
  countSmokeTests,
  smokeE2eCommandOf,
  smokeListCommandOf,
  verificationPlanFor,
  waitFailureReport,
} from './verification-plan.ts';

const catalogOf = (json: Record<string, unknown>): ResourceCatalog => {
  const result = parseResourceCatalog(json);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.catalog;
};

const stagingCatalog = (): ResourceCatalog => catalogOf(validCatalogJson());

const prodCatalog = (): ResourceCatalog =>
  catalogOf(
    JSON.parse(
      JSON.stringify(validCatalogJson()).replaceAll('staging', 'prod'),
    ) as Record<string, unknown>,
  );

const withoutHostname = (
  catalog: ResourceCatalog,
  key: string,
): ResourceCatalog => ({
  ...catalog,
  hostnames: Object.fromEntries(
    Object.entries(catalog.hostnames).filter(([name]) => name !== key),
  ),
});

describe('verificationPlanFor', () => {
  test('stagingでは、apiのヘルスチェックを待ってからclient・adminのhttpsのURLへスモークテストを行う', () => {
    expect(verificationPlanFor(stagingCatalog())).toEqual({
      ok: true,
      plan: {
        kind: 'smoke-e2e',
        clientUrl: 'https://client-staging.launch.example',
        adminUrl: 'https://admin-staging.launch.example',
        waitForHealth: 'https://api-staging.launch.example/health',
      },
    });
  });

  test('prodでは、apiとeventのヘルスチェックとclientのトップページを確かめる', () => {
    expect(verificationPlanFor(prodCatalog())).toEqual({
      ok: true,
      plan: {
        kind: 'health',
        urls: [
          'https://api-prod.launch.example/health',
          'https://event-prod.launch.example/health',
          'https://client-prod.launch.example/',
        ],
      },
    });
  });

  test.each([
    ['staging', 'admin', stagingCatalog],
    ['prod', 'event', prodCatalog],
  ])(
    '%sで確かめる対象のホスト名(%s)が資源一覧に無ければ、そのキーを示す誤りを返す',
    (_environment, key, catalog) => {
      const result = verificationPlanFor(withoutHostname(catalog(), key));

      expect(result).toEqual({
        ok: false,
        errors: [`hostnames.${key}がありません(デプロイ後の確認の対象です)`],
      });
    },
  );

  test('ホスト名を1件も持たない資源一覧では、必要なキーをすべて示す', () => {
    const result = verificationPlanFor({
      ...stagingCatalog(),
      hostnames: {},
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        'hostnames.apiがありません(デプロイ後の確認の対象です)',
        'hostnames.clientがありません(デプロイ後の確認の対象です)',
        'hostnames.adminがありません(デプロイ後の確認の対象です)',
      ],
    });
  });
});

describe('smokeE2eCommandOf', () => {
  test('ルートの`test:e2e`を`@smoke`で絞り込み、client・adminのURLを環境変数で渡す', () => {
    expect(
      smokeE2eCommandOf({
        kind: 'smoke-e2e',
        clientUrl: 'https://client-staging.launch.example',
        adminUrl: 'https://admin-staging.launch.example',
        waitForHealth: 'https://api-staging.launch.example/health',
      }),
    ).toEqual({
      command: 'bun',
      args: ['run', 'test:e2e', '--grep', '@smoke'],
      env: {
        E2E_CLIENT_URL: 'https://client-staging.launch.example',
        E2E_ADMIN_URL: 'https://admin-staging.launch.example',
      },
    });
  });
});

const STAGING_SMOKE_PLAN = {
  kind: 'smoke-e2e',
  clientUrl: 'https://client-staging.launch.example',
  adminUrl: 'https://admin-staging.launch.example',
  waitForHealth: 'https://api-staging.launch.example/health',
} as const;

describe('smokeListCommandOf', () => {
  test('実行と同じ絞り込みと環境変数で、実行せずに対象のテストをJSONで一覧にする', () => {
    expect(smokeListCommandOf(STAGING_SMOKE_PLAN)).toEqual({
      command: 'bun',
      args: [
        'run',
        'test:e2e',
        '--grep',
        '@smoke',
        '--list',
        '--reporter=json',
      ],
      env: {
        E2E_CLIENT_URL: 'https://client-staging.launch.example',
        E2E_ADMIN_URL: 'https://admin-staging.launch.example',
      },
    });
  });
});

describe('countSmokeTests', () => {
  test('`@smoke`のタグを持つテストを入れ子のsuiteまで数え、タグの無い到達確認のsetupを数えない', () => {
    const json = playwrightListJson([
      smokeSpec('疎通確認の画面を表示する'),
      { title: '管理者側', tags: ['smoke'], projects: ['admin', 'admin-2'] },
      { title: 'タグ無し', tags: ['slow'], projects: ['client'] },
    ]);

    expect(countSmokeTests(json)).toEqual({ ok: true, count: 3 });
  });

  test('`@smoke`のテストが無く到達確認のsetupだけが一覧に残っても0件と数える', () => {
    expect(countSmokeTests(playwrightListJson([]))).toEqual({
      ok: true,
      count: 0,
    });
    expect(
      countSmokeTests(playwrightListJson([], { withSetup: false })),
    ).toEqual({ ok: true, count: 0 });
  });

  test.each([
    ['JSONでない', 'Listing tests:\nTotal: 25 tests in 3 files\n'],
    ['JSONがオブジェクトでない', JSON.stringify([])],
    ['suitesが配列でない', JSON.stringify({ suites: {}, errors: [] })],
    ['suiteがオブジェクトでない', JSON.stringify({ suites: [1], errors: [] })],
    [
      'specがオブジェクトでない',
      JSON.stringify({ suites: [{ specs: [null] }], errors: [] }),
    ],
    [
      'specのtestsが配列でない',
      JSON.stringify({
        suites: [{ specs: [{ tags: ['smoke'], tests: 1 }] }],
        errors: [],
      }),
    ],
    [
      '入れ子のsuitesが配列でない',
      JSON.stringify({ suites: [{ specs: [], suites: 'x' }], errors: [] }),
    ],
  ])('一覧の形が想定と違えば(%s)誤りにする', (_label, text) => {
    const result = countSmokeTests(text);

    expect(result.ok).toBe(false);
  });

  test('一覧の作成時の誤り(テストファイルの読み込みの失敗など)があれば、その内容を示して誤りにする', () => {
    const json = playwrightListJson([smokeSpec('疎通確認')], {
      errors: [{ message: 'SyntaxError: Unexpected token' }],
    });

    expect(countSmokeTests(json)).toEqual({
      ok: false,
      error:
        'テストの一覧の作成で誤りがありました: SyntaxError: Unexpected token',
    });
  });
});

describe('waitFailureReport', () => {
  test('待ち合わせの上限は10分である', () => {
    expect(VERIFY_WAIT_TIMEOUT_MS).toBe(600_000);
  });

  test('届かなかった対象ごとに、URLと最後の状態コード(応答が無ければその旨)を1行で示す', () => {
    expect(
      waitFailureReport([
        { url: 'https://api-prod.launch.example/health', lastStatus: 503 },
        { url: 'https://client-prod.launch.example/', lastStatus: undefined },
      ]),
    ).toBe(
      [
        '- https://api-prod.launch.example/health: 10分以内に200を返しませんでした(最後の状態コード: 503)',
        '- https://client-prod.launch.example/: 10分以内に200を返しませんでした(応答がありませんでした)',
        '',
      ].join('\n'),
    );
  });
});
