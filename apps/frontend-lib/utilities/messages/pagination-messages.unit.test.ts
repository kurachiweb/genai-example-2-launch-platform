import { describe, expect, test } from 'bun:test';

import { NEXT_PAGE_LABEL, PREVIOUS_PAGE_LABEL } from './pagination-messages.ts';

describe('ページ送りの文言', () => {
  test('前後のページへの操作は「前へ」「次へ」で、句点の無い体言止めにする', () => {
    expect([PREVIOUS_PAGE_LABEL, NEXT_PAGE_LABEL]).toStrictEqual([
      '前へ',
      '次へ',
    ]);
  });
});
