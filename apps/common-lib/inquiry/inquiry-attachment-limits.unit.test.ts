import { describe, expect, test } from 'bun:test';

import { MAX_UPLOAD_BYTES } from '../media/media-types.ts';
import {
  checkAttachmentTotals,
  INQUIRY_ATTACHMENT_LIMITS,
  INQUIRY_ATTACHMENT_PURPOSE,
} from './inquiry-attachment-limits.ts';

const MAX_BYTES = 20_971_520;

describe('添付の用途と上限', () => {
  test('用途の名前はinquiry-attachmentにする', () => {
    expect(INQUIRY_ATTACHMENT_PURPOSE).toBe('inquiry-attachment');
  });

  test('1メッセージ20件・合計20,971,520バイト・1ファイル20,971,520バイトにする', () => {
    expect(INQUIRY_ATTACHMENT_LIMITS).toEqual({
      maxCount: 20,
      maxTotalBytes: MAX_BYTES,
      maxFileBytes: MAX_BYTES,
    });
    expect(Object.isFrozen(INQUIRY_ATTACHMENT_LIMITS)).toBe(true);
  });

  test('合計と1ファイルの上限がアップロードの上限の最大値と等しい', () => {
    expect(INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes).toBe(MAX_UPLOAD_BYTES);
    expect(INQUIRY_ATTACHMENT_LIMITS.maxFileBytes).toBe(MAX_UPLOAD_BYTES);
  });
});

describe('checkAttachmentTotals', () => {
  test.each([
    ['0件', []],
    ['1件の1バイト', [1]],
    ['20件', Array.from({ length: 20 }, () => 1)],
    ['1件で合計20,971,520バイト', [MAX_BYTES]],
    [
      '20件で合計20,971,520バイト',
      Array.from({ length: 20 }, () => MAX_BYTES / 20),
    ],
  ])('%sを受け付ける', (_, sizes) => {
    expect(checkAttachmentTotals(sizes)).toBeUndefined();
  });

  test('21件を多すぎると判定する', () => {
    expect(checkAttachmentTotals(Array.from({ length: 21 }, () => 1))).toBe(
      'too-many',
    );
  });

  test.each([
    ['1件で合計20,971,521バイト', [MAX_BYTES + 1]],
    ['2件で合計20,971,521バイト', [MAX_BYTES, 1]],
  ])('%sを大きすぎると判定する', (_, sizes) => {
    expect(checkAttachmentTotals(sizes)).toBe('too-large');
  });

  test('件数を合計より先に判定する', () => {
    expect(
      checkAttachmentTotals(Array.from({ length: 21 }, () => MAX_BYTES)),
    ).toBe('too-many');
  });
});
