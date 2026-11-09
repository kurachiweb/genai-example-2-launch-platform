import { describe, expect, test } from 'bun:test';

import type { MyProductEditView } from '../../graphql/my-products.ts';
import {
  EMPTY_PRODUCT_FORM_VALUES,
  editProductFormDefaultsOf,
  toUpdateProductInput,
} from './product-form-values.ts';

const PRODUCT: MyProductEditView = {
  handle: 'pitch-notes',
  previousHandle: null,
  name: 'Pitch Notes',
  tagline: 'ピッチの台本を整える',
  category: {
    id: '01JD0CATEGORY0000000000001',
    name: '開発ツール',
    handle: 'dev-tools',
    systemDefault: false,
  },
  websiteUrl: 'https://pitch.example/',
  description: '本文',
  logoFileId: '01JD0FILE00000000000000001',
  logo: null,
  screenshots: [
    { fileId: '01JD0FILE00000000000000002', image: null, byteSize: 1024 },
    { fileId: '01JD0FILE00000000000000003', image: null, byteSize: 2048 },
  ],
  hidden: false,
  listed: false,
  latestLaunch: null,
  plan: {
    mode: 'reschedule',
    currentLaunchDate: '2026-11-20',
    window: {
      earliest: '2026-11-11',
      latest: '2027-02-07',
      unavailable: [],
      relaunchIntervalDays: null,
    },
    blocks: [],
    locked: false,
    locks: [],
    lockUnknown: false,
    ultrasEntitled: false,
  },
  version: 7,
};

const EDITED_FIELDS = Object.freeze({
  name: 'Pitch Notes 2',
  tagline: '台本を磨く',
  categoryId: '01JD0CATEGORY0000000000002',
  handle: 'pitch-notes-2',
  websiteUrl: 'https://pitch2.example/',
  description: '新しい本文',
  logoFileId: '01JD0FILE00000000000000009',
  screenshotFileIds: [],
});

// 無効にしたカテゴリの欄は送る値から外れるため、その形の値を作る
const withoutCategory = <T extends { categoryId?: string }>(
  fields: T,
): Omit<T, 'categoryId'> => {
  const copy: { -readonly [K in keyof T]?: T[K] } = { ...fields };
  delete copy.categoryId;
  return copy as Omit<T, 'categoryId'>;
};

describe('EMPTY_PRODUCT_FORM_VALUES', () => {
  test('登録のフォームの全欄を空の値で持つ', () => {
    expect(EMPTY_PRODUCT_FORM_VALUES).toEqual({
      fields: {
        name: '',
        tagline: '',
        categoryId: '',
        handle: '',
        websiteUrl: '',
        description: '',
        logoFileId: null,
        screenshotFileIds: [],
      },
      launchDate: null,
    });
  });
});

describe('editProductFormDefaultsOf', () => {
  test('読み込んだプロダクトの値を欄の名前どおりに並べ、予定のローンチ日を選択済みにする', () => {
    expect(editProductFormDefaultsOf(PRODUCT)).toEqual({
      fields: {
        name: 'Pitch Notes',
        tagline: 'ピッチの台本を整える',
        categoryId: '01JD0CATEGORY0000000000001',
        handle: 'pitch-notes',
        websiteUrl: 'https://pitch.example/',
        description: '本文',
        logoFileId: '01JD0FILE00000000000000001',
        screenshotFileIds: [
          '01JD0FILE00000000000000002',
          '01JD0FILE00000000000000003',
        ],
      },
      launchDate: '2026-11-20',
    });
  });

  test('予定のローンチ日を変更する計画でなければ、ローンチ日を未選択にする', () => {
    const product: MyProductEditView = {
      ...PRODUCT,
      plan: { ...PRODUCT.plan, mode: 'new', currentLaunchDate: null },
    };

    expect(editProductFormDefaultsOf(product).launchDate).toBeNull();
  });
});

describe('toUpdateProductInput', () => {
  test('編集画面を開いたハンドルと読み込んだ版を足し、選んだローンチ日を送る', () => {
    expect(
      toUpdateProductInput(
        { fields: EDITED_FIELDS, launchDate: '2026-11-25' },
        PRODUCT,
      ),
    ).toEqual({
      productHandle: 'pitch-notes',
      expectedVersion: 7,
      fields: EDITED_FIELDS,
      launchDate: '2026-11-25',
    });
  });

  test('無効にしたカテゴリは読み込んだカテゴリを、ローンチ日の欄が無ければnullを送る', () => {
    const fields = withoutCategory(EDITED_FIELDS);

    expect(toUpdateProductInput({ fields }, PRODUCT)).toEqual({
      productHandle: 'pitch-notes',
      expectedVersion: 7,
      fields: { ...fields, categoryId: '01JD0CATEGORY0000000000001' },
      launchDate: null,
    });
  });

  test('次回のローンチを予約しない(未選択)ならnullを送る', () => {
    expect(
      toUpdateProductInput({ fields: EDITED_FIELDS, launchDate: null }, PRODUCT)
        .launchDate,
    ).toBeNull();
  });
});
