import { describe, expect, test } from 'bun:test';

import { PROJECT_ID } from '../test-fixtures/resource-catalog.ts';
import {
  CHECK_SECRETS_IDENTITY,
  INFISICAL_CONFIG_PATH,
  checkSecretsSettings,
} from './check-secrets.ts';
import { isUuid } from './resource-catalog.ts';

const infisicalYaml = (projectId: string): string =>
  ['version: 1', 'secrets-management:', `  project-id: ${projectId}`, ''].join(
    '\n',
  );

describe('checkSecretsSettings', () => {
  test('プロジェクトをInfisicalの設定ファイルから読み、検査用の主体とdevの環境を組み合わせる', () => {
    const result = checkSecretsSettings(infisicalYaml(PROJECT_ID));

    expect(result).toEqual({
      ok: true,
      settings: {
        environment: 'dev',
        host: CHECK_SECRETS_IDENTITY.host,
        projectId: PROJECT_ID,
        identityId: CHECK_SECRETS_IDENTITY.identityId,
        oidcAudience: CHECK_SECRETS_IDENTITY.oidcAudience,
      },
    });
  });

  test.each([
    ['プロジェクトの識別子がUUIDでない', infisicalYaml('my-project')],
    ['プロジェクトの識別子が無い', 'version: 1\nsecrets-management: {}\n'],
    ['secrets-managementが無い', 'version: 1\n'],
    ['secrets-managementがオブジェクトでない', 'secrets-management: 1\n'],
    ['最上位がオブジェクトでない', '- a\n- b\n'],
    ['空のファイル', ''],
  ])('%s場合は、項目のパスを添えて失敗を返す', (_, yaml) => {
    const result = checkSecretsSettings(yaml);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([
      expect.stringContaining('secrets-management.project-id'),
    ]);
  });

  test('YAMLとして解析できなければ、設定ファイルの名前を添えて失敗を返す', () => {
    const result = checkSecretsSettings('secrets-management: [\n');

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([
      expect.stringContaining(INFISICAL_CONFIG_PATH),
    ]);
  });
});

describe('CHECK_SECRETS_IDENTITY', () => {
  test('検査用の主体の識別子はUUIDの形である(初回の準備で記入するまでは全桁0)', () => {
    expect(isUuid(CHECK_SECRETS_IDENTITY.identityId)).toBe(true);
  });

  test('Infisicalの設定ファイルはリポジトリの最上位にある', () => {
    expect(INFISICAL_CONFIG_PATH).toBe('.infisical.yaml');
  });
});
