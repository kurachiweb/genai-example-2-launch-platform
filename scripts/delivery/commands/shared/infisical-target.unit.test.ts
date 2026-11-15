import { describe, expect, test } from 'bun:test';

import { CHECK_SECRETS_IDENTITY } from '../../catalog/check-secrets.ts';
import {
  CATALOG_AUDIENCE,
  CATALOG_HOST,
  CHECKS_IDENTITY_ID,
  PROD_IDENTITY_ID,
  STAGING_IDENTITY_ID,
  infisicalRepoTexts,
} from '../../test-fixtures/infisical.ts';
import {
  createFakeRepoFiles,
  withoutPath,
} from '../../test-fixtures/repo-files.ts';
import { PROJECT_ID } from '../../test-fixtures/resource-catalog.ts';
import { loadInfisicalTarget } from './infisical-target.ts';

const files = createFakeRepoFiles(infisicalRepoTexts());

describe('loadInfisicalTarget', () => {
  test('検査の範囲は、.infisical.yamlのプロジェクトのdevを、検査用の主体で取り出す', async () => {
    expect(await loadInfisicalTarget(files, 'checks')).toEqual({
      ok: true,
      value: {
        scope: 'checks',
        environment: 'dev',
        projectId: PROJECT_ID,
        host: CHECK_SECRETS_IDENTITY.host,
        identityId: CHECK_SECRETS_IDENTITY.identityId,
        oidcAudience: CHECK_SECRETS_IDENTITY.oidcAudience,
        identitySource: 'scripts/delivery/catalog/check-secrets.ts',
      },
    });
  });

  test('検査用の主体を差し替えられる', async () => {
    const result = await loadInfisicalTarget(files, 'checks', {
      ...CHECK_SECRETS_IDENTITY,
      identityId: CHECKS_IDENTITY_ID,
    });

    expect(result.ok && result.value.identityId).toBe(CHECKS_IDENTITY_ID);
  });

  test.each([
    ['staging', STAGING_IDENTITY_ID],
    ['prod', PROD_IDENTITY_ID],
  ] as const)(
    '%sの範囲は、資源一覧の同じプロジェクトから同じ名前の環境を、その環境の主体で取り出す',
    async (scope, identityId) => {
      expect(await loadInfisicalTarget(files, scope)).toEqual({
        ok: true,
        value: {
          scope,
          environment: scope,
          projectId: PROJECT_ID,
          host: CATALOG_HOST,
          identityId,
          oidcAudience: CATALOG_AUDIENCE,
          identitySource: `apps/infra/environments/${scope}.json`,
        },
      });
    },
  );

  test('.infisical.yamlが無ければ読み込めないことを返す', async () => {
    const result = await loadInfisicalTarget(
      createFakeRepoFiles(withoutPath(infisicalRepoTexts(), '.infisical.yaml')),
      'checks',
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([
      '.infisical.yamlを読み込めませんでした: ENOENT: no such file',
    ]);
  });

  test('.infisical.yamlのプロジェクトのIDが不正なら、その誤りを返す', async () => {
    const result = await loadInfisicalTarget(
      createFakeRepoFiles({
        ...infisicalRepoTexts(),
        '.infisical.yaml': 'version: 1\n',
      }),
      'checks',
    );

    expect(result.ok ? [] : result.errors).toEqual([
      'secrets-management.project-id: 英小文字の16進のUUIDが必要です(実際: (なし))',
    ]);
  });

  test.each([
    ['{', 'apps/infra/environments/prod.json: JSONとして解析できません'],
    ['{}', 'apps/infra/environments/prod.json: '],
  ])(
    '資源一覧を解析できなければ、ファイルの名前を添えて誤りを返す(%p)',
    async (text, prefix) => {
      const result = await loadInfisicalTarget(
        createFakeRepoFiles({
          ...infisicalRepoTexts(),
          'apps/infra/environments/prod.json': text,
        }),
        'prod',
      );

      expect(result.ok).toBe(false);
      expect(
        (result.ok ? [] : result.errors).every((error) =>
          error.startsWith(prefix),
        ),
      ).toBe(true);
    },
  );
});
