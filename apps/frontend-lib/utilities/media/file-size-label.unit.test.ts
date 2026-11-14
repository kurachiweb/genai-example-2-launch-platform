import { describe, expect, test } from 'bun:test';

import { formatFileSize } from './file-size-label.ts';

describe('ファイルサイズの表記', () => {
  test.each([
    [512_000, '500kB'],
    [5_242_880, '5MB'],
    [10_485_760, '10MB'],
    [20_971_520, '20MB'],
  ])(
    '文言規則の容量の単位の表のバイト数%iは、1,024を基数として%sと書く',
    (bytes, label) => {
      expect(formatFileSize(bytes)).toBe(label);
    },
  );

  test('1MB未満はkB、1MB以上はMBで書く', () => {
    expect(formatFileSize(1024)).toBe('1kB');
    expect(formatFileSize(1_048_576)).toBe('1MB');
  });

  test('割り切れない値は小数第1位まで切り上げ、上限を1バイトでも超えたサイズが上限と同じ表記にならない', () => {
    expect(formatFileSize(20_971_521)).toBe('20.1MB');
    expect(formatFileSize(1_258_291)).toBe('1.2MB');
    expect(formatFileSize(1536)).toBe('1.5kB');
    expect(formatFileSize(1)).toBe('0.1kB');
  });

  test('0バイトは0kBと書く', () => {
    expect(formatFileSize(0)).toBe('0kB');
  });

  test('切り上げで1,024kBに届く1MB未満の値はMBで書く', () => {
    expect(formatFileSize(1_048_575)).toBe('1MB');
  });

  test('1,000kB以上の値は3桁区切りで書く', () => {
    expect(formatFileSize(1_024_000)).toBe('1,000kB');
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '0以上の整数でないバイト数%pは範囲外として拒否する',
    (bytes) => {
      expect(() => formatFileSize(bytes)).toThrow(RangeError);
    },
  );
});
