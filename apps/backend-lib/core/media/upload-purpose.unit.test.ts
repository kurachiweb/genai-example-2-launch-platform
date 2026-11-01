import { describe, expect, test } from 'bun:test';

import {
  ATTACHMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
  IMAGE_STORAGE_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  type MediaType,
} from '../../../common-lib/media/media-types.ts';
import {
  createUploadPurposeRegistry,
  defineUploadPurpose,
  MEDIA_SMOKE_PURPOSE,
  type UploadPurpose,
  UploadPurposeError,
} from './upload-purpose.ts';

const imagePurpose = (
  overrides: Partial<UploadPurpose> = {},
): UploadPurpose => ({
  name: 'product-logo',
  storage: 'images',
  uploaderKinds: ['user'],
  allowedTypes: ['image/png', 'image/jpeg'],
  maxBytes: 512_000,
  ...overrides,
});

const filePurpose = (
  overrides: Partial<UploadPurpose> = {},
): UploadPurpose => ({
  name: 'inquiry-attachment',
  storage: 'files',
  uploaderKinds: ['user', 'admin'],
  allowedTypes: ['application/pdf', 'text/plain'],
  maxBytes: 10_485_760,
  ...overrides,
});

describe('defineUploadPurpose', () => {
  test('正しい定義を同じ内容のまま返す', () => {
    const purpose = defineUploadPurpose(imagePurpose());

    expect(purpose).toEqual(imagePurpose());
  });

  test('返す定義と配列は凍結され、渡した配列を変えても影響しない', () => {
    const allowedTypes: MediaType[] = ['image/png'];
    const uploaderKinds: ('user' | 'admin')[] = ['user'];
    const purpose = defineUploadPurpose(
      imagePurpose({ allowedTypes, uploaderKinds }),
    );

    allowedTypes.push('image/gif');
    uploaderKinds.push('admin');

    expect(Object.isFrozen(purpose)).toBe(true);
    expect(Object.isFrozen(purpose.allowedTypes)).toBe(true);
    expect(Object.isFrozen(purpose.uploaderKinds)).toBe(true);
    expect(purpose.allowedTypes).toEqual(['image/png']);
    expect(purpose.uploaderKinds).toEqual(['user']);
  });

  test.each([
    'user-avatar',
    'product-logo',
    'inquiry-attachment',
    'a-b',
    'v2-screenshot',
    'product-screenshot-full',
  ])('ハイフンで区切った小文字の英数字の名前%pを受け付ける', (name) => {
    expect(defineUploadPurpose(imagePurpose({ name })).name).toBe(name);
  });

  test.each([
    ['ハイフンの無い名前', 'avatar'],
    ['空の名前', ''],
    ['数字で始まる名前', '1st-image'],
    ['ハイフンで始まる名前', '-avatar'],
    ['ハイフンで終わる名前', 'avatar-'],
    ['ハイフンが連続する名前', 'user--avatar'],
    ['大文字を含む名前', 'User-avatar'],
    ['アンダースコアを含む名前', 'user_avatar'],
    ['スラッシュを含む名前', 'user/avatar'],
    ['ドットを含む名前', 'user.avatar'],
    ['空白を含む名前', 'user avatar'],
    ['末尾に改行を持つ名前', 'user-avatar\n'],
  ])('%sを拒否する', (_label, name) => {
    expect(() => defineUploadPurpose(imagePurpose({ name }))).toThrow(
      UploadPurposeError,
    );
  });

  test('未知の保存先を拒否する', () => {
    expect(() =>
      defineUploadPurpose(
        imagePurpose({ storage: 'videos' as UploadPurpose['storage'] }),
      ),
    ).toThrow(UploadPurposeError);
  });

  test('画像用の用途は画像5形式をすべて許可できる', () => {
    expect(
      defineUploadPurpose(imagePurpose({ allowedTypes: IMAGE_MEDIA_TYPES }))
        .allowedTypes,
    ).toEqual(IMAGE_MEDIA_TYPES);
  });

  test.each(['application/pdf', 'text/plain'] as const)(
    '画像用の用途で画像以外の形式%pを拒否する',
    (type) => {
      expect(() =>
        defineUploadPurpose(
          imagePurpose({ allowedTypes: ['image/png', type] }),
        ),
      ).toThrow(UploadPurposeError);
    },
  );

  test('ファイル用の用途は画像5形式・PDF・テキストをすべて許可できる', () => {
    expect(
      defineUploadPurpose(filePurpose({ allowedTypes: ATTACHMENT_MEDIA_TYPES }))
        .allowedTypes,
    ).toEqual(ATTACHMENT_MEDIA_TYPES);
  });

  test.each(['application/zip', 'image/heic', 'text/html', 'IMAGE/PNG'])(
    'ファイル用の用途で範囲外の形式%pを拒否する',
    (type) => {
      expect(() =>
        defineUploadPurpose(
          filePurpose({ allowedTypes: ['application/pdf', type as MediaType] }),
        ),
      ).toThrow(UploadPurposeError);
    },
  );

  test('許可する形式が空の定義を拒否する', () => {
    expect(() =>
      defineUploadPurpose(filePurpose({ allowedTypes: [] })),
    ).toThrow(UploadPurposeError);
  });

  test('アップロードできる主体の種類が空の定義を拒否する', () => {
    expect(() =>
      defineUploadPurpose(imagePurpose({ uploaderKinds: [] })),
    ).toThrow(UploadPurposeError);
  });

  test('未知の主体の種類を拒否する', () => {
    expect(() =>
      defineUploadPurpose(
        imagePurpose({
          uploaderKinds: ['guest' as UploadPurpose['uploaderKinds'][number]],
        }),
      ),
    ).toThrow(UploadPurposeError);
  });

  test('ファイル用の用途は全用途の上限の最大値ちょうどを受け付ける', () => {
    expect(
      defineUploadPurpose(filePurpose({ maxBytes: MAX_UPLOAD_BYTES })).maxBytes,
    ).toBe(20_971_520);
  });

  test('ファイル用の用途で全用途の上限の最大値を1バイト超える上限を拒否する', () => {
    expect(() =>
      defineUploadPurpose(filePurpose({ maxBytes: MAX_UPLOAD_BYTES + 1 })),
    ).toThrow(UploadPurposeError);
  });

  test('画像用の用途は画像用の上限の最大値ちょうどを受け付ける', () => {
    expect(
      defineUploadPurpose(imagePurpose({ maxBytes: IMAGE_STORAGE_MAX_BYTES }))
        .maxBytes,
    ).toBe(20_000_000);
  });

  test('画像用の用途で画像用の上限の最大値を1バイト超える上限を拒否する', () => {
    expect(() =>
      defineUploadPurpose(
        imagePurpose({ maxBytes: IMAGE_STORAGE_MAX_BYTES + 1 }),
      ),
    ).toThrow(UploadPurposeError);
  });

  test('1バイトの上限を受け付ける', () => {
    expect(defineUploadPurpose(filePurpose({ maxBytes: 1 })).maxBytes).toBe(1);
  });

  test.each([
    ['0', 0],
    ['負の値', -1],
    ['整数でない値', 1.5],
    ['NaN', Number.NaN],
    ['無限大', Number.POSITIVE_INFINITY],
  ])('上限が%sの定義を拒否する', (_label, maxBytes) => {
    expect(() => defineUploadPurpose(filePurpose({ maxBytes }))).toThrow(
      UploadPurposeError,
    );
  });

  test('違反の例外は用途の名前を含むメッセージを持つ', () => {
    expect(() => defineUploadPurpose(imagePurpose({ maxBytes: 0 }))).toThrow(
      /product-logo/u,
    );
  });
});

