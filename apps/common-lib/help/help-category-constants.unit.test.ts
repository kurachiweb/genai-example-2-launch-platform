import { describe, expect, test } from 'bun:test';

import { INQUIRY_CATEGORY_OTHER_ID } from '../inquiry/inquiry-category-constants.ts';
import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from './help-category-constants.ts';

describe('標準カテゴリ', () => {
  test('初期データの固定のULIDと名前「その他」を持つ', () => {
    expect({ HELP_CATEGORY_OTHER_ID, HELP_CATEGORY_OTHER_NAME }).toEqual({
      HELP_CATEGORY_OTHER_ID: '01JC0000000000000000000001',
      HELP_CATEGORY_OTHER_NAME: 'その他',
    });
  });

  test('問い合わせカテゴリの標準カテゴリとIDが重ならない', () => {
    expect(HELP_CATEGORY_OTHER_ID).not.toBe(INQUIRY_CATEGORY_OTHER_ID);
  });
});
