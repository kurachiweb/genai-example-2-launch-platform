import { describe, expect, test } from 'bun:test';

import {
  APP_CHECKS,
  type AppCheck,
  appCheckDirs,
  type AppCheckLayout,
  planAppChecks,
  scriptNamesOf,
} from './app-checks.ts';

const LAYOUT: AppCheckLayout = {
  apps: [
    { name: 'api', dir: 'apps/api' },
    { name: 'event', dir: 'apps/event' },
  ],
};

const CHECKS: readonly AppCheck[] = [
  { app: 'api', script: 'db:migrations:check' },
  { app: 'event', script: 'lint' },
  { app: 'api', script: 'test:smoke' },
];

const scriptsOf = (
  entries: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, readonly string[]> => new Map(Object.entries(entries));

describe('APP_CHECKS', () => {
  test('apiのマイグレーションの検出、DIのスモークテストの順に並ぶ', () => {
    expect(APP_CHECKS).toEqual([
      { app: 'api', script: 'db:migrations:check' },
      { app: 'api', script: 'test:smoke' },
    ]);
  });

  test('型の鮮度とGraphQLの検査は、先に実行する一括検査が行うため含めない', () => {
    const scripts = APP_CHECKS.map(({ script }) => script);

    expect(scripts).not.toContain('cf-typegen:check');
    expect(scripts).not.toContain('graphql:check');
  });
});

describe('appCheckDirs', () => {
  test('表に現れるアプリのディレクトリを、表の順に重複を除いて返す', () => {
    expect(appCheckDirs(CHECKS, LAYOUT)).toEqual(['apps/api', 'apps/event']);
  });

  test('アプリの一覧に無いアプリを表に書くと失敗する', () => {
    expect(() =>
      appCheckDirs([{ app: 'admin', script: 'lint' }], LAYOUT),
    ).toThrow('アプリの一覧にadminがありません。');
  });
});

describe('scriptNamesOf', () => {
  test('package.jsonのscriptsのうち、コマンドが文字列のものの名前を返す', () => {
    expect(
      scriptNamesOf({
        name: 'api',
        scripts: { 'test:smoke': 'bun ./smoke.ts', broken: 1 },
      }),
    ).toEqual(['test:smoke']);
  });

  test.each([
    ['scriptsが無い', { name: 'api' }],
    ['scriptsがオブジェクトでない', { scripts: ['test:smoke'] }],
    ['package.jsonがオブジェクトでない', 'test:smoke'],
    ['package.jsonがnull', null],
  ])('%s場合は空を返す', (_, packageJson) => {
    expect(scriptNamesOf(packageJson)).toEqual([]);
  });
});

describe('planAppChecks', () => {
  test('表の順に、アプリのディレクトリとスクリプトの手順を返す', () => {
    const plan = planAppChecks(
      scriptsOf({
        'apps/api': ['db:migrations:check', 'test:smoke'],
        'apps/event': ['lint'],
      }),
      CHECKS,
      LAYOUT,
    );

    expect(plan).toEqual({
      ok: true,
      steps: [
        { dir: 'apps/api', script: 'db:migrations:check' },
        { dir: 'apps/event', script: 'lint' },
        { dir: 'apps/api', script: 'test:smoke' },
      ],
    });
  });

  test('アプリにスクリプトが無ければ、欠けたものをすべて挙げて失敗する', () => {
    const plan = planAppChecks(
      scriptsOf({ 'apps/api': ['test:smoke'], 'apps/event': [] }),
      CHECKS,
      LAYOUT,
    );

    expect(plan).toEqual({
      ok: false,
      errors: [
        'apps/api/package.json: スクリプトdb:migrations:checkがありません',
        'apps/event/package.json: スクリプトlintがありません',
      ],
    });
  });

  test('アプリのスクリプトの一覧が渡されなければ、そのアプリのスクリプトはすべて欠けたものとして失敗する', () => {
    const plan = planAppChecks(
      scriptsOf({ 'apps/event': ['lint'] }),
      CHECKS,
      LAYOUT,
    );

    expect(plan).toEqual({
      ok: false,
      errors: [
        'apps/api/package.json: スクリプトdb:migrations:checkがありません',
        'apps/api/package.json: スクリプトtest:smokeがありません',
      ],
    });
  });
});