describe('createUploadPurposeRegistry', () => {
  test('登録した用途を名前で引ける', () => {
    const logo = defineUploadPurpose(imagePurpose());
    const attachment = defineUploadPurpose(filePurpose());
    const registry = createUploadPurposeRegistry([logo, attachment]);

    expect(registry.find('product-logo')).toBe(logo);
    expect(registry.find('inquiry-attachment')).toBe(attachment);
  });

  test.each(['user-avatar', '', 'constructor', '__proto__', 'Product-logo'])(
    '登録していない名前%pはundefinedになる',
    (name) => {
      const registry = createUploadPurposeRegistry([
        defineUploadPurpose(imagePurpose()),
      ]);

      expect(registry.find(name)).toBeUndefined();
    },
  );

  test('一覧は登録した順の凍結された配列である', () => {
    const logo = defineUploadPurpose(imagePurpose());
    const attachment = defineUploadPurpose(filePurpose());
    const purposes = [attachment, logo];
    const registry = createUploadPurposeRegistry(purposes);

    purposes.pop();

    expect(registry.list()).toEqual([attachment, logo]);
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  test('空の登録表を作れる', () => {
    const registry = createUploadPurposeRegistry([]);

    expect(registry.list()).toEqual([]);
    expect(registry.find('product-logo')).toBeUndefined();
  });

  test('名前が重複する登録を拒否する', () => {
    expect(() =>
      createUploadPurposeRegistry([
        defineUploadPurpose(imagePurpose()),
        defineUploadPurpose(filePurpose({ name: 'product-logo' })),
      ]),
    ).toThrow(UploadPurposeError);
  });
});

describe('MEDIA_SMOKE_PURPOSE', () => {
  test('画像用の保存先に画像5形式を5MBまで受け付ける動作確認の用途である', () => {
    expect(MEDIA_SMOKE_PURPOSE).toEqual({
      name: 'media-smoke',
      storage: 'images',
      uploaderKinds: [],
      allowedTypes: IMAGE_MEDIA_TYPES,
      maxBytes: 5_242_880,
    });
  });

  test('主体の種類が空のため、定義の検証を通らない', () => {
    expect(() => defineUploadPurpose(MEDIA_SMOKE_PURPOSE)).toThrow(
      UploadPurposeError,
    );
  });

  test('定義と配列は凍結されている', () => {
    expect(Object.isFrozen(MEDIA_SMOKE_PURPOSE)).toBe(true);
    expect(Object.isFrozen(MEDIA_SMOKE_PURPOSE.uploaderKinds)).toBe(true);
    expect(Object.isFrozen(MEDIA_SMOKE_PURPOSE.allowedTypes)).toBe(true);
  });
});

describe('UploadPurposeError', () => {
  test('名前で他の例外と区別できるErrorである', () => {
    const error = new UploadPurposeError('違反');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UploadPurposeError');
  });
});
