import { describe, expect, test } from 'bun:test';

import {
  RESERVED_FIELD_NAMES,
  reservedFieldNamePathsOf,
} from './reserved-field-names.ts';

class Attachment {
  readonly type = 'image/png';
  readonly message = '添付';
}

describe('RESERVED_FIELD_NAMES', () => {
  test('欄のエラーの末端の判定に使う名前を持つ', () => {
    expect(RESERVED_FIELD_NAMES).toEqual(['type', 'message', 'types', 'ref']);
  });
});

describe('reservedFieldNamePathsOf', () => {
  test('予約された名前が無ければ空の配列を返す', () => {
    expect(
      reservedFieldNamePathsOf({
        title: '',
        maker: { name: '' },
        links: [{ url: '' }],
      }),
    ).toEqual([]);
  });

  test.each(RESERVED_FIELD_NAMES)(
    '欄をまとめた値のキーが%sなら、その経路を返す',
    (name) => {
      expect(
        reservedFieldNamePathsOf({ contact: { [name]: '', email: '' } }),
      ).toEqual([`contact.${name}`]);
    },
  );

  test('深い入れ子と一覧の要素のキーの経路を、値の順に返す', () => {
    expect(
      reservedFieldNamePathsOf({
        profile: { contact: { ref: '', types: [] } },
        links: [{ url: '' }, { url: '', message: '' }],
      }),
    ).toEqual([
      'profile.contact.ref',
      'profile.contact.types',
      'links.1.message',
    ]);
  });

  test('予約された名前のキーの値の中も調べる', () => {
    expect(
      reservedFieldNamePathsOf({ contact: { type: { message: '' } } }),
    ).toEqual(['contact.type', 'contact.type.message']);
  });

  test('最上位のキーは返さず、その値の中のキーは返す', () => {
    expect(
      reservedFieldNamePathsOf({
        type: { message: '' },
        message: '',
        types: [],
        ref: '',
      }),
    ).toEqual(['type.message']);
  });

  test('配列の値の要素(文字列の一覧)は返さない', () => {
    expect(
      reservedFieldNamePathsOf({ tags: ['type', 'message', 'types', 'ref'] }),
    ).toEqual([]);
  });

  test('DateやFile、クラスのインスタンスのように欄の値として扱う値の中へは入らない', () => {
    expect(
      reservedFieldNamePathsOf({
        schedule: { startsAt: new Date(0) },
        upload: {
          file: new File([''], 'logo.png', { type: 'image/png' }),
          attachment: new Attachment(),
        },
      }),
    ).toEqual([]);
  });

  test('プロトタイプがnullの値も、react-hook-formと同じく入れ子の値として中を調べる', () => {
    const meta = Object.assign(Object.create(null) as Record<string, string>, {
      type: 'launch',
    });

    expect(reservedFieldNamePathsOf({ product: { meta } })).toEqual([
      'product.meta.type',
    ]);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'type'],
  ])('既定値が%sなら空の配列を返す', (_label, defaultValues) => {
    expect(reservedFieldNamePathsOf(defaultValues)).toEqual([]);
  });
});
