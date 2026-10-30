import { describe, expect, test } from 'bun:test';

import {
  type ResourceCatalog,
  parseResourceCatalog,
} from '../catalog/resource-catalog.ts';
import { validCatalogJson } from '../test-fixtures/resource-catalog.ts';
import {
  VERIFY_WAIT_TIMEOUT_MS,
  smokeE2eCommandOf,
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
