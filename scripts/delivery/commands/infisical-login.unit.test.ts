import { describe, expect, test } from 'bun:test';

import { CHECK_SECRETS_IDENTITY } from '../catalog/check-secrets.ts';
import {
  CATALOG_AUDIENCE,
  CATALOG_HOST,
  CHECKS_IDENTITY_ID,
  FAKE_OIDC_TOKEN,
  STAGING_IDENTITY_ID,
  createFakeSecretSource,
  createRecordingGithub,
  infisicalRepoTexts,
} from '../test-fixtures/infisical.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import {
  createFakeDeps,
  createFakeRepoFiles,
} from '../test-fixtures/repo-files.ts';
import { PLACEHOLDER_UUID } from '../test-fixtures/resource-catalog.ts';
import { command, createInfisicalLoginCommand } from './infisical-login.ts';
import {
  EXIT_FAILURE,
  EXIT_SUCCESS,
  UsageError,
} from './shared/delivery-command.ts';

const ACCESS_TOKEN = 'fake-infisical-access-token';

const runWith = async (
  args: readonly string[],
  texts: Record<string, string> = infisicalRepoTexts(),
) => {
  const timeline: string[] = [];
  const fake = createFakeDeps(createFakeRepoFiles(texts));
  const login = createInfisicalLoginCommand({
    checksIdentity: {
      ...CHECK_SECRETS_IDENTITY,
      identityId: CHECKS_IDENTITY_ID,
    },
  });
  const code = await login.run(args, {
    ...fake.deps,
    github: createRecordingGithub(timeline),
    secrets: createFakeSecretSource({ timeline, token: ACCESS_TOKEN }),
  });
  return { ...fake, code, timeline };
};

describe('infisical-login', () => {
  test('名前と説明を持つ', () => {
    expect(command.name).toBe('infisical-login');
    expect(command.description).not.toBe('');
  });

  test('OIDCのトークンを主体と接続先とともにログインへ渡し、アクセストークンをマスクしてから環境変数のファイルへ追記する', async () => {
    const { code, timeline, stdout, stderr } = await runWith([
      '--scope',
      'staging',
    ]);

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline).toEqual([
      `oidc:${CATALOG_AUDIENCE}`,
      `login:${STAGING_IDENTITY_ID}:${FAKE_OIDC_TOKEN}:${CATALOG_HOST}`,
      `mask:${ACCESS_TOKEN}`,
      `exportEnv:INFISICAL_TOKEN=${ACCESS_TOKEN}`,
    ]);
    expect(stdout.text()).toContain(
      `範囲stagingの主体${STAGING_IDENTITY_ID}でInfisicalにログインし、INFISICAL_TOKENを後続の手順へ渡しました(取り出す環境: staging)`,
    );
    expect(stdout.text() + stderr.text()).not.toContain(ACCESS_TOKEN);
    expect(stdout.text() + stderr.text()).not.toContain(FAKE_OIDC_TOKEN);
  });

  test('検査の範囲は検査用の主体と接続先でログインし、devを取り出すことを示す', async () => {
    const { code, timeline, stdout } = await runWith(['--scope', 'checks']);

    expect(code).toBe(EXIT_SUCCESS);
    expect(timeline.slice(0, 2)).toEqual([
      `oidc:${CHECK_SECRETS_IDENTITY.oidcAudience}`,
      `login:${CHECKS_IDENTITY_ID}:${FAKE_OIDC_TOKEN}:${CHECK_SECRETS_IDENTITY.host}`,
    ]);
    expect(stdout.text()).toContain('(取り出す環境: dev)');
  });

  test('主体のIDが仮の値なら、ログインせずに記入先を示して失敗する', async () => {
    const { code, timeline, stderr } = await runWith(
      ['--scope', 'prod'],
      infisicalRepoTexts({ prod: PLACEHOLDER_UUID }),
    );

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline).toEqual([]);
    expect(stderr.text()).toContain(
      '範囲prodの主体のIDが仮の値です。apps/infra/environments/prod.jsonに主体のIDを記入してください',
    );
  });

  test('主体の設定を読み込めなければ、ログインせずに前提の不足として失敗する', async () => {
    const { code, timeline, stderr } = await runWith(['--scope', 'checks'], {
      ...infisicalRepoTexts(),
      '.infisical.yaml': 'version: 1\n',
    });

    expect(code).toBe(EXIT_FAILURE);
    expect(timeline.filter((event) => !event.startsWith('summary:'))).toEqual(
      [],
    );
    expect(stderr.text()).toContain('secrets-management.project-id');
  });

  test.each([
    [[], '--scopeを指定してください(checks・staging・prod)'],
    [
      ['--scope', 'local'],
      '--scopeはchecks・staging・prodのいずれかにしてください',
    ],
    [['--scope', 'checks', '--', 'echo'], '`--`の後のコマンドは受け取りません'],
  ])('引数の誤り(%p)はログインせずに示す', async (args, message) => {
    const error = await runWith(args).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(UsageError);
    expect(await rejectionMessageOf(runWith(args))).toContain(message);
  });
});
