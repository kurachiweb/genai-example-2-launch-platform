import { describe, expect, test } from 'bun:test';

import { withConditions } from '../../../common-lib/directory/directory-query-rules.ts';
import { directoryHref } from './directory-href.ts';

describe('directoryHref', () => {
  test('条件が無ければディレクトリのパスだけを返す', () => {
    expect(directoryHref({})).toBe('/p');
  });

  test('既定の値の項目を省き、指定された条件だけをクエリにする', () => {
    expect(
      directoryHref(
        withConditions(
          { q: 'note', from: '2026-09-01', sort: 'upvotes', page: 3 },
          { category: 'developer-tools' },
        ),
      ),
    ).toBe('/p?q=note&category=developer-tools&from=2026-09-01&sort=upvotes');
  });

  test('数として読める検索語は、ルーターと同じく文字列のまま読み戻せる表記にする', () => {
    expect(directoryHref({ q: '123' })).toBe('/p?q=%22123%22');
  });
});
