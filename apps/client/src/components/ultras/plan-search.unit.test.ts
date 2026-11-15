import { describe, expect, test } from 'bun:test';

import { PORTAL_RETURNED, toPlanSearch } from './plan-search.ts';

describe('toPlanSearch', () => {
  test('Customer Portalから戻った印を受け取り、他の検索パラメータを持たない', () => {
    expect(
      toPlanSearch({ portal: 'returned', utm_source: 'mail' }),
    ).toStrictEqual({ portal: PORTAL_RETURNED });
  });

  test('印が無ければ、値の無い項目にする', () => {
    expect(toPlanSearch({})).toStrictEqual({ portal: undefined });
  });

  test.each([
    ['空の文字列', ''],
    ['文字列でない値', 1],
    ['戻った印でない値', 'opened'],
    ['大文字の値', 'RETURNED'],
  ])(
    '%sは、URLの元の値を残さないよう値の無い項目で上書きする',
    (_label, value) => {
      expect(toPlanSearch({ portal: value })).toStrictEqual({
        portal: undefined,
      });
    },
  );
});
