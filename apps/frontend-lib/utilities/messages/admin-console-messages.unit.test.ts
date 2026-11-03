import { describe, expect, test } from 'bun:test';

import {
  ADMIN_FILTER_LABEL,
  ADMIN_PAGINATION_LABEL,
  APPLY_FILTER_LABEL,
  NEXT_PAGE_LABEL,
  PREVIOUS_PAGE_LABEL,
  RESET_FILTER_LABEL,
} from './admin-console-messages.ts';

const LABELS = [
  ADMIN_PAGINATION_LABEL,
  PREVIOUS_PAGE_LABEL,
  NEXT_PAGE_LABEL,
  ADMIN_FILTER_LABEL,
  APPLY_FILTER_LABEL,
  RESET_FILTER_LABEL,
];

describe('管理画面の共通部品の文言', () => {
  test('ページ送りと絞り込みの名前と操作は、この部品で定めた文言のまま変わらない', () => {
    expect(LABELS).toStrictEqual([
      'ページ送り',
      '前へ',
      '次へ',
      '絞り込み',
      '適用',
      '解除',
    ]);
  });

  test('名前と操作は句点の無い体言止めにする', () => {
    for (const label of LABELS) {
      expect(label).not.toMatch(/(?:。|です|ます)$/u);
    }
  });

  test('同じ領域に並ぶ操作の名前は互いに異なる', () => {
    expect(PREVIOUS_PAGE_LABEL).not.toBe(NEXT_PAGE_LABEL);
    expect(APPLY_FILTER_LABEL).not.toBe(RESET_FILTER_LABEL);
  });
});
