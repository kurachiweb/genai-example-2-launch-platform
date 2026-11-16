import { describe, expect, test } from 'bun:test';

import { ENGAGEMENT_TYPES } from '../application/engagement/engagement-types.ts';
import { assertItemMetricRegistrations } from '../application/directory/item-metric-sources.ts';
import { DIRECTORY_ITEM_METRIC_SOURCES } from './directory-item-metric-sources.ts';

describe('一覧の項目の値の供給元の登録口', () => {
  test('エンゲージメントのコメント数をkeyのcommentsで登録する', () => {
    expect(DIRECTORY_ITEM_METRIC_SOURCES).toStrictEqual([
      {
        name: 'engagement.comment-count',
        order: 10,
        key: 'comments',
        source: ENGAGEMENT_TYPES.CommentCountMetricSource,
      },
    ]);
  });

  test('登録は<spec名>.<名詞句>の名前・order・keyが重複せず、orderは整数である', () => {
    expect(() => {
      assertItemMetricRegistrations(DIRECTORY_ITEM_METRIC_SOURCES);
    }).not.toThrow();
  });
});
