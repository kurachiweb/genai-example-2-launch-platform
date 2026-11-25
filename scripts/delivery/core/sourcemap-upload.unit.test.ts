import { describe, expect, test } from 'bun:test';

import {
  SOURCEMAP_BUILD_OUT_DIRS,
  planSourcemapUpload,
  readSentryValues,
  sentryCliEnv,
  sentryFolderKeys,
  sourcemapSteps,
} from './sourcemap-upload.ts';

const COMPLETE = [
  { key: 'SENTRY_AUTH_TOKEN', value: 'fake-sentry-auth-token' },
  { key: 'SENTRY_ORG', value: 'example-org' },
  { key: 'SENTRY_PROJECT', value: 'example-project' },
] as const;

describe('sentryFolderKeys', () => {
  test('認証トークン・組織・プロジェクトのキー名をこの順で返す', () => {
    expect(sentryFolderKeys()).toEqual([
      'SENTRY_AUTH_TOKEN',
      'SENTRY_ORG',
      'SENTRY_PROJECT',
    ]);
  });
});

describe('planSourcemapUpload', () => {
  test.each(['client', 'admin'] as const)(
    '%sは、Viteの出力の全体を埋め込みとアップロードの対象にし、静的な配信物のdist/clientから.mapを削除する',
    (app) => {
      expect(planSourcemapUpload(app, `apps/${app}/dist`)).toEqual({
        app,
        artifactDir: `apps/${app}/dist`,
        removeMapsFrom: `apps/${app}/dist/client`,
      });
    },
  );

  test.each(['api', 'event'] as const)(
    '%sは、Wranglerの出力先を対象にし、静的な配信物が無いため.mapの削除先を持たない',
    (app) => {
      expect(
        planSourcemapUpload(app, `apps/${app}/.wrangler/sourcemaps`),
      ).toEqual({
        app,
        artifactDir: `apps/${app}/.wrangler/sourcemaps`,
        removeMapsFrom: null,
      });
    },
  );

  test('出力先の末尾のスラッシュは削除先に重ねない', () => {
    expect(planSourcemapUpload('client', 'apps/client/dist/')).toEqual({
      app: 'client',
      artifactDir: 'apps/client/dist',
      removeMapsFrom: 'apps/client/dist/client',
    });
  });

  test.each(['', '   '])(
    '出力先が空(%j)なら、誤ってリポジトリ全体を対象にしないよう例外にする',
    (buildOutDir) => {
      expect(() => planSourcemapUpload('client', buildOutDir)).toThrow(
        '出力先',
      );
    },
  );

  test('既定の出力先は全アプリのアプリのディレクトリの下にある', () => {
    expect(SOURCEMAP_BUILD_OUT_DIRS).toEqual({
      client: 'apps/client/dist',
      admin: 'apps/admin/dist',
      api: 'apps/api/.wrangler/sourcemaps',
      event: 'apps/event/.wrangler/sourcemaps',
    });
  });
});

describe('readSentryValues', () => {
  test('3つのキーが揃っていれば値を返す', () => {
    expect(readSentryValues(COMPLETE)).toEqual({
      ok: true,
      values: {
        authToken: 'fake-sentry-auth-token',
        org: 'example-org',
        project: 'example-project',
      },
    });
  });

  test('無関係なキーは無視する', () => {
    const result = readSentryValues([
      ...COMPLETE,
      { key: 'SENTRY_DSN', value: 'https://dsn.example' },
    ]);

    expect(result.ok).toBe(true);
  });

  test('キーが無ければ、欠けたキーの名前を宣言の順に返す', () => {
    expect(
      readSentryValues([{ key: 'SENTRY_ORG', value: 'example-org' }]),
    ).toEqual({ ok: false, missing: ['SENTRY_AUTH_TOKEN', 'SENTRY_PROJECT'] });
  });

  test('フォルダが空なら3つとも欠けとして返す', () => {
    expect(readSentryValues([])).toEqual({
      ok: false,
      missing: ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'],
    });
  });

  test.each(['', '  ', '\n'])(
    '値が空白だけ(%j)のキーは欠けとして扱う',
    (value) => {
      const result = readSentryValues([
        { key: 'SENTRY_AUTH_TOKEN', value },
        { key: 'SENTRY_ORG', value: 'example-org' },
        { key: 'SENTRY_PROJECT', value: 'example-project' },
      ]);

      expect(result).toEqual({ ok: false, missing: ['SENTRY_AUTH_TOKEN'] });
    },
  );

  test('値の前後の空白は取り除く', () => {
    const result = readSentryValues([
      { key: 'SENTRY_AUTH_TOKEN', value: ' fake-sentry-auth-token\n' },
      { key: 'SENTRY_ORG', value: 'example-org' },
      { key: 'SENTRY_PROJECT', value: 'example-project' },
    ]);

    expect(result).toMatchObject({
      ok: true,
      values: { authToken: 'fake-sentry-auth-token' },
    });
  });
});

describe('sentryCliEnv', () => {
  test('値を引数でなく、sentry-cliが読む3つの環境変数へ置く', () => {
    expect(
      sentryCliEnv({
        authToken: 'fake-sentry-auth-token',
        org: 'example-org',
        project: 'example-project',
      }),
    ).toEqual({
      SENTRY_AUTH_TOKEN: 'fake-sentry-auth-token',
      SENTRY_ORG: 'example-org',
      SENTRY_PROJECT: 'example-project',
    });
  });
});

describe('sourcemapSteps', () => {
  test('client・adminは、埋め込み→アップロード→.mapの削除の順に呼び出す', () => {
    const steps = sourcemapSteps(
      planSourcemapUpload('client', 'apps/client/dist'),
    );

    expect(steps).toEqual([
      {
        kind: 'inject',
        command: 'bun',
        args: [
          'x',
          '--no-install',
          'sentry-cli',
          'sourcemaps',
          'inject',
          'apps/client/dist',
        ],
      },
      {
        kind: 'upload',
        command: 'bun',
        args: [
          'x',
          '--no-install',
          'sentry-cli',
          'sourcemaps',
          'upload',
          'apps/client/dist',
        ],
      },
      {
        kind: 'remove-maps',
        command: 'find',
        args: [
          'apps/client/dist/client',
          '-type',
          'f',
          '-name',
          '*.map',
          '-delete',
        ],
      },
    ]);
  });

  test('api・eventは、.mapを削除する手順を持たない', () => {
    const steps = sourcemapSteps(
      planSourcemapUpload('api', 'apps/api/.wrangler/sourcemaps'),
    );

    expect(steps.map(({ kind }) => kind)).toEqual(['inject', 'upload']);
  });

  test('パッケージを取得し直さないよう、導入済みのバイナリだけを実行する', () => {
    const [inject] = sourcemapSteps(
      planSourcemapUpload('admin', 'apps/admin/dist'),
    );

    expect(inject?.args.slice(0, 3)).toEqual([
      'x',
      '--no-install',
      'sentry-cli',
    ]);
  });
});
