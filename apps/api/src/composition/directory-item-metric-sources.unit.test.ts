import { describe, expect, test } from 'bun:test';

import { assertItemMetricRegistrations } from '../application/directory/item-metric-sources.ts';
import { DIRECTORY_ITEM_METRIC_SOURCES } from './directory-item-metric-sources.ts';

describe('一覧の項目の値の供給元の登録口', () => {
  test('初版の登録口は空である', () => {
    expect(DIRECTORY_ITEM_METRIC_SOURCES).toStrictEqual([]);
  });

  test('登録は<spec名>.<名詞句>の名前・order・keyが重複せず、orderは整数である', () => {
    expect(() => {
      assertItemMetricRegistrations(DIRECTORY_ITEM_METRIC_SOURCES);
    }).not.toThrow();
  });
});
