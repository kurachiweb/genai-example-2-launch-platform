import { describe, expect, test } from 'bun:test';

import { withConditions } from '../../../common-lib/directory/directory-query-rules.ts';
import { directoryHref, directoryPageHref } from './directory-href.ts';

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

describe('directoryPageHref', () => {
  test('他の条件を保ったまま、ページだけを変えたURLを返す', () => {
    expect(
      directoryPageHref(
        { q: 'note', category: 'developer-tools', sort: 'upvotes', page: 3 },
        4,
      ),
    ).toBe('/p?q=note&category=developer-tools&sort=upvotes&page=4');
  });

  test('1ページ目はクエリから`page`を外す', () => {
    expect(directoryPageHref({ category: 'developer-tools', page: 2 }, 1)).toBe(
      '/p?category=developer-tools',
    );
    expect(directoryPageHref({}, 1)).toBe('/p');
  });

  test('既定の値の項目を省く規則は条件の変更と同じにする', () => {
    expect(directoryPageHref({ sort: 'newest' }, 2)).toBe('/p?page=2');
  });
});
