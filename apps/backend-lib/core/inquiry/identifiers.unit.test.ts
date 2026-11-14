import { describe, expect, test } from 'bun:test';

import { INQUIRY_EXPORT_TYPES } from './identifiers.ts';

const EXPECTED_NAMES = ['InquiryExport'] as const;

describe('INQUIRY_EXPORT_TYPES', () => {
  test('データエクスポートが受け取るエクスポート用の照会口の識別子だけを持つ', () => {
    expect(Object.keys(INQUIRY_EXPORT_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のinquiry.<名前>である',
    (name) => {
      expect<symbol>(INQUIRY_EXPORT_TYPES[name]).toBe(
        Symbol.for(`inquiry.${name}`),
      );
    },
  );

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(INQUIRY_EXPORT_TYPES)).toBe(true);
  });
});
