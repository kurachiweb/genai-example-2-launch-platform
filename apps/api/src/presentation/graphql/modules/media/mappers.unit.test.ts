import { describe, expect, test } from 'bun:test';

import type { ImageMediaType } from '../../../../../common-lib/media/media-types.ts';
import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../../../../test/support/media-file-view.ts';
import { toMediaAttachment, toMediaImage } from './mappers.ts';

const OBJECT_KEY = 'fedcba9876543210'.repeat(2);

function deliverableImageOf(
  overrides: Parameters<typeof imageFileViewOf>[0] = {},
) {
  return imageFileViewOf({
    objectKey: OBJECT_KEY,
    location: 'images',
    moderationStatus: 'passed',
    quarantineReasons: [],
    quarantined: false,
    ...overrides,
  });
}

describe('toMediaImage', () => {
  test('配信できる画像は識別子・オブジェクトキー・幅・高さをそのまま返す', () => {
    const file = deliverableImageOf();

    expect(toMediaImage(file)).toEqual({
      id: file.id,
      objectKey: OBJECT_KEY,
      fallbackFormat: 'PNG',
      width: 640,
      height: 480,
    });
  });

  test.each<[ImageMediaType, 'JPG' | 'PNG' | 'SVG']>([
    ['image/jpeg', 'JPG'],
    ['image/png', 'PNG'],
    ['image/webp', 'PNG'],
    ['image/gif', 'PNG'],
    ['image/svg+xml', 'SVG'],
  ])('原本が%sならフォールバックの形式を%sにする', (contentType, expected) => {
    expect(
      toMediaImage(deliverableImageOf({ contentType })).fallbackFormat,
    ).toBe(expected);
  });

  test('寸法を持たないSVGは幅・高さを空にする', () => {
    const image = toMediaImage(
      deliverableImageOf({
        contentType: 'image/svg+xml',
        width: null,
        height: null,
      }),
    );

    expect(image.width).toBeNull();
    expect(image.height).toBeNull();
  });

  test('隔離中の画像はオブジェクトキーを空にする', () => {
    const image = toMediaImage(
      deliverableImageOf({
        location: 'quarantine',
        quarantineReasons: ['product_hidden'],
        quarantined: true,
      }),
    );

    expect(image.objectKey).toBeNull();
    expect(image.fallbackFormat).toBe('PNG');
  });

  test('理由が外れて保存先への移動を待つ画像は隔離中でないためオブジェクトキーを返す', () => {
    const image = toMediaImage(deliverableImageOf({ location: 'quarantine' }));

    expect(image.objectKey).toBe(OBJECT_KEY);
  });

  test('削除待ちの画像はオブジェクトキーを空にする', () => {
    expect(
      toMediaImage(deliverableImageOf({ eraseRequested: true })).objectKey,
    ).toBeNull();
  });

  test('保存未完了の画像はオブジェクトキーを空にする', () => {
    expect(
      toMediaImage(deliverableImageOf({ stored: false })).objectKey,
    ).toBeNull();
  });

  test('論理削除済みの画像は物理削除まで配信を止めないためオブジェクトキーを返す', () => {
    const image = toMediaImage(
      deliverableImageOf({ deletedAt: new Date('2026-11-02T00:00:00.000Z') }),
    );

    expect(image.objectKey).toBe(OBJECT_KEY);
  });

  test('画像用の用途でないファイルは画像として返せないため例外を投げる', () => {
    expect(() =>
      toMediaImage(mediaFileViewOf({ contentType: 'image/png' })),
    ).toThrow(TypeError);
  });

  test('画像でない形式のファイルは画像として返せないため例外を投げる', () => {
    expect(() =>
      toMediaImage(deliverableImageOf({ contentType: 'application/pdf' })),
    ).toThrow(TypeError);
  });
});

describe('toMediaAttachment', () => {
  test('元のファイル名・形式・バイト数と、フロントエンドサーバーのダウンロードのパスを返す', () => {
    const file = mediaFileViewOf({
      originalFileName: '見積書.pdf',
      byteSize: 2048,
    });

    expect(toMediaAttachment(file)).toEqual({
      id: file.id,
      originalFileName: '見積書.pdf',
      contentType: 'application/pdf',
      byteSize: 2048,
      downloadPath: `/_bff/files/${file.id}`,
    });
  });

  test('ダウンロードのパスの識別子は百分率符号化する', () => {
    expect(
      toMediaAttachment(mediaFileViewOf({ id: 'a/b?c' })).downloadPath,
    ).toBe('/_bff/files/a%2Fb%3Fc');
  });

  test('ファイル用の用途でないファイルは添付として返せないため例外を投げる', () => {
    expect(() => toMediaAttachment(deliverableImageOf())).toThrow(TypeError);
  });

  test('テキストの形式は引数を含まないMIMEタイプで返す', () => {
    expect(
      toMediaAttachment(mediaFileViewOf({ contentType: 'text/plain' }))
        .contentType,
    ).toBe('text/plain');
  });
});
