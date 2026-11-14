import { describe, expect, test } from 'bun:test';

import {
  MEDIA_MESSAGE_LIMITS,
  MODERATE_IMAGE_MESSAGE,
  PURGE_IMAGE_CACHE_MESSAGE,
  RELOCATE_FILES_MESSAGE,
} from './media-messages.ts';

const FILE_ID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1';

const OBJECT_KEY = '0123456789abcdef'.repeat(2);

const fileIdAt = (index: number): string =>
  `01JBQ6Z8Y3V4W5X6Y7Z8A${index.toString().padStart(5, '0')}`;

const objectKeyAt = (index: number): string =>
  index.toString(16).padStart(32, '0');

describe('MEDIA_MESSAGE_LIMITS', () => {
  test('移動の依頼は25件、パージの依頼は100件を上限にする', () => {
    expect(MEDIA_MESSAGE_LIMITS).toEqual({
      relocateBatch: 25,
      purgeBatch: 100,
    });
    expect(Object.isFrozen(MEDIA_MESSAGE_LIMITS)).toBe(true);
  });
});

describe('MODERATE_IMAGE_MESSAGE', () => {
  test('種別media.moderate-imageの凍結済みの契約である', () => {
    expect(MODERATE_IMAGE_MESSAGE.type).toBe('media.moderate-image');
    expect(Object.isFrozen(MODERATE_IMAGE_MESSAGE)).toBe(true);
  });

  test('ファイルの識別子だけの本文を受け付ける', () => {
    expect(
      MODERATE_IMAGE_MESSAGE.schema.safeParse({ fileId: FILE_ID }),
    ).toEqual({ success: true, data: { fileId: FILE_ID } });
  });

  test('本文にファイル名や主体を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = MODERATE_IMAGE_MESSAGE.schema.parse({
      fileId: FILE_ID,
      originalFileName: 'avatar.png',
      owner: { kind: 'user', id: 'user-1' },
    });

    expect(first).toEqual({ fileId: FILE_ID });
    expect(MODERATE_IMAGE_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['識別子の欠落', {}],
    ['空の識別子', { fileId: '' }],
    ['25文字の識別子', { fileId: FILE_ID.slice(1) }],
    ['27文字の識別子', { fileId: `${FILE_ID}0` }],
    ['ULIDに使わない文字Uを含む識別子', { fileId: `U${FILE_ID.slice(1)}` }],
    ['オブジェクトキー', { fileId: OBJECT_KEY }],
    ['数値の識別子', { fileId: 1 }],
    ['配列の識別子', { fileId: [FILE_ID] }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(MODERATE_IMAGE_MESSAGE.schema.safeParse(body).success).toBe(false);
  });
});

describe('RELOCATE_FILES_MESSAGE', () => {
  test('種別media.relocate-filesの凍結済みの契約である', () => {
    expect(RELOCATE_FILES_MESSAGE.type).toBe('media.relocate-files');
    expect(Object.isFrozen(RELOCATE_FILES_MESSAGE)).toBe(true);
  });

  test.each([
    ['1件', [FILE_ID]],
    [
      '上限の25件',
      Array.from({ length: MEDIA_MESSAGE_LIMITS.relocateBatch }, (_, index) =>
        fileIdAt(index),
      ),
    ],
  ])('%sのファイルの識別子を受け付ける', (_label, fileIds) => {
    expect(RELOCATE_FILES_MESSAGE.schema.safeParse({ fileIds })).toEqual({
      success: true,
      data: { fileIds },
    });
  });

  test('本文に識別子以外を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = RELOCATE_FILES_MESSAGE.schema.parse({
      fileIds: [FILE_ID],
      reason: 'auto',
    });

    expect(first).toEqual({ fileIds: [FILE_ID] });
    expect(RELOCATE_FILES_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['識別子の一覧の欠落', {}],
    ['空の一覧', { fileIds: [] }],
    [
      '26件の一覧',
      {
        fileIds: Array.from(
          { length: MEDIA_MESSAGE_LIMITS.relocateBatch + 1 },
          (_, index) => fileIdAt(index),
        ),
      },
    ],
    ['ULIDでない識別子を含む一覧', { fileIds: [FILE_ID, 'file-1'] }],
    ['一覧でない識別子', { fileIds: FILE_ID }],
    ['数値を含む一覧', { fileIds: [1] }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(RELOCATE_FILES_MESSAGE.schema.safeParse(body).success).toBe(false);
  });
});

describe('PURGE_IMAGE_CACHE_MESSAGE', () => {
  test('種別media.purge-image-cacheの凍結済みの契約である', () => {
    expect(PURGE_IMAGE_CACHE_MESSAGE.type).toBe('media.purge-image-cache');
    expect(Object.isFrozen(PURGE_IMAGE_CACHE_MESSAGE)).toBe(true);
  });

  test.each([
    ['1件', [OBJECT_KEY]],
    [
      '上限の100件',
      Array.from({ length: MEDIA_MESSAGE_LIMITS.purgeBatch }, (_, index) =>
        objectKeyAt(index),
      ),
    ],
  ])('%sのオブジェクトキーを受け付ける', (_label, objectKeys) => {
    expect(PURGE_IMAGE_CACHE_MESSAGE.schema.safeParse({ objectKeys })).toEqual({
      success: true,
      data: { objectKeys },
    });
  });

  test('本文にオブジェクトキー以外を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = PURGE_IMAGE_CACHE_MESSAGE.schema.parse({
      objectKeys: [OBJECT_KEY],
      fileIds: [FILE_ID],
    });

    expect(first).toEqual({ objectKeys: [OBJECT_KEY] });
    expect(PURGE_IMAGE_CACHE_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['キーの一覧の欠落', {}],
    ['空の一覧', { objectKeys: [] }],
    [
      '101件の一覧',
      {
        objectKeys: Array.from(
          { length: MEDIA_MESSAGE_LIMITS.purgeBatch + 1 },
          (_, index) => objectKeyAt(index),
        ),
      },
    ],
    ['大文字の16進を含むキー', { objectKeys: [OBJECT_KEY.toUpperCase()] }],
    ['31文字のキー', { objectKeys: [OBJECT_KEY.slice(1)] }],
    ['33文字のキー', { objectKeys: [`${OBJECT_KEY}0`] }],
    ['パスの区切りを含むキー', { objectKeys: [`${OBJECT_KEY.slice(1)}/`] }],
    ['ファイルの識別子', { objectKeys: [FILE_ID] }],
    ['一覧でないキー', { objectKeys: OBJECT_KEY }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(PURGE_IMAGE_CACHE_MESSAGE.schema.safeParse(body).success).toBe(
      false,
    );
  });
});
