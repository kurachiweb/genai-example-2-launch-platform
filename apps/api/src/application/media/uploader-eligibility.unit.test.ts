import { describe, expect, test } from 'bun:test';

import { UPLOAD_ACCESS_TYPES } from './uploader-eligibility.ts';

describe('UPLOAD_ACCESS_TYPES', () => {
  test('アップロードできる利用者かの差し込み口の識別子だけを持つ', () => {
    expect(Object.keys(UPLOAD_ACCESS_TYPES)).toEqual(['UploaderEligibility']);
  });

  test('識別子はグローバルのシンボル登録簿のmedia.UploaderEligibilityで、他のアプリやspecからも同じ値で束縛できる', () => {
    expect<symbol>(UPLOAD_ACCESS_TYPES.UploaderEligibility).toBe(
      Symbol.for('media.UploaderEligibility'),
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(UPLOAD_ACCESS_TYPES)).toBe(true);
  });
});
