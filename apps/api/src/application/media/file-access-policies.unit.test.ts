import { describe, expect, test } from 'bun:test';

import { FILE_ACCESS_TYPES } from './file-access-policies.ts';

describe('FILE_ACCESS_TYPES', () => {
  test('管理者の画像確認・既定の閲覧の可否・閲覧の判定の識別子を持つ', () => {
    expect(Object.keys(FILE_ACCESS_TYPES)).toEqual([
      'AdminMediaReviewPolicy',
      'DefaultFileReadPolicy',
      'FileAccessAuthorizer',
    ]);
  });

  test('識別子はグローバルのシンボル登録簿のmedia.<名前>で、他のspecからも同じ値で束縛を差し替えられる', () => {
    expect<symbol>(FILE_ACCESS_TYPES.AdminMediaReviewPolicy).toBe(
      Symbol.for('media.AdminMediaReviewPolicy'),
    );
    expect<symbol>(FILE_ACCESS_TYPES.DefaultFileReadPolicy).toBe(
      Symbol.for('media.DefaultFileReadPolicy'),
    );
    expect<symbol>(FILE_ACCESS_TYPES.FileAccessAuthorizer).toBe(
      Symbol.for('media.FileAccessAuthorizer'),
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(FILE_ACCESS_TYPES)).toBe(true);
  });
});
