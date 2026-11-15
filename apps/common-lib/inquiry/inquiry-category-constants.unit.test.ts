import { describe, expect, test } from 'bun:test';

import {
  INQUIRY_CATEGORY_OTHER_ID,
  INQUIRY_CATEGORY_OTHER_NAME,
} from './inquiry-category-constants.ts';

describe('標準カテゴリ', () => {
  test('初期データの固定のULIDと名前「その他」を持つ', () => {
    expect({ INQUIRY_CATEGORY_OTHER_ID, INQUIRY_CATEGORY_OTHER_NAME }).toEqual({
      INQUIRY_CATEGORY_OTHER_ID: '01JC0000000000000000000000',
      INQUIRY_CATEGORY_OTHER_NAME: 'その他',
    });
  });
});
