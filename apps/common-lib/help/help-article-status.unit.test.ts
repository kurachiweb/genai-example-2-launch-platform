import { describe, expect, test } from 'bun:test';

import {
  HELP_ARTICLE_STATUS_LABELS,
  HELP_ARTICLE_STATUSES,
} from './help-article-status.ts';

describe('ヘルプ記事のステータス', () => {
  test('下書き・公開の順に並び、書き換えられない', () => {
    expect(HELP_ARTICLE_STATUSES).toEqual(['draft', 'published']);
    expect(Object.isFrozen(HELP_ARTICLE_STATUSES)).toBe(true);
  });

  test('各ステータスの表示名を持ち、書き換えられない', () => {
    expect(HELP_ARTICLE_STATUS_LABELS).toEqual({
      draft: '下書き',
      published: '公開',
    });
    expect(Object.isFrozen(HELP_ARTICLE_STATUS_LABELS)).toBe(true);
  });
});
