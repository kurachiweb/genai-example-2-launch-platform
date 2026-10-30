import { describe, expect, test } from 'bun:test';

import { WORKER_KEYS } from '../catalog/resource-catalog.ts';
import { VITE_BUILT_WORKERS, appDirOf } from './worker-apps.ts';

describe('appDirOf', () => {
  test.each(WORKER_KEYS)(
    'Worker(%s)のアプリのディレクトリをアプリの一覧から返す',
    (app) => {
      expect(appDirOf(app)).toBe(`apps/${app}`);
    },
  );

  test('アプリの一覧に無い名前なら、名前を示して例外を投げる', () => {
    expect(() => appDirOf('unknown' as 'api')).toThrow(
      'アプリの一覧にunknownがありません。',
    );
  });
});

describe('VITE_BUILT_WORKERS', () => {
  test('Viteでビルドしてからビルドの設定でデプロイするWorkerはclient・adminである', () => {
    expect([...VITE_BUILT_WORKERS].toSorted()).toEqual(['admin', 'client']);
  });
});
