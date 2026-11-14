import { describe, expect, test } from 'bun:test';

import type { CommandSpec } from './command-runner.ts';
import { createInfisicalSecretSource } from './infisical.ts';
import {
  type CommandOutputs,
  commandLineOf,
  createRecordingRunner,
} from '../test-fixtures/command-runner.ts';
import { rejectionMessageOf } from '../test-fixtures/rejection.ts';

const HOST = 'https://infisical.example';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const IDENTITY_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const SECRET_VALUE = 'fake-secret-value-1';
const ACCESS_TOKEN = 'fake-access-token';

const createSource = (
  exitCode: number,
  outputs: CommandOutputs,
): {
  readonly source: ReturnType<typeof createInfisicalSecretSource>;
  readonly calls: () => readonly CommandSpec[];
} => {
  const recording = createRecordingRunner(
    () => exitCode,
    () => outputs,
  );
  return {
    source: createInfisicalSecretSource({ runner: recording.runner }),
    calls: recording.calls,
  };
};

describe('login', () => {
  test('OIDCのトークンを主体と接続先とともにログインへ渡し、表示せずに得たアクセストークンを返す', async () => {
    const { source, calls } = createSource(0, {
      stdout: `${ACCESS_TOKEN}\n`,
    });

    const token = await source.login({
      identityId: IDENTITY_ID,
      jwt: 'fake-jwt',
      host: HOST,
    });

    expect(token).toBe(ACCESS_TOKEN);
    expect(calls().map(commandLineOf)).toEqual([
      `infisical --telemetry=false login --method=oidc-auth --machine-identity-id=${IDENTITY_ID} --jwt=fake-jwt --domain=${HOST} --silent --plain`,
    ]);
    expect(calls()[0]?.output).toBe('capture');
  });

  test('ログインが失敗すれば、主体・接続先・終了コードとCLIのエラーを示して失敗する', async () => {
    const { source } = createSource(1, {
      stderr: 'invalid subject claim\n',
    });

    const message = await rejectionMessageOf(
      source.login({ identityId: IDENTITY_ID, jwt: 'fake-jwt', host: HOST }),
    );

    expect(message).toBe(
      `Infisicalへのログインが失敗しました(主体${IDENTITY_ID}・接続先${HOST}・終了コード1): invalid subject claim`,
    );
  });

  test('アクセストークンが出力されなければ失敗する', async () => {
    const { source } = createSource(0, { stdout: '\n' });

    expect(
      await rejectionMessageOf(
        source.login({ identityId: IDENTITY_ID, jwt: 'fake-jwt', host: HOST }),
      ),
    ).toBe(
      `Infisicalへのログインでアクセストークンが出力されませんでした(主体${IDENTITY_ID}・接続先${HOST})`,
    );
  });
});

describe('exportFolder', () => {
  test('環境・フォルダ・プロジェクト・接続先を付けてJSONで取り出し、表示せずにキーと値を取り込む', async () => {
    const { source, calls } = createSource(0, {
      stdout: JSON.stringify([{ key: 'HASH_PEPPER', value: SECRET_VALUE }]),
    });

    const entries = await source.exportFolder({
      projectId: PROJECT_ID,
      environment: 'staging',
      folder: '/workers/api',
      host: HOST,
    });

    expect(entries).toEqual([{ key: 'HASH_PEPPER', value: SECRET_VALUE }]);
    expect(calls().map(commandLineOf)).toEqual([
      `infisical --telemetry=false export --format=json --env=staging --path=/workers/api --projectId=${PROJECT_ID} --domain=${HOST} --silent`,
    ]);
    expect(calls()[0]?.output).toBe('capture');
  });

  test('空のフォルダは空の一覧として取り込む', async () => {
    const { source } = createSource(0, { stdout: 'null' });

    expect(
      await source.exportFolder({
        projectId: PROJECT_ID,
        environment: 'dev',
        folder: '/workers/event',
        host: HOST,
      }),
    ).toEqual([]);
  });

  test('取り出しが失敗すれば、出力を含めずに環境とフォルダの名前だけを示して失敗する', async () => {
    const { source } = createSource(1, {
      stdout: SECRET_VALUE,
      stderr: `Folder not found ${SECRET_VALUE}`,
    });

    const message = await rejectionMessageOf(
      source.exportFolder({
        projectId: PROJECT_ID,
        environment: 'dev',
        folder: '/workers/api',
        host: HOST,
      }),
    );

    expect(message).toBe(
      'Infisicalのdevのフォルダ/workers/apiを取り出せませんでした(終了コード1)',
    );
    expect(message).not.toContain(SECRET_VALUE);
  });

  test('出力を解析できなければ、出力を含めずにフォルダの名前を示して失敗する', async () => {
    const { source } = createSource(0, { stdout: `KEY=${SECRET_VALUE}` });

    const message = await rejectionMessageOf(
      source.exportFolder({
        projectId: PROJECT_ID,
        environment: 'dev',
        folder: '/',
        host: HOST,
      }),
    );

    expect(message).toBe(
      'Infisicalのdevのフォルダ/の出力を取り込めませんでした(`infisical export`の出力をJSONとして解析できません)',
    );
    expect(message).not.toContain(SECRET_VALUE);
  });
});
