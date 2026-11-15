import { describe, expect, test } from 'bun:test';

import { MEDIA_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = [
  'MediaFiles',
  'MediaQuarantine',
  'MediaEraser',
  'UploadReceiver',
  'MediaFileStore',
  'MediaObjectStore',
  'UploadPurposeRegistry',
] as const;

describe('MEDIA_TYPES', () => {
  test('両アプリとドメインspecが共有する7種の識別子だけを持つ', () => {
    expect(Object.keys(MEDIA_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のmedia.<名前>である',
    (name) => {
      expect<symbol>(MEDIA_TYPES[name]).toBe(Symbol.for(`media.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(MEDIA_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(MEDIA_TYPES)).toBe(true);
  });
});
