import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  ATTACHMENT_MEDIA_TYPES,
  fallbackFormatOf,
  IMAGE_MEDIA_TYPES,
  IMAGE_STORAGE_MAX_BYTES,
  type ImageMediaType,
  isImageMediaType,
  MAX_UPLOAD_BYTES,
  MEDIA_TYPE_LABELS,
  type MediaType,
  parseMediaType,
} from './media-types.ts';

describe('形式の一覧', () => {
  test('画像はJPEG・PNG・GIF・WebP・SVGの5形式に限る', () => {
    expect(IMAGE_MEDIA_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ]);
  });

  test('添付は画像5形式・PDF・プレーンテキストに限る', () => {
    expect(ATTACHMENT_MEDIA_TYPES).toEqual([
      ...IMAGE_MEDIA_TYPES,
      'application/pdf',
      'text/plain',
    ]);
  });

  test('一覧を書き換えられない', () => {
    expect(Object.isFrozen(IMAGE_MEDIA_TYPES)).toBe(true);
    expect(Object.isFrozen(ATTACHMENT_MEDIA_TYPES)).toBe(true);
    expect(Object.isFrozen(MEDIA_TYPE_LABELS)).toBe(true);
  });

  test('全形式に表示名がある', () => {
    expect(MEDIA_TYPE_LABELS).toEqual({
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/gif': 'GIF',
      'image/webp': 'WebP',
      'image/svg+xml': 'SVG',
      'application/pdf': 'PDF',
      'text/plain': 'テキスト',
    });
    expect(Object.keys(MEDIA_TYPE_LABELS).toSorted()).toEqual(
      [...ATTACHMENT_MEDIA_TYPES].toSorted(),
    );
  });
});

describe('上限サイズ', () => {
  test('用途の上限の最大値は1,024を基数とする20MBである', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBe(20_971_520);
  });

  test('画像用の用途の上限の最大値は1,000を基数とする20MBで、用途の上限の最大値を超えない', () => {
    expect(IMAGE_STORAGE_MAX_BYTES).toBe(20_000_000);
    expect(IMAGE_STORAGE_MAX_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
  });
});

describe('parseMediaType', () => {
  test.each(ATTACHMENT_MEDIA_TYPES.map((type) => [type]))(
    '%sをそのまま返す',
    (type) => {
      expect(parseMediaType(type)).toBe(type);
    },
  );

  test.each([
    ['大文字', 'IMAGE/PNG', 'image/png'],
    ['大文字小文字の混在', 'Image/Svg+Xml', 'image/svg+xml'],
    ['前後の空白', '  application/pdf\t', 'application/pdf'],
    ['引数', 'image/jpeg; quality=90', 'image/jpeg'],
    ['空白の無い引数', 'image/webp;foo=bar', 'image/webp'],
    ['引数の前の空白', 'image/gif ; foo=bar', 'image/gif'],
    ['空の引数', 'application/pdf;', 'application/pdf'],
    ['SVGのcharset', 'image/svg+xml; charset=utf-8', 'image/svg+xml'],
  ] as const)('%sの形式を照合する', (_, header, expected) => {
    expect(parseMediaType(header)).toBe(expected);
  });

  test.each([
    ['charsetの無いテキスト', 'text/plain'],
    ['UTF-8のテキスト', 'text/plain; charset=utf-8'],
    ['大文字のUTF-8', 'TEXT/PLAIN; CHARSET=UTF-8'],
    ['引用符で囲んだUTF-8', 'text/plain; charset="utf-8"'],
    ['空白の無いcharset', 'text/plain;charset=utf-8'],
    ['charset以外の引数', 'text/plain; format=flowed; charset=utf-8'],
    ['値の無い引数', 'text/plain; flowed'],
  ])('%sをテキストとして受け付ける', (_, header) => {
    expect(parseMediaType(header)).toBe('text/plain');
  });

  test.each([
    ['Shift_JIS', 'text/plain; charset=shift_jis'],
    ['UTF-16', 'text/plain; charset=utf-16'],
    ['ハイフンの無いutf8', 'text/plain; charset=utf8'],
    ['空のcharset', 'text/plain; charset='],
    ['空の引用符', 'text/plain; charset=""'],
    ['UTF-8と別のcharsetの重複', 'text/plain; charset=utf-8; charset=latin1'],
    ['閉じていない引用符', 'text/plain; charset="utf-8'],
    ['引用符1つだけ', 'text/plain; charset="'],
  ])('%sのテキストを受け付けない', (_, header) => {
    expect(parseMediaType(header)).toBeUndefined();
  });

  test.each([
    ['ヘッダーが無い', null],
    ['空文字列', ''],
    ['空白だけ', '   '],
    ['未知の画像の形式', 'image/heic'],
    ['未知の文書の形式', 'application/zip'],
    ['HTML', 'text/html'],
    ['XML', 'application/xml'],
    ['任意の形式', 'application/octet-stream'],
    ['ワイルドカード', 'image/*'],
    ['副型が無い', 'image'],
    ['余分な階層', 'image/png/extra'],
    ['形式の途中の空白', 'image/ png'],
    ['引数だけ', '; charset=utf-8'],
  ])('%sならundefinedを返す', (_, header) => {
    expect(parseMediaType(header)).toBeUndefined();
  });
});

describe('isImageMediaType', () => {
  test.each(IMAGE_MEDIA_TYPES.map((type) => [type]))(
    '%sを画像と判定する',
    (type) => {
      expect(isImageMediaType(type)).toBe(true);
    },
  );

  test.each([['application/pdf'], ['text/plain']] as const)(
    '%sを画像と判定しない',
    (type) => {
      expect(isImageMediaType(type)).toBe(false);
    },
  );

  test('判定した値を画像の形式に絞り込む', () => {
    expectTypeOf(isImageMediaType).guards.toEqualTypeOf<ImageMediaType>();
    expectTypeOf(isImageMediaType).parameters.toEqualTypeOf<[MediaType]>();
  });
});

describe('fallbackFormatOf', () => {
  test.each([
    ['image/jpeg', 'jpg'],
    ['image/svg+xml', 'svg'],
    ['image/png', 'png'],
    ['image/gif', 'png'],
    ['image/webp', 'png'],
  ] as const)('%sのフォールバックの形式は%sである', (type, expected) => {
    expect(fallbackFormatOf(type)).toBe(expected);
  });
});
