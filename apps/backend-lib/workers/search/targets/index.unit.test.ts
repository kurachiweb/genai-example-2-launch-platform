import { describe, expect, test } from 'bun:test';

import { SEARCH_INDEXES } from '../../../../db/search/search-indexes.ts';
import { createSearchTargetRegistry } from '../search-target-definition.ts';
import { SEARCH_TARGETS } from './index.ts';

describe('SEARCH_TARGETS', () => {
  test('全ての検索対象の登録に成功する', () => {
    const registry = createSearchTargetRegistry(SEARCH_TARGETS);

    expect(registry.names()).toEqual(
      SEARCH_TARGETS.map((definition) => definition.name),
    );
  });

  test('全ての検索対象の索引の定義が、マイグレーションとの突き合わせを受ける索引の定義の集約点にある', () => {
    const missing = SEARCH_TARGETS.filter(
      (definition) => !SEARCH_INDEXES.includes(definition.index),
    ).map((definition) => definition.name);

    expect(missing).toEqual([]);
  });
});
